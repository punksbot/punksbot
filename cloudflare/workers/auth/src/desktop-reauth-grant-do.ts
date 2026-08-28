import { DurableObject } from "cloudflare:workers";

import type { AuthEnv } from "./env";

export type DesktopReauthTarget =
  | "link_google"
  | "link_github"
  | "transfer_workspace_ownership";

/** Immutable Workspace coordinates confirmed by one strong reauthentication. */
export interface WorkspaceOwnershipTransferBinding {
  workspaceId: string;
  targetPunkId: string;
  expectedRevision: number;
}

interface DesktopReauthGrantRecord {
  authorizationId: string;
  sessionId: string;
  punkId: string;
  targetMethod: DesktopReauthTarget;
  workspaceOwnershipTransfer: WorkspaceOwnershipTransferBinding | null;
  handoffId: string;
  expiresAt: string;
  consumedByFlowId: string | null;
}

function validTarget(value: unknown): value is DesktopReauthTarget {
  return (
    value === "link_google" ||
    value === "link_github" ||
    value === "transfer_workspace_ownership"
  );
}

const RECORD_KEY = "desktop_reauth_grant_v1";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function validWorkspaceOwnershipTransferBinding(
  value: WorkspaceOwnershipTransferBinding | null | undefined,
): boolean {
  return (
    value !== null &&
    value !== undefined &&
    UUID.test(value.workspaceId) &&
    UUID.test(value.targetPunkId) &&
    Number.isSafeInteger(value.expectedRevision) &&
    value.expectedRevision >= 1
  );
}

function sameWorkspaceOwnershipTransferBinding(
  left: WorkspaceOwnershipTransferBinding | null | undefined,
  right: WorkspaceOwnershipTransferBinding | null | undefined,
): boolean {
  const leftMissing = left === null || left === undefined;
  const rightMissing = right === null || right === undefined;
  return leftMissing || rightMissing
    ? leftMissing && rightMissing
    : left.workspaceId === right.workspaceId &&
        left.targetPunkId === right.targetPunkId &&
        left.expectedRevision === right.expectedRevision;
}

function sameGrant(
  left: Omit<DesktopReauthGrantRecord, "consumedByFlowId">,
  right: Omit<DesktopReauthGrantRecord, "consumedByFlowId">,
): boolean {
  return (
    left.authorizationId === right.authorizationId &&
    left.sessionId === right.sessionId &&
    left.punkId === right.punkId &&
    left.targetMethod === right.targetMethod &&
    sameWorkspaceOwnershipTransferBinding(
      left.workspaceOwnershipTransfer,
      right.workspaceOwnershipTransfer,
    ) &&
    left.handoffId === right.handoffId &&
    left.expiresAt === right.expiresAt
  );
}

/** Five-minute, target-bound authorization created only by reauth confirm. */
export class DesktopReauthGrantDO extends DurableObject<AuthEnv> {
  async create(
    input: Omit<DesktopReauthGrantRecord, "consumedByFlowId">,
  ): Promise<boolean> {
    if (
      !validTarget(input.targetMethod) ||
      (input.targetMethod === "transfer_workspace_ownership") !==
        validWorkspaceOwnershipTransferBinding(
          input.workspaceOwnershipTransfer,
        ) ||
      (input.targetMethod !== "transfer_workspace_ownership" &&
        input.workspaceOwnershipTransfer !== null)
    ) {
      return false;
    }
    const existing = await this.read();
    if (existing !== null) {
      return sameGrant(existing, input);
    }
    if (Date.parse(input.expiresAt) <= Date.now()) return false;
    const record: DesktopReauthGrantRecord = {
      ...input,
      consumedByFlowId: null,
    };
    let indexed = false;
    try {
      indexed = await this.env.PUNKS.getByName(
        input.punkId,
      ).recordAccountMergeHandoff({
        handoffId: input.authorizationId,
        punkId: input.punkId,
        kind: "reauth-authorization",
        state: "deliverable",
        expiresAt: input.expiresAt,
      });
    } catch {
      return false;
    }
    if (!indexed) return false;
    await this.ctx.storage.put(RECORD_KEY, record);
    this.ctx.waitUntil(this.ctx.storage.setAlarm(Date.parse(input.expiresAt)));
    return true;
  }

  /** Spends this grant once, after revalidating its confirmed OAuth source. */
  async consume(input: {
    authorizationId: string;
    sessionId: string;
    punkId: string;
    targetMethod: DesktopReauthTarget;
    workspaceOwnershipTransfer: WorkspaceOwnershipTransferBinding | null;
    flowId: string;
  }): Promise<
    | { ok: true; replayed: boolean; authenticationMethod: "google" | "github" }
    | {
        ok: false;
        code: "missing" | "expired" | "binding_mismatch" | "consumed";
      }
  > {
    if (!validTarget(input.targetMethod))
      return { ok: false, code: "binding_mismatch" };
    const record = await this.read();
    if (record === null) return { ok: false, code: "missing" };
    if (Date.parse(record.expiresAt) <= Date.now()) {
      await this.remove(record);
      return { ok: false, code: "expired" };
    }
    if (
      record.authorizationId !== input.authorizationId ||
      record.sessionId !== input.sessionId ||
      record.punkId !== input.punkId ||
      record.targetMethod !== input.targetMethod ||
      !sameWorkspaceOwnershipTransferBinding(
        record.workspaceOwnershipTransfer,
        input.workspaceOwnershipTransfer,
      )
    ) {
      return { ok: false, code: "binding_mismatch" };
    }
    const authenticationMethod = await this.oauthSource(record);
    if (authenticationMethod === null) return { ok: false, code: "missing" };
    // The source RPC permits interleaving. Re-read and claim atomically so two
    // consumers cannot both spend the same authorization after that await.
    const result = this.ctx.storage.transactionSync(() => {
      const current =
        this.ctx.storage.kv.get<DesktopReauthGrantRecord>(RECORD_KEY);
      if (current === undefined || !sameGrant(current, record)) {
        return { ok: false, code: "missing" } as const;
      }
      if (Date.parse(current.expiresAt) <= Date.now()) {
        return { ok: false, code: "expired" } as const;
      }
      if (current.consumedByFlowId !== null) {
        return current.consumedByFlowId === input.flowId
          ? ({ ok: true, replayed: true, authenticationMethod } as const)
          : ({ ok: false, code: "consumed" } as const);
      }
      this.ctx.storage.kv.put(RECORD_KEY, {
        ...current,
        consumedByFlowId: input.flowId,
      });
      return { ok: true, replayed: false, authenticationMethod } as const;
    });
    if (!result.ok) return result;
    await this.env.PUNKS.getByName(record.punkId).removeAccountMergeHandoff(
      record.authorizationId,
    );
    return result;
  }

  /** Account-merge planning revalidates the live grant at its source. */
  async readForAccountMerge(): Promise<{
    punkId: string;
    kind: "reauth-authorization";
    state: "deliverable";
    expiresAt: string;
  } | null> {
    const record = await this.read();
    if (
      record === null ||
      record.consumedByFlowId !== null ||
      Date.parse(record.expiresAt) <= Date.now() ||
      (await this.oauthSource(record)) === null
    ) {
      return null;
    }
    return {
      punkId: record.punkId,
      kind: "reauth-authorization",
      state: "deliverable",
      expiresAt: record.expiresAt,
    };
  }

  /** Cancels this exact unconsumed authorization during merge roll-forward. */
  async cancelForAccountMerge(input: {
    handoffId: string;
    punkId: string;
    kind: "reauth-authorization";
    state: "deliverable";
    expiresAt: string;
  }): Promise<boolean> {
    const current = await this.readForAccountMerge();
    if (current === null) return true;
    if (
      input.handoffId !== this.ctx.id.name ||
      current.punkId !== input.punkId ||
      current.kind !== input.kind ||
      current.state !== input.state ||
      current.expiresAt !== input.expiresAt
    ) {
      return false;
    }
    const record = await this.read();
    if (record === null) return true;
    await this.remove(record);
    return (await this.readForAccountMerge()) === null;
  }

  override async alarm(): Promise<void> {
    const record = await this.read();
    if (record !== null) await this.remove(record);
  }

  private async remove(record: DesktopReauthGrantRecord): Promise<void> {
    await this.env.PUNKS.getByName(record.punkId).removeAccountMergeHandoff(
      record.authorizationId,
    );
    await this.ctx.storage.deleteAll();
  }

  private async oauthSource(
    record: DesktopReauthGrantRecord,
  ): Promise<"google" | "github" | null> {
    const flow = await this.env.DESKTOP_AUTH_FLOWS.getByName(
      record.handoffId,
    ).browserMetadata();
    if (
      flow === null ||
      flow.intent !== "reauthenticate" ||
      (flow.method !== "google" && flow.method !== "github") ||
      flow.flowId !== record.handoffId ||
      flow.currentSessionId !== record.sessionId ||
      flow.currentPunkId !== record.punkId ||
      flow.purpose !== record.targetMethod ||
      flow.authorizationId !== record.authorizationId ||
      flow.authorizationExpiresAt !== record.expiresAt ||
      !sameWorkspaceOwnershipTransferBinding(
        flow.workspaceOwnershipTransfer,
        record.workspaceOwnershipTransfer,
      )
    ) {
      await this.remove(record);
      return null;
    }
    // Confirm seals the grant immediately before confirming its source flow.
    // Preserve that intermediate record, but do not let it authorize an action.
    return flow.phase === "confirmed" ? flow.method : null;
  }

  private async read(): Promise<DesktopReauthGrantRecord | null> {
    const record =
      (await this.ctx.storage.get<DesktopReauthGrantRecord>(RECORD_KEY)) ??
      null;
    if (record !== null && !validTarget(record.targetMethod)) {
      await this.remove(record);
      return null;
    }
    return record;
  }
}

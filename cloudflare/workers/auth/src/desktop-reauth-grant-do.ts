import { DurableObject } from "cloudflare:workers";

import type { AuthEnv } from "./env";

export type DesktopReauthTarget =
  | "link_google"
  | "link_github"
  | "register_passkey"
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

/** Five-minute, target-bound authorization created only by reauth confirm. */
export class DesktopReauthGrantDO extends DurableObject<AuthEnv> {
  async create(
    input: Omit<DesktopReauthGrantRecord, "consumedByFlowId">,
  ): Promise<boolean> {
    if (
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
      return (
        existing.authorizationId === input.authorizationId &&
        existing.sessionId === input.sessionId &&
        existing.punkId === input.punkId &&
        existing.targetMethod === input.targetMethod &&
        sameWorkspaceOwnershipTransferBinding(
          existing.workspaceOwnershipTransfer,
          input.workspaceOwnershipTransfer,
        ) &&
        existing.handoffId === input.handoffId &&
        existing.expiresAt === input.expiresAt
      );
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

  async consume(input: {
    authorizationId: string;
    sessionId: string;
    punkId: string;
    targetMethod: DesktopReauthTarget;
    workspaceOwnershipTransfer: WorkspaceOwnershipTransferBinding | null;
    flowId: string;
  }): Promise<
    | { ok: true; replayed: boolean }
    | {
        ok: false;
        code: "missing" | "expired" | "binding_mismatch" | "consumed";
      }
  > {
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
    if (record.consumedByFlowId !== null) {
      return record.consumedByFlowId === input.flowId
        ? { ok: true, replayed: true }
        : { ok: false, code: "consumed" };
    }
    record.consumedByFlowId = input.flowId;
    await this.ctx.storage.put(RECORD_KEY, record);
    await this.env.PUNKS.getByName(record.punkId).removeAccountMergeHandoff(
      record.authorizationId,
    );
    return { ok: true, replayed: false };
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
      Date.parse(record.expiresAt) <= Date.now()
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

  private async read(): Promise<DesktopReauthGrantRecord | null> {
    return (
      (await this.ctx.storage.get<DesktopReauthGrantRecord>(RECORD_KEY)) ?? null
    );
  }
}

import { WorkerEntrypoint } from "cloudflare:workers";

import type { ApiEnv } from "./env";
import type { WorkspaceAccountMergeResult } from "./workspace-do";

/** Exact capability passed only to the private Account Merge applicator. */
export type AccountMergeWorkspaceServiceProps = {
  role: "punks-account-merge-workspace-applicator";
  environment: "local" | "staging" | "production";
};

type BatchItemResult =
  | WorkspaceAccountMergeResult
  | { ok: true; workspaceId: string; aborted: true };

type BatchResult =
  | { ok: true; results: BatchItemResult[] }
  | {
      ok: false;
      code: "invalid_request" | "authority_unavailable";
      failedIndex: number | null;
      results: BatchItemResult[];
    };

function privateNotFound(): Response {
  return new Response(null, {
    status: 404,
    headers: { "cache-control": "no-store" },
  });
}

/** Exact private batch boundary; each Workspace remains its own authority. */
export class AccountMergeWorkspaceService extends WorkerEntrypoint<
  ApiEnv,
  AccountMergeWorkspaceServiceProps
> {
  /** Refuses HTTP access so Account Merge can only use typed service RPC. */
  override fetch(): Response {
    return privateNotFound();
  }

  /** Prepares bounded Workspace membership fences before the terminal receipt. */
  async prepare(input: unknown): Promise<BatchResult> {
    return this.run(input, "prepare");
  }

  /** Applies bounded Workspace membership transfers after the terminal receipt. */
  async apply(input: unknown): Promise<BatchResult> {
    return this.run(input, "apply");
  }

  /** Releases bounded Workspace fences while the merge remains reversible. */
  async abort(input: unknown): Promise<BatchResult> {
    return this.run(input, "abort");
  }

  private allowed(): boolean {
    const props = this.ctx.props;
    return (
      typeof props === "object" &&
      props !== null &&
      !Array.isArray(props) &&
      Object.keys(props).sort().join(",") === "environment,role" &&
      props.role === "punks-account-merge-workspace-applicator" &&
      props.environment === this.env.ENVIRONMENT
    );
  }

  private async run(
    input: unknown,
    operation: "prepare" | "apply" | "abort",
  ): Promise<BatchResult> {
    if (
      !this.allowed() ||
      typeof input !== "object" ||
      input === null ||
      Array.isArray(input) ||
      Object.keys(input).join(",") !== "workspaces" ||
      !Array.isArray(Reflect.get(input, "workspaces"))
    ) {
      return {
        ok: false,
        code: "invalid_request",
        failedIndex: null,
        results: [],
      };
    }
    const workspaces = Reflect.get(input, "workspaces") as unknown[];
    if (workspaces.length === 0 || workspaces.length > 32) {
      return {
        ok: false,
        code: "invalid_request",
        failedIndex: null,
        results: [],
      };
    }
    const results: BatchItemResult[] = [];
    for (const [index, workspace] of workspaces.entries()) {
      const workspaceId =
        typeof workspace === "object" && workspace !== null
          ? Reflect.get(workspace, "workspaceId")
          : null;
      if (typeof workspaceId !== "string") {
        return {
          ok: false,
          code: "invalid_request",
          failedIndex: index,
          results,
        };
      }
      const authority = this.env.WORKSPACES.getByName(workspaceId);
      const result =
        operation === "prepare"
          ? await authority.prepareAccountMerge(workspace)
          : operation === "apply"
            ? await authority.applyAccountMerge(workspace)
            : (await authority.abortAccountMerge(workspace))
              ? { ok: true as const, workspaceId, aborted: true as const }
              : ({ ok: false, code: "idempotency_conflict" } as const);
      results.push(result);
      if (!result.ok) {
        return {
          ok: false,
          code: "authority_unavailable",
          failedIndex: index,
          results,
        };
      }
    }
    return { ok: true, results };
  }
}

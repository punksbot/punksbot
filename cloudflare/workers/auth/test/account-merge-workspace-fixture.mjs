import { WorkerEntrypoint } from "cloudflare:workers";

export class AccountMergeWorkspaceService extends WorkerEntrypoint {
  prepare(input) {
    return {
      ok: true,
      results: input.workspaces.map((workspace) => ({
        ok: true,
        workspaceId: workspace.workspaceId,
        prepared: true,
        replayed: false,
      })),
    };
  }

  apply(input) {
    return {
      ok: true,
      results: input.workspaces.map((workspace) => ({
        ok: true,
        workspaceId: workspace.workspaceId,
        role: workspace.resultingRole,
        revision: workspace.expectedRevision + 1,
        replayed: false,
      })),
    };
  }

  abort() {
    return { ok: true };
  }

  fetch() {
    return new Response(null, { status: 404 });
  }
}

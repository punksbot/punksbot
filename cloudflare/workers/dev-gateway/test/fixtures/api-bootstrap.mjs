import { WorkerEntrypoint } from "cloudflare:workers";

export class LocalDevApiBootstrapService extends WorkerEntrypoint {
  bootstrap() {
    return {
      ok: true,
      coordinates: {
        workspaceSlug: "local",
        workspaceId: "019913d8-1254-811e-8c0f-43aac49f3b22",
        conversationId: "019913d8-1254-811e-8c0f-43aac49f3b23",
      },
    };
  }
}

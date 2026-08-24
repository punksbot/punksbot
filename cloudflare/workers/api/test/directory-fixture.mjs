import { WorkerEntrypoint } from "cloudflare:workers";

export class ProjectionDirectoryService extends WorkerEntrypoint {
  fetch() {
    return new Response("Not found", { status: 404 });
  }

  listWorkspaceCandidates() {
    return [];
  }

  listConversationCandidates() {
    return [];
  }
}

export default {
  fetch() {
    return new Response("Not found", { status: 404 });
  },
};

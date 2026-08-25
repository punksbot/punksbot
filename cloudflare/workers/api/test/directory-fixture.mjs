import { WorkerEntrypoint } from "cloudflare:workers";

export class RuntimeIdentityService extends WorkerEntrypoint {
  async runtimeVersion() {
    return { versionId: "00000000-0000-4000-8000-000000000004" };
  }
}

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

  upsertPunkProfile() {
    return true;
  }

  searchPunkCandidates() {
    return [];
  }
}

export default {
  fetch() {
    return new Response("Not found", { status: 404 });
  },
};

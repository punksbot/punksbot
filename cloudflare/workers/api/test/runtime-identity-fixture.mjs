import { WorkerEntrypoint } from "cloudflare:workers";

/** Private runtime identity RPC fixture; deliberately has no fetch method. */
export class RuntimeIdentityService extends WorkerEntrypoint {
  async runtimeVersion() {
    return { versionId: "00000000-0000-4000-8000-000000000007" };
  }
}

export default {
  fetch() {
    return new Response("Not found", { status: 404 });
  },
};

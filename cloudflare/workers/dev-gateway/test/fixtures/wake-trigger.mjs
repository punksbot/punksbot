import { WorkerEntrypoint } from "cloudflare:workers";

export class BotWakeTriggerService extends WorkerEntrypoint {
  async offerWake() {
    return {
      ok: true,
      wakeId: "019913d8-1254-811e-8c0f-43aac49f3b14",
    };
  }
}

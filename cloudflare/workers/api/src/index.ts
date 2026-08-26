import type { ApiEnv } from "./env";
import { route } from "./router";

export { WorkspaceDO } from "./workspace-do";
export { WorkspaceSlugDO } from "./workspace-slug-do";
export { BotDO } from "./bot-do";
export { BotSlugDO } from "./bot-slug-do";
export { BotInstallationDO } from "./bot-installation-do";
export { ConversationDO } from "./conversation-do";
export { ConversationIdentityDO } from "./conversation-identity-do";
export { MessageContentDO } from "./message-content-do";
export { MediaUploadDO } from "./media-upload-do";
export { PresenceDO } from "./presence-do";
export { BotActionService } from "./bot-action-service";
export {
  BotHarnessService,
  BotWakeTriggerService,
} from "./bot-harness-service";
export { LocalDevApiBootstrapService } from "./local-dev-bootstrap";
export { AccountMergeWorkspaceService } from "./account-merge-workspace-service";

export default {
  fetch(request: Request, env: ApiEnv): Promise<Response> {
    return route(request, env);
  },
} satisfies ExportedHandler<ApiEnv>;

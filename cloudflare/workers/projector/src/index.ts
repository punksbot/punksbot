import type {
  BotInstallationProjectionEnvelope,
  BotProjectionEnvelope,
  ConversationProjectionMessageV2,
  ConversationProjectionMessage,
  MessageReactionProjectionEnvelope,
  MessageProjectionMessage,
  WorkspaceProjectionMessage,
  WorkspaceProjectionMessageV2,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import { WorkerEntrypoint } from "cloudflare:workers";

import { type AttestationRegistryEnv, verifyAttestation } from "./attestation";
import {
  isConsistentBotInstallationProjection,
  projectBotInstallationEnvelope,
} from "./bot-installation-projector";
import { isConsistentBotProjection, projectBotEnvelope } from "./bot-projector";
import {
  isConsistentMessageReactionProjection,
  projectMessageReactionEnvelope,
} from "./message-reaction-projector";
import {
  projectConversationMembershipProjection,
  projectWorkspaceMembershipProjection,
  validateConversationMembershipProjection,
  validateWorkspaceMembershipProjection,
} from "./membership-delta-projector";
import {
  projectMessageEnvelope,
  type ValidatedMessageProjectionEnvelope,
} from "./message-projector";
import {
  isConsistentConversationProjection,
  isConsistentWorkspaceProjection,
  projectConversation,
  projectWorkspace,
} from "./project";
import {
  globalProjectionDatabase,
  projectionDatabase,
  type ProjectionShardEnv,
} from "./shards";

/** Dedicated private probe for the version executing this Projector Worker. */
export class RuntimeIdentityService extends WorkerEntrypoint<CloudflareBindings> {
  override fetch(): Response {
    return new Response("Not found", {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }

  runtimeVersion(): { versionId: string } {
    return { versionId: this.env.CF_VERSION_METADATA.id };
  }
}

export { ProjectionDirectoryService } from "./directory-service";

type ProjectorEnv = CloudflareBindings &
  ProjectionShardEnv &
  AttestationRegistryEnv;

function hasSingleMessageTag(
  message: MessageProjectionMessage,
  name: string,
  expectedValue: string,
): boolean {
  const tags = message.event.tags.filter(([tagName]) => tagName === name);
  return tags.length === 1 && tags[0]?.[1] === expectedValue;
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => jsonValuesEqual(value, right[index]))
    );
  }
  if (
    typeof left !== "object" ||
    left === null ||
    typeof right !== "object" ||
    right === null
  ) {
    return false;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        jsonValuesEqual(Reflect.get(left, key), Reflect.get(right, key)),
    )
  );
}

function hasConsistentMessageTransition(
  message: MessageProjectionMessage,
): boolean {
  const { state, versionDelta } = message;
  if (message.event.kind === 50200) {
    return (
      state.status === "active" &&
      state.currentVersion === 1 &&
      state.retraction === null &&
      state.erasureMarker === null &&
      state.revision === 1 &&
      state.createdCursor === message.cursor &&
      versionDelta.operation === "upsert" &&
      versionDelta.version.version === 1 &&
      versionDelta.version.contentCommitment ===
        state.originalContentCommitment &&
      versionDelta.version.topicPresent === state.topicPresent
    );
  }
  if (message.event.kind === 50201) {
    return (
      state.status === "active" &&
      state.currentVersion !== null &&
      state.currentVersion >= 2 &&
      state.retraction === null &&
      state.erasureMarker === null &&
      state.createdCursor < message.cursor &&
      versionDelta.operation === "upsert" &&
      versionDelta.version.version === state.currentVersion &&
      versionDelta.version.topicPresent === state.topicPresent
    );
  }
  if (message.event.kind === 50202) {
    return (
      state.status === "retracted" &&
      state.currentVersion !== null &&
      state.retraction !== null &&
      state.erasureMarker === null &&
      state.createdCursor < message.cursor &&
      versionDelta.operation === "retain"
    );
  }
  if (message.event.kind === 50203) {
    return (
      state.status === "active" &&
      state.currentVersion !== null &&
      state.retraction === null &&
      state.erasureMarker === null &&
      state.createdCursor < message.cursor &&
      versionDelta.operation === "retain"
    );
  }
  return (
    message.event.kind === 50204 &&
    state.status === "erased" &&
    state.currentVersion === null &&
    state.retraction === null &&
    state.erasureMarker !== null &&
    state.createdCursor < message.cursor &&
    versionDelta.operation === "erase-all"
  );
}

function nonzeroCounterDelta(value: number): 1 | -1 | undefined {
  return value === 1 || value === -1 ? value : undefined;
}

/**
 * Verifies that a schema-valid Message projection is bound to its signed event
 * and to exactly one Workspace, Conversation, Message, and Conversation cursor.
 */
export function isConsistentMessageProjection(
  message: MessageProjectionMessage,
): boolean {
  const expectedContract =
    message.event.kind === 50200
      ? "message.post@1"
      : message.event.kind === 50201
        ? "message.edit@1"
        : message.event.kind === 50202
          ? "message.retract@1"
          : message.event.kind === 50203
            ? "message.restore@1"
            : message.event.kind === 50204
              ? "message.finalize-erasure@1"
              : null;
  if (
    expectedContract === null ||
    message.workspaceId !== message.state.workspaceId ||
    message.conversationId !== message.state.conversationId ||
    message.messageId !== message.state.id ||
    message.cursor !== message.state.cursor ||
    message.state.createdCursor > message.cursor ||
    !hasConsistentMessageTransition(message) ||
    message.threadDeltas.some(
      (delta) =>
        delta.cursor !== message.cursor ||
        (delta.replyCountDelta === 0 && delta.descendantCountDelta === 0),
    ) ||
    !hasSingleMessageTag(message, "workspace", message.workspaceId) ||
    !hasSingleMessageTag(message, "conversation", message.conversationId) ||
    !hasSingleMessageTag(message, "message", message.messageId) ||
    !hasSingleMessageTag(message, "cursor", String(message.cursor)) ||
    !hasSingleMessageTag(message, "contract", expectedContract)
  ) {
    return false;
  }

  try {
    const content = JSON.parse(message.event.content) as unknown;
    if (
      typeof content !== "object" ||
      content === null ||
      Reflect.get(content, "schemaVersion") !== 1 ||
      !("message" in content) ||
      !("versionDelta" in content)
    ) {
      return false;
    }
    const state = Reflect.get(content, "message") as unknown;
    const versionDelta = Reflect.get(content, "versionDelta") as unknown;
    return (
      jsonValuesEqual(state, message.state) &&
      jsonValuesEqual(versionDelta, message.versionDelta)
    );
  } catch {
    return false;
  }
}

export default {
  fetch(): Response {
    return Response.json(
      { code: "not_found", title: "This Worker is a private Queue consumer" },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  },

  async queue(
    batch: MessageBatch<unknown>,
    env: ProjectorEnv,
    _context: ExecutionContext,
  ): Promise<void> {
    for (const queued of batch.messages) {
      const botValidation = validateContract(
        "punks://contracts/bot.projection@1",
        queued.body,
      );
      if (botValidation.valid) {
        const message = queued.body as BotProjectionEnvelope;
        if (
          !(await verifyAttestation(message.event, env)) ||
          !isConsistentBotProjection(message)
        ) {
          console.error("bot_projection_invariant_rejected", {
            queueMessageId: queued.id,
            botId: message.botId,
          });
          queued.retry();
          continue;
        }
        try {
          await projectBotEnvelope(globalProjectionDatabase(env), message);
          queued.ack();
        } catch (error) {
          console.error("bot_projection_failed", {
            queueMessageId: queued.id,
            botId: message.botId,
            error: error instanceof Error ? error.message : "unknown",
          });
          queued.retry();
        }
        continue;
      }

      const installationValidation = validateContract(
        "punks://contracts/bot-installation.projection@1",
        queued.body,
      );
      if (installationValidation.valid) {
        const message = queued.body as BotInstallationProjectionEnvelope;
        if (
          !(await verifyAttestation(message.event, env)) ||
          !isConsistentBotInstallationProjection(message)
        ) {
          console.error("bot_installation_projection_invariant_rejected", {
            queueMessageId: queued.id,
            workspaceId: message.workspaceId,
            installationId: message.installationId,
          });
          queued.retry();
          continue;
        }
        try {
          const database = projectionDatabase(env, message.workspaceId);
          await projectBotInstallationEnvelope(database, message);
          queued.ack();
        } catch (error) {
          console.error("bot_installation_projection_failed", {
            queueMessageId: queued.id,
            workspaceId: message.workspaceId,
            installationId: message.installationId,
            error: error instanceof Error ? error.message : "unknown",
          });
          queued.retry();
        }
        continue;
      }

      const workspaceV2Validation = validateContract(
        "punks://contracts/workspace.projection@2",
        queued.body,
      );
      if (workspaceV2Validation.valid) {
        const message = queued.body as WorkspaceProjectionMessageV2;
        if (!(await verifyAttestation(message.event, env))) {
          console.error("workspace_membership_projection_invariant_rejected", {
            messageId: queued.id,
            workspaceId: message.workspaceId,
          });
          queued.retry();
          continue;
        }
        const validated = await validateWorkspaceMembershipProjection(message);
        if (validated === null) {
          console.error("workspace_membership_projection_invariant_rejected", {
            messageId: queued.id,
            workspaceId: message.workspaceId,
          });
          queued.retry();
          continue;
        }
        try {
          const database = projectionDatabase(env, message.workspaceId);
          await projectWorkspaceMembershipProjection(database, validated);
          queued.ack();
        } catch (error) {
          console.error("workspace_membership_projection_failed", {
            messageId: queued.id,
            workspaceId: message.workspaceId,
            error: error instanceof Error ? error.message : "unknown",
          });
          queued.retry();
        }
        continue;
      }

      const workspaceValidation = validateContract(
        "punks://contracts/workspace.projection@1",
        queued.body,
      );
      if (workspaceValidation.valid) {
        const message = queued.body as WorkspaceProjectionMessage;
        if (
          !(await verifyAttestation(message.event, env)) ||
          !isConsistentWorkspaceProjection(message)
        ) {
          console.error("projection_invariant_rejected", {
            messageId: queued.id,
          });
          queued.retry();
          continue;
        }
        try {
          const database = projectionDatabase(env, message.workspaceId);
          await projectWorkspace(database, message);
          queued.ack();
        } catch (error) {
          console.error("workspace_projection_failed", {
            messageId: queued.id,
            workspaceId: message.workspaceId,
            error: error instanceof Error ? error.message : "unknown",
          });
          queued.retry();
        }
        continue;
      }

      const conversationV2Validation = validateContract(
        "punks://contracts/conversation.projection@2",
        queued.body,
      );
      if (conversationV2Validation.valid) {
        const message = queued.body as ConversationProjectionMessageV2;
        if (!(await verifyAttestation(message.event, env))) {
          console.error(
            "conversation_membership_projection_invariant_rejected",
            {
              messageId: queued.id,
              workspaceId: message.workspaceId,
              conversationId: message.conversationId,
            },
          );
          queued.retry();
          continue;
        }
        const validated =
          await validateConversationMembershipProjection(message);
        if (validated === null) {
          console.error(
            "conversation_membership_projection_invariant_rejected",
            {
              messageId: queued.id,
              workspaceId: message.workspaceId,
              conversationId: message.conversationId,
            },
          );
          queued.retry();
          continue;
        }
        try {
          const database = projectionDatabase(env, message.workspaceId);
          await projectConversationMembershipProjection(database, validated);
          queued.ack();
        } catch (error) {
          console.error("conversation_membership_projection_failed", {
            messageId: queued.id,
            workspaceId: message.workspaceId,
            conversationId: message.conversationId,
            error: error instanceof Error ? error.message : "unknown",
          });
          queued.retry();
        }
        continue;
      }

      const conversationValidation = validateContract(
        "punks://contracts/conversation.projection@1",
        queued.body,
      );
      if (conversationValidation.valid) {
        const message = queued.body as ConversationProjectionMessage;
        if (
          !(await verifyAttestation(message.event, env)) ||
          !isConsistentConversationProjection(message)
        ) {
          console.error("projection_invariant_rejected", {
            messageId: queued.id,
          });
          queued.retry();
          continue;
        }
        try {
          const database = projectionDatabase(env, message.workspaceId);
          await projectConversation(database, message);
          queued.ack();
        } catch (error) {
          console.error("conversation_projection_failed", {
            messageId: queued.id,
            workspaceId: message.workspaceId,
            error: error instanceof Error ? error.message : "unknown",
          });
          queued.retry();
        }
        continue;
      }

      const reactionValidation = validateContract(
        "punks://contracts/message-reaction.projection@1",
        queued.body,
      );
      if (reactionValidation.valid) {
        const message = queued.body as MessageReactionProjectionEnvelope;
        if (
          !(await verifyAttestation(message.event, env)) ||
          !isConsistentMessageReactionProjection(message)
        ) {
          console.error("projection_invariant_rejected", {
            queueMessageId: queued.id,
            workspaceId: message.workspaceId,
            conversationId: message.conversationId,
            messageId: message.messageId,
          });
          queued.retry();
          continue;
        }
        try {
          const database = projectionDatabase(env, message.workspaceId);
          await projectMessageReactionEnvelope(database, message);
          queued.ack();
        } catch (error) {
          console.error("message_reaction_projection_failed", {
            queueMessageId: queued.id,
            workspaceId: message.workspaceId,
            conversationId: message.conversationId,
            messageId: message.messageId,
            error: error instanceof Error ? error.message : "unknown",
          });
          queued.retry();
        }
        continue;
      }

      const messageValidation = validateContract(
        "punks://contracts/message.projection@1",
        queued.body,
      );
      if (!messageValidation.valid) {
        console.error("projection_contract_rejected", { messageId: queued.id });
        queued.retry();
        continue;
      }

      const message = queued.body as MessageProjectionMessage;
      if (
        !(await verifyAttestation(message.event, env)) ||
        !isConsistentMessageProjection(message)
      ) {
        console.error("projection_invariant_rejected", {
          queueMessageId: queued.id,
          workspaceId: message.workspaceId,
          conversationId: message.conversationId,
          messageId: message.messageId,
        });
        queued.retry();
        continue;
      }
      try {
        const database = projectionDatabase(env, message.workspaceId);
        const projection: ValidatedMessageProjectionEnvelope = {
          ...message,
          event: { ...message.event },
          state: { ...message.state },
          threadDeltas: message.threadDeltas.map((delta) => {
            const {
              replyCountDelta: rawReplyCountDelta,
              descendantCountDelta: rawDescendantCountDelta,
              ...metadata
            } = delta;
            const replyCountDelta = nonzeroCounterDelta(rawReplyCountDelta);
            const descendantCountDelta = nonzeroCounterDelta(
              rawDescendantCountDelta,
            );
            return {
              ...metadata,
              ...(replyCountDelta === undefined ? {} : { replyCountDelta }),
              ...(descendantCountDelta === undefined
                ? {}
                : { descendantCountDelta }),
            };
          }),
        };
        await projectMessageEnvelope(database, projection);
        queued.ack();
      } catch (error) {
        console.error("message_projection_failed", {
          queueMessageId: queued.id,
          workspaceId: message.workspaceId,
          conversationId: message.conversationId,
          messageId: message.messageId,
          error: error instanceof Error ? error.message : "unknown",
        });
        queued.retry();
      }
    }
  },
} satisfies ExportedHandler<ProjectorEnv>;

import { expect, test, type Page } from "@playwright/test";
import { DESKTOP_SOCIAL_LOOP_CAPABILITIES } from "@punks/contracts/desktop-profile";
import type {
  ConversationFollowServerFrame,
  ConversationSummary,
  ConversationView,
  MessageHistoryResponse,
  Workspace,
} from "@punks/contracts";
import {
  exerciseNestedReply,
  exerciseRootMessageSubject,
  exerciseUnicodeReactionToggle,
  type SocialMutationHarness,
} from "./helpers/punksSocialMutationScenarios";

const ORIGIN = "http://127.0.0.1:4174";
const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const PUNK_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const CONVERSATION_ID = "44444444-4444-4444-8444-444444444444";
const ALL_CAPABILITY_CHUNKS =
  /PunksRuntime|punksTauriTransport|MessageLifecycleControls|punksMessageLifecycleTauri|IdentityGovernanceControls|PunksIdentityPanels|punksIdentityGovernanceTauri|PunksPresenceRuntime|punksPresenceTauri/u;
const LIFECYCLE_CHUNKS = /MessageLifecycleControls|punksMessageLifecycleTauri/u;
const GOVERNANCE_CHUNKS =
  /IdentityGovernanceControls|PunksIdentityPanels|punksIdentityGovernanceTauri/u;

const T1_CAPABILITIES = DESKTOP_SOCIAL_LOOP_CAPABILITIES;

type ChangesFrame = Extract<ConversationFollowServerFrame, { type: "changes" }>;

type PunksSocialSeed = {
  streams: readonly ConversationSummary[];
  stream: ConversationView;
  timeline: MessageHistoryResponse;
  followBatch?: ChangesFrame;
  followFailure?: { kind: string; message: string };
};

type PunksSeed = {
  compatible: boolean;
  capabilities: readonly string[];
  compatibilityFailures?: number;
  workspaces?: readonly {
    id: string;
    slug: string;
    name: string;
    visibility: "open" | "private" | "hidden";
    role: "owner" | "moderator" | "member";
    revision: number;
  }[];
  social?: PunksSocialSeed;
  governance?: Workspace;
  mountedCapabilities?: readonly string[];
};

function socialMessage(
  id: string,
  cursor: number,
  content: string,
): MessageHistoryResponse["items"][number] {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    conversationId: CONVERSATION_ID,
    author: { kind: "punk", punkId: PUNK_ID },
    messageType: "stream-message",
    status: "active",
    content,
    topic: null,
    mentionedPunkIds: [],
    mediaIds: [],
    parentMessageId: null,
    threadRootMessageId: id,
    threadDepth: 0,
    broadcast: false,
    replyCount: 0,
    descendantCount: 0,
    lastReplyAt: null,
    currentVersion: 1,
    retractionKind: null,
    retractedAt: null,
    eraseAfter: null,
    publicReason: null,
    erasedAt: null,
    revision: 1,
    createdCursor: cursor,
    cursor,
    createdAt: "2026-08-25T10:00:00.000Z",
    updatedAt: "2026-08-25T10:00:00.000Z",
    editedAt: null,
  };
}

async function installPunksTauriBoundary(
  page: Page,
  seed: PunksSeed = {
    compatible: true,
    capabilities: T1_CAPABILITIES,
  },
) {
  const workspaces = seed.workspaces ?? [
    {
      id: WORKSPACE_ID,
      slug: "capability-test",
      name: "Capability Test",
      visibility: "private" as const,
      role: "owner" as const,
      revision: 1,
    },
  ];
  await page.addInitScript(
    ({
      compatibilitySeed,
      origin,
      punkId,
      sessionId,
      socialSeed,
      workspaceSeed,
      governanceSeed,
      mountedCapabilities,
    }) => {
      const commands: string[] = [];
      const calls: { command: string; args: Record<string, unknown> }[] = [];
      let compatibilityFailures = compatibilitySeed.compatibilityFailures ?? 0;
      let generation = 0;
      let switchStarted = false;
      let ownershipReauthenticationPending = false;
      let ownershipReauthenticated = false;
      let activeWorkspaces = structuredClone(workspaceSeed);
      let followBatchDelivered = false;
      let followLiveDelivered = false;
      let followLiveRequested = false;
      let releaseFollowLive: (() => void) | null = null;
      let releaseFollowSignal: ((delivery: unknown) => void) | null = null;
      const queuedFollowSignals: unknown[] = [];
      let presenceAccepted = false;
      let releasePresenceDelivery: ((delivery: unknown) => void) | null = null;
      const queuedPresenceDeliveries: unknown[] = [];
      const socialMessages = structuredClone(socialSeed?.timeline.items ?? []);
      let governance = structuredClone(
        governanceSeed ?? {
          id: workspaceSeed[0]?.id,
          slug: workspaceSeed[0]?.slug,
          name: workspaceSeed[0]?.name,
          visibility: "private",
          status: "active",
          ownerPunkId: punkId,
          members: [{ punkId, role: "owner" }],
          revision: workspaceSeed[0]?.revision ?? 1,
          cursor: workspaceSeed[0]?.revision ?? 1,
          createdAt: "2026-08-25T10:00:00.000Z",
          updatedAt: "2026-08-25T10:00:00.000Z",
        },
      );
      const governanceView = () => {
        const { members, ...workspace } = governance;
        return {
          contract: "workspace.governance-view@1",
          ...workspace,
          memberCount: members.length,
        };
      };
      let issuedInvitation: {
        code: string;
        invitation: Record<string, unknown>;
      } | null = null;
      const reactionViews = new Map<
        string,
        {
          id: string;
          workspaceId: string;
          conversationId: string;
          messageId: string;
          actor: { kind: "punk"; punkId: string };
          reaction: string;
          reactedAt: string;
        }
      >();
      Object.assign(window, {
        __PUNKS_CAPABILITY_COMMANDS__: commands,
        __PUNKS_CAPABILITY_CALLS__: calls,
        __PUNKS_RELEASE_FOLLOW__: () => {
          followLiveRequested = true;
          releaseFollowLive?.();
        },
        __PUNKS_EMIT_TYPING__: (patch: unknown) => {
          const delivery = { kind: "typing", patch };
          const release = releaseFollowSignal;
          if (release === null) queuedFollowSignals.push(delivery);
          else {
            releaseFollowSignal = null;
            release(delivery);
          }
        },
        __PUNKS_DEGRADE_PRESENCE__: () => {
          const delivery = {
            kind: "realtime_degraded",
            reason: "capacity_unavailable",
          };
          const release = releasePresenceDelivery;
          if (release === null) queuedPresenceDeliveries.push(delivery);
          else {
            releasePresenceDelivery = null;
            release(delivery);
          }
        },
      });
      if (mountedCapabilities !== undefined) {
        Object.assign(window, {
          __PUNKS_E2E_ENVIRONMENT__: {
            distribution: "punks",
            mounted: [...mountedCapabilities],
            compatibility: {
              compatible: compatibilitySeed.compatible,
              capabilities: [...compatibilitySeed.capabilities],
            },
          },
        });
      }

      const invoke = async (
        command: string,
        args: Record<string, unknown> = {},
      ): Promise<unknown> => {
        commands.push(command);
        calls.push({ command, args: structuredClone(args) });
        switch (command) {
          case "punks_check_compatibility":
            if (compatibilityFailures > 0) {
              compatibilityFailures -= 1;
              throw {
                kind: "transport",
                message: "temporary compatibility transport failure",
              };
            }
            return {
              contract: "desktop.compatibility-response@1",
              compatible: compatibilitySeed.compatible,
              profile: "desktop-social-loop@1",
              registryVersion: 1,
              minimumClientVersion: "0.6.0",
              environment: "staging",
              origin,
              capabilities: [...compatibilitySeed.capabilities],
            };
          case "punks_get_account_session_state":
            if (switchStarted) {
              return {
                state: "signed_out",
                authentication: {
                  phase: "started",
                  intent: "switch_account",
                  method: "github",
                },
                resumeAvailable: false,
              };
            }
            if (ownershipReauthenticationPending) {
              ownershipReauthenticationPending = false;
              ownershipReauthenticated = true;
              return {
                state: "authenticated",
                authentication: { phase: "confirmed", sessionId },
                resumeAvailable: false,
                session: {
                  sessionId,
                  punkId,
                  authenticatedAt: "2026-08-25T10:00:00.000Z",
                  expiresAt: "2026-08-26T10:00:00.000Z",
                  recentReauthUntil: "2026-08-25T10:05:00.000Z",
                  punk: {
                    id: punkId,
                    displayName: "Capability Test Punk",
                    avatarUrl: null,
                  },
                },
              };
            }
            return {
              state: "authenticated",
              authentication: { phase: "idle" },
              resumeAvailable: false,
              session: {
                sessionId,
                punkId,
                authenticatedAt: "2026-08-25T10:00:00.000Z",
                expiresAt: "2026-08-26T10:00:00.000Z",
                recentReauthUntil: null,
                punk: {
                  id: punkId,
                  displayName: "Capability Test Punk",
                  avatarUrl: null,
                },
              },
            };
          case "punks_list_workspaces":
            return structuredClone(activeWorkspaces);
          case "punks_validate_navigation":
            return {
              kind: "workspace",
              path: new URL(String(args.url)).pathname,
            };
          case "punks_open_workspace": {
            generation += 1;
            return {
              origin,
              punkId,
              workspaceId: String(args.workspaceId),
              generation,
            };
          }
          case "punks_list_streams":
            return structuredClone(socialSeed?.streams ?? []);
          case "punks_get_workspace_governance":
            return {
              contract: "workspace.governance-response@1",
              workspace: governanceView(),
              members: structuredClone(governance.members),
              nextCursor: null,
            };
          case "punks_get_punk_summaries":
            return {
              contract: "punk.summary-batch-response@1",
              workspaceId: governance.id,
              items: ((args.punkIds as string[]) ?? []).map(
                (candidate, index) => ({
                  punkId: candidate,
                  displayName:
                    index === 0 ? "Capability Owner" : "Invited Punk",
                  avatarUrl: null,
                }),
              ),
            };
          case "punks_create_workspace_invitation": {
            const input = args.input as {
              role: "member" | "guest";
              expectedRevision: number;
              maxUses?: number;
            };
            const code = `${governance.id}.${"A".repeat(43)}`;
            issuedInvitation = {
              code,
              invitation: {
                contract: "workspace.invitation@1",
                invitationId: "77777777-7777-4777-8777-777777777777",
                workspace: {
                  id: governance.id,
                  slug: governance.slug,
                  name: governance.name,
                },
                workspaceRevision: governance.revision,
                role: input.role,
                status: "issued",
                issuedAt: "2026-08-25T10:00:00.000Z",
                expiresAt: "2026-09-01T10:00:00.000Z",
                revokedAt: null,
                maxUses: input.maxUses ?? 1,
                uses: 0,
                usesRemaining: input.maxUses ?? 1,
              },
            };
            return {
              contract: "workspace.invite-response@1",
              ...structuredClone(issuedInvitation),
              replayed: false,
            };
          }
          case "punks_revoke_workspace_invitation": {
            if (issuedInvitation === null) {
              throw new Error("No invitation fixture is issued");
            }
            issuedInvitation.invitation.status = "revoked";
            issuedInvitation.invitation.revokedAt = "2026-08-25T10:01:00.000Z";
            return {
              contract: "workspace.invite-revoke-response@1",
              invitation: structuredClone(issuedInvitation.invitation),
              replayed: false,
            };
          }
          case "punks_set_workspace_member_role": {
            const input = args.input as {
              targetPunkId: string;
              role: "moderator" | "member" | "guest";
            };
            governance = {
              ...governance,
              members: governance.members.map((member) =>
                member.punkId === input.targetPunkId
                  ? { ...member, role: input.role }
                  : member,
              ) as Workspace["members"],
              revision: governance.revision + 1,
              cursor: governance.cursor + 1,
            };
            return {
              contract: "workspace.membership-mutation-response@1",
              workspace: governanceView(),
              memberDeltas: [
                {
                  punkId: input.targetPunkId,
                  present: true,
                  role: input.role,
                },
              ],
              replayed: false,
            };
          }
          case "punks_remove_workspace_member": {
            const input = args.input as { targetPunkId: string };
            governance = {
              ...governance,
              members: governance.members.filter(
                (member) => member.punkId !== input.targetPunkId,
              ) as Workspace["members"],
              revision: governance.revision + 1,
              cursor: governance.cursor + 1,
            };
            return {
              contract: "workspace.membership-mutation-response@1",
              workspace: governanceView(),
              memberDeltas: [
                {
                  punkId: input.targetPunkId,
                  present: false,
                  role: null,
                },
              ],
              replayed: false,
            };
          }
          case "punks_start_reauthentication":
            ownershipReauthenticationPending = true;
            ownershipReauthenticated = false;
            return {
              phase: "started",
              intent: "reauthenticate",
              method: String(args.method),
            };
          case "punks_transfer_workspace_ownership": {
            if (!ownershipReauthenticated) {
              throw {
                kind: "problem",
                message: "A fresh ownership reauthentication is required",
              };
            }
            ownershipReauthenticated = false;
            const input = args.input as {
              targetPunkId: string;
              expectedRevision: number;
            };
            const previousOwner = governance.ownerPunkId;
            governance = {
              ...governance,
              ownerPunkId: input.targetPunkId,
              members: governance.members.map((member) =>
                member.punkId === previousOwner
                  ? { ...member, role: "member" }
                  : member.punkId === input.targetPunkId
                    ? { ...member, role: "owner" }
                    : member,
              ) as Workspace["members"],
              revision: governance.revision + 1,
              cursor: governance.cursor + 1,
            };
            activeWorkspaces = activeWorkspaces.map((workspace) =>
              workspace.id === governance.id
                ? {
                    ...workspace,
                    role: "member",
                    revision: governance.revision,
                  }
                : workspace,
            );
            return {
              contract: "workspace.membership-lifecycle-response@1",
              workspaceId: governance.id,
              revision: governance.revision,
              outcome: "ownership_transferred",
              role: "member",
              replayed: false,
            };
          }
          case "punks_leave_workspace": {
            governance = {
              ...governance,
              members: governance.members.filter(
                (member) => member.punkId !== punkId,
              ) as Workspace["members"],
              revision: governance.revision + 1,
              cursor: governance.cursor + 1,
            };
            activeWorkspaces = activeWorkspaces.filter(
              (workspace) => workspace.id !== governance.id,
            );
            return {
              contract: "workspace.membership-lifecycle-response@1",
              workspaceId: governance.id,
              revision: governance.revision,
              outcome: "left",
              role: null,
              replayed: false,
            };
          }
          case "punks_get_stream":
            if (socialSeed === undefined) {
              throw new Error("No social Stream fixture is installed");
            }
            return structuredClone(socialSeed.stream);
          case "punks_get_timeline":
            if (socialSeed === undefined) {
              throw new Error("No social timeline fixture is installed");
            }
            return {
              ...structuredClone(socialSeed.timeline),
              items: structuredClone(socialMessages),
            };
          case "punks_get_thread": {
            if (socialSeed === undefined) {
              throw new Error("No social thread fixture is installed");
            }
            const input = args.input as { threadRootMessageId: string };
            return {
              ...structuredClone(socialSeed.timeline),
              items: structuredClone(
                socialMessages.filter(
                  (message) =>
                    message.threadRootMessageId === input.threadRootMessageId,
                ),
              ),
              nextCursor: null,
            };
          }
          case "punks_resolve_authors":
            return (
              (args.authors as readonly (
                | { kind: "punk"; punkId: string }
                | { kind: "bot"; installationId: string }
              )[]) ?? []
            ).map((author) =>
              author.kind === "punk"
                ? {
                    kind: "punk",
                    punkId: author.punkId,
                    displayName: "Capability Test Punk",
                    avatarUrl: null,
                  }
                : {
                    kind: "bot",
                    installationId: author.installationId,
                    displayName: "Capability Test Bot",
                    avatarUrl: null,
                  },
            );
          case "punks_follow_conversation":
            return "follow-operation";
          case "punks_follow_next":
            if (socialSeed?.followBatch && !followBatchDelivered) {
              followBatchDelivered = true;
              return {
                kind: "apply_batch",
                frame: structuredClone(socialSeed.followBatch),
              };
            }
            if (socialSeed?.followFailure) {
              throw structuredClone(socialSeed.followFailure);
            }
            if (!followLiveDelivered) {
              if (followLiveRequested) {
                followLiveDelivered = true;
                return { kind: "became_live" };
              }
              return new Promise((resolve) => {
                releaseFollowLive = () => {
                  followLiveDelivered = true;
                  releaseFollowLive = null;
                  resolve({ kind: "became_live" });
                };
              });
            }
            return (
              queuedFollowSignals.shift() ??
              new Promise((resolve) => {
                releaseFollowSignal = resolve;
              })
            );
          case "punks_confirm_follow_batch":
          case "punks_close_follow":
            return null;
          case "punks_hold_presence":
            return "presence-operation";
          case "punks_presence_next":
            if (!presenceAccepted) {
              presenceAccepted = true;
              return {
                kind: "accepted",
                clientGeneration: generation,
                leaseGeneration: 1,
                heartbeatIntervalMs: 15_000,
                awayAfterMs: 30_000,
                expiresAfterMs: 60_000,
                presences: [
                  {
                    punkId,
                    state: "online",
                    status: null,
                    leaseGeneration: 1,
                    sequence: 1,
                    expiresAt: "2032-01-01T00:01:00.000Z",
                  },
                ],
              };
            }
            return (
              queuedPresenceDeliveries.shift() ??
              new Promise((resolve) => {
                releasePresenceDelivery = resolve;
              })
            );
          case "punks_set_presence_status":
          case "punks_signal_presence_typing":
            return null;
          case "punks_close_presence":
            releasePresenceDelivery?.({
              kind: "realtime_degraded",
              reason: "capacity_unavailable",
            });
            releasePresenceDelivery = null;
            return null;
          case "punks_post_message": {
            if (socialSeed === undefined) {
              throw new Error("No social mutation fixture is installed");
            }
            const input = args.input as {
              conversationId: string;
              content: string;
              topic?: string | null;
              replyTarget?: {
                messageId: string;
                threadRootMessageId: string;
                threadDepth: number;
              };
            };
            const parent = input.replyTarget
              ? socialMessages.find(
                  (message) => message.id === input.replyTarget?.messageId,
                )
              : undefined;
            if (
              input.replyTarget &&
              (parent === undefined ||
                parent.threadRootMessageId !==
                  input.replyTarget.threadRootMessageId ||
                parent.threadDepth !== input.replyTarget.threadDepth)
            ) {
              throw {
                kind: "problem",
                message: "Reply target is unavailable",
              };
            }
            const id = crypto.randomUUID();
            const cursor =
              socialMessages.reduce(
                (maximum, message) => Math.max(maximum, message.cursor),
                socialSeed.timeline.highWaterCursor,
              ) + 1;
            const timestamp = new Date().toISOString();
            const posted = {
              id,
              workspaceId: socialSeed.timeline.workspaceId,
              conversationId: input.conversationId,
              author: { kind: "punk" as const, punkId },
              messageType: "stream-message" as const,
              status: "active" as const,
              content: input.content,
              topic: input.topic ?? null,
              mentionedPunkIds: [],
              mediaIds: [],
              parentMessageId: input.replyTarget?.messageId ?? null,
              threadRootMessageId: parent?.threadRootMessageId ?? id,
              threadDepth: parent === undefined ? 0 : parent.threadDepth + 1,
              broadcast: false,
              replyCount: 0,
              descendantCount: 0,
              lastReplyAt: null,
              currentVersion: 1,
              retractionKind: null,
              retractedAt: null,
              eraseAfter: null,
              publicReason: null,
              erasedAt: null,
              revision: 1,
              createdCursor: cursor,
              cursor,
              createdAt: timestamp,
              updatedAt: timestamp,
              editedAt: null,
            };
            socialMessages.push(posted);
            return structuredClone(posted);
          }
          case "punks_add_reaction": {
            const input = args.input as {
              conversationId: string;
              messageId: string;
              reaction: string;
            };
            const key = `${input.conversationId}:${input.messageId}:${input.reaction}`;
            const existing = reactionViews.get(key);
            const reaction = existing ?? {
              id: crypto.randomUUID(),
              workspaceId: socialSeed?.timeline.workspaceId ?? "",
              conversationId: input.conversationId,
              messageId: input.messageId,
              actor: { kind: "punk" as const, punkId },
              reaction: input.reaction,
              reactedAt: new Date().toISOString(),
            };
            reactionViews.set(key, reaction);
            return {
              reaction: structuredClone(reaction),
              effect: existing === undefined ? "added" : "unchanged",
              replayed: false,
            };
          }
          case "punks_remove_reaction": {
            const input = args.input as {
              conversationId: string;
              messageId: string;
              reaction: string;
            };
            const key = `${input.conversationId}:${input.messageId}:${input.reaction}`;
            const removed = reactionViews.delete(key);
            return {
              reaction: null,
              effect: removed ? "removed" : "unchanged",
              replayed: false,
            };
          }
          case "punks_close_workspace":
            return null;
          case "punks_start_account_switch":
            switchStarted = true;
            return {
              phase: "started",
              intent: "switch_account",
              method: String(args.provider),
            };
          case "punks_cancel_authentication":
            switchStarted = false;
            ownershipReauthenticationPending = false;
            ownershipReauthenticated = false;
            return { phase: "cancelled" };
          default:
            throw new Error(`Unexpected Punks command: ${command}`);
        }
      };

      Object.assign(window, {
        __TAURI_INTERNALS__: {
          ...(
            window as typeof window & {
              __TAURI_INTERNALS__?: Record<string, unknown>;
            }
          ).__TAURI_INTERNALS__,
          invoke,
        },
      });
    },
    {
      compatibilitySeed: seed,
      origin: ORIGIN,
      punkId: PUNK_ID,
      sessionId: SESSION_ID,
      socialSeed: seed.social,
      workspaceSeed: workspaces,
      governanceSeed: seed.governance,
      mountedCapabilities: seed.mountedCapabilities,
    },
  );
}

async function invokedCommands(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      (
        window as typeof window & {
          __PUNKS_CAPABILITY_COMMANDS__?: string[];
        }
      ).__PUNKS_CAPABILITY_COMMANDS__ ?? [],
  );
}

async function invokedCalls(
  page: Page,
): Promise<{ command: string; args: Record<string, unknown> }[]> {
  return page.evaluate(
    () =>
      (
        window as typeof window & {
          __PUNKS_CAPABILITY_CALLS__?: {
            command: string;
            args: Record<string, unknown>;
          }[];
        }
      ).__PUNKS_CAPABILITY_CALLS__ ?? [],
  );
}

async function loadedResources(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    performance.getEntriesByType("resource").map((entry) => entry.name),
  );
}

async function releaseFollow(page: Page): Promise<void> {
  await page.evaluate(() => {
    (
      window as typeof window & {
        __PUNKS_RELEASE_FOLLOW__?: () => void;
      }
    ).__PUNKS_RELEASE_FOLLOW__?.();
  });
}

async function emitTyping(page: Page, patch: Record<string, unknown>) {
  await page.evaluate((value) => {
    (
      window as typeof window & {
        __PUNKS_EMIT_TYPING__?: (patch: unknown) => void;
      }
    ).__PUNKS_EMIT_TYPING__?.(value);
  }, patch);
}

async function degradePresence(page: Page) {
  await page.evaluate(() => {
    (
      window as typeof window & {
        __PUNKS_DEGRADE_PRESENCE__?: () => void;
      }
    ).__PUNKS_DEGRADE_PRESENCE__?.();
  });
}

const SOCIAL_MUTATION_HARNESS: SocialMutationHarness = {
  capabilities: T1_CAPABILITIES,
  conversationId: CONVERSATION_ID,
  install: installPunksTauriBoundary,
  invokedCalls,
  message: socialMessage,
  releaseFollow,
  workspaceId: WORKSPACE_ID,
};

test("une route directe indisponible s'arrête avant toute commande", async ({
  page,
}) => {
  await installPunksTauriBoundary(page);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));

  await page.goto("/pulse");

  const terminal = page.getByTestId("unavailable-terminal");
  await expect(terminal).toBeVisible();
  await expect(terminal).not.toContainText(
    /pulse|workspace|community|preview|enable|settings/i,
  );
  expect(await invokedCommands(page)).toEqual([]);
  expect(
    requests.filter(
      (url) => new URL(url).pathname.startsWith("/api/") || /^wss?:/u.test(url),
    ),
  ).toEqual([]);
  expect((await loadedResources(page)).join("\n")).not.toMatch(
    ALL_CAPABILITY_CHUNKS,
  );
});

test("la découverte et le clavier n'exposent aucune capacité ultérieure", async ({
  page,
}) => {
  await installPunksTauriBoundary(page);
  await page.goto("/");
  await expect(page.getByTestId("punks-workspace-shell")).toBeVisible();

  for (const testId of [
    "open-pulse-view",
    "open-projects-view",
    "open-workflows-view",
    "open-agents-view",
    "open-search",
    "sidebar-home-count",
  ]) {
    await expect(page.getByTestId(testId)).toHaveCount(0);
  }

  const before = await invokedCommands(page);
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  for (const shortcut of [
    `${modifier}+k`,
    `${modifier}+f`,
    `${modifier}+Shift+k`,
    `${modifier}+Shift+n`,
    `${modifier}+Shift+o`,
    `${modifier}+Shift+a`,
    "Control+Shift+Space",
  ]) {
    await page.keyboard.press(shortcut);
  }
  await page.waitForTimeout(100);

  await expect(page).toHaveURL(`${ORIGIN}/`);
  await expect(page.getByTestId("punks-workspace-shell")).toBeVisible();
  expect(await invokedCommands(page)).toEqual(before);
  expect((await loadedResources(page)).join("\n")).not.toMatch(
    LIFECYCLE_CHUNKS,
  );
});

test("deux routes indisponibles rendent le même terminal non divulguant", async ({
  page,
}) => {
  await installPunksTauriBoundary(page);

  await page.goto("/pulse");
  const terminal = page.getByTestId("unavailable-terminal");
  await expect(terminal).toBeVisible();
  const pulseText = await terminal.textContent();

  await page.goto("/workflows");
  await expect(terminal).toBeVisible();
  expect(await terminal.textContent()).toBe(pulseText);
  await expect(terminal).not.toContainText(
    /pulse|workflow|workspace|community|preview|enable|settings/i,
  );
  expect(await invokedCommands(page)).toEqual([]);
});

test("une réponse compatible mais incomplète échoue fermée", async ({
  page,
}) => {
  await installPunksTauriBoundary(page, {
    compatible: true,
    capabilities: T1_CAPABILITIES.filter(
      (capability) => capability !== "unicode-reactions",
    ),
  });
  await page.goto("/");

  await expect(page.getByTestId("unavailable-terminal")).toBeVisible();
  await expect(page.getByTestId("punks-workspace-shell")).toHaveCount(0);
  expect(await invokedCommands(page)).toEqual(["punks_check_compatibility"]);
  expect((await loadedResources(page)).join("\n")).not.toMatch(
    ALL_CAPABILITY_CHUNKS,
  );
});

test("une incompatibilité bloque avant tout montage de Workspace", async ({
  page,
}) => {
  await installPunksTauriBoundary(page, {
    compatible: false,
    capabilities: [],
  });
  await page.goto("/");

  const gate = page.getByTestId("client-incompatible-gate");
  await expect(gate).toBeVisible();
  await expect(gate).not.toContainText(
    /workspace|community|update|upgrade|compatib/i,
  );
  await expect(page.getByTestId("punks-workspace-shell")).toHaveCount(0);
  expect(await invokedCommands(page)).toEqual(["punks_check_compatibility"]);
  expect((await loadedResources(page)).join("\n")).not.toMatch(
    ALL_CAPABILITY_CHUNKS,
  );
});

test("une panne de compatibilité reste un état runtime récupérable", async ({
  page,
}) => {
  await installPunksTauriBoundary(page, {
    compatible: true,
    capabilities: T1_CAPABILITIES,
    compatibilityFailures: 1,
  });
  await page.goto("/");

  const error = page.getByTestId("punks-capability-error");
  await expect(error).toBeVisible();
  await expect(page.getByTestId("client-incompatible-gate")).toHaveCount(0);
  await expect(page.getByTestId("punks-workspace-shell")).toHaveCount(0);
  expect(await invokedCommands(page)).toEqual(["punks_check_compatibility"]);
  expect((await loadedResources(page)).join("\n")).not.toMatch(
    ALL_CAPABILITY_CHUNKS,
  );

  await error.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("punks-workspace-shell")).toBeVisible();
  expect(await invokedCommands(page)).toEqual([
    "punks_check_compatibility",
    "punks_check_compatibility",
    "punks_get_account_session_state",
    "punks_list_workspaces",
    "punks_open_workspace",
    "punks_list_streams",
  ]);
});

test("changer de Workspace ferme l'ancienne génération avant la nouvelle I/O", async ({
  page,
}) => {
  const secondWorkspaceId = "44444444-4444-4444-8444-444444444444";
  await installPunksTauriBoundary(page, {
    compatible: true,
    capabilities: T1_CAPABILITIES,
    workspaces: [
      {
        id: WORKSPACE_ID,
        slug: "capability-test",
        name: "Capability Test",
        visibility: "private",
        role: "owner",
        revision: 1,
      },
      {
        id: secondWorkspaceId,
        slug: "second",
        name: "Second Workspace",
        visibility: "private",
        role: "member",
        revision: 1,
      },
    ],
  });
  await page.goto("/");
  await expect(page.getByTestId("punks-workspace-shell")).toBeVisible();

  await page.getByTestId("punks-workspace-second").click();
  await expect(
    page.getByRole("heading", { name: "Second Workspace" }).first(),
  ).toBeVisible();

  const calls = await invokedCalls(page);
  const closeIndex = calls.findIndex(
    ({ command }) => command === "punks_close_workspace",
  );
  const secondOpenIndex = calls.findIndex(
    ({ command, args }) =>
      command === "punks_open_workspace" &&
      args.workspaceId === secondWorkspaceId,
  );
  expect(closeIndex).toBeGreaterThan(-1);
  expect(secondOpenIndex).toBeGreaterThan(closeIndex);
  expect(
    calls.filter(({ command }) => command === "punks_open_workspace"),
  ).toHaveLength(2);
});

test("changer de Compte ferme le Workspace avant la cérémonie", async ({
  page,
}) => {
  await installPunksTauriBoundary(page);
  await page.goto("/");
  await expect(page.getByTestId("punks-workspace-shell")).toBeVisible();

  await page.getByRole("button", { name: "Switch Account" }).click();
  await page.getByRole("button", { name: "GitHub" }).click();
  await expect(page.getByTestId("punks-account-switching")).toBeVisible();
  await expect(page.getByTestId("punks-workspace-shell")).toHaveCount(0);

  const commands = await invokedCommands(page);
  const closeIndex = commands.indexOf("punks_close_workspace");
  const switchIndex = commands.indexOf("punks_start_account_switch");
  expect(closeIndex).toBeGreaterThan(-1);
  expect(switchIndex).toBeGreaterThan(closeIndex);
});

test("la boucle sociale publie un batch avant ACK et bloque les mutations avant live", async ({
  page,
}) => {
  const initialMessageId = "55555555-5555-4555-8555-555555555555";
  const liveMessageId = "66666666-6666-4666-8666-666666666666";
  const streamSummary: ConversationSummary = {
    id: CONVERSATION_ID,
    workspaceId: WORKSPACE_ID,
    name: "Social Loop",
    type: "stream",
    visibility: "private",
    description: null,
    topic: "FOLLOW",
    purpose: "Exercise the bounded social loop",
    topicRequired: false,
    ttlSeconds: null,
    ttlDeadline: null,
    revision: 1,
    cursor: 1,
    updatedAt: "2026-08-25T10:00:00.000Z",
  };
  await installPunksTauriBoundary(page, {
    compatible: true,
    capabilities: T1_CAPABILITIES,
    social: {
      streams: [streamSummary],
      stream: {
        ...streamSummary,
        maxMembers: null,
        status: "active",
        createdAt: "2026-08-25T10:00:00.000Z",
        archivedAt: null,
      },
      timeline: {
        workspaceId: WORKSPACE_ID,
        conversationId: CONVERSATION_ID,
        highWaterCursor: 1,
        order: "createdCursor-ascending",
        items: [socialMessage(initialMessageId, 1, "Initial snapshot")],
        nextCursor: null,
      },
      followBatch: {
        schemaVersion: 1,
        type: "changes",
        fromExclusiveCursor: 1,
        throughCursor: 2,
        messages: [socialMessage(liveMessageId, 2, "FOLLOW batch")],
        threadPatches: [],
        reactionPatches: [],
        reactionCollectionPatches: [],
      },
    },
  });
  await page.goto("/");
  await page.getByTestId(`punks-stream-${CONVERSATION_ID}`).click();

  await expect(
    page.getByRole("heading", { name: "Social Loop" }),
  ).toBeVisible();
  await expect(page.getByText("FOLLOW batch", { exact: true })).toBeVisible();
  const composer = page.getByTestId("punks-message-composer");
  await expect(composer).toBeDisabled();
  await expect(
    page.getByTestId("punks-follow-connecting").first(),
  ).toBeVisible();
  const beforeLive = await invokedCommands(page);
  expect(beforeLive.indexOf("punks_confirm_follow_batch")).toBeGreaterThan(
    beforeLive.indexOf("punks_follow_next"),
  );

  await releaseFollow(page);

  await expect(page.getByTestId("punks-follow-live").first()).toBeVisible();
  await expect(composer).toBeEnabled();

  const unavailableTargetId = "77777777-7777-4777-8777-777777777777";
  await page.goto(
    `/w/capability-test/conversations/${CONVERSATION_ID}/messages/${unavailableTargetId}`,
  );
  await expect(
    page.getByTestId("punks-message-target-unavailable"),
  ).toBeVisible();
  await releaseFollow(page);
  await expect(page.getByTestId("punks-follow-live").first()).toBeVisible();
  await expect(page.getByTestId("punks-message-composer")).toBeDisabled();
  expect(await invokedCommands(page)).not.toContain("punks_get_thread");
  expect(await invokedCommands(page)).not.toContain("punks_post_message");
});

test("un Punk publie un Message racine avec son sujet", async ({ page }) => {
  await exerciseRootMessageSubject(page, SOCIAL_MUTATION_HARNESS);
});

test("un Propriétaire gouverne invitations et rôles par la frontière Punks", async ({
  page,
}) => {
  const targetPunkId = "55555555-5555-4555-8555-555555555555";
  const capabilities = [...T1_CAPABILITIES, "identity-governance"];
  await installPunksTauriBoundary(page, {
    compatible: true,
    capabilities,
    mountedCapabilities: capabilities,
    governance: {
      id: WORKSPACE_ID,
      slug: "capability-test",
      name: "Capability Test",
      visibility: "private",
      status: "active",
      ownerPunkId: PUNK_ID,
      members: [
        { punkId: PUNK_ID, role: "owner" },
        { punkId: targetPunkId, role: "member" },
      ],
      revision: 1,
      cursor: 1,
      createdAt: "2026-08-25T10:00:00.000Z",
      updatedAt: "2026-08-25T10:00:00.000Z",
    },
  });
  await page.goto("/");
  expect(
    await page.evaluate(
      () =>
        (
          window as typeof window & {
            __PUNKS_E2E_ENVIRONMENT__?: {
              mounted?: string[];
              compatibility?: { capabilities: string[] };
            };
          }
        ).__PUNKS_E2E_ENVIRONMENT__,
    ),
  ).toMatchObject({
    mounted: expect.arrayContaining(["identity-governance"]),
    compatibility: {
      capabilities: expect.arrayContaining(["identity-governance"]),
    },
  });
  await page.getByTestId("punks-open-governance").click();
  await expect(
    page.getByRole("heading", { name: "Members and invitations" }),
  ).toBeVisible();

  await page.getByLabel("Role for Invited Punk").selectOption("moderator");
  await expect(page.getByLabel("Role for Invited Punk")).toHaveValue(
    "moderator",
  );
  await page.getByRole("button", { name: "Create invitation" }).click();
  await expect(
    page.getByText("Invitation ready", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Revoke", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByLabel("Role for Invited Punk")).toHaveCount(0);

  const calls = await invokedCalls(page);
  expect(
    calls
      .filter(({ command }) =>
        [
          "punks_set_workspace_member_role",
          "punks_create_workspace_invitation",
          "punks_revoke_workspace_invitation",
          "punks_remove_workspace_member",
        ].includes(command),
      )
      .map(({ command }) => command),
  ).toEqual([
    "punks_set_workspace_member_role",
    "punks_create_workspace_invitation",
    "punks_revoke_workspace_invitation",
    "punks_remove_workspace_member",
  ]);
  expect(
    calls.some(({ command }) => command === "punks_get_workspace_governance"),
  ).toBe(true);
  expect(
    calls.some(({ command }) => command === "punks_get_punk_summaries"),
  ).toBe(true);
  expect(GOVERNANCE_CHUNKS.test("IdentityGovernanceControls")).toBe(true);
});

test("un Propriétaire réauthentifie le transfert puis quitte sans conserver de scope", async ({
  page,
}) => {
  const targetPunkId = "55555555-5555-4555-8555-555555555555";
  const capabilities = [...T1_CAPABILITIES, "identity-governance"];
  await installPunksTauriBoundary(page, {
    compatible: true,
    capabilities,
    mountedCapabilities: capabilities,
    governance: {
      id: WORKSPACE_ID,
      slug: "capability-test",
      name: "Capability Test",
      visibility: "private",
      status: "active",
      ownerPunkId: PUNK_ID,
      members: [
        { punkId: PUNK_ID, role: "owner" },
        { punkId: targetPunkId, role: "member" },
      ],
      revision: 1,
      cursor: 1,
      createdAt: "2026-08-25T10:00:00.000Z",
      updatedAt: "2026-08-25T10:00:00.000Z",
    },
  });
  await page.goto("/");
  await page.getByTestId("punks-open-governance").click();
  await page
    .getByRole("button", { name: "Transfer ownership", exact: true })
    .click();
  const transferDialog = page.getByRole("dialog", {
    name: "Transfer Workspace ownership",
  });
  await transferDialog.getByRole("textbox").fill("Invited Punk");
  await transferDialog
    .getByRole("button", { name: "Reauthenticate", exact: true })
    .click();
  await expect(
    transferDialog.getByRole("button", { name: "Reauthenticated" }),
  ).toBeVisible();
  await transferDialog
    .getByRole("button", { name: "Transfer ownership", exact: true })
    .click();

  await expect(page.getByTestId("punks-open-governance")).toHaveCount(0);
  await page.getByTestId("punks-open-workspace-departure").click();
  const departureDialog = page.getByRole("dialog", {
    name: "Leave Capability Test",
  });
  await departureDialog.getByRole("textbox").fill("Capability Test");
  await departureDialog
    .getByTestId("punks-confirm-workspace-departure")
    .click();
  await expect(
    page.getByRole("heading", { name: "Join a Workspace" }),
  ).toBeVisible();

  const commands = await invokedCommands(page);
  expect(commands).toEqual(
    expect.arrayContaining([
      "punks_start_reauthentication",
      "punks_transfer_workspace_ownership",
      "punks_leave_workspace",
      "punks_close_workspace",
    ]),
  );
});

test("une réponse reste dans le Fil du Message sélectionné", async ({
  page,
}) => {
  await exerciseNestedReply(page, SOCIAL_MUTATION_HARNESS);
});

test("un Punk ajoute puis retire une Réaction Unicode", async ({ page }) => {
  await exerciseUnicodeReactionToggle(page, SOCIAL_MUTATION_HARNESS);
});

test("une révocation FOLLOW purge les vues et reste terminale", async ({
  page,
}) => {
  const secretMessageId = "88888888-8888-4888-8888-888888888888";
  const streamSummary: ConversationSummary = {
    id: CONVERSATION_ID,
    workspaceId: WORKSPACE_ID,
    name: "Private revoked Stream",
    type: "stream",
    visibility: "private",
    description: "Private description",
    topic: "Private topic",
    purpose: "Private purpose",
    topicRequired: false,
    ttlSeconds: null,
    ttlDeadline: null,
    revision: 1,
    cursor: 1,
    updatedAt: "2026-08-25T10:00:00.000Z",
  };
  await installPunksTauriBoundary(page, {
    compatible: true,
    capabilities: T1_CAPABILITIES,
    social: {
      streams: [streamSummary],
      stream: {
        ...streamSummary,
        maxMembers: null,
        status: "active",
        createdAt: "2026-08-25T10:00:00.000Z",
        archivedAt: null,
      },
      timeline: {
        workspaceId: WORKSPACE_ID,
        conversationId: CONVERSATION_ID,
        highWaterCursor: 1,
        order: "createdCursor-ascending",
        items: [socialMessage(secretMessageId, 1, "Private Message body")],
        nextCursor: null,
      },
      followFailure: {
        kind: "problem",
        message: "Punks FOLLOW authorization is no longer available",
      },
    },
  });

  await page.goto(`/w/capability-test/conversations/${CONVERSATION_ID}`);

  await expect(page.getByTestId("punks-stream-unavailable")).toBeVisible();
  await expect(
    page.getByText("Private Message body", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Private revoked Stream", { exact: true }),
  ).toHaveCount(0);
  const commands = await invokedCommands(page);
  expect(
    commands.filter((command) => command === "punks_follow_conversation"),
  ).toHaveLength(1);
});

test("la Présence préparée rend statut, frappe et dégradation honnêtes", async ({
  page,
}) => {
  const messageId = "95555555-5555-4555-8555-555555555555";
  const otherPunkId = "99999999-9999-4999-8999-999999999999";
  const streamSummary: ConversationSummary = {
    id: CONVERSATION_ID,
    workspaceId: WORKSPACE_ID,
    name: "Presence Loop",
    type: "stream",
    visibility: "private",
    description: null,
    topic: "Ephemeral",
    purpose: "Exercise Presence without authority",
    topicRequired: false,
    ttlSeconds: null,
    ttlDeadline: null,
    revision: 1,
    cursor: 1,
    updatedAt: "2026-08-25T10:00:00.000Z",
  };
  const preparedCapabilities = [...T1_CAPABILITIES, "presence"];
  await installPunksTauriBoundary(page, {
    compatible: true,
    capabilities: preparedCapabilities,
    mountedCapabilities: preparedCapabilities,
    social: {
      streams: [streamSummary],
      stream: {
        ...streamSummary,
        maxMembers: null,
        status: "active",
        createdAt: "2026-08-25T10:00:00.000Z",
        archivedAt: null,
      },
      timeline: {
        workspaceId: WORKSPACE_ID,
        conversationId: CONVERSATION_ID,
        highWaterCursor: 1,
        order: "createdCursor-ascending",
        items: [socialMessage(messageId, 1, "Presence is decorative")],
        nextCursor: null,
      },
    },
  });
  await page.goto("/");
  await expect(page.getByTestId("punks-realtime-status")).toHaveText(
    "Realtime live",
  );

  await page.getByTestId(`punks-stream-${CONVERSATION_ID}`).click();
  await releaseFollow(page);
  await expect(page.getByTestId("punks-follow-live").first()).toBeVisible();
  await expect(page.getByTestId(`punks-presence-${PUNK_ID}`)).toHaveAttribute(
    "aria-label",
    /is online/u,
  );

  await emitTyping(page, {
    workspaceId: WORKSPACE_ID,
    conversationId: CONVERSATION_ID,
    punkId: otherPunkId,
    active: true,
    leaseGeneration: 4,
    sequence: 1,
    expiresAt: "2032-01-01T00:00:05.000Z",
  });
  await expect(page.getByTestId("punks-typing-indicator")).toHaveText(
    "Someone is typing…",
  );

  await page.getByLabel("Status").fill("Reviewing T8");
  await page.getByRole("button", { name: "Set" }).click();
  await expect
    .poll(async () =>
      (await invokedCalls(page)).some(
        ({ command, args }) =>
          command === "punks_set_presence_status" &&
          args.status === "Reviewing T8",
      ),
    )
    .toBe(true);

  await degradePresence(page);
  await expect(page.getByTestId("punks-realtime-status")).toHaveText(
    "Realtime unavailable",
  );
  expect(await invokedCommands(page)).not.toContain("subscribe_presence");
});

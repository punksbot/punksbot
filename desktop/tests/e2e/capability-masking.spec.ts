import { expect, test } from "@playwright/test";
import type { ConversationSummary } from "@punks/contracts";
import {
  exerciseNestedReply,
  exerciseRootMessageSubject,
  exerciseUnicodeReactionToggle,
} from "./helpers/punksSocialMutationScenarios";
import {
  ALL_CAPABILITY_CHUNKS,
  CONVERSATION_ID,
  degradePresence,
  emitTyping,
  GOVERNANCE_CHUNKS,
  installPunksTauriBoundary,
  invokedCalls,
  invokedCommands,
  LIFECYCLE_CHUNKS,
  loadedResources,
  ORIGIN,
  PUNK_ID,
  releaseFollow,
  SOCIAL_MUTATION_HARNESS,
  socialMessage,
  T1_CAPABILITIES,
  WORKSPACE_ID,
} from "./helpers/punksCapabilityBoundary";

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

test("le renderer ne possède aucune boucle de reconnexion Présence", async ({
  page,
}) => {
  const preparedCapabilities = [...T1_CAPABILITIES, "presence"];
  await installPunksTauriBoundary(page, {
    compatible: true,
    capabilities: preparedCapabilities,
    mountedCapabilities: preparedCapabilities,
    presenceFailure: {
      kind: "transport",
      message: "native Presence supervisor stopped",
    },
  });
  await page.goto("/");

  await expect(page.getByTestId("punks-realtime-status")).toHaveText(
    "Realtime unavailable",
  );
  await page.waitForTimeout(750);
  expect(
    (await invokedCommands(page)).filter(
      (command) => command === "punks_hold_presence",
    ),
  ).toHaveLength(1);
});

import { expect, type Page } from "@playwright/test";
import type {
  ConversationSummary,
  ConversationView,
  MessageHistoryResponse,
} from "@punks/contracts";

type SocialMutationSeed = {
  compatible: boolean;
  capabilities: readonly string[];
  social: {
    streams: readonly ConversationSummary[];
    stream: ConversationView;
    timeline: MessageHistoryResponse;
  };
};

type InvokedCall = {
  command: string;
  args: Record<string, unknown>;
};

export type SocialMutationHarness = {
  conversationId: string;
  workspaceId: string;
  capabilities: readonly string[];
  install(page: Page, seed: SocialMutationSeed): Promise<void>;
  invokedCalls(page: Page): Promise<InvokedCall[]>;
  message(
    id: string,
    cursor: number,
    content: string,
  ): MessageHistoryResponse["items"][number];
  releaseFollow(page: Page): Promise<void>;
};

const MUTATION_MESSAGE_ID = "88888888-8888-4888-8888-888888888888";

async function openSocialMutationStream(
  page: Page,
  harness: SocialMutationHarness,
  selectedMessageId: string | null,
): Promise<void> {
  const streamSummary: ConversationSummary = {
    id: harness.conversationId,
    workspaceId: harness.workspaceId,
    name: "Subject Stream",
    type: "stream",
    visibility: "private",
    description: null,
    topic: "Publication",
    purpose: "Exercise explicit Message intents",
    topicRequired: true,
    ttlSeconds: null,
    ttlDeadline: null,
    revision: 1,
    cursor: 1,
    updatedAt: "2026-08-25T10:00:00.000Z",
  };
  await harness.install(page, {
    compatible: true,
    capabilities: harness.capabilities,
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
        workspaceId: harness.workspaceId,
        conversationId: harness.conversationId,
        highWaterCursor: 1,
        order: "createdCursor-ascending",
        items: [harness.message(MUTATION_MESSAGE_ID, 1, "Existing Message")],
        nextCursor: null,
      },
    },
  });
  const selectedPath =
    selectedMessageId === null ? "" : `/messages/${selectedMessageId}`;
  await page.goto(
    `/w/capability-test/conversations/${harness.conversationId}${selectedPath}`,
  );
  await expect(page.getByTestId("punks-message-composer")).toBeDisabled();
  await harness.releaseFollow(page);
  await expect(page.getByTestId("punks-follow-live").first()).toBeVisible();
}

export async function exerciseRootMessageSubject(
  page: Page,
  harness: SocialMutationHarness,
): Promise<void> {
  await openSocialMutationStream(page, harness, null);
  await page.getByTestId("punks-message-topic").fill("Release notes");
  const composer = page.getByTestId("punks-message-composer");
  await composer.fill("The new social loop is live.");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(
    page
      .getByTestId("punks-message-list")
      .getByText("The new social loop is live.", { exact: true }),
  ).toBeVisible();
  const postedRow = page
    .getByTestId("punks-message-list")
    .locator("article")
    .filter({ hasText: "The new social loop is live." });
  await expect(
    postedRow.getByText("Release notes", { exact: true }),
  ).toBeVisible();
  await expect(composer).toHaveValue("");
  const postCalls = (await harness.invokedCalls(page)).filter(
    ({ command }) => command === "punks_post_message",
  );
  expect(postCalls).toHaveLength(1);
  expect(postCalls[0]?.args.input).toEqual({
    conversationId: harness.conversationId,
    content: "The new social loop is live.",
    topic: "Release notes",
  });
}

export async function exerciseNestedReply(
  page: Page,
  harness: SocialMutationHarness,
): Promise<void> {
  await openSocialMutationStream(page, harness, MUTATION_MESSAGE_ID);
  await page
    .getByTestId("punks-message-composer")
    .fill("A nested reply stays in the selected thread.");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(
    page
      .getByTestId("punks-thread")
      .getByText("A nested reply stays in the selected thread.", {
        exact: true,
      }),
  ).toBeVisible();
  const replyCalls = (await harness.invokedCalls(page)).filter(
    ({ command }) => command === "punks_post_message",
  );
  expect(replyCalls).toHaveLength(1);
  expect(replyCalls[0]?.args.input).toEqual({
    conversationId: harness.conversationId,
    content: "A nested reply stays in the selected thread.",
    topic: null,
    replyTarget: {
      messageId: MUTATION_MESSAGE_ID,
      threadRootMessageId: MUTATION_MESSAGE_ID,
      threadDepth: 0,
    },
  });
}

export async function exerciseUnicodeReactionToggle(
  page: Page,
  harness: SocialMutationHarness,
): Promise<void> {
  await openSocialMutationStream(page, harness, MUTATION_MESSAGE_ID);
  const initialRow = page
    .getByTestId("punks-message-list")
    .locator(`[data-message-id="${MUTATION_MESSAGE_ID}"]`);
  await initialRow
    .getByTestId(`punks-reaction-input-${MUTATION_MESSAGE_ID}`)
    .fill("🦄");
  const reactionButton = initialRow.getByTestId(
    `punks-reaction-${MUTATION_MESSAGE_ID}-thumbs-up`,
  );
  await expect(reactionButton).toHaveText("Add 🦄 0");
  await reactionButton.click();
  await expect(reactionButton).toHaveText("Remove 🦄 0");
  await reactionButton.click();
  await expect(reactionButton).toHaveText("Add 🦄 0");

  const reactionCalls = (await harness.invokedCalls(page)).filter(
    ({ command }) =>
      ["punks_add_reaction", "punks_remove_reaction"].includes(command),
  );
  expect(reactionCalls.map(({ command }) => command)).toEqual([
    "punks_add_reaction",
    "punks_remove_reaction",
  ]);
  for (const call of reactionCalls) {
    expect(call.args.input).toEqual({
      conversationId: harness.conversationId,
      messageId: MUTATION_MESSAGE_ID,
      reaction: "🦄",
    });
  }
}

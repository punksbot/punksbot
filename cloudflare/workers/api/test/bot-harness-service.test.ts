import { canonicalJson, sha256Hex } from "@punks/core";
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { BotInstallationDO } from "../src/bot-installation-do";
import {
  BotHarnessService,
  BotWakeTriggerService,
} from "../src/bot-harness-service";
import { ConversationDO } from "../src/conversation-do";

const installationId = "10000000-0000-8000-8000-000000000001";
const wakeId = "10000000-0000-8000-8000-000000000002";
const turnId = "10000000-0000-8000-8000-000000000003";
const workspaceId = "10000000-0000-8000-8000-000000000004";
const botId = "10000000-0000-8000-8000-000000000005";
const conversationId = "10000000-0000-8000-8000-000000000006";
const messageId = "10000000-0000-8000-8000-000000000007";
const plaintextSentinel = "private plaintext sentinel: never leak this";
const offer = {
  contract: "bot-wake.offer@1",
  wakeId,
  workspaceId,
  installationId,
  botId,
  conversationId,
  messageId,
  messageCursor: 11,
  subscriptionEpoch: 7,
  runtimeRelease: {
    releaseId: "punks.reaction-turn.v1",
    releaseDigest: "3".repeat(64),
  },
  sourceEventId: "1".repeat(64),
  sourceEventDigest: "2".repeat(64),
  createdAt: "2026-08-21T08:00:00.000Z",
};
const offerDigest = await sha256Hex(canonicalJson(offer));
const changedOffer = { ...offer, sourceEventDigest: "4".repeat(64) };
const changedOfferDigest = await sha256Hex(canonicalJson(changedOffer));

type HarnessBindingName =
  | "BOT_HARNESS_SERVICE"
  | "BOT_HARNESS_WRONG_ENV"
  | "BOT_HARNESS_NO_PROPS"
  | "BOT_HARNESS_EXTRA_PROPS";

interface HarnessBinding {
  claimWake(input: unknown): Promise<unknown>;
  completeWake(input: unknown): Promise<unknown>;
  readWakeContext(input: unknown): Promise<unknown>;
  fetch(request: Request): Promise<Response>;
}

type TriggerBindingName =
  | "BOT_WAKE_TRIGGER_SERVICE"
  | "BOT_WAKE_TRIGGER_WRONG_ENV"
  | "BOT_WAKE_TRIGGER_NO_PROPS"
  | "BOT_WAKE_TRIGGER_EXTRA_PROPS";

interface TriggerBinding {
  offerWake(input: unknown): Promise<unknown>;
  fetch(request: Request): Promise<Response>;
}

interface PropertySnapshot {
  hadPrevious: boolean;
  previous: unknown;
}

function replaceProperty(
  target: object,
  key: PropertyKey,
  replacement: unknown,
): PropertySnapshot {
  const snapshot = {
    hadPrevious: Object.hasOwn(target, key),
    previous: Reflect.get(target, key),
  };
  if (!Reflect.set(target, key, replacement)) {
    throw new Error(`Workerd refused to replace ${String(key)}`);
  }
  return snapshot;
}

function restoreProperty(
  target: object,
  key: PropertyKey,
  snapshot: PropertySnapshot,
): void {
  const restored = snapshot.hadPrevious
    ? Reflect.set(target, key, snapshot.previous)
    : Reflect.deleteProperty(target, key);
  if (!restored) {
    throw new Error(`Workerd refused to restore ${String(key)}`);
  }
}

function binding(name: HarnessBindingName): HarnessBinding {
  return Reflect.get(env, name) as HarnessBinding;
}

function triggerBinding(name: TriggerBindingName): TriggerBinding {
  return Reflect.get(env, name) as TriggerBinding;
}

const claim = {
  contract: "bot-wake.claim@1",
  installationId,
  wakeId,
};
const completion = {
  contract: "bot-wake.complete@1",
  installationId,
  wakeId,
  turnId,
  terminal: {
    outcome: "succeeded",
    decision: "skip",
    reason: "model_selected_skip",
  },
};
const contextRequest = { installationId, wakeId, turnId };

function exactAuthorization() {
  return {
    ok: true,
    offer,
    turnId,
    authorityGeneration: 7,
    offerDigest,
  };
}

function expectNoPlaintext(value: unknown): void {
  expect(JSON.stringify(value)).not.toContain(plaintextSentinel);
}

describe("BotHarnessService private runtime boundary", () => {
  it("fails closed without exact static service-binding props", async () => {
    await expect(
      binding("BOT_HARNESS_NO_PROPS").claimWake(claim),
    ).resolves.toEqual({
      contract: "bot-wake.claim-result@1",
      ok: false,
      code: "authority_revoked",
    });
    await expect(
      binding("BOT_HARNESS_WRONG_ENV").claimWake(claim),
    ).resolves.toEqual({
      contract: "bot-wake.claim-result@1",
      ok: false,
      code: "authority_revoked",
    });
    for (const name of [
      "BOT_HARNESS_NO_PROPS",
      "BOT_HARNESS_WRONG_ENV",
      "BOT_HARNESS_EXTRA_PROPS",
    ] as const) {
      await expect(binding(name).completeWake(completion)).resolves.toEqual({
        contract: "bot-wake.claim-result@1",
        ok: false,
        code: "authority_revoked",
      });
      await expect(
        binding(name).readWakeContext(contextRequest),
      ).resolves.toEqual({ ok: false, code: "forbidden" });
    }
  });

  it("rejects extra claim fields before reaching an Installation", async () => {
    await expect(
      binding("BOT_HARNESS_SERVICE").claimWake({
        ...claim,
        conversationId: "10000000-0000-8000-8000-000000000003",
      }),
    ).resolves.toEqual({
      contract: "bot-wake.claim-result@1",
      ok: false,
      code: "invalid_request",
    });
    await expect(
      binding("BOT_HARNESS_SERVICE").completeWake({
        ...completion,
        provider: plaintextSentinel,
      }),
    ).resolves.toEqual({
      contract: "bot-wake.claim-result@1",
      ok: false,
      code: "invalid_request",
    });
    const read = await binding("BOT_HARNESS_SERVICE").readWakeContext({
      ...contextRequest,
      conversationId,
    });
    expect(read).toEqual({ ok: false, code: "invalid_request" });
    expectNoPlaintext(read);
  });

  it("returns an exact authoritative claim result", async () => {
    const prototype = BotInstallationDO.prototype;
    let receivedInstallationId: unknown;
    let receivedCommand: unknown;
    const snapshot = replaceProperty(
      prototype,
      "claimBotWake",
      async function (this: object, command: unknown) {
        const context: unknown = Reflect.get(this, "ctx");
        const durableObjectId: unknown =
          typeof context === "object" && context !== null
            ? Reflect.get(context, "id")
            : undefined;
        receivedInstallationId =
          typeof durableObjectId === "object" && durableObjectId !== null
            ? Reflect.get(durableObjectId, "name")
            : undefined;
        receivedCommand = command;
        return {
          contract: "bot-wake.claim-result@1",
          ok: false,
          code: "not_found",
        };
      },
    );
    try {
      await expect(
        binding("BOT_HARNESS_SERVICE").claimWake(claim),
      ).resolves.toEqual({
        contract: "bot-wake.claim-result@1",
        ok: false,
        code: "not_found",
      });
      expect(receivedInstallationId).toBe(installationId);
      expect(receivedCommand).toEqual(claim);
    } finally {
      restoreProperty(prototype, "claimBotWake", snapshot);
    }
  });

  it("returns an exact authoritative completion result", async () => {
    const prototype = BotInstallationDO.prototype;
    const snapshot = replaceProperty(
      prototype,
      "completeBotWake",
      async () => ({
        contract: "bot-wake.claim-result@1",
        ok: false,
        code: "not_found",
      }),
    );
    try {
      await expect(
        binding("BOT_HARNESS_SERVICE").completeWake(completion),
      ).resolves.toEqual({
        contract: "bot-wake.claim-result@1",
        ok: false,
        code: "not_found",
      });
    } finally {
      restoreProperty(prototype, "completeBotWake", snapshot);
    }
  });

  it("returns only bounded plaintext after two identical authority proofs", async () => {
    const installationPrototype = BotInstallationDO.prototype;
    const conversationPrototype = ConversationDO.prototype;
    let authorizationCalls = 0;
    const installationSnapshot = replaceProperty(
      installationPrototype,
      "authorizeBotWakeContext",
      async () => {
        authorizationCalls += 1;
        return exactAuthorization();
      },
    );
    let receivedProof: unknown;
    const conversationSnapshot = replaceProperty(
      conversationPrototype,
      "readBotWakeContext",
      async (proof: unknown) => {
        receivedProof = proof;
        return { ok: true, content: plaintextSentinel };
      },
    );
    try {
      await expect(
        binding("BOT_HARNESS_SERVICE").readWakeContext(contextRequest),
      ).resolves.toEqual({ ok: true, content: plaintextSentinel });
      expect(authorizationCalls).toBe(2);
      expect(receivedProof).toEqual({
        installationId,
        wakeId,
        turnId,
        authorityGeneration: 7,
        offerDigest,
        offer,
      });
    } finally {
      restoreProperty(
        conversationPrototype,
        "readBotWakeContext",
        conversationSnapshot,
      );
      restoreProperty(
        installationPrototype,
        "authorizeBotWakeContext",
        installationSnapshot,
      );
    }
  });

  it("rejects malformed Installation results without leaking their details", async () => {
    const prototype = BotInstallationDO.prototype;
    for (const fixture of [
      {
        method: "claimBotWake",
        invoke: () => binding("BOT_HARNESS_SERVICE").claimWake(claim),
      },
      {
        method: "completeBotWake",
        invoke: () => binding("BOT_HARNESS_SERVICE").completeWake(completion),
      },
    ] as const) {
      const snapshot = replaceProperty(prototype, fixture.method, async () => ({
        contract: "bot-wake.claim-result@1",
        ok: false,
        code: "internal",
        detail: plaintextSentinel,
      }));
      try {
        const response = await fixture.invoke();
        expect(response).toEqual({
          contract: "bot-wake.claim-result@1",
          ok: false,
          code: "temporarily_unavailable",
        });
        expectNoPlaintext(response);
      } finally {
        restoreProperty(prototype, fixture.method, snapshot);
      }
    }
  });

  it("rejects malformed authority and Conversation responses without plaintext", async () => {
    const installationPrototype = BotInstallationDO.prototype;
    const conversationPrototype = ConversationDO.prototype;
    const malformedAuthorization = replaceProperty(
      installationPrototype,
      "authorizeBotWakeContext",
      async () => ({
        ok: false,
        code: "internal",
        detail: plaintextSentinel,
      }),
    );
    try {
      const response = await binding("BOT_HARNESS_SERVICE").readWakeContext(
        contextRequest,
      );
      expect(response).toEqual({
        ok: false,
        code: "temporarily_unavailable",
      });
      expectNoPlaintext(response);
    } finally {
      restoreProperty(
        installationPrototype,
        "authorizeBotWakeContext",
        malformedAuthorization,
      );
    }

    const validAuthorization = replaceProperty(
      installationPrototype,
      "authorizeBotWakeContext",
      async () => exactAuthorization(),
    );
    const malformedContext = replaceProperty(
      conversationPrototype,
      "readBotWakeContext",
      async () => ({
        ok: false,
        code: "internal",
        detail: plaintextSentinel,
      }),
    );
    try {
      const response = await binding("BOT_HARNESS_SERVICE").readWakeContext(
        contextRequest,
      );
      expect(response).toEqual({
        ok: false,
        code: "temporarily_unavailable",
      });
      expectNoPlaintext(response);
    } finally {
      restoreProperty(
        conversationPrototype,
        "readBotWakeContext",
        malformedContext,
      );
      restoreProperty(
        installationPrototype,
        "authorizeBotWakeContext",
        validAuthorization,
      );
    }
  });

  it("discards decrypted content when authority is revoked before final recheck", async () => {
    const installationPrototype = BotInstallationDO.prototype;
    const conversationPrototype = ConversationDO.prototype;
    let authorizationCalls = 0;
    const installationSnapshot = replaceProperty(
      installationPrototype,
      "authorizeBotWakeContext",
      async () => {
        authorizationCalls += 1;
        return authorizationCalls === 1
          ? exactAuthorization()
          : { ok: false, code: "authority_revoked" };
      },
    );
    const conversationSnapshot = replaceProperty(
      conversationPrototype,
      "readBotWakeContext",
      async () => ({ ok: true, content: plaintextSentinel }),
    );
    try {
      const response = await binding("BOT_HARNESS_SERVICE").readWakeContext(
        contextRequest,
      );
      expect(response).toEqual({ ok: false, code: "authority_revoked" });
      expectNoPlaintext(response);
      expect(authorizationCalls).toBe(2);
    } finally {
      restoreProperty(
        conversationPrototype,
        "readBotWakeContext",
        conversationSnapshot,
      );
      restoreProperty(
        installationPrototype,
        "authorizeBotWakeContext",
        installationSnapshot,
      );
    }
  });

  it("discards decrypted content when the final canonical proof changes", async () => {
    const installationPrototype = BotInstallationDO.prototype;
    const conversationPrototype = ConversationDO.prototype;
    let authorizationCalls = 0;
    const installationSnapshot = replaceProperty(
      installationPrototype,
      "authorizeBotWakeContext",
      async () => {
        authorizationCalls += 1;
        return authorizationCalls === 1
          ? exactAuthorization()
          : {
              ...exactAuthorization(),
              offer: changedOffer,
              offerDigest: changedOfferDigest,
            };
      },
    );
    const conversationSnapshot = replaceProperty(
      conversationPrototype,
      "readBotWakeContext",
      async () => ({ ok: true, content: plaintextSentinel }),
    );
    try {
      const response = await binding("BOT_HARNESS_SERVICE").readWakeContext(
        contextRequest,
      );
      expect(response).toEqual({ ok: false, code: "authority_revoked" });
      expectNoPlaintext(response);
      expect(authorizationCalls).toBe(2);
    } finally {
      restoreProperty(
        conversationPrototype,
        "readBotWakeContext",
        conversationSnapshot,
      );
      restoreProperty(
        installationPrototype,
        "authorizeBotWakeContext",
        installationSnapshot,
      );
    }
  });

  it("rejects decrypted content above 8192 UTF-8 bytes", async () => {
    const installationPrototype = BotInstallationDO.prototype;
    const conversationPrototype = ConversationDO.prototype;
    const oversizedContent = "🔥".repeat(2_049);
    const installationSnapshot = replaceProperty(
      installationPrototype,
      "authorizeBotWakeContext",
      async () => exactAuthorization(),
    );
    const conversationSnapshot = replaceProperty(
      conversationPrototype,
      "readBotWakeContext",
      async () => ({ ok: true, content: oversizedContent }),
    );
    try {
      const response = await binding("BOT_HARNESS_SERVICE").readWakeContext(
        contextRequest,
      );
      expect(response).toEqual({ ok: false, code: "content_unavailable" });
      expect(JSON.stringify(response)).not.toContain(oversizedContent);
    } finally {
      restoreProperty(
        conversationPrototype,
        "readBotWakeContext",
        conversationSnapshot,
      );
      restoreProperty(
        installationPrototype,
        "authorizeBotWakeContext",
        installationSnapshot,
      );
    }
  });

  it("exposes only three runtime RPC methods plus the private HTTP handler", () => {
    expect(
      Object.getOwnPropertyNames(BotHarnessService.prototype).sort(),
    ).toEqual([
      "claimWake",
      "completeWake",
      "constructor",
      "fetch",
      "readWakeContext",
    ]);
  });

  it("keeps the Harness HTTP surface private", async () => {
    const response = await binding("BOT_HARNESS_SERVICE").fetch(
      new Request("https://punks.bot/private/bot-harness", {
        method: "POST",
        body: plaintextSentinel,
      }),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });
});

describe("BotWakeTriggerService known-Installation boundary", () => {
  it("fails closed without exact trigger service-binding props", async () => {
    const input = { installationId, conversationId, messageId };
    for (const name of [
      "BOT_WAKE_TRIGGER_NO_PROPS",
      "BOT_WAKE_TRIGGER_WRONG_ENV",
      "BOT_WAKE_TRIGGER_EXTRA_PROPS",
    ] as const) {
      await expect(triggerBinding(name).offerWake(input)).resolves.toEqual({
        ok: false,
        code: "forbidden",
      });
    }
  });

  it("rejects extra trigger fields before reaching a Conversation", async () => {
    await expect(
      triggerBinding("BOT_WAKE_TRIGGER_SERVICE").offerWake({
        installationId,
        conversationId,
        messageId,
        wakeId,
      }),
    ).resolves.toEqual({ ok: false, code: "invalid_request" });
  });

  it("routes only to the explicitly named Conversation", async () => {
    const prototype = ConversationDO.prototype;
    let receivedConversationId: unknown;
    let receivedOffer: unknown;
    const snapshot = replaceProperty(
      prototype,
      "offerBotWake",
      async function (this: object, input: unknown) {
        const context: unknown = Reflect.get(this, "ctx");
        const durableObjectId: unknown =
          typeof context === "object" && context !== null
            ? Reflect.get(context, "id")
            : undefined;
        receivedConversationId =
          typeof durableObjectId === "object" && durableObjectId !== null
            ? Reflect.get(durableObjectId, "name")
            : undefined;
        receivedOffer = input;
        return { ok: true, wakeId };
      },
    );
    try {
      await expect(
        triggerBinding("BOT_WAKE_TRIGGER_SERVICE").offerWake({
          installationId,
          conversationId,
          messageId,
        }),
      ).resolves.toEqual({ ok: true, wakeId });
      expect(receivedConversationId).toBe(conversationId);
      expect(receivedOffer).toEqual({ installationId, messageId });
    } finally {
      restoreProperty(prototype, "offerBotWake", snapshot);
    }
  });

  it("rejects a malformed Conversation result without leaking details", async () => {
    const prototype = ConversationDO.prototype;
    const snapshot = replaceProperty(prototype, "offerBotWake", async () => ({
      ok: true,
      wakeId,
      detail: plaintextSentinel,
    }));
    try {
      const response = await triggerBinding(
        "BOT_WAKE_TRIGGER_SERVICE",
      ).offerWake({ installationId, conversationId, messageId });
      expect(response).toEqual({
        ok: false,
        code: "temporarily_unavailable",
      });
      expectNoPlaintext(response);
    } finally {
      restoreProperty(prototype, "offerBotWake", snapshot);
    }
  });

  it("keeps the trigger HTTP surface private and its RPC interface narrow", async () => {
    const response = await triggerBinding("BOT_WAKE_TRIGGER_SERVICE").fetch(
      new Request("https://punks.bot/private/bot-wake-trigger", {
        method: "POST",
        body: plaintextSentinel,
      }),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(
      Object.getOwnPropertyNames(BotWakeTriggerService.prototype).sort(),
    ).toEqual(["constructor", "fetch", "offerWake"]);
  });
});

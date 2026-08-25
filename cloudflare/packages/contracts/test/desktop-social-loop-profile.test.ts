import { Validator } from "@cfworker/json-schema";
import { describe, expect, it } from "vitest";

import profileSchema from "../profiles/client-profile.schema.json";
import operationCorpus from "../conformance/desktop-social-loop-operations.json";
import desktopSocialLoop from "../profiles/desktop-social-loop@1.json";
import {
  DESKTOP_SOCIAL_LOOP_CAPABILITIES,
  DESKTOP_SOCIAL_LOOP_PROFILE_ID,
  DESKTOP_SOCIAL_LOOP_REGISTRY_VERSION,
} from "../src/generated/desktop-social-loop-profile";
import { validateContract } from "../src/registry";

describe("desktop-social-loop@1 profile", () => {
  it("is a strict, versioned profile of the first desktop social loop", () => {
    const validator = new Validator(profileSchema as never, "2020-12", false);

    expect(validator.validate(desktopSocialLoop).valid).toBe(true);
    expect(desktopSocialLoop).toMatchObject({
      id: "desktop-social-loop@1",
      registryVersion: 1,
      corpusVersion: 1,
      failureKinds: [
        "problem",
        "transport",
        "contract_violation",
        "cancelled",
        "stale_workspace",
        "session_expired",
        "ambiguous",
      ],
    });
    expect(DESKTOP_SOCIAL_LOOP_PROFILE_ID).toBe(desktopSocialLoop.id);
    expect(DESKTOP_SOCIAL_LOOP_REGISTRY_VERSION).toBe(
      desktopSocialLoop.registryVersion,
    );
    expect(DESKTOP_SOCIAL_LOOP_CAPABILITIES).toEqual(
      desktopSocialLoop.capabilities,
    );
  });

  it("closes the exact account and WorkspaceSession operation surface", () => {
    expect(desktopSocialLoop.operations.map(({ name }) => name)).toEqual([
      "checkCompatibility",
      "getSession",
      "getPunkProfile",
      "updatePunkProfile",
      "startDesktopAuthentication",
      "getDesktopAuthenticationStatus",
      "claimDesktopAuthentication",
      "confirmDesktopAuthentication",
      "cancelDesktopAuthentication",
      "renewDesktopSession",
      "revokeDesktopSession",
      "listWorkspaces",
      "resolveWorkspace",
      "openWorkspace",
      "closeWorkspace",
      "listStreams",
      "getStream",
      "getTimeline",
      "getThread",
      "resolveAuthors",
      "getPunkSummaries",
      "searchPunks",
      "followConversation",
      "confirmFollowBatch",
      "postMessage",
      "addReaction",
      "removeReaction",
    ]);
    expect(desktopSocialLoop.operations).toSatisfy(
      (operations: Array<{ command?: boolean; retry?: string }>) =>
        operations
          .filter(({ command }) => command === true)
          .every(({ retry }) =>
            ["human_intent_required", "same_identity"].includes(retry ?? ""),
          ),
    );
    expect(desktopSocialLoop.operations).toSatisfy(
      (operations: Array<{ cancellablePhases?: string[] }>) =>
        operations.every(({ cancellablePhases }) =>
          Array.isArray(cancellablePhases),
        ),
    );
    expect(
      desktopSocialLoop.operations.find(
        ({ name }) => name === "followConversation",
      )?.kind,
    ).toBe("follow");
    expect(
      desktopSocialLoop.operations
        .filter(({ name }) =>
          ["openWorkspace", "closeWorkspace", "confirmFollowBatch"].includes(
            name,
          ),
        )
        .map(({ kind }) => kind),
    ).toEqual([
      "local-orchestration",
      "local-orchestration",
      "local-orchestration",
    ]);
  });

  it("ferme le corpus commun sur les opérations et leurs scénarios applicables", () => {
    expect(operationCorpus.version).toBe(desktopSocialLoop.corpusVersion);
    expect(
      operationCorpus.operations.map(({ operation }) => operation),
    ).toEqual(desktopSocialLoop.operations.map(({ name }) => name));
    for (const operation of operationCorpus.operations) {
      const stimuli = new Set(operation.cases.map(({ stimulus }) => stimulus));
      const profileOperation = desktopSocialLoop.operations.find(
        ({ name }) => name === operation.operation,
      );
      expect(profileOperation, operation.operation).toBeDefined();
      expect(stimuli, operation.operation).toContain("success");
      for (const testCase of operation.cases) {
        expect(
          testCase.events.length,
          `${operation.operation}/${testCase.name}`,
        ).toBeGreaterThan(0);
      }
      if (operation.request !== null) {
        expect([...stimuli], operation.operation).toEqual(
          expect.arrayContaining([
            "valid_request",
            "unknown_field",
            "version_incompatibility",
          ]),
        );
        const requestValidation = validateContract(
          operation.request.contract as never,
          operation.request.payload,
        );
        expect(
          requestValidation.valid,
          `${operation.operation} request ${JSON.stringify(requestValidation)}`,
        ).toBe(true);
      }
      if (operation.response !== null) {
        expect([...stimuli], operation.operation).toEqual(
          expect.arrayContaining(["valid_response", "malformed_response"]),
        );
        const responseValidation = validateContract(
          operation.response.contract as never,
          operation.response.payload,
        );
        expect(
          responseValidation.valid,
          `${operation.operation} response ${JSON.stringify(responseValidation)}`,
        ).toBe(true);
      }
      if (operation.kind === "read") {
        expect([...stimuli], operation.operation).toEqual(
          expect.arrayContaining([
            "cancel_before_emit",
            "interrupt_before_emit",
            "interrupt_after_emit",
            "safe_read_resume",
            "session_expired",
            "closed_problem",
          ]),
        );
      }
      if (operation.kind === "mutation") {
        expect([...stimuli], operation.operation).toEqual(
          expect.arrayContaining([
            "authoritative_noop",
            "replayed_response",
            "loss_after_commit",
            "same_command",
            "closed_problem",
          ]),
        );
      }
      for (const phase of profileOperation?.cancellablePhases ?? []) {
        expect(stimuli, `${operation.operation}/${phase}`).toContain(
          `cancel_${phase}`,
        );
      }
      if (operation.kind === "follow") {
        const malformedFrame = operation.cases.find(
          ({ stimulus }) => stimulus === "malformed_frame",
        );
        expect(malformedFrame?.contract).toBe(
          "punks://contracts/conversation.follow-server-frame@1",
        );
        expect(
          validateContract(
            malformedFrame?.contract as never,
            malformedFrame?.payload,
          ).valid,
        ).toBe(false);
      }
      if (operation.kind === "local-orchestration") {
        expect(stimuli, operation.operation).not.toContain("closed_problem");
        expect(stimuli, operation.operation).not.toContain("session_expired");
        expect(stimuli, operation.operation).not.toContain("stale_before_io");
        expect(stimuli, operation.operation).not.toContain("stale_during_io");
      }
      for (const testCase of operation.cases) {
        expect(Object.keys(testCase.expect).sort()).toEqual([
          "ack",
          "case",
          "deliveries",
          "failureKind",
          "generation",
          "operation",
          "outcome",
          "phase",
          "recoveryDecision",
          "rendererConfirmation",
        ]);
      }
    }
  });

  it("keeps every later capability structurally unavailable", () => {
    expect(desktopSocialLoop.unavailableCapabilities).toEqual([
      "message-lifecycle",
      "account-merge",
      "identity-governance",
      "workspace-lifecycle",
      "conversation-management",
      "attention",
      "presence",
      "search",
      "moderation",
      "forum",
      "direct-conversations",
      "command-palette",
      "bots",
      "references-broadcasts",
      "pins-bookmarks",
      "home",
      "attachments",
      "visual-identities",
      "canvas",
      "repositories",
      "local-bot-body",
      "workflows",
      "forge",
      "huddles",
      "advanced-agents",
      "external-workflows",
      "templates",
      "voice-extensions",
      "pulse",
      "shared-compute",
    ]);
  });
});

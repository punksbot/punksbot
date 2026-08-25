import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://staging.punks.bot/",
});
let cleanup;
let fireEvent;
let render;
let screen;
let waitFor;
let createElement;
let PunksRuntime;
let visibilityState = "visible";

const compatibility = {
  contract: "desktop.compatibility-response@1",
  compatible: true,
  profile: "desktop-social-loop@1",
  registryVersion: 1,
  minimumClientVersion: "0.6.0",
  environment: "staging",
  origin: "https://staging.punks.bot",
  capabilities: ["authentication"],
};

before(async () => {
  Object.assign(globalThis, {
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    PopStateEvent: dom.window.PopStateEvent,
    window: dom.window,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });
  Object.defineProperty(dom.window.document, "visibilityState", {
    configurable: true,
    get: () => visibilityState,
  });
  dom.window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  ({ cleanup, fireEvent, render, screen, waitFor } = await import(
    "@testing-library/react"
  ));
  ({ createElement } = await import("react"));
  ({ PunksRuntime } = await import("./PunksRuntime.tsx"));
});

afterEach(() => {
  visibilityState = "visible";
  cleanup?.();
});
after(() => dom.window.close());

test("interrupted authentication waits for an explicit Finish sign-in action", async () => {
  let resumeCalls = 0;
  const client = {
    async getAccountSessionState() {
      return {
        state: "signed_out",
        authentication: { phase: "ready" },
        resumeAvailable: true,
      };
    },
    async resumeInterruptedAuthentication() {
      resumeCalls += 1;
      return { phase: "ready" };
    },
  };

  render(
    createElement(PunksRuntime, {
      client,
      compatibility,
      route: { kind: "home" },
    }),
  );

  const finish = await screen.findByRole("button", { name: "Finish sign-in" });
  assert.equal(resumeCalls, 0);
  assert.ok(screen.getByRole("button", { name: "Passkey" }));
  assert.ok(screen.getByRole("button", { name: "Cancel" }));

  fireEvent.click(finish);
  await screen.findByText(/finish authorization in your system browser/i);
  assert.equal(resumeCalls, 1);
});

test("Passkey sign-in uses the semantic startSignIn method", async () => {
  const providers = [];
  const client = {
    async getAccountSessionState() {
      return {
        state: "signed_out",
        authentication: { phase: "idle" },
        resumeAvailable: false,
      };
    },
    async startSignIn(provider) {
      providers.push(provider);
      return { phase: "started", intent: "sign_in", method: provider };
    },
  };
  render(
    createElement(PunksRuntime, {
      client,
      compatibility,
      route: { kind: "home" },
    }),
  );

  fireEvent.click(await screen.findByRole("button", { name: "Passkey" }));
  await screen.findByText(/finish authorization in your system browser/i);
  assert.deepEqual(providers, ["passkey"]);
});

test("Account renewal is requested only on a visible foreground return", async () => {
  let renewCalls = 0;
  const client = {
    async getAccountSessionState() {
      return {
        state: "authenticated",
        authentication: { phase: "idle" },
        resumeAvailable: false,
        session: {
          sessionId: "11111111-1111-4111-8111-111111111111",
          punkId: "22222222-2222-4222-8222-222222222222",
          authenticatedAt: "2026-08-25T10:00:00.000Z",
          expiresAt: "2026-08-26T10:00:00.000Z",
          recentReauthUntil: null,
          punk: {
            id: "22222222-2222-4222-8222-222222222222",
            displayName: "Foreground Punk",
            avatarUrl: null,
          },
        },
      };
    },
    async listWorkspaces() {
      return [];
    },
    async renewAccountSession() {
      renewCalls += 1;
      return { phase: "idle" };
    },
  };
  render(
    createElement(PunksRuntime, {
      client,
      compatibility,
      route: { kind: "home" },
    }),
  );
  await screen.findByTestId("punks-no-workspace");
  assert.equal(renewCalls, 0);

  visibilityState = "hidden";
  dom.window.document.dispatchEvent(new dom.window.Event("visibilitychange"));
  dom.window.dispatchEvent(new dom.window.Event("focus"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(renewCalls, 0);

  visibilityState = "visible";
  dom.window.document.dispatchEvent(new dom.window.Event("visibilitychange"));
  await waitFor(() => assert.equal(renewCalls, 1));
});

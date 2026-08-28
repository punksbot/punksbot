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
let useEffect;
let useState;
let PunksRuntime;
let parsePunksPath;
let createPunksLocalStore;
let visibilityState = "visible";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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
  ({ createElement, useEffect, useState } = await import("react"));
  ({ PunksRuntime } = await import("./PunksRuntime.tsx"));
  ({ parsePunksPath } = await import("./routes.ts"));
  ({ createPunksLocalStore } = await import("./storage.ts"));
});

afterEach(() => {
  visibilityState = "visible";
  cleanup?.();
  dom.window.localStorage.clear();
  dom.window.history.replaceState({}, "", "/");
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
  assert.equal(
    screen.queryByRole("button", { name: "Passkey" }) === null,
    true,
  );
  assert.ok(screen.getByRole("button", { name: "Cancel" }));

  fireEvent.click(finish);
  await screen.findByText(/finish authorization in your system browser/i);
  assert.equal(resumeCalls, 1);
});

test("Google and GitHub are the only sign-in choices", async () => {
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

  const google = await screen.findByRole("button", { name: "Google" });
  assert.ok(screen.getByRole("button", { name: "GitHub" }));
  assert.equal(
    screen.queryByRole("button", { name: "Passkey" }) === null,
    true,
  );
  fireEvent.click(google);
  await screen.findByText(/finish authorization in your system browser/i);
  assert.deepEqual(providers, ["google"]);
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

test("a failed secure-store sign-out stays blocked instead of claiming signed out", async () => {
  let signOutCalls = 0;
  const punkId = "22222222-2222-4222-8222-222222222222";
  const workspaceId = "33333333-3333-4333-8333-333333333333";
  const client = {
    async getAccountSessionState() {
      return {
        state: "authenticated",
        authentication: { phase: "idle" },
        resumeAvailable: false,
        session: {
          sessionId: "11111111-1111-4111-8111-111111111111",
          punkId,
          authenticatedAt: "2026-08-25T10:00:00.000Z",
          expiresAt: "2026-09-25T10:00:00.000Z",
          recentReauthUntil: null,
          punk: { id: punkId, displayName: "Locked Punk", avatarUrl: null },
        },
      };
    },
    async listWorkspaces() {
      return [
        {
          id: workspaceId,
          slug: "locked",
          name: "Locked Workspace",
          visibility: "private",
          role: "owner",
          revision: 1,
        },
      ];
    },
    async openWorkspace() {
      return {
        lease: {
          origin: compatibility.origin,
          punkId,
          workspaceId,
          generation: 1,
        },
        async listStreams() {
          return [];
        },
        async close() {},
      };
    },
    async signOut() {
      signOutCalls += 1;
      throw new Error("secure Account storage is unavailable");
    },
  };
  render(
    createElement(PunksRuntime, {
      client,
      compatibility,
      route: { kind: "home" },
    }),
  );

  fireEvent.click(await screen.findByTestId("punks-sign-out"));
  await screen.findByTestId("punks-compatibility-gate");
  assert.equal(signOutCalls, 1);
  assert.equal(screen.queryByTestId("punks-workspace-shell"), null);
  assert.equal(screen.queryByRole("button", { name: "Passkey" }), null);
});

test("route restoration mounts only the final authorized Workspace", async () => {
  const punkId = "22222222-2222-4222-8222-222222222222";
  const firstWorkspaceId = "33333333-3333-4333-8333-333333333333";
  const restoredWorkspaceId = "44444444-4444-4444-8444-444444444444";
  const localStore = createPunksLocalStore(dom.window.localStorage, {
    origin: compatibility.origin,
    punkId,
  });
  localStore.saveLastWorkspaceId(firstWorkspaceId);
  localStore.saveRouteCoordinates({ workspaceId: restoredWorkspaceId });

  const openedWorkspaceIds = [];
  let generation = 0;
  const workspaces = [
    {
      id: firstWorkspaceId,
      slug: "first",
      name: "First Workspace",
      visibility: "private",
      role: "owner",
      revision: 1,
    },
    {
      id: restoredWorkspaceId,
      slug: "restored",
      name: "Restored Workspace",
      visibility: "private",
      role: "member",
      revision: 1,
    },
  ];
  const client = {
    async getAccountSessionState() {
      return {
        state: "authenticated",
        authentication: { phase: "idle" },
        resumeAvailable: false,
        session: {
          sessionId: "11111111-1111-4111-8111-111111111111",
          punkId,
          authenticatedAt: "2026-08-25T10:00:00.000Z",
          expiresAt: "2026-09-25T10:00:00.000Z",
          recentReauthUntil: null,
          punk: { id: punkId, displayName: "Restored Punk", avatarUrl: null },
        },
      };
    },
    async listWorkspaces() {
      return workspaces;
    },
    async validateNavigation(url) {
      await Promise.resolve();
      return { kind: "workspace", path: new URL(url).pathname };
    },
    async openWorkspace(workspaceId) {
      openedWorkspaceIds.push(workspaceId);
      generation += 1;
      return {
        lease: {
          origin: compatibility.origin,
          punkId,
          workspaceId,
          generation,
        },
        async listStreams() {
          return [];
        },
        async close() {},
      };
    },
  };

  function RuntimeHarness() {
    const [route, setRoute] = useState(() =>
      parsePunksPath(dom.window.location.pathname),
    );
    useEffect(() => {
      const update = () =>
        setRoute(parsePunksPath(dom.window.location.pathname));
      dom.window.addEventListener("popstate", update);
      return () => dom.window.removeEventListener("popstate", update);
    }, []);
    return createElement(PunksRuntime, { client, compatibility, route });
  }

  render(createElement(RuntimeHarness));

  await waitFor(() =>
    assert.equal(dom.window.location.pathname, "/w/restored"),
  );
  await screen.findByTestId("punks-workspace-shell");
  assert.deepEqual(openedWorkspaceIds, [restoredWorkspaceId]);
});

test("restoration purges persisted coordinates for a forbidden Workspace", async () => {
  const punkId = "22222222-2222-4222-8222-222222222222";
  const forbiddenWorkspaceId = "33333333-3333-4333-8333-333333333333";
  const allowedWorkspaceId = "44444444-4444-4444-8444-444444444444";
  const localStore = createPunksLocalStore(dom.window.localStorage, {
    origin: compatibility.origin,
    punkId,
  });
  localStore.saveLastWorkspaceId(forbiddenWorkspaceId);
  localStore.saveRouteCoordinates({ workspaceId: forbiddenWorkspaceId });
  const openedWorkspaceIds = [];
  const client = {
    async getAccountSessionState() {
      return {
        state: "authenticated",
        authentication: { phase: "idle" },
        resumeAvailable: false,
        session: {
          sessionId: "11111111-1111-4111-8111-111111111111",
          punkId,
          authenticatedAt: "2026-08-25T10:00:00.000Z",
          expiresAt: "2026-09-25T10:00:00.000Z",
          recentReauthUntil: null,
          punk: { id: punkId, displayName: "Allowed Punk", avatarUrl: null },
        },
      };
    },
    async listWorkspaces() {
      return [
        {
          id: allowedWorkspaceId,
          slug: "allowed",
          name: "Allowed Workspace",
          visibility: "private",
          role: "member",
          revision: 1,
        },
      ];
    },
    async openWorkspace(workspaceId) {
      openedWorkspaceIds.push(workspaceId);
      return {
        lease: {
          origin: compatibility.origin,
          punkId,
          workspaceId,
          generation: 1,
        },
        async listStreams() {
          return [];
        },
        async close() {},
      };
    },
  };

  render(
    createElement(PunksRuntime, {
      client,
      compatibility,
      route: { kind: "home" },
    }),
  );

  await screen.findByTestId("punks-workspace-shell");
  assert.deepEqual(openedWorkspaceIds, [allowedWorkspaceId]);
  assert.equal(localStore.loadLastWorkspaceId(), allowedWorkspaceId);
  assert.deepEqual(localStore.loadRouteCoordinates(), {});
  assert.equal(
    [...Array(dom.window.localStorage.length).keys()]
      .map((index) => dom.window.localStorage.key(index))
      .filter((key) => key !== null)
      .map((key) => dom.window.localStorage.getItem(key))
      .join("\n")
      .includes(forbiddenWorkspaceId),
    false,
  );
});

test("a Workspace directory problem never claims that the Account signed out", async () => {
  const { PunksDesktopFailure } = await import("@/shared/api/punksClient");
  const punkId = "22222222-2222-4222-8222-222222222222";
  const client = {
    async getAccountSessionState() {
      return {
        state: "authenticated",
        authentication: { phase: "idle" },
        resumeAvailable: false,
        session: {
          sessionId: "11111111-1111-4111-8111-111111111111",
          punkId,
          authenticatedAt: "2026-08-25T10:00:00.000Z",
          expiresAt: "2026-09-25T10:00:00.000Z",
          recentReauthUntil: null,
          punk: { id: punkId, displayName: "Authorized Punk", avatarUrl: null },
        },
      };
    },
    async listWorkspaces() {
      throw new PunksDesktopFailure(
        "problem",
        "Workspace directory is temporarily unavailable",
      );
    },
  };

  render(
    createElement(PunksRuntime, {
      client,
      compatibility,
      route: { kind: "home" },
    }),
  );

  await screen.findByTestId("punks-runtime-error");
  assert.equal(screen.queryByTestId("punks-signed-out"), null);
  assert.equal(screen.queryByRole("button", { name: "Passkey" }), null);
});

test("Account switching tears down the mounted Workspace before ceremony I/O", async () => {
  const teardown = deferred();
  const punkId = "22222222-2222-4222-8222-222222222222";
  const workspaceId = "33333333-3333-4333-8333-333333333333";
  let switchStarted = false;
  let switchCalls = 0;
  const client = {
    async getAccountSessionState() {
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
      return {
        state: "authenticated",
        authentication: { phase: "idle" },
        resumeAvailable: false,
        session: {
          sessionId: "11111111-1111-4111-8111-111111111111",
          punkId,
          authenticatedAt: "2026-08-25T10:00:00.000Z",
          expiresAt: "2026-09-25T10:00:00.000Z",
          recentReauthUntil: null,
          punk: { id: punkId, displayName: "Switching Punk", avatarUrl: null },
        },
      };
    },
    async listWorkspaces() {
      return [
        {
          id: workspaceId,
          slug: "switching",
          name: "Switching Workspace",
          visibility: "private",
          role: "owner",
          revision: 1,
        },
      ];
    },
    async openWorkspace() {
      return {
        lease: {
          origin: compatibility.origin,
          punkId,
          workspaceId,
          generation: 1,
        },
        async listStreams() {
          return [];
        },
        async close() {
          await teardown.promise;
        },
      };
    },
    async startAccountSwitch(provider) {
      switchCalls += 1;
      switchStarted = true;
      return { phase: "started", intent: "switch_account", method: provider };
    },
    async cancelAuthentication() {
      switchStarted = false;
      return { phase: "cancelled" };
    },
  };

  dom.window.history.replaceState({}, "", "/w/switching");
  render(
    createElement(PunksRuntime, {
      client,
      compatibility,
      route: { kind: "workspace", workspaceSlug: "switching" },
    }),
  );

  await screen.findByTestId("punks-workspace-shell");
  fireEvent.click(screen.getByRole("button", { name: "Switch Account" }));
  fireEvent.click(screen.getByRole("button", { name: "GitHub" }));
  await waitFor(() =>
    assert.equal(screen.queryByTestId("punks-workspace-shell"), null),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(switchCalls, 0);

  teardown.resolve();
  await screen.findByTestId("punks-account-switching");
  assert.equal(switchCalls, 1);
  assert.equal(dom.window.location.pathname, "/");
});

import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "@/app/App";
import { RootErrorBoundary } from "@/app/RootErrorBoundary";
import { NostrBindConsentDialog } from "@/features/profile/ui/NostrBindConsentDialog";
import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/inter/opsz-italic.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "@/shared/styles/globals.css";
import { UpdaterProvider } from "@/features/settings/hooks/UpdaterProvider";
import { migrateLegacyCommunityStorageBeforeRender } from "@/features/communities/legacyCommunityStorage";
import { CommunitiesProvider } from "@/features/communities/useCommunities";
import { huddleWindowChannelId } from "@/features/huddle/lib/huddleWindow";
import { CommunityOnboardingProvider } from "@/features/onboarding/communityOnboarding";
import { ThemeProvider } from "@/shared/theme/ThemeProvider";
import { EmojiBurstProvider } from "@/shared/ui/EmojiBurstProvider";
import { PoofBurstProvider } from "@/shared/ui/PoofBurstProvider";
import { Toaster } from "@/shared/ui/sonner";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { recoverLocalStorageQuotaOnStartup } from "@/shared/lib/localStorageQuota";
import { startLocalStorageSweep } from "@/shared/lib/localStorageSweep";
import { initializeConversationDensityPreference } from "@/shared/lib/conversationDensityPreference";
import { initializeFontSizePreference } from "@/shared/lib/fontSizePreference";
import { invoke } from "@tauri-apps/api/core";
import { migratePunksStorage } from "@/shared/lib/punksStorageMigration";
import { listLocalWorkspaces } from "@/shared/api/tauriLocalWorkspaces";

type E2eWindow = Window & {
  __PUNKS_E2E__?: unknown;
};

const E2E_DEFAULT_PUBKEY = "deadbeef".repeat(8);
const E2E_COMMUNITY_ID = "e2e-default-community";
const ONBOARDING_COMPLETION_STORAGE_KEY_PREFIX =
  "punks-onboarding-complete.v1:";
const DEV_STATE_RESET_PARAM = "resetDevState";
const PUNKS_LOCAL_COMMUNITY_ID = "punks-full-local";
const MACHINE_ONBOARDING_COMPLETION_STORAGE_KEY =
  "punks-machine-onboarding-complete.v2";

type LocalIdentity = { pubkey: string };

async function configurePunksFullLocal() {
  if (import.meta.env.VITE_PUNKS_LOCAL !== "1") return;

  const identity = await invoke<LocalIdentity>("get_identity");
  const workspaces = (await listLocalWorkspaces()).filter(
    (workspace) => !workspace.archived,
  );
  const communities = workspaces.map((workspace) => ({
    addedAt: new Date(workspace.createdAt * 1000).toISOString(),
    id: workspace.id,
    name: workspace.name,
    pubkey: identity.pubkey,
    relayUrl: workspace.relayUrl,
  }));
  if (communities.length === 0) {
    throw new Error("Punks Full Local has no active Workspace");
  }
  window.localStorage.setItem("punks-communities", JSON.stringify(communities));
  const savedActiveId = window.localStorage.getItem(
    "punks-active-community-id",
  );
  const activeId =
    savedActiveId &&
    communities.some((community) => community.id === savedActiveId)
      ? savedActiveId
      : (communities.find(
          (community) => community.id === PUNKS_LOCAL_COMMUNITY_ID,
        )?.id ?? communities[0].id);
  window.localStorage.setItem("punks-active-community-id", activeId);
  window.localStorage.setItem(
    `${ONBOARDING_COMPLETION_STORAGE_KEY_PREFIX}${identity.pubkey}`,
    "true",
  );
  window.localStorage.setItem(
    `${MACHINE_ONBOARDING_COMPLETION_STORAGE_KEY}:${identity.pubkey}`,
    "true",
  );
}

function resetDevWebviewStateFromUrl() {
  if (!import.meta.env.DEV) {
    return;
  }

  const url = new URL(window.location.href);
  if (url.searchParams.get(DEV_STATE_RESET_PARAM) !== "1") {
    return;
  }

  // WebKit groups every Punks binary under one disk directory, but storage is
  // isolated by origin. Clearing here resets only this dev server's origin;
  // deleting the shared WebKit directory would also destroy installed-app state.
  window.localStorage.clear();
  window.sessionStorage.clear();
  url.searchParams.delete(DEV_STATE_RESET_PARAM);
  window.history.replaceState(window.history.state, "", url);
}

function configureDevE2eBridgeFromUrl() {
  if (import.meta.env.MODE !== "e2e") {
    return;
  }

  const url = new URL(window.location.href);
  if (url.searchParams.get("e2e") !== "mock") {
    return;
  }

  const e2eWindow = window as E2eWindow;
  e2eWindow.__PUNKS_E2E__ ??= { mode: "mock" };

  const community = {
    addedAt: new Date().toISOString(),
    id: E2E_COMMUNITY_ID,
    name: "E2E Test",
    relayUrl: "ws://localhost:3000",
  };
  window.localStorage.setItem("punks-communities", JSON.stringify([community]));
  window.localStorage.setItem("punks-active-community-id", E2E_COMMUNITY_ID);
  window.localStorage.setItem(
    `${ONBOARDING_COMPLETION_STORAGE_KEY_PREFIX}${E2E_DEFAULT_PUBKEY}`,
    "true",
  );
}

function renderApp() {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      {/* block/punks#5078 — catch any uncaught render error so a WebKit
          SecurityError from localStorage can't blank the whole window. */}
      <RootErrorBoundary>
        <CommunitiesProvider>
          <CommunityOnboardingProvider
            enabled={huddleWindowChannelId() === null}
          >
            <ThemeProvider defaultTheme="punks">
              <TooltipProvider>
                <EmojiBurstProvider>
                  <PoofBurstProvider>
                    <UpdaterProvider>
                      <App />
                      <NostrBindConsentDialog />
                    </UpdaterProvider>
                    <Toaster />
                  </PoofBurstProvider>
                </EmojiBurstProvider>
              </TooltipProvider>
            </ThemeProvider>
          </CommunityOnboardingProvider>
        </CommunitiesProvider>
      </RootErrorBoundary>
    </React.StrictMode>,
  );
}

async function installE2eBridgeIfConfigured() {
  // The mock bridge is compiled only into dev and explicit E2E builds. A
  // pre-bootstrap global alone must never activate mock IPC in production.
  if (import.meta.env.MODE !== "e2e" || !(window as E2eWindow).__PUNKS_E2E__) {
    return;
  }

  const { maybeInstallE2eTauriMocks } = await import("@/testing/e2eBridge");
  maybeInstallE2eTauriMocks();
}

async function bootstrap() {
  resetDevWebviewStateFromUrl();
  configureDevE2eBridgeFromUrl();
  if (import.meta.env.VITE_PUNKS_LOCAL === "1") {
    migratePunksStorage(window.localStorage);
  }
  recoverLocalStorageQuotaOnStartup();
  initializeConversationDensityPreference();
  initializeFontSizePreference();
  startLocalStorageSweep();
  await installE2eBridgeIfConfigured();
  await migrateLegacyCommunityStorageBeforeRender();
  await configurePunksFullLocal();
  renderApp();
}

void bootstrap();

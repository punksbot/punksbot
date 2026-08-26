import { spawn } from "node:child_process";
import { openSync, readFileSync, writeFileSync } from "node:fs";

import axeCore from "axe-core";
import { Builder, By, Capabilities, Key, until } from "selenium-webdriver";

import {
  AUTHENTICATION_SCENARIO_OUTCOMES,
  FOLLOW_SCENARIO_OUTCOMES,
  REQUIRED_STORIES,
} from "../promotion-installed-transcript-lib.mjs";
import { PREUVES_RECUPERATION } from "../promotion-resilience-lib.mjs";
import {
  createStagingBoundary,
  exerciseIndependentFaultMatrix,
  promotionAuthorityTargets,
} from "./independent-fault-controller.mjs";
import { withNativeScreenReader } from "./native-screen-reader.mjs";

function fail(message) {
  throw new Error(`installed platform automation rejected: ${message}`);
}

function testId(value) {
  return `[data-testid="${value}"]`;
}

function messageSelector(messageId) {
  return `[data-message-id="${messageId}"]`;
}

function boundedText(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 500 ||
    value.trim() !== value
  ) {
    fail(`${label} is not one bounded observation`);
  }
  return value;
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function waitForTauriDriver(process) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (process.exitCode !== null) {
      fail(
        `tauri-driver exited before accepting a session (${process.exitCode})`,
      );
    }
    try {
      const response = await fetch("http://127.0.0.1:4444/status", {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) return;
    } catch {
      // The native driver has not bound its loopback port yet.
    }
    await wait(250);
  }
  fail("tauri-driver did not become ready within 30 seconds");
}

function parseIpcJournal(path) {
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line !== "");
  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      return fail(`native IPC journal line ${index + 1} is not JSON`);
    }
  });
}

export function traceFromIpc(path) {
  const records = parseIpcJournal(path);
  const accepted = records.find(
    ({ command, status }) =>
      command === "punks_follow_conversation" && status === "ok",
  );
  const operationId = accepted?.coordinates?.operationId;
  const operationRecords = records.filter(
    ({ coordinates }) => coordinates?.operationId === operationId,
  );
  const batch = operationRecords.find(
    ({ command, status, coordinates }) =>
      command === "punks_follow_next" &&
      status === "ok" &&
      coordinates?.kind === "apply_batch",
  );
  const ack = operationRecords.find(
    ({ command, status, coordinates }) =>
      command === "punks_confirm_follow_batch" &&
      status === "ok" &&
      coordinates?.throughCursor === batch?.coordinates?.throughCursor,
  );
  const live = operationRecords.find(
    ({ command, status, coordinates }) =>
      command === "punks_follow_next" &&
      status === "ok" &&
      coordinates?.kind === "became_live",
  );
  const terminal = operationRecords.find(
    ({ command, status }) =>
      command === "punks_close_follow" && status === "ok",
  );
  if (
    !Number.isSafeInteger(accepted?.coordinates?.afterCursor) ||
    typeof operationId !== "string" ||
    operationId.length === 0 ||
    operationId.length > 200 ||
    !Number.isSafeInteger(accepted?.sequence) ||
    !Number.isSafeInteger(batch?.coordinates?.fromExclusiveCursor) ||
    !Number.isSafeInteger(batch?.coordinates?.throughCursor) ||
    ack === undefined ||
    live === undefined ||
    terminal === undefined ||
    !Number.isSafeInteger(batch.sequence) ||
    !Number.isSafeInteger(ack.sequence) ||
    !Number.isSafeInteger(live.sequence) ||
    !Number.isSafeInteger(terminal.sequence) ||
    batch.sequence <= accepted.sequence ||
    live.sequence <= accepted.sequence ||
    ack.sequence <= batch.sequence ||
    terminal.sequence <= ack.sequence ||
    terminal.sequence <= live.sequence
  ) {
    fail(
      "native IPC journal does not contain a complete handoff for the same native FOLLOW operation",
    );
  }
  const acceptedCursor = `cursor-${accepted.coordinates.afterCursor}`;
  const previousCursor = `cursor-${batch.coordinates.fromExclusiveCursor}`;
  const cursor = `cursor-${batch.coordinates.throughCursor}`;
  if (acceptedCursor !== previousCursor) {
    fail("native FOLLOW batch does not continue the accepted cursor");
  }
  const change = [
    {
      state: "changes",
      previousCursor,
      cursor,
      batchId: `native-${batch.sequence}`,
      atomic: true,
    },
    { state: "renderer-confirmed", cursor },
    { state: "ack", cursor },
  ];
  return live.sequence < batch.sequence
    ? [
        { state: "accepted", cursor: acceptedCursor },
        { state: "ready", cursor: acceptedCursor },
        { state: "live", cursor: acceptedCursor },
        ...change,
        { state: "terminal", cursor },
      ]
    : [
        { state: "accepted", cursor: acceptedCursor },
        ...change,
        { state: "ready", cursor },
        { state: "live", cursor },
        { state: "terminal", cursor },
      ];
}

export function followScenariosFromIpc(path) {
  const records = parseIpcJournal(path).filter(
    ({ command, status }) =>
      command === "punks_promotion_live_follow_conformance" && status === "ok",
  );
  if (records.length !== 1) {
    fail(
      "installed native FOLLOW conformance observation is missing or duplicated",
    );
  }
  const scenarios = records[0]?.coordinates?.scenarios;
  if (
    scenarios === null ||
    typeof scenarios !== "object" ||
    Array.isArray(scenarios) ||
    JSON.stringify(Object.keys(scenarios).sort()) !==
      JSON.stringify(Object.keys(FOLLOW_SCENARIO_OUTCOMES).sort())
  ) {
    fail("installed native FOLLOW scenario set is incomplete");
  }
  for (const [id, outcome] of Object.entries(FOLLOW_SCENARIO_OUTCOMES)) {
    const observed = scenarios[id];
    if (
      observed === null ||
      typeof observed !== "object" ||
      Array.isArray(observed) ||
      JSON.stringify(Object.keys(observed).sort()) !==
        JSON.stringify(["observations", "outcome"]) ||
      observed.outcome !== outcome ||
      !Array.isArray(observed.observations) ||
      observed.observations.length === 0 ||
      observed.observations.some(
        (value) => typeof value !== "string" || value.trim() === "",
      )
    ) {
      fail(`installed native FOLLOW scenario ${id} is invalid`);
    }
  }
  return scenarios;
}

export function authenticationFromIpc(path, fixture) {
  const records = parseIpcJournal(path);
  const conformance = records.filter(
    ({ command, status }) =>
      command === "punks_promotion_auth_conformance" && status === "ok",
  );
  if (conformance.length !== 1) {
    fail(
      "installed native authentication conformance is missing or duplicated",
    );
  }
  const scenarios = conformance[0]?.coordinates?.scenarios;
  if (
    scenarios === null ||
    typeof scenarios !== "object" ||
    Array.isArray(scenarios) ||
    JSON.stringify(Object.keys(scenarios).sort()) !==
      JSON.stringify(Object.keys(AUTHENTICATION_SCENARIO_OUTCOMES).sort())
  ) {
    fail("installed native authentication scenario set is incomplete");
  }
  for (const [id, outcome] of Object.entries(
    AUTHENTICATION_SCENARIO_OUTCOMES,
  )) {
    const observed = scenarios[id];
    if (
      observed === null ||
      typeof observed !== "object" ||
      Array.isArray(observed) ||
      JSON.stringify(Object.keys(observed).sort()) !==
        JSON.stringify(["observations", "outcome"]) ||
      observed.outcome !== outcome ||
      !Array.isArray(observed.observations) ||
      observed.observations.length === 0 ||
      observed.observations.some(
        (value) => typeof value !== "string" || value.trim() === "",
      )
    ) {
      fail(`installed native authentication scenario ${id} is invalid`);
    }
  }
  const active = records.find(
    ({ command, status, coordinates }) =>
      command === "punks_get_account_session_state" &&
      status === "ok" &&
      coordinates?.state === "authenticated",
  );
  if (active === undefined) {
    fail("installed operating-system Session was not restored");
  }
  if (active.coordinates?.punkId !== fixture?.punkId) {
    fail("installed operating-system Session belongs to another Punk");
  }
  return { complete: true, punkId: active.coordinates.punkId, scenarios };
}

function xpathString(value) {
  if (value.includes('"')) fail("driver text contains an unsupported quote");
  return `"${value}"`;
}

export async function createSeleniumBrowser(input) {
  writeFileSync(
    input.outputs.platformLog,
    `${JSON.stringify({
      schema: "punks.platform-driver-log.v1",
      platform: input.platform,
      driver: "tauri-driver",
      application: input.nativeBinary,
    })}\n`,
    { flag: "wx", mode: 0o600 },
  );
  const logDescriptor = openSync(input.outputs.platformLog, "a");
  const tauriDriver = spawn("tauri-driver", [], {
    env: {
      ...process.env,
      PUNKS_PROMOTION_ASSET_MANIFEST: input.outputs.embeddedAssets,
      PUNKS_PROMOTION_IPC_LOG: input.outputs.ipc,
      PUNKS_PROMOTION_NETWORK_LOG: input.outputs.network,
    },
    stdio: ["ignore", logDescriptor, logDescriptor],
    windowsHide: true,
  });
  tauriDriver.on("error", () => undefined);
  await waitForTauriDriver(tauriDriver);
  const capabilities = new Capabilities();
  capabilities.setBrowserName("wry");
  capabilities.set("tauri:options", { application: input.nativeBinary });
  const driver = await new Builder()
    .withCapabilities(capabilities)
    .usingServer("http://127.0.0.1:4444/")
    .build();
  const element = async (selector) => {
    const located = await driver.wait(
      until.elementLocated(By.css(selector)),
      30_000,
    );
    await driver.wait(until.elementIsVisible(located), 30_000);
    return located;
  };
  const invokeNative = async (command, payload) =>
    await driver.executeAsyncScript(
      `
        const command = arguments[0];
        const input = arguments[1];
        const done = arguments[arguments.length - 1];
        window.__TAURI_INTERNALS__.invoke(command, { input })
          .then((value) => done({ ok: true, value }))
          .catch((error) => done({
            ok: false,
            error: error && typeof error === "object"
              ? { kind: error.kind, message: error.message }
              : { kind: null, message: String(error) },
          }));
      `,
      command,
      payload,
    );
  const observeNative = async (identity) =>
    await invokeNative("punks_observe_promotion_fault", {
      executionId: identity.executionId,
      candidateSha: identity.candidateSha,
      stagingDeploymentId: identity.stagingDeploymentId,
      type: identity.type,
      authority: identity.authority,
      target: identity.target,
    });
  return {
    async exerciseAuthenticationCeremonies() {
      return authenticationFromIpc(input.outputs.ipc, input.fixture);
    },
    async waitVisible(selector) {
      await element(selector);
    },
    async click(selector) {
      await (await element(selector)).click();
    },
    async replace(selector, value) {
      const target = await element(selector);
      await target.sendKeys(Key.chord(Key.CONTROL, "a"), value);
    },
    async messageIdForText(value) {
      const text = xpathString(value);
      const target = await driver.wait(
        until.elementLocated(
          By.xpath(
            `//*[contains(normalize-space(text()), ${text})]/ancestor::*[@data-message-id][1]`,
          ),
        ),
        30_000,
      );
      return target.getAttribute("data-message-id");
    },
    async screenshot() {
      return Buffer.from(await driver.takeScreenshot(), "base64");
    },
    async auditAccessibility() {
      await driver.executeScript(axeCore.source);
      const audit = await driver.executeAsyncScript(`
        const done = arguments[arguments.length - 1];
        axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })
          .then((result) => done({ violations: result.violations, passes: result.passes.length }))
          .catch((error) => done({ error: String(error) }));
      `);
      if (audit?.error || !Array.isArray(audit?.violations)) {
        fail(
          `axe-core did not return a bounded audit: ${String(audit?.error)}`,
        );
      }
      if (audit.violations.length !== 0) {
        fail(
          `axe-core found ${audit.violations.length} accessibility violations`,
        );
      }
      const tree = await driver.executeScript(`
        return Array.from(document.querySelectorAll('button,input,textarea,[role],a'))
          .filter((element) => {
            const style = getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden';
          })
          .slice(0, 256)
          .map((element) => ({
            tag: element.tagName.toLowerCase(),
            role: element.getAttribute('role'),
            name: element.getAttribute('aria-label') || element.textContent?.trim() || element.getAttribute('placeholder'),
            testId: element.getAttribute('data-testid'),
          }));
      `);
      if (!Array.isArray(tree) || tree.length === 0) {
        fail("installed accessibility tree is empty");
      }
      await driver.executeScript(`document.body.focus()`);
      const focusSequence = [];
      for (let index = 0; index < Math.min(8, tree.length); index += 1) {
        await driver.actions({ async: true }).sendKeys(Key.TAB).perform();
        const focused = await driver.executeScript(`
          const active = document.activeElement;
          return active && active !== document.body
            ? active.getAttribute('data-testid') || active.getAttribute('aria-label') || active.id || active.tagName.toLowerCase()
            : null;
        `);
        if (typeof focused === "string" && focused.trim() !== "") {
          focusSequence.push(focused);
        }
      }
      if (focusSequence.length < 3) {
        fail("installed keyboard traversal did not reach three controls");
      }
      for (let index = 0; index < 12; index += 1) {
        await driver
          .actions({ async: true })
          .keyDown(Key.CONTROL)
          .sendKeys("+")
          .keyUp(Key.CONTROL)
          .perform();
      }
      const zoomFactor = await driver.executeScript(
        `return Number.parseFloat(localStorage.getItem('punks:text-scale') || '1')`,
      );
      if (!Number.isFinite(zoomFactor) || zoomFactor < 2) {
        fail(`installed text zoom stopped at ${String(zoomFactor)}`);
      }
      await driver
        .actions({ async: true })
        .keyDown(Key.CONTROL)
        .sendKeys("0")
        .keyUp(Key.CONTROL)
        .perform();
      const reducedMotionRules = await driver.executeScript(`
        const count = (rules) => Array.from(rules || []).reduce((total, rule) => {
          const own = typeof rule.conditionText === 'string' && rule.conditionText.includes('prefers-reduced-motion') ? 1 : 0;
          let nested = 0;
          try { nested = count(rule.cssRules); } catch {}
          return total + own + nested;
        }, 0);
        return Array.from(document.styleSheets).reduce((total, sheet) => {
          try { return total + count(sheet.cssRules); } catch { return total; }
        }, 0);
      `);
      if (!Number.isSafeInteger(reducedMotionRules) || reducedMotionRules < 1) {
        fail("installed stylesheet has no reduced-motion runtime rule");
      }
      const automated = {
        clavier: {
          tool: "selenium-native-keyboard",
          exitCode: 0,
          observation: `${focusSequence.length} controls reached by Tab`,
        },
        focus: {
          tool: "selenium-focus-order",
          exitCode: 0,
          observation: `focus order observed: ${focusSequence.slice(0, 8).join(" > ")}`,
        },
        "zoom-200": {
          tool: "punks-native-zoom-shortcuts",
          exitCode: 0,
          observation: `installed text scale reached ${zoomFactor * 100}%`,
        },
        contraste: {
          tool: "axe-core@4.13.0",
          exitCode: 0,
          observation: `${audit.passes} axe checks passed with no WCAG 2.1 AA violation`,
        },
        "mouvement-reduit": {
          tool: "installed-runtime-stylesheet",
          exitCode: 0,
          observation: `${reducedMotionRules} prefers-reduced-motion rule(s) loaded`,
        },
        "lecteur-ecran": {
          tool: "axe-core@4.13.0",
          exitCode: 0,
          observation: `${tree.length} named accessible nodes observed`,
        },
      };
      return Object.fromEntries(
        [
          "clavier",
          "focus",
          "zoom-200",
          "contraste",
          "mouvement-reduit",
          "lecteur-ecran",
        ].map((criterion) => [
          criterion,
          {
            automated: [automated[criterion]],
          },
        ]),
      );
    },
    async exerciseFollowScenarios() {
      return followScenariosFromIpc(input.outputs.ipc);
    },
    async exerciseFaultMatrix() {
      const context = input.faultContext;
      if (
        context === null ||
        typeof context !== "object" ||
        typeof context.origin !== "string" ||
        typeof context.operatorToken !== "string" ||
        typeof context.output !== "string"
      ) {
        fail("installed fault context is unavailable");
      }
      return exerciseIndependentFaultMatrix(
        {
          platform: input.platform,
          candidateSha: input.candidateSha,
          stagingDeploymentId: input.stagingDeploymentId,
          artifactSha256: input.artifactSha256,
          authorities: input.authorities,
          targets: promotionAuthorityTargets(input.fixture, input.authorities),
          output: context.output,
        },
        {
          boundary: createStagingBoundary({
            origin: context.origin,
            token: context.operatorToken,
          }),
          observer: {
            async observeFailure(identity) {
              const result = await observeNative(identity);
              if (result?.ok !== false) {
                fail(
                  `fault ${identity.type}/${identity.authority} remained usable`,
                );
              }
              const expected =
                identity.type === "revocation"
                  ? "session_expired"
                  : identity.type === "coupure"
                    ? "transport"
                    : "problem";
              if (result.error?.kind !== expected) {
                fail(
                  `fault ${identity.type}/${identity.authority} returned ${String(result.error?.kind)}`,
                );
              }
              const boundary = identity.control?.authorityState;
              if (
                boundary === null ||
                typeof boundary !== "object" ||
                boundary.authority !== identity.authority ||
                boundary.target?.id !== identity.target.id ||
                boundary.phase !== "injected"
              ) {
                fail(
                  `fault ${identity.type}/${identity.authority} did not originate in its named authority`,
                );
              }
              return {
                observedAt: new Date().toISOString(),
                operation: `installed-native/promotion.fault-observe@1/${identity.authority}`,
                failureKind: result.error.kind,
                observations: [
                  `${identity.type}/${identity.authority} target=${boundary.target.id} state=${boundary.stateFingerprint} failed closed through the installed native Session; ` +
                    `worker=${boundary.worker}; binding=${boundary.binding}; class=${boundary.className}`,
                ],
              };
            },
            async observeRecovery(identity) {
              const result = await observeNative(identity);
              const terminal = identity.proof === PREUVES_RECUPERATION.at(-1);
              if (
                (terminal && result?.ok !== true) ||
                (!terminal && result?.ok !== false)
              ) {
                fail(
                  `recovery ${identity.proof} did not preserve its expected boundary state`,
                );
              }
              const boundary = identity.control?.authorityState;
              if (
                boundary === null ||
                typeof boundary !== "object" ||
                boundary.authority !== identity.authority ||
                boundary.target?.id !== identity.target.id ||
                boundary.proof !== identity.proof
              ) {
                fail(
                  `recovery ${identity.proof} did not originate in its named authority`,
                );
              }
              return {
                observedAt: new Date().toISOString(),
                observations: [
                  terminal
                    ? `${identity.proof} reopened ${identity.type}/${identity.authority} target=${boundary.target.id} state=${boundary.stateFingerprint} through the installed native Session; worker=${boundary.worker}; binding=${boundary.binding}; class=${boundary.className}`
                    : `${identity.proof} kept ${identity.type}/${identity.authority} target=${boundary.target.id} state=${boundary.stateFingerprint} closed until terminal recovery; worker=${boundary.worker}; binding=${boundary.binding}; class=${boundary.className}`,
                ],
              };
            },
          },
        },
      );
    },
    async followTrace() {
      return traceFromIpc(input.outputs.ipc);
    },
    async close() {
      try {
        await driver.quit();
      } finally {
        tauriDriver.kill();
      }
    },
  };
}

export async function exerciseInstalledPlatform(
  input,
  {
    withScreenReader = withNativeScreenReader,
    browserFactory = createSeleniumBrowser,
  } = {},
) {
  if (input.platform.startsWith("macos-")) {
    const { exerciseMacosInstalledCandidate } = await import(
      "./platform-macos-xctest.mjs"
    );
    return exerciseMacosInstalledCandidate(input);
  }
  const session = await withScreenReader(
    {
      platform: input.platform,
      binary: input.screenReaderBinary,
      log: input.outputs.screenReaderLog,
      applicationTokens: [
        "Punks Bot Staging",
        "punks-bot-staging",
        "bot.punks.desktop.staging",
      ],
    },
    async () => {
      const browser = await browserFactory(input);
      try {
        return await exerciseBrowserInstalledCandidate(input, { browser });
      } finally {
        await browser.close();
      }
    },
  );
  const accessibility = session.value.accessibility;
  const reader = accessibility?.["lecteur-ecran"];
  if (reader === null || typeof reader !== "object" || Array.isArray(reader)) {
    fail("installed screen-reader accessibility observation is missing");
  }
  reader.automated.push({
    tool: `${session.technology}-native-session`,
    exitCode: 0,
    observation: session.observation,
  });
  reader.technology = session.technology;
  return session.value;
}

export async function exerciseBrowserInstalledCandidate(input, { browser }) {
  if (
    !["linux-x64", "windows-x64"].includes(input.platform) ||
    browser === null ||
    typeof browser !== "object"
  ) {
    fail("native WebDriver platform boundary is required");
  }
  const workspaceSlug = boundedText(
    input.fixture?.workspaceSlug,
    "Workspace slug",
  );
  const conversationId = boundedText(
    input.fixture?.conversationId,
    "Conversation ID",
  );
  const seedMessageIds = input.fixture?.seedMessageIds;
  if (!Array.isArray(seedMessageIds) || seedMessageIds.length < 2) {
    fail("at least two seeded Messages are required");
  }
  const firstSeed = boundedText(seedMessageIds[0], "first seeded Message");
  const threadSeed = boundedText(
    seedMessageIds.at(-1),
    "thread seeded Message",
  );
  const ui = new Map();
  const screenshots = {};
  const observe = async (story, selector, action) => {
    await browser.waitVisible(selector);
    ui.set(story, { story, action, selector, outcome: "visible" });
    screenshots[story] = await browser.screenshot(story);
  };

  const authentication = await browser.exerciseAuthenticationCeremonies();
  if (authentication?.complete !== true) {
    fail("installed authentication ceremony matrix is incomplete");
  }

  await observe("connexion", testId("punks-workspace-shell"), "session-ready");
  const workspaceSelector = testId(`punks-workspace-${workspaceSlug}`);
  await browser.waitVisible(workspaceSelector);
  await browser.click(workspaceSelector);
  await observe("workspace", workspaceSelector, "workspace-mounted");

  const streamSelector = testId(`punks-stream-${conversationId}`);
  await browser.waitVisible(streamSelector);
  await browser.click(streamSelector);
  await observe("lecture-live", testId("punks-follow-live"), "follow-live");

  const olderSelector = testId("punks-load-older");
  await browser.waitVisible(olderSelector);
  await browser.click(olderSelector);
  await observe("pagination", messageSelector(firstSeed), "older-page-visible");

  const rootContent = `Promotion root ${Date.now()}`;
  const rootTopic = `Subject ${Date.now()}`;
  await browser.replace(testId("punks-message-topic"), rootTopic);
  await browser.replace(testId("punks-message-composer"), rootContent);
  await browser.click(testId("punks-send-message"));
  const rootMessageId = boundedText(
    await browser.messageIdForText(rootContent),
    "published Message ID",
  );
  await observe(
    "publication",
    messageSelector(rootMessageId),
    "root-message-visible",
  );
  await observe(
    "sujet",
    testId(`punks-message-topic-${rootMessageId}`),
    "root-subject-visible",
  );

  const reactionSelector = testId(`punks-reaction-${rootMessageId}-thumbs-up`);
  await browser.click(reactionSelector);
  await observe("reactions", reactionSelector, "reaction-added");

  const threadSelector = testId(`punks-thread-${threadSeed}`);
  await browser.waitVisible(threadSelector);
  await browser.click(threadSelector);
  await browser.waitVisible(testId("punks-thread"));
  const replyContent = `Promotion Reply ${Date.now()}`;
  await browser.replace(testId("punks-message-composer"), replyContent);
  await browser.click(testId("punks-send-message"));
  const replyMessageId = boundedText(
    await browser.messageIdForText(replyContent),
    "Reply Message ID",
  );
  await observe("reponse", messageSelector(replyMessageId), "reply-visible");

  const accessibility = await browser.auditAccessibility();
  const scenarios = await browser.exerciseFollowScenarios();
  if (
    scenarios === null ||
    typeof scenarios !== "object" ||
    Object.entries(FOLLOW_SCENARIO_OUTCOMES).some(
      ([id, outcome]) => scenarios[id]?.outcome !== outcome,
    )
  ) {
    fail("installed FOLLOW scenario set is incomplete");
  }
  await browser.click(workspaceSelector);
  await browser.waitVisible(testId("punks-workspace-shell"));
  const trace = await browser.followTrace();
  if (!Array.isArray(trace) || trace.length < 7) {
    fail("installed FOLLOW trace is incomplete");
  }
  await browser.exerciseFaultMatrix();

  return {
    installed: {
      bundleId: "bot.punks.desktop.staging",
      launched: true,
      executable: input.nativeBinary,
    },
    ui: REQUIRED_STORIES.map((story) => {
      const record = ui.get(story);
      if (record === undefined) fail(`UI story ${story} was not observed`);
      return record;
    }),
    screenshots,
    accessibility,
    follow: {
      request: {
        transport: "wss",
        method: "FOLLOW",
        origin: "wss://staging.punks.bot",
        path: `/api/v1/workspaces/${input.fixture.workspaceId ?? "w"}/conversations/${conversationId}/follow`,
        status: 101,
      },
      trace,
      scenarios,
    },
  };
}

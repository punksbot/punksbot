import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  GATE_IDS,
  buildSecretlessGatesReport,
} from "./secretless-gates-report.mjs";

const SOURCE_SHA = "9a".repeat(20);
const DEPLOYMENT_ID = `sha256:${"bc".repeat(32)}`;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "punks-secretless-gates-"));
  const log = join(root, "gates.log");
  const output = join(root, "report.json");
  const lines = GATE_IDS.flatMap((id) => [
    `::punks-gate::${id}::start`,
    `${id} observed output`,
    `::punks-gate::${id}::pass`,
  ]);
  writeFileSync(log, `${lines.join("\n")}\n`);
  return { root, log, output };
}

test("seals one ordered report from every successful secretless gate", (t) => {
  const input = fixture();
  t.after(() => rmSync(input.root, { recursive: true, force: true }));

  const report = buildSecretlessGatesReport({
    sourceSha: SOURCE_SHA,
    stagingDeploymentId: DEPLOYMENT_ID,
    log: input.log,
    output: input.output,
  });

  assert.deepEqual(JSON.parse(readFileSync(input.output, "utf8")), report);
  assert.equal(report.schema, "punks.secretless-gates-report.v1");
  assert.deepEqual(
    report.gates.map(({ id, result }) => ({ id, result })),
    GATE_IDS.map((id) => ({ id, result: "vert" })),
  );
  assert.match(report.logSha256, /^[0-9a-f]{64}$/);
});

test("writes no report when one gate has no terminal pass marker", (t) => {
  const input = fixture();
  t.after(() => rmSync(input.root, { recursive: true, force: true }));
  const content = readFileSync(input.log, "utf8").replace(
    `::punks-gate::cloudflare-check::pass\n`,
    "",
  );
  writeFileSync(input.log, content);

  assert.throws(
    () =>
      buildSecretlessGatesReport({
        sourceSha: SOURCE_SHA,
        stagingDeploymentId: DEPLOYMENT_ID,
        log: input.log,
        output: input.output,
      }),
    /cloudflare-check.*pass/i,
  );
  assert.throws(() => readFileSync(input.output), /ENOENT/);
});

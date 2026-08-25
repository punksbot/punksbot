import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(
  new URL("../workers/api/package.json", import.meta.url),
);
const typescript = require("typescript");
const repositoryRoot = new URL("../../", import.meta.url).pathname;
const workers = [
  "auth",
  "attestation",
  "erasure",
  "projector",
  "search",
  "bot-runtime",
];

test("runtime identity entrypoints expose only the RPC and a private 404 fetch", () => {
  for (const worker of workers) {
    const path = join(
      repositoryRoot,
      "cloudflare",
      "workers",
      worker,
      "src",
      "index.ts",
    );
    const source = typescript.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      typescript.ScriptTarget.Latest,
      true,
      typescript.ScriptKind.TS,
    );
    const entrypoint = source.statements.find(
      (statement) =>
        typescript.isClassDeclaration(statement) &&
        statement.name?.text === "RuntimeIdentityService",
    );
    assert.ok(entrypoint, `${worker} must export RuntimeIdentityService`);
    assert.ok(
      entrypoint.modifiers?.some(
        (modifier) => modifier.kind === typescript.SyntaxKind.ExportKeyword,
      ),
      `${worker} runtime identity must be a named export`,
    );
    assert.match(
      entrypoint.heritageClauses
        ?.map((clause) => clause.getText(source))
        .join(" ") ?? "",
      /extends WorkerEntrypoint/,
      `${worker} runtime identity must remain a private WorkerEntrypoint RPC`,
    );
    const methods = entrypoint.members.filter(typescript.isMethodDeclaration);
    assert.deepEqual(
      methods.map((member) => member.name.getText(source)),
      ["fetch", "runtimeVersion"],
      `${worker} runtime identity must expose no additional entrypoint`,
    );
    const fetchMethod = methods[0];
    let fetchBoundary = fetchMethod.getText(source);
    if (/privateNotFound\s*\(/u.test(fetchBoundary)) {
      const helper = source.statements.find(
        (statement) =>
          typescript.isFunctionDeclaration(statement) &&
          statement.name?.text === "privateNotFound",
      );
      assert.ok(helper, `${worker} private fetch helper must exist`);
      fetchBoundary += helper.getText(source);
    }
    assert.match(
      fetchBoundary,
      /status:\s*404/u,
      `${worker} fetch must stay inaccessible`,
    );
    assert.match(
      fetchBoundary,
      /cache-control["']?\s*:\s*["']no-store/u,
      `${worker} private 404 must never be cached`,
    );
  }
});

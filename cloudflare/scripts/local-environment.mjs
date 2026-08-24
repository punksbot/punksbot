import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const LOCAL_ATTESTATION_PUBLIC_KEY =
  "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

export const LOCAL_BINDING_FILES = Object.freeze({
  "cloudflare/workers/api/.dev.vars": Object.freeze({
    OPERATOR_PROVISIONING_TOKEN:
      "local-operator-token-00000000000000000000000000000000000000000000",
    ATTESTATION_PUBLIC_KEYS_JSON: JSON.stringify({
      local: { "local-v1": LOCAL_ATTESTATION_PUBLIC_KEY },
    }),
    MESSAGE_SEARCH_MASTER_KEY:
      "local-search-master-key-000000000000000000000000000000000000",
    MESSAGE_SEARCH_CURSOR_KEY:
      "local-search-cursor-key-000000000000000000000000000000000000",
    MESSAGE_HISTORY_CURSOR_KEY:
      "local-history-cursor-key-0000000000000000000000000000000000",
    DIRECTORY_CURSOR_KEY:
      "local-directory-cursor-key-00000000000000000000000000000000",
  }),
  "cloudflare/workers/auth/.dev.vars": Object.freeze({
    GOOGLE_OAUTH_CLIENT_ID: "local-google-client-id",
    GOOGLE_OAUTH_CLIENT_SECRET: "local-google-client-secret",
    GITHUB_OAUTH_CLIENT_ID: "local-github-client-id",
    GITHUB_OAUTH_CLIENT_SECRET: "local-github-client-secret",
    BOT_INVOCATION_CURRENT_SECRET:
      "local-bot-invocation-secret-000000000000000000000000000000000000",
  }),
  "cloudflare/workers/attestation/.dev.vars": Object.freeze({
    ATTESTATION_PRIVATE_KEY:
      "0000000000000000000000000000000000000000000000000000000000000001",
  }),
  "cloudflare/workers/projector/.dev.vars": Object.freeze({
    ATTESTATION_PUBLIC_KEYS_JSON: JSON.stringify({
      local: { "local-v1": LOCAL_ATTESTATION_PUBLIC_KEY },
    }),
  }),
});

function dotenv(bindings) {
  return `${Object.entries(bindings)
    .map(([key, value]) => {
      if (value.includes("'") || value.includes("\n") || value.includes("\r")) {
        throw new Error(`Local binding ${key} cannot be encoded safely`);
      }
      return `${key}='${value}'`;
    })
    .join("\n")}\n`;
}

function legacyDotenv(bindings) {
  return `${Object.entries(bindings)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n")}\n`;
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function ensureLocalEnvironment(repoRoot) {
  const created = [];
  const preserved = [];
  const repaired = [];
  for (const [relativePath, bindings] of Object.entries(LOCAL_BINDING_FILES)) {
    const path = join(repoRoot, relativePath);
    await mkdir(dirname(path), { recursive: true });
    if (await exists(path)) {
      await chmod(path, 0o600);
      if ((await readFile(path, "utf8")) === legacyDotenv(bindings)) {
        await writeFile(path, dotenv(bindings), {
          encoding: "utf8",
          mode: 0o600,
        });
        repaired.push(relativePath);
        continue;
      }
      preserved.push(relativePath);
      continue;
    }
    await writeFile(path, dotenv(bindings), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    created.push(relativePath);
  }
  return { created, preserved, repaired };
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath) {
  const repoRoot = resolve(dirname(modulePath), "../..");
  const result = await ensureLocalEnvironment(repoRoot);
  for (const path of result.created) {
    process.stdout.write(`created ${path}\n`);
  }
  for (const path of result.preserved) {
    process.stdout.write(`preserved ${path}\n`);
  }
  for (const path of result.repaired) {
    process.stdout.write(`repaired ${path}\n`);
  }
}

import { createECDH, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const STAGING_MACHINE_KEYS = Object.freeze([
  "ATTESTATION_PRIVATE_KEY",
  "ATTESTATION_PUBLIC_KEYS_JSON",
  "BOT_INVOCATION_CURRENT_SECRET",
  "OPERATOR_PROVISIONING_TOKEN",
  "MESSAGE_SEARCH_MASTER_KEY",
  "MESSAGE_SEARCH_CURSOR_KEY",
  "MESSAGE_HISTORY_CURSOR_KEY",
  "DIRECTORY_CURSOR_KEY",
]);

export function parseBindingFile(text) {
  const result = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      throw new Error("invalid staging binding file");
    }
    const key = trimmed.slice(0, separator);
    let value = trimmed.slice(separator + 1);
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function newPrivateKey() {
  for (;;) {
    const privateKey = randomBytes(32);
    try {
      const ecdh = createECDH("secp256k1");
      ecdh.setPrivateKey(privateKey);
      return privateKey.toString("hex");
    } catch {
      // Retry the vanishingly unlikely invalid secp256k1 scalar.
    }
  }
}

function xOnlyPublicKey(privateKey) {
  if (!/^[0-9a-f]{64}$/.test(privateKey)) {
    throw new Error("ATTESTATION_PRIVATE_KEY must be 32 lowercase hex bytes");
  }
  const ecdh = createECDH("secp256k1");
  ecdh.setPrivateKey(Buffer.from(privateKey, "hex"));
  return ecdh.getPublicKey(undefined, "compressed").subarray(1).toString("hex");
}

function serialize(bindings) {
  for (const [key, value] of Object.entries(bindings)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || /[\r\n]/.test(value)) {
      throw new Error("invalid staging binding value");
    }
  }
  return `${Object.entries(bindings)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`;
}

export async function ensureStagingMaterial(path) {
  await mkdir(dirname(path), { recursive: true });
  let bindings = {};
  try {
    bindings = parseBindingFile(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const created = [];
  if (bindings.ATTESTATION_PRIVATE_KEY === undefined) {
    bindings.ATTESTATION_PRIVATE_KEY = newPrivateKey();
    created.push("ATTESTATION_PRIVATE_KEY");
  }
  const publicKey = xOnlyPublicKey(bindings.ATTESTATION_PRIVATE_KEY);
  const registry = JSON.stringify({
    staging: { "staging-v1": publicKey },
  });
  if (bindings.ATTESTATION_PUBLIC_KEYS_JSON === undefined) {
    bindings.ATTESTATION_PUBLIC_KEYS_JSON = registry;
    created.push("ATTESTATION_PUBLIC_KEYS_JSON");
  } else if (bindings.ATTESTATION_PUBLIC_KEYS_JSON !== registry) {
    throw new Error(
      "ATTESTATION_PUBLIC_KEYS_JSON does not match ATTESTATION_PRIVATE_KEY",
    );
  }

  for (const key of STAGING_MACHINE_KEYS.slice(2)) {
    if (bindings[key] === undefined) {
      bindings[key] = randomBytes(32).toString("hex");
      created.push(key);
    }
  }

  await writeFile(path, serialize(bindings), {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(path, 0o600);
  return { created, keys: Object.keys(bindings).sort() };
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath) {
  const path = resolve(process.argv[2] ?? "cloudflare/.dev.vars.staging");
  const result = await ensureStagingMaterial(path);
  process.stdout.write(
    result.created.length === 0
      ? "staging machine secrets preserved\n"
      : `staging machine secrets created: ${result.created.join(", ")}\n`,
  );
}

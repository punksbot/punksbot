import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../../..");
const protocolRegistry = await readFile(
  resolve(repositoryRoot, "crates/punks-core/src/kind.rs"),
  "utf8",
);
const workspaceRegistry = await readFile(
  resolve(packageRoot, "src/workspace.ts"),
  "utf8",
);

const protocolKinds = new Set(
  [...protocolRegistry.matchAll(/pub const [A-Z0-9_]+: u32 = ([0-9_]+);/g)].map(
    (match) => Number(match[1].replaceAll("_", "")),
  ),
);
const workspaceBlock = workspaceRegistry.match(
  /PUNKS_EVENT_KINDS = \{(?<body>[\s\S]*?)\} as const/,
)?.groups?.body;
if (workspaceBlock === undefined) {
  throw new Error("PUNKS_EVENT_KINDS registry was not found");
}
const workspaceKinds = [...workspaceBlock.matchAll(/:\s*([0-9_]+)/g)].map(
  (match) => Number(match[1].replaceAll("_", "")),
);

if (new Set(workspaceKinds).size !== workspaceKinds.length) {
  throw new Error("Punks event kind registry contains a duplicate value");
}
for (const kind of workspaceKinds) {
  if (protocolKinds.has(kind)) {
    throw new Error(
      `Punks event kind ${kind} collides with the protocol registry`,
    );
  }
  if (kind < 50_000 || kind > 59_999) {
    throw new Error(
      `Punks internal event kind ${kind} is outside reserved range 50000-59999`,
    );
  }
}

console.log(
  `Verified ${workspaceKinds.length} Punks kinds against ${protocolKinds.size} protocol constants.`,
);

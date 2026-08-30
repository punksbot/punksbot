import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../../..");
const punksRegistry = await readFile(
  resolve(repositoryRoot, "crates/punks-core/src/kind.rs"),
  "utf8",
);
const punksRegistry = await readFile(
  resolve(packageRoot, "src/workspace.ts"),
  "utf8",
);

const punksKinds = new Set(
  [...punksRegistry.matchAll(/pub const [A-Z0-9_]+: u32 = ([0-9_]+);/g)].map(
    (match) => Number(match[1].replaceAll("_", "")),
  ),
);
const punksBlock = punksRegistry.match(
  /PUNKS_EVENT_KINDS = \{(?<body>[\s\S]*?)\} as const/,
)?.groups?.body;
if (punksBlock === undefined) {
  throw new Error("PUNKS_EVENT_KINDS registry was not found");
}
const punksKinds = [...punksBlock.matchAll(/:\s*([0-9_]+)/g)].map((match) =>
  Number(match[1].replaceAll("_", "")),
);

if (new Set(punksKinds).size !== punksKinds.length) {
  throw new Error("Punks event kind registry contains a duplicate value");
}
for (const kind of punksKinds) {
  if (punksKinds.has(kind)) {
    throw new Error(`Punks event kind ${kind} collides with frozen Punks`);
  }
  if (kind < 50_000 || kind > 59_999) {
    throw new Error(
      `Punks internal event kind ${kind} is outside reserved range 50000-59999`,
    );
  }
}

console.log(
  `Verified ${punksKinds.length} Punks kinds against ${punksKinds.size} Punks constants.`,
);

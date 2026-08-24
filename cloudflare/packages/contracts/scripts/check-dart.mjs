import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../../..");
const hermitWrapper = resolve(repositoryRoot, "bin/dart");
const home = process.env.HOME ?? "";

let pathDart = null;
try {
  pathDart = execFileSync("which", ["dart"], { encoding: "utf8" }).trim();
} catch {
  // La liste explicite ci-dessous reste disponible.
}

const candidates = [
  process.env.PUNKS_DART,
  process.env.FLUTTER_ROOT
    ? resolve(process.env.FLUTTER_ROOT, "bin/dart")
    : null,
  home ? resolve(home, "development/flutter/bin/dart") : null,
  home ? resolve(home, "flutter/bin/dart") : null,
  "/opt/homebrew/bin/dart",
  pathDart,
  // Repli reproductible des environnements propres et de la CI : le wrapper
  // versionné bootstrappe le SDK déclaré par la toolchain Hermit du dépôt.
  hermitWrapper,
].filter((candidate) => typeof candidate === "string" && existsSync(candidate));

const executable = candidates[0];

if (executable === undefined) {
  throw new Error("SDK Dart introuvable ; définir PUNKS_DART ou FLUTTER_ROOT");
}

const files = [
  "generated/dart/punks_contracts.dart",
  "test/dart-generated-smoke.dart",
];
execFileSync(executable, ["analyze", ...files], {
  cwd: packageRoot,
  stdio: "inherit",
});
execFileSync(executable, ["run", files[1]], {
  cwd: packageRoot,
  stdio: "inherit",
});

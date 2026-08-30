import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(
  fileURLToPath(new URL("../../", import.meta.url)),
);
const workflowDirectory = resolve(repositoryRoot, ".github/workflows");
const cloudflareDirectory = resolve(repositoryRoot, "cloudflare");

const forbidden = [
  ["container runtime", /\bdocker(?:-compose)?\b|\bpodman\b/i],
  ["external SQL server", /\bpostgres(?:ql)?\b/i],
  ["external cache", /\bredis\b/i],
  ["legacy object server", /\bminio\b/i],
  ["legacy relay", /\bpunks-relay\b/i],
  ["Kubernetes packaging", /\bhelm\b|\bkubectl\b/i],
  ["upstream container registry", /\bghcr\.io\/block\b/i],
];

const workflowFiles = (await readdir(workflowDirectory))
  .filter((file) => /\.ya?ml$/i.test(file))
  .sort();

if (workflowFiles.length === 0) {
  throw new Error("No active Punks workflow was found");
}

const violations = [];
for (const file of workflowFiles) {
  const text = await readFile(resolve(workflowDirectory, file), "utf8");
  for (const [boundary, pattern] of forbidden) {
    if (pattern.test(text)) {
      violations.push(`${file}: ${boundary}`);
    }
  }
}

const rootPackage = JSON.parse(
  await readFile(resolve(repositoryRoot, "package.json"), "utf8"),
);
const packageFiles = [resolve(repositoryRoot, "package.json")];
const pendingDirectories = [cloudflareDirectory];
while (pendingDirectories.length > 0) {
  const directory = pendingDirectories.pop();
  if (directory === undefined) {
    break;
  }
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") {
        pendingDirectories.push(path);
      }
    } else if (entry.isFile() && entry.name === "package.json") {
      packageFiles.push(path);
    }
  }
}

for (const packageFile of packageFiles.sort()) {
  const packageJson =
    packageFile === resolve(repositoryRoot, "package.json")
      ? rootPackage
      : JSON.parse(await readFile(packageFile, "utf8"));
  const scripts = JSON.stringify(packageJson.scripts ?? {});
  for (const [boundary, pattern] of forbidden) {
    if (pattern.test(scripts)) {
      const label = packageFile.slice(repositoryRoot.length + 1);
      violations.push(`${label} scripts: ${boundary}`);
    }
  }
}

if (violations.length > 0) {
  throw new Error(
    `Managed-only boundary violation:\n${violations
      .map((violation) => `- ${violation}`)
      .join("\n")}`,
  );
}

console.log(
  `Verified ${workflowFiles.length} active Punks workflow(s) and ${packageFiles.length} package manifest(s): Workers managed-only boundary intact.`,
);

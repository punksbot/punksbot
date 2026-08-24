import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileFromFile } from "json-schema-to-typescript";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const registry = JSON.parse(
  await readFile(resolve(packageRoot, "registry.json"), "utf8"),
);
const generatedDirectory = resolve(packageRoot, "src/generated");
const checkOnly = process.argv.includes("--check");

if (!checkOnly) {
  await mkdir(generatedDirectory, { recursive: true });
}

const normalize = (source) => `${source.trim()}\n`;

for (const contract of registry.contracts) {
  const schemaPath = resolve(packageRoot, contract.file);
  const outputName = contract.file
    .replace("schemas/", "")
    .replace(".schema.json", ".ts");
  const outputPath = resolve(generatedDirectory, outputName);
  const generated = normalize(
    await compileFromFile(schemaPath, {
      bannerComment:
        "/* Generated from the canonical Punks JSON Schema. Do not edit. */",
      cwd: packageRoot,
      format: false,
      strictIndexSignatures: true,
    }),
  );

  if (checkOnly) {
    const existing = normalize(await readFile(outputPath, "utf8"));
    if (existing !== generated) {
      throw new Error(`Generated contract is stale: ${outputName}`);
    }
    continue;
  }

  await writeFile(outputPath, generated, "utf8");
}

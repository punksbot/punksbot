import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.cwd(), "dist");
const previousProduct = ["bu", "zz"].join("");
const forbidden = [
  {
    label: "previous product marker",
    pattern: new RegExp(previousProduct, "iu"),
  },
  { label: "remote runtime marker", pattern: /cloudflare/iu },
  { label: "E2E runtime hook", pattern: /__punks_e2e/iu },
  { label: "mock launch query", pattern: /e2e=mock/iu },
];
const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".map",
  ".svg",
  ".txt",
  ".xml",
]);

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? filesBelow(target) : [target];
    }),
  );
  return nested.flat();
}

const failures = [];
for (const file of await filesBelow(root)) {
  const relative = path.relative(root, file);
  for (const marker of forbidden) {
    if (marker.pattern.test(relative)) {
      failures.push(`${relative}: ${marker.label} in filename`);
    }
  }
  if (!textExtensions.has(path.extname(file).toLowerCase())) continue;
  const content = await readFile(file, "utf8");
  for (const marker of forbidden) {
    marker.pattern.lastIndex = 0;
    if (marker.pattern.test(content)) {
      failures.push(`${relative}: ${marker.label} in content`);
    }
  }
}

if (failures.length > 0) {
  console.error("Punks Full Local artifact scan failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Punks Full Local artifact scan passed.");

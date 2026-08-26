import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const SHA256_RE = /^[0-9a-f]{64}$/u;

function fail(message) {
  throw new Error(`installed raw evidence rejected: ${message}`);
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function exactKeys(value, keys, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...keys].sort())
  ) {
    fail(`${label} has an unexpected shape`);
  }
}

function stableDirectory(path, label) {
  const absolute = resolve(path);
  const status = lstatSync(absolute);
  if (status.isSymbolicLink() || !status.isDirectory()) {
    fail(`${label} must be one real directory`);
  }
  return absolute;
}

function stableFile(path, label) {
  const absolute = resolve(path);
  const status = lstatSync(absolute);
  if (status.isSymbolicLink() || !status.isFile() || status.size < 1) {
    fail(`${label} must be one non-empty real regular file`);
  }
  let descriptor;
  try {
    descriptor = openSync(
      absolute,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const before = fstatSync(descriptor, { bigint: true });
    const content = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs
    ) {
      fail(`${label} changed while it was read`);
    }
    return { absolute, content, sha256: sha256(content) };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function rawEvidencePaths(root, directory = root) {
  const paths = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const status = lstatSync(path);
    if (status.isSymbolicLink()) fail("evidence contains a symbolic link");
    if (status.isDirectory()) {
      paths.push(...rawEvidencePaths(root, path));
    } else if (status.isFile()) {
      paths.push(relative(root, path).split(sep).join("/"));
    } else {
      fail("evidence contains a non-regular entry");
    }
  }
  return paths.sort();
}

export function validateInstalledRawEvidence({
  reference,
  root: rootPath,
  platform,
  candidateSha,
  stagingDeploymentId,
  artifactSha256,
}) {
  exactKeys(reference, ["indexSha256", "files"], "raw evidence reference");
  if (
    !SHA256_RE.test(reference.indexSha256 ?? "") ||
    !Number.isSafeInteger(reference.files) ||
    reference.files < 1
  ) {
    fail("reference is invalid");
  }
  const root = stableDirectory(rootPath, "raw evidence root");
  const indexFile = stableFile(join(root, "index.json"), "raw evidence index");
  if (indexFile.sha256 !== reference.indexSha256) {
    fail("index digest is divergent");
  }
  let index;
  try {
    index = JSON.parse(indexFile.content.toString("utf8"));
  } catch {
    fail("index is not JSON");
  }
  exactKeys(
    index,
    [
      "schema",
      "platform",
      "candidateSha",
      "stagingDeploymentId",
      "artifactSha256",
      "files",
    ],
    "raw evidence index",
  );
  if (
    index.schema !== "punks.installed-raw-evidence-index.v1" ||
    index.platform !== platform ||
    index.candidateSha !== candidateSha ||
    index.stagingDeploymentId !== stagingDeploymentId ||
    index.artifactSha256 !== artifactSha256 ||
    !Array.isArray(index.files) ||
    index.files.length !== reference.files
  ) {
    fail("index belongs to another installed candidate");
  }
  const paths = [];
  const files = [];
  for (const [position, file] of index.files.entries()) {
    exactKeys(
      file,
      ["path", "size", "sha256"],
      `raw evidence file ${position}`,
    );
    if (
      typeof file.path !== "string" ||
      file.path.length === 0 ||
      file.path.startsWith("/") ||
      file.path.includes("\\") ||
      file.path
        .split("/")
        .some((part) => part === "" || part === "." || part === "..") ||
      !Number.isSafeInteger(file.size) ||
      file.size < 1 ||
      !SHA256_RE.test(file.sha256 ?? "")
    ) {
      fail(`raw evidence file ${position} is invalid`);
    }
    const path = resolve(root, file.path);
    const contained = relative(root, path);
    if (
      contained === "" ||
      contained === ".." ||
      contained.startsWith(`..${sep}`) ||
      isAbsolute(contained)
    ) {
      fail(`raw evidence file ${position} escapes its root`);
    }
    const observed = stableFile(path, `raw evidence file ${position}`);
    if (
      observed.content.length !== file.size ||
      observed.sha256 !== file.sha256
    ) {
      fail(`raw evidence file ${position} digest is divergent`);
    }
    paths.push(file.path);
    files.push({ reference: file, file: observed });
  }
  if (
    new Set(paths).size !== paths.length ||
    JSON.stringify(paths) !== JSON.stringify([...paths].sort()) ||
    JSON.stringify(rawEvidencePaths(root)) !==
      JSON.stringify([...paths, "index.json"].sort())
  ) {
    fail("index is incomplete, widened or unordered");
  }
  return { root, index, indexFile, files };
}

export function buildRawEvidenceArchive(validated) {
  return Buffer.from(
    `${JSON.stringify(
      {
        schema: "punks.installed-raw-evidence-archive.v1",
        indexSha256: validated.indexFile.sha256,
        files: validated.files.map(({ reference, file }) => ({
          ...reference,
          contentBase64: file.content.toString("base64"),
        })),
      },
      null,
      2,
    )}\n`,
  );
}

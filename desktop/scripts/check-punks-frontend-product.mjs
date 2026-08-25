#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SOURCE_FILES = [
  "punks-product/index.html",
  "punks-product/main.tsx",
  "src/punks-main.tsx",
  "vite.config.ts",
];
const FORBIDDEN_DIST_MARKERS = [
  "buzz-media",
  "native_websocket",
  "buzz",
  "nostr",
  "relay",
  "huddle",
];
const LAZY_CAPABILITY_CHUNKS = [
  {
    capability: "desktop-social-loop",
    fileName: /^(?:PunksRuntime|punksTauriTransport)-[A-Za-z0-9_-]+\.js$/u,
    eagerMarkers: [
      "punks-workspace-shell",
      "punks://contracts/auth.session@1",
      "punks_get_account_session_state",
      "punks_start_sign_in",
      "punks_start_account_switch",
      "punks_start_reauthentication",
      "punks_start_identity_link",
      "punks_start_passkey_registration",
      "punks_resume_interrupted_authentication",
      "punks_cancel_authentication",
      "punks_renew_account_session",
      "punks_sign_out",
      "punks_list_workspaces",
      "punks_open_workspace",
      "punks_get_timeline",
      "punks_get_thread",
      "punks_follow_conversation",
      "punks_post_message",
      "punks_add_reaction",
      "punks_remove_reaction",
    ],
  },
  {
    capability: "message-lifecycle",
    fileName:
      /^(?:MessageLifecycleControls|punksMessageLifecycleTauri)-[A-Za-z0-9_-]+\.js$/u,
    eagerMarkers: [
      "punks_edit_message",
      "punks_retract_message",
      "punks_restore_message",
      "Edit Message",
      "Save edit",
    ],
  },
];

function fail(message) {
  throw new Error(`Punks frontend product check failed: ${message}`);
}

function compareCanonical(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function parseArguments(argv) {
  let root = resolve(import.meta.dirname, "..");
  let dist = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dist") {
      dist = true;
      continue;
    }
    if (argument === "--root" && argv[index + 1]) {
      root = resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    fail("usage: check-punks-frontend-product.mjs [--root <desktop>] [--dist]");
  }
  return { dist, root };
}

function readRequiredFile(root, relativePath) {
  const path = resolve(root, relativePath);
  if (!existsSync(path) || !statSync(path).isFile()) {
    fail(`required file is missing: ${relativePath}`);
  }
  return readFileSync(path);
}

function parseTypeScript(relativePath, contents) {
  const source = ts.createSourceFile(
    relativePath,
    contents.toString("utf8"),
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  if (source.parseDiagnostics.length > 0) {
    fail(`${relativePath} is not valid TypeScript`);
  }
  return source;
}

function propertyName(node) {
  if (
    ts.isIdentifier(node.name) ||
    ts.isStringLiteral(node.name) ||
    ts.isNumericLiteral(node.name)
  ) {
    return node.name.text;
  }
  return undefined;
}

function unwrapExpression(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function returnedViteConfiguration(source) {
  const exports = source.statements.filter(
    (statement) =>
      ts.isExportAssignment(statement) && !statement.isExportEquals,
  );
  if (exports.length !== 1) return undefined;
  const call = unwrapExpression(exports[0].expression);
  if (
    !ts.isCallExpression(call) ||
    !ts.isIdentifier(call.expression) ||
    call.expression.text !== "defineConfig" ||
    call.arguments.length !== 1
  ) {
    return undefined;
  }
  const callback = unwrapExpression(call.arguments[0]);
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) {
    return undefined;
  }
  if (!ts.isBlock(callback.body)) {
    const expression = unwrapExpression(callback.body);
    return ts.isObjectLiteralExpression(expression) ? expression : undefined;
  }
  const returns = callback.body.statements.filter(ts.isReturnStatement);
  if (returns.length !== 1 || !returns[0].expression) return undefined;
  const expression = unwrapExpression(returns[0].expression);
  return ts.isObjectLiteralExpression(expression) ? expression : undefined;
}

function directProperties(object, name) {
  return object.properties.filter(
    (property) =>
      ts.isPropertyAssignment(property) && propertyName(property) === name,
  );
}

function isPathResolveTo(node, directory) {
  if (
    !ts.isCallExpression(node) ||
    !ts.isPropertyAccessExpression(node.expression) ||
    node.expression.expression.getText() !== "path" ||
    node.expression.name.text !== "resolve" ||
    node.arguments.length !== 2
  ) {
    return false;
  }
  const [base, child] = node.arguments;
  return (
    base.getText() === "__dirname" &&
    ts.isStringLiteral(child) &&
    child.text === directory
  );
}

function selectedPunksBranch(property, predicate, validateValue) {
  const initializer = property.initializer;
  return (
    ts.isConditionalExpression(initializer) &&
    initializer.condition.getText() === predicate &&
    validateValue(initializer.whenTrue)
  );
}

function validateViteConfig(contents) {
  const source = parseTypeScript("vite.config.ts", contents);
  const configuration = returnedViteConfiguration(source);
  if (!configuration) {
    fail(
      "vite.config.ts must expose the Punks configuration returned by defineConfig",
    );
  }
  const roots = directProperties(configuration, "root");
  if (roots.length !== 1 || !ts.isConditionalExpression(roots[0].initializer)) {
    fail("vite.config.ts must select one conditional Punks root");
  }
  const predicate = roots[0].initializer.condition.getText();
  if (predicate !== "punks") {
    fail("vite.config.ts must use the active Punks predicate");
  }
  if (
    !selectedPunksBranch(roots[0], predicate, (node) =>
      isPathResolveTo(node, "punks-product"),
    )
  ) {
    fail("vite.config.ts must select punks-product as the Punks root");
  }

  const publicDirectories = directProperties(configuration, "publicDir");
  if (
    publicDirectories.length !== 1 ||
    !selectedPunksBranch(
      publicDirectories[0],
      predicate,
      (node) => node.kind === ts.SyntaxKind.FalseKeyword,
    )
  ) {
    fail("vite.config.ts must set publicDir=false for Punks");
  }

  const builds = directProperties(configuration, "build");
  if (
    builds.length !== 1 ||
    !selectedPunksBranch(builds[0], predicate, (node) => {
      if (!ts.isObjectLiteralExpression(node)) return false;
      const outDirectories = directProperties(node, "outDir");
      return (
        outDirectories.length === 1 &&
        isPathResolveTo(outDirectories[0].initializer, "dist")
      );
    })
  ) {
    fail("vite.config.ts must emit Punks into desktop/dist");
  }
}

function collectModuleSpecifiers(source) {
  const specifiers = [];
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      specifiers.push(node.moduleReference.expression.text);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require")) &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return specifiers;
}

function forbiddenImport(specifier) {
  const normalized = specifier.replaceAll("\\", "/");
  const lower = normalized.toLowerCase();
  const segments = lower
    .split("/")
    .map((segment) => segment.replace(/\.(?:[cm]?[jt]sx?)$/u, ""));
  if (
    lower.includes("src/main") ||
    lower === "@/main" ||
    segments.includes("app")
  ) {
    return true;
  }
  return ["capabilities", "communities", "huddle", "relay", "nostr"].some(
    (term) => lower.includes(term),
  );
}

function validateSourceImports(relativePath, contents) {
  const source = parseTypeScript(relativePath, contents);
  const specifiers = collectModuleSpecifiers(source);
  const forbidden = specifiers.find(forbiddenImport);
  if (forbidden) {
    fail(`${relativePath} imports forbidden product code: ${forbidden}`);
  }
  return specifiers;
}

function validateEntries(files) {
  const html = files.get("punks-product/index.html").toString("utf8");
  const scripts = [...html.matchAll(/<script\b[^>]*>/giu)];
  const moduleScripts = [
    ...html.matchAll(
      /<script\b(?=[^>]*\btype=["']module["'])(?=[^>]*\bsrc=["']([^"']+)["'])[^>]*>/giu,
    ),
  ].map((match) => match[1]);
  if (
    scripts.length !== 1 ||
    moduleScripts.length !== 1 ||
    moduleScripts[0] !== "/main.tsx"
  ) {
    fail(
      "punks-product/index.html must load only /main.tsx as its module entry",
    );
  }

  const productImports = validateSourceImports(
    "punks-product/main.tsx",
    files.get("punks-product/main.tsx"),
  );
  if (
    productImports.length !== 1 ||
    !["@/punks-main", "../src/punks-main", "../src/punks-main.tsx"].includes(
      productImports[0],
    )
  ) {
    fail("punks-product/main.tsx must import only src/punks-main.tsx");
  }
  validateSourceImports("src/punks-main.tsx", files.get("src/punks-main.tsx"));
}

function walkDistribution(root, files) {
  const distPath = resolve(root, "dist");
  if (!existsSync(distPath)) {
    fail("desktop/dist is absent");
  }
  const distMetadata = lstatSync(distPath);
  if (distMetadata.isSymbolicLink() || !distMetadata.isDirectory()) {
    fail("desktop/dist must be a real directory");
  }

  const topLevel = readdirSync(distPath, { withFileTypes: true }).sort(
    (left, right) => compareCanonical(left.name, right.name),
  );
  if (topLevel.length === 0) {
    fail("desktop/dist is empty");
  }
  if (
    topLevel.length !== 2 ||
    topLevel[0].name !== "assets" ||
    !topLevel[0].isDirectory() ||
    topLevel[1].name !== "index.html" ||
    !topLevel[1].isFile()
  ) {
    fail(
      "desktop/dist must contain exactly index.html and the assets directory",
    );
  }

  function walk(absoluteDirectory, relativeDirectory) {
    const entries = readdirSync(absoluteDirectory, {
      withFileTypes: true,
    }).sort((left, right) => compareCanonical(left.name, right.name));
    for (const entry of entries) {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      const absolutePath = resolve(absoluteDirectory, entry.name);
      const metadata = lstatSync(absolutePath);
      if (metadata.isSymbolicLink()) {
        fail(`desktop/dist must not contain symbolic links: ${relativePath}`);
      }
      if (metadata.isDirectory()) {
        walk(absolutePath, relativePath);
      } else if (metadata.isFile()) {
        files.set(relativePath, readFileSync(absolutePath));
      } else {
        fail(`desktop/dist contains an unsupported entry: ${relativePath}`);
      }
    }
  }
  walk(distPath, "dist");
}

function matchingForbiddenMarker(value) {
  const representations = [];
  if (Buffer.isBuffer(value)) {
    representations.push(value.toString("latin1"), value.toString("utf16le"));
    const evenLength = value.length - (value.length % 2);
    const byteSwapped = Buffer.allocUnsafe(evenLength);
    for (let index = 0; index < evenLength; index += 2) {
      byteSwapped[index] = value[index + 1];
      byteSwapped[index + 1] = value[index];
    }
    representations.push(byteSwapped.toString("utf16le"));
  } else {
    representations.push(value);
  }
  for (const representation of representations) {
    const lower = representation.toLowerCase();
    const marker = FORBIDDEN_DIST_MARKERS.find((candidate) =>
      lower.includes(candidate),
    );
    if (marker) return marker;
  }
  return undefined;
}

function attribute(tag, name) {
  const match = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "iu"),
  );
  return match?.[1];
}

function normalizeAssetReference(reference) {
  if (!reference || /[?#]/u.test(reference)) return undefined;
  return reference.startsWith("/") ? reference.slice(1) : reference;
}

function validateDistribution(files) {
  const distFiles = [...files.entries()].filter(([path]) =>
    path.startsWith("dist/"),
  );
  if (distFiles.length === 0) {
    fail("desktop/dist is empty");
  }
  for (const [path, contents] of distFiles) {
    const nameMarker = matchingForbiddenMarker(path);
    if (nameMarker) {
      fail(
        `desktop/dist file name contains forbidden marker ${nameMarker}: ${path}`,
      );
    }
    const contentMarker = matchingForbiddenMarker(contents);
    if (contentMarker) {
      fail(
        `desktop/dist content contains forbidden marker ${contentMarker}: ${path}`,
      );
    }
  }

  const javascript = distFiles
    .map(([path]) => path)
    .filter((path) => path.endsWith(".js"));
  const stylesheets = distFiles
    .map(([path]) => path)
    .filter((path) => path.endsWith(".css"));
  if (javascript.length === 0 || stylesheets.length !== 1) {
    fail(
      "desktop/dist assets must contain exactly one JavaScript and one CSS file",
    );
  }

  const html = files.get("dist/index.html").toString("utf8");
  const scripts = [...html.matchAll(/<script\b[^>]*>/giu)].map(
    (match) => match[0],
  );
  if (
    scripts.length !== 1 ||
    attribute(scripts[0], "type")?.toLowerCase() !== "module"
  ) {
    fail("dist/index.html must contain exactly one module JavaScript entry");
  }
  const scriptPath = normalizeAssetReference(attribute(scripts[0], "src"));
  const eagerScriptPath = scriptPath ? `dist/${scriptPath}` : undefined;
  if (!eagerScriptPath || !javascript.includes(eagerScriptPath)) {
    fail("dist/index.html must reference the only JavaScript asset");
  }

  const eagerContents = files.get(eagerScriptPath)?.toString("utf8") ?? "";
  for (const capability of LAZY_CAPABILITY_CHUNKS) {
    if (
      capability.eagerMarkers.some((marker) => eagerContents.includes(marker))
    ) {
      fail(
        `eager JavaScript contains unavailable capability ${capability.capability}`,
      );
    }
  }

  for (const lazyPath of javascript.filter(
    (path) => path !== eagerScriptPath,
  )) {
    const fileName = lazyPath.split("/").at(-1) ?? "";
    const capability = LAZY_CAPABILITY_CHUNKS.find(({ fileName: pattern }) =>
      pattern.test(fileName),
    );
    if (capability === undefined) {
      fail(
        "desktop/dist assets must contain exactly one JavaScript and one CSS file unless every additional JavaScript asset is a reviewed capability chunk",
      );
    }
    const contents = files.get(lazyPath)?.toString("utf8") ?? "";
    if (!capability.eagerMarkers.some((marker) => contents.includes(marker))) {
      fail(
        `capability chunk ${fileName} does not contain ${capability.capability}`,
      );
    }
    const assetReference = lazyPath.slice("dist/".length);
    if (html.includes(assetReference)) {
      fail(`capability chunk ${fileName} must not be referenced by HTML`);
    }
  }

  const stylesheetLinks = [...html.matchAll(/<link\b[^>]*>/giu)]
    .map((match) => match[0])
    .filter((tag) =>
      attribute(tag, "rel")?.toLowerCase().split(/\s+/u).includes("stylesheet"),
    );
  if (stylesheetLinks.length !== 1) {
    fail("dist/index.html must contain exactly one CSS entry");
  }
  const stylesheetPath = normalizeAssetReference(
    attribute(stylesheetLinks[0], "href"),
  );
  if (!stylesheetPath || `dist/${stylesheetPath}` !== stylesheets[0]) {
    fail("dist/index.html must reference the only CSS asset");
  }
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function createProof(mode, files) {
  const entries = [...files.entries()]
    .map(([path, contents]) => ({ path, sha256: sha256(contents) }))
    .sort((left, right) => compareCanonical(left.path, right.path));
  const core = {
    schemaVersion: 1,
    product: "punks-frontend",
    mode,
    files: entries,
  };
  return { ...core, sha256: sha256(Buffer.from(JSON.stringify(core))) };
}

export function verifyPunksFrontendProduct({ root, dist = false }) {
  const files = new Map(
    SOURCE_FILES.map((relativePath) => [
      relativePath,
      readRequiredFile(root, relativePath),
    ]),
  );
  validateViteConfig(files.get("vite.config.ts"));
  validateEntries(files);
  if (dist) {
    walkDistribution(root, files);
    validateDistribution(files);
  }
  return createProof(dist ? "dist" : "source", files);
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const proof = verifyPunksFrontendProduct(options);
  process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

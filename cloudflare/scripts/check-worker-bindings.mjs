import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(
  new URL("../workers/api/package.json", import.meta.url),
);
const typescript = require("typescript");

const LOCAL_ONLY_WORKERS = new Set(["dev-gateway"]);
const REQUIRED_NAMED_LOCAL_WORKERS = new Set(["erasure", "search"]);

function parseJsonc(source, path) {
  const parsed = typescript.parseConfigFileTextToJson(path, source);
  if (parsed.error !== undefined) {
    const message = typescript.flattenDiagnosticMessageText(
      parsed.error.messageText,
      "\n",
    );
    throw new Error(`Cannot parse ${path}: ${message}`);
  }
  return parsed.config;
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeEnvironmentValue(value, environment) {
  if (value === environment) return "<environment>";
  if (Array.isArray(value)) {
    return value.map((item) => normalizeEnvironmentValue(item, environment));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        normalizeEnvironmentValue(item, environment),
      ]),
    );
  }
  return value;
}

function normalizeResourceName(value, environment) {
  if (typeof value !== "string") return value;
  return value.replace(
    new RegExp(`-${environment}(?=-|$)`, "g"),
    "-<environment>",
  );
}

function withoutProperties(value, properties) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !properties.has(key)),
  );
}

function resourceSignature(item, environment, resourceKeys, identifierKeys) {
  const signature = withoutProperties(
    item,
    new Set(["binding", ...identifierKeys]),
  );
  for (const key of resourceKeys) {
    if (key in signature) {
      signature[key] = normalizeResourceName(signature[key], environment);
    }
  }
  for (const key of identifierKeys) {
    if (key in item) signature[key] = "<resource-id>";
  }
  return signature;
}

function keyedBindings({
  items,
  keyOf,
  label,
  signature,
  worker,
  variant,
  violations,
}) {
  const bindings = new Map();
  for (const item of items ?? []) {
    const binding = keyOf(item);
    if (typeof binding !== "string" || binding.length === 0) {
      violations.push(`${worker} ${variant} has an unnamed ${label} binding`);
      continue;
    }
    if (bindings.has(binding)) {
      violations.push(
        `${worker} ${variant} ${label} binding ${binding} is duplicated`,
      );
      continue;
    }
    bindings.set(binding, canonicalJson(signature(item)));
  }
  return bindings;
}

function bindingShape(worker, config, variant, environment, violations) {
  const simpleKeys = (values) =>
    new Map([...values].sort().map((binding) => [binding, "null"]));
  const categories = new Map();

  categories.set("variable", simpleKeys(Object.keys(config.vars ?? {})));
  categories.set("required secret", simpleKeys(config.secrets?.required ?? []));
  categories.set(
    "R2",
    keyedBindings({
      items: config.r2_buckets,
      keyOf: (item) => item.binding,
      label: "R2",
      signature: (item) =>
        resourceSignature(
          item,
          environment,
          ["bucket_name", "preview_bucket_name"],
          [],
        ),
      worker: worker.directory,
      variant,
      violations,
    }),
  );
  categories.set(
    "D1",
    keyedBindings({
      items: config.d1_databases,
      keyOf: (item) => item.binding,
      label: "D1",
      signature: (item) =>
        resourceSignature(
          item,
          environment,
          ["database_name"],
          ["database_id", "preview_database_id"],
        ),
      worker: worker.directory,
      variant,
      violations,
    }),
  );
  categories.set(
    "Durable Object",
    keyedBindings({
      items: config.durable_objects?.bindings,
      keyOf: (item) => item.name,
      label: "Durable Object",
      signature: (item) =>
        withoutProperties(item, new Set(["name", "script_name"])),
      worker: worker.directory,
      variant,
      violations,
    }),
  );
  categories.set(
    "Service",
    keyedBindings({
      items: config.services,
      keyOf: (item) => item.binding,
      label: "Service",
      signature: (item) =>
        normalizeEnvironmentValue(
          withoutProperties(item, new Set(["binding", "service"])),
          environment,
        ),
      worker: worker.directory,
      variant,
      violations,
    }),
  );
  categories.set(
    "Workflow",
    keyedBindings({
      items: config.workflows,
      keyOf: (item) => item.binding,
      label: "Workflow",
      signature: (item) => resourceSignature(item, environment, ["name"], []),
      worker: worker.directory,
      variant,
      violations,
    }),
  );
  categories.set(
    "Queue producer",
    keyedBindings({
      items: config.queues?.producers,
      keyOf: (item) => item.binding,
      label: "Queue producer",
      signature: (item) => resourceSignature(item, environment, ["queue"], []),
      worker: worker.directory,
      variant,
      violations,
    }),
  );
  categories.set(
    "Queue consumer",
    keyedBindings({
      items: config.queues?.consumers,
      keyOf: (item) => normalizeResourceName(item.queue, environment),
      label: "Queue consumer",
      signature: (item) =>
        resourceSignature(
          withoutProperties(item, new Set(["queue"])),
          environment,
          ["dead_letter_queue"],
          [],
        ),
      worker: worker.directory,
      variant,
      violations,
    }),
  );
  categories.set(
    "AI",
    typeof config.ai?.binding === "string"
      ? new Map([
          [
            config.ai.binding,
            canonicalJson(withoutProperties(config.ai, new Set(["binding"]))),
          ],
        ])
      : new Map(),
  );

  return categories;
}

function stagingOnlyBindings(worker, category) {
  if (worker.directory === "bot-runtime" && category === "AI") {
    return new Map([["AI", canonicalJson({})]]);
  }
  return new Map();
}

function compareBindingShapes({
  worker,
  referenceConfig,
  candidateConfig,
  candidateVariant,
  referenceEnvironment,
  candidateEnvironment,
  allowStagingOnly,
  violations,
}) {
  const reference = bindingShape(
    worker,
    referenceConfig,
    "local",
    referenceEnvironment,
    violations,
  );
  const candidate = bindingShape(
    worker,
    candidateConfig,
    candidateVariant,
    candidateEnvironment,
    violations,
  );
  for (const [category, referenceBindings] of reference) {
    const candidateBindings = candidate.get(category) ?? new Map();
    const additions = allowStagingOnly
      ? stagingOnlyBindings(worker, category)
      : new Map();
    const expected = new Map([...referenceBindings, ...additions]);
    const missing = [...expected.keys()].filter(
      (binding) => !candidateBindings.has(binding),
    );
    const unexpected = [...candidateBindings.keys()].filter(
      (binding) => !expected.has(binding),
    );
    if (missing.length > 0 || unexpected.length > 0) {
      violations.push(
        `${worker.directory} ${candidateVariant} ${category} bindings differ from local (missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"})`,
      );
    }
    for (const [binding, expectedSignature] of expected) {
      const candidateSignature = candidateBindings.get(binding);
      if (
        candidateSignature !== undefined &&
        candidateSignature !== expectedSignature
      ) {
        violations.push(
          `${worker.directory} ${candidateVariant} ${category} binding ${binding} changes configuration`,
        );
      }
    }
  }
}

function collectBindingNames(bindingName, names) {
  if (typescript.isIdentifier(bindingName)) {
    names.add(bindingName.text);
    return;
  }
  for (const element of bindingName.elements) {
    if (!typescript.isOmittedExpression(element)) {
      collectBindingNames(element.name, names);
    }
  }
}

function emittedExportSurface(source) {
  const output = typescript.transpileModule(source.text, {
    compilerOptions: {
      target: typescript.ScriptTarget.ESNext,
      module: typescript.ModuleKind.ESNext,
      verbatimModuleSyntax: true,
    },
    fileName: source.fileName,
  }).outputText;
  const emitted = typescript.createSourceFile(
    `${source.fileName}.mjs`,
    output,
    typescript.ScriptTarget.ESNext,
    true,
    typescript.ScriptKind.JS,
  );
  const names = new Set();
  const hasModifier = (statement, kind) =>
    typescript.canHaveModifiers(statement) &&
    (typescript
      .getModifiers(statement)
      ?.some((modifier) => modifier.kind === kind) ??
      false);

  for (const statement of emitted.statements) {
    if (typescript.isExportAssignment(statement)) {
      names.add("default");
      continue;
    }
    if (typescript.isExportDeclaration(statement)) {
      if (
        statement.exportClause !== undefined &&
        typescript.isNamespaceExport(statement.exportClause)
      ) {
        names.add(statement.exportClause.name.text);
      } else if (statement.exportClause !== undefined) {
        for (const element of statement.exportClause.elements) {
          names.add(element.name.text);
        }
      }
      continue;
    }
    if (!hasModifier(statement, typescript.SyntaxKind.ExportKeyword)) continue;
    if (hasModifier(statement, typescript.SyntaxKind.DefaultKeyword)) {
      names.add("default");
    } else if (
      (typescript.isClassDeclaration(statement) ||
        typescript.isFunctionDeclaration(statement)) &&
      statement.name !== undefined
    ) {
      names.add(statement.name.text);
    } else if (typescript.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        collectBindingNames(declaration.name, names);
      }
    }
  }
  return names;
}

function runtimeExports(program, checker, sourcePath, cache) {
  const cached = cache.get(sourcePath);
  if (cached !== undefined) return cached;
  const source = program.getSourceFile(sourcePath);
  if (source === undefined) {
    throw new Error(`TypeScript did not load Worker entrypoint ${sourcePath}`);
  }
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (moduleSymbol === undefined) return new Set();
  const names = new Set();
  cache.set(sourcePath, names);
  const emittedNames = emittedExportSurface(source);
  for (const statement of source.statements) {
    if (
      !typescript.isExportDeclaration(statement) ||
      statement.isTypeOnly ||
      statement.exportClause !== undefined ||
      statement.moduleSpecifier === undefined
    ) {
      continue;
    }
    const targetModule = checker.getSymbolAtLocation(statement.moduleSpecifier);
    for (const declaration of targetModule?.declarations ?? []) {
      if (!typescript.isSourceFile(declaration)) continue;
      for (const name of runtimeExports(
        program,
        checker,
        declaration.fileName,
        cache,
      )) {
        if (name !== "default") emittedNames.add(name);
      }
    }
  }
  for (const exportedSymbol of checker.getExportsOfModule(moduleSymbol)) {
    if (!emittedNames.has(exportedSymbol.name)) continue;
    const target =
      exportedSymbol.flags & typescript.SymbolFlags.Alias
        ? checker.getAliasedSymbol(exportedSymbol)
        : exportedSymbol;
    if (
      target.flags & typescript.SymbolFlags.Value &&
      (target.declarations?.length ?? 0) > 0
    ) {
      names.add(exportedSymbol.name);
    }
  }
  return names;
}

async function workerManifests(repositoryRoot) {
  const workersRoot = join(repositoryRoot, "cloudflare/workers");
  const directories = (await readdir(workersRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const workers = [];
  for (const directory of directories) {
    const root = join(workersRoot, directory);
    const configPath = join(root, "wrangler.jsonc");
    const config = parseJsonc(await readFile(configPath, "utf8"), configPath);
    workers.push({
      directory,
      config,
      sourcePath: join(root, config.main),
    });
  }
  const program = typescript.createProgram({
    rootNames: workers.map((worker) => worker.sourcePath),
    options: {
      target: typescript.ScriptTarget.ESNext,
      module: typescript.ModuleKind.ESNext,
      moduleResolution: typescript.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
    },
  });
  const checker = program.getTypeChecker();
  const exportsCache = new Map();
  return workers.map((worker) => ({
    ...worker,
    exports: runtimeExports(program, checker, worker.sourcePath, exportsCache),
  }));
}

function workerNames(profile, violations) {
  const byName = new Map();
  for (const { worker, config, variant } of profile) {
    if (typeof config.name !== "string") {
      violations.push(`${worker.directory} has no ${variant} Worker name`);
    } else if (byName.has(config.name)) {
      violations.push(`${variant} Worker name ${config.name} is duplicated`);
    } else {
      byName.set(config.name, worker);
    }
  }
  return byName;
}

function validateEntrypoints(profile, byName, violations) {
  let bindingCount = 0;
  for (const { worker, config, variant } of profile) {
    for (const service of config.services ?? []) {
      bindingCount += 1;
      const target = byName.get(service.service);
      if (target === undefined) {
        violations.push(
          `${worker.directory} ${variant} service binding ${service.binding} targets unknown Worker ${service.service}`,
        );
      } else if (
        typeof service.entrypoint === "string" &&
        !target.exports.has(service.entrypoint)
      ) {
        violations.push(
          `${worker.directory} ${variant} service binding ${service.binding} targets missing export ${service.entrypoint} on ${service.service}`,
        );
      }
    }
    for (const workflow of config.workflows ?? []) {
      if (!worker.exports.has(workflow.class_name)) {
        violations.push(
          `${worker.directory} ${variant} Workflow binding ${workflow.binding} targets missing export ${workflow.class_name}`,
        );
      }
    }
    for (const durableObject of config.durable_objects?.bindings ?? []) {
      const target =
        durableObject.script_name === undefined
          ? worker
          : byName.get(durableObject.script_name);
      if (target === undefined) {
        violations.push(
          `${worker.directory} ${variant} Durable Object binding ${durableObject.name} targets unknown Worker ${durableObject.script_name}`,
        );
      } else if (!target.exports.has(durableObject.class_name)) {
        violations.push(
          `${worker.directory} ${variant} Durable Object binding ${durableObject.name} targets missing export ${durableObject.class_name}`,
        );
      }
    }
  }
  return bindingCount;
}

function validateQueueTopology(profile, violations) {
  const consumers = new Map();
  const producers = new Map();
  const variant = profile[0]?.variant ?? "environment";
  for (const { worker, config } of profile) {
    for (const consumer of config.queues?.consumers ?? []) {
      const owners = consumers.get(consumer.queue) ?? [];
      owners.push(worker.directory);
      consumers.set(consumer.queue, owners);
      if (
        typeof consumer.dead_letter_queue !== "string" ||
        consumer.dead_letter_queue.length === 0
      ) {
        violations.push(
          `${worker.directory} ${variant} Queue consumer ${consumer.queue} has no dead-letter Queue`,
        );
      } else if (consumer.dead_letter_queue === consumer.queue) {
        violations.push(
          `${worker.directory} ${variant} Queue consumer ${consumer.queue} uses itself as its dead-letter Queue`,
        );
      }
    }
    for (const producer of config.queues?.producers ?? []) {
      const owners = producers.get(producer.queue) ?? [];
      owners.push({ directory: worker.directory, binding: producer.binding });
      producers.set(producer.queue, owners);
    }
  }
  for (const [queue, owners] of producers) {
    if (!consumers.has(queue)) {
      for (const owner of owners) {
        violations.push(
          `${owner.directory} ${variant} Queue binding ${owner.binding} has no consumer for ${queue}`,
        );
      }
    }
    if (owners.length > 1) {
      violations.push(
        `${variant} Queue ${queue} has multiple producers: ${owners
          .map((owner) => `${owner.directory}.${owner.binding}`)
          .join(", ")}`,
      );
    }
  }
  for (const [queue, owners] of consumers) {
    if (!producers.has(queue)) {
      violations.push(
        `${owners.join(", ")} ${variant} Queue consumer has no producer for ${queue}`,
      );
    }
    if (owners.length > 1) {
      violations.push(
        `${variant} Queue ${queue} has multiple consumers: ${owners.join(", ")}`,
      );
    }
  }
}

function compareTargetNames({
  worker,
  referenceConfig,
  candidateConfig,
  candidateVariant,
  targetName,
  byReferenceName,
  violations,
}) {
  const candidateServices = new Map(
    (candidateConfig.services ?? []).map((service) => [
      service.binding,
      service,
    ]),
  );
  for (const referenceService of referenceConfig.services ?? []) {
    const candidateService = candidateServices.get(referenceService.binding);
    const target = byReferenceName.get(referenceService.service);
    if (candidateService === undefined || target === undefined) continue;
    const expectedTarget = targetName(target);
    if (candidateService.service !== expectedTarget) {
      violations.push(
        `${worker.directory} ${candidateVariant} service binding ${referenceService.binding} targets ${candidateService.service} instead of ${String(expectedTarget)}`,
      );
    }
  }

  const candidateDurableObjects = new Map(
    (candidateConfig.durable_objects?.bindings ?? []).map((binding) => [
      binding.name,
      binding,
    ]),
  );
  for (const referenceBinding of referenceConfig.durable_objects?.bindings ??
    []) {
    const candidateBinding = candidateDurableObjects.get(referenceBinding.name);
    if (candidateBinding === undefined) continue;
    const referenceTarget =
      referenceBinding.script_name === undefined
        ? worker
        : byReferenceName.get(referenceBinding.script_name);
    const expectedTarget =
      referenceBinding.script_name === undefined ||
      referenceTarget === undefined
        ? undefined
        : targetName(referenceTarget);
    if (candidateBinding.script_name !== expectedTarget) {
      violations.push(
        `${worker.directory} ${candidateVariant} Durable Object binding ${referenceBinding.name} changes script target`,
      );
    }
  }
}

export async function validateWorkerBindings(repositoryRoot) {
  const workers = await workerManifests(repositoryRoot);
  const violations = [];
  const byRootName = new Map(
    workers.map((worker) => [worker.config.name, worker]),
  );

  for (const worker of workers) {
    const staging = worker.config.env?.staging;
    if (LOCAL_ONLY_WORKERS.has(worker.directory)) {
      if (staging !== undefined) {
        violations.push(
          `${worker.directory} is local-only but defines a staging environment`,
        );
      }
    } else if (staging === undefined) {
      violations.push(`${worker.directory} has no staging environment`);
    } else {
      compareBindingShapes({
        worker,
        referenceConfig: worker.config,
        candidateConfig: staging,
        candidateVariant: "staging",
        referenceEnvironment: "local",
        candidateEnvironment: "staging",
        allowStagingOnly: true,
        violations,
      });
      compareTargetNames({
        worker,
        referenceConfig: worker.config,
        candidateConfig: staging,
        candidateVariant: "staging",
        targetName: (target) => target.config.env?.staging?.name,
        byReferenceName: byRootName,
        violations,
      });
    }

    const namedLocal = worker.config.env?.local;
    if (
      namedLocal === undefined &&
      REQUIRED_NAMED_LOCAL_WORKERS.has(worker.directory)
    ) {
      violations.push(`${worker.directory} has no named local environment`);
    } else if (namedLocal !== undefined) {
      compareBindingShapes({
        worker,
        referenceConfig: worker.config,
        candidateConfig: namedLocal,
        candidateVariant: "named local",
        referenceEnvironment: "local",
        candidateEnvironment: "local",
        allowStagingOnly: false,
        violations,
      });
      compareTargetNames({
        worker,
        referenceConfig: worker.config,
        candidateConfig: namedLocal,
        candidateVariant: "named local",
        targetName: (target) =>
          target.config.env?.local?.name ?? target.config.name,
        byReferenceName: byRootName,
        violations,
      });
    }
  }

  const localProfile = workers.map((worker) => ({
    worker,
    config: worker.config,
    variant: "local",
  }));
  const stagingProfile = workers
    .filter(
      (worker) =>
        !LOCAL_ONLY_WORKERS.has(worker.directory) &&
        worker.config.env?.staging !== undefined,
    )
    .map((worker) => ({
      worker,
      config: worker.config.env.staging,
      variant: "staging",
    }));
  const namedLocalNames = new Map();
  for (const worker of workers) {
    namedLocalNames.set(worker.config.name, worker);
    const localName = worker.config.env?.local?.name;
    if (typeof localName === "string") namedLocalNames.set(localName, worker);
  }
  const namedLocalProfile = workers
    .filter((worker) => worker.config.env?.local !== undefined)
    .map((worker) => ({
      worker,
      config: worker.config.env.local,
      variant: "named local",
    }));

  const localNames = workerNames(localProfile, violations);
  const stagingNames = workerNames(stagingProfile, violations);
  let bindingCount = validateEntrypoints(localProfile, localNames, violations);
  bindingCount += validateEntrypoints(stagingProfile, stagingNames, violations);
  validateEntrypoints(namedLocalProfile, namedLocalNames, violations);
  validateQueueTopology(localProfile, violations);
  validateQueueTopology(stagingProfile, violations);

  if (violations.length > 0) {
    throw new Error(
      `Worker binding graph invalid:\n${violations
        .map((violation) => `- ${violation}`)
        .join("\n")}`,
    );
  }
  return { workerCount: workers.length, bindingCount };
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath) {
  const repositoryRoot = resolve(dirname(modulePath), "../..");
  try {
    const result = await validateWorkerBindings(repositoryRoot);
    process.stdout.write(
      `Verified ${String(result.workerCount)} Worker manifests, ${String(result.bindingCount)} service bindings, and complete local/staging binding parity.\n`,
    );
  } catch (error) {
    process.stderr.write(
      `[cloudflare:bindings] FAIL ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

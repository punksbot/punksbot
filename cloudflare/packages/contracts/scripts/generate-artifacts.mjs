/**
 * Génération multi-cible du profil `desktop-social-loop@1` (issue #50).
 *
 * Source unique : `registry.json` + `profiles/desktop-social-loop@1.json` +
 * `schemas/*.json`. Produit, de façon déterministe :
 *
 *   - `generated/rust/punks_contracts.rs`   : types serde du profil (compilés
 *     par la crate `punks-account-client` via `include!`) ;
 *   - `generated/dart/punks_contracts.dart` : projection Dart normative,
 *     analysée et exécutée par `check-dart.mjs` ;
 *   - `generated/openapi/desktop-social-loop@1.json` : surface HTTP vérifiée
 *     du profil (routes miroir de `cloudflare/workers/api/src/router.ts` et du
 *     Auth Worker) ;
 *   - `generated/asyncapi/desktop-social-loop@1.json` : canal FOLLOW WebSocket.
 *
 * `--check` échoue sur tout artefact périmé. Les types Rust/Dart projettent la
 * FORME des contrats (champs, unions, constantes, énumérations fermées) ; les
 * contraintes de valeur (pattern, bornes, longueurs, uniqueItems) restent
 * portées par les validateurs JSON Schema et le corpus commun.
 */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateOperationCorpus } from "./conformance-corpus.mjs";
import { emitDart as emitFaithfulDart } from "./dart-emitter.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");
const registry = JSON.parse(
  await readFile(resolve(packageRoot, "registry.json"), "utf8"),
);
const profile = JSON.parse(
  await readFile(
    resolve(packageRoot, "profiles/desktop-social-loop@1.json"),
    "utf8",
  ),
);
const schemaByContract = new Map(
  registry.contracts.map((contract) => [
    contract.id.split("/").pop().split("@")[0],
    contract,
  ]),
);
const schemaCache = new Map();

function externalRefs(node, into) {
  if (Array.isArray(node)) {
    for (const item of node) {
      externalRefs(item, into);
    }
    return into;
  }
  if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") {
        const match = /schemas\/([a-z0-9.-]+)\.schema\.json/.exec(value);
        if (match !== null) {
          into.add(match[1].replace(/\.schema$/, ""));
        }
      } else {
        externalRefs(value, into);
      }
    }
  }
  return into;
}

async function loadSchema(name) {
  if (schemaCache.has(name)) {
    return schemaCache.get(name);
  }
  const contract = schemaByContract.get(name);
  if (contract === undefined) {
    throw new Error(`contrat inconnu du registre : ${name}`);
  }
  const schema = JSON.parse(
    await readFile(resolve(packageRoot, contract.file), "utf8"),
  );
  schemaCache.set(name, schema);
  const refs = [...externalRefs(schema, new Set())];
  await Promise.all(refs.map((ref) => loadSchema(ref)));
  return schema;
}

/** Contrats du profil, dans l'ordre déclaré (request puis response), + problem. */
async function profileContracts() {
  const names = [];
  const seen = new Set();
  const push = (reference) => {
    if (typeof reference !== "string") {
      return;
    }
    const name = reference.split("@")[0];
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  };
  for (const operation of profile.operations) {
    push(operation.requestContract);
    push(operation.responseContract);
  }
  // `getStream` renvoie une enveloppe dont la Conversation peut être complète
  // pour un membre, ou publique pour un visiteur autorisé.
  push("conversation");
  push("problem");
  const entries = await Promise.all(
    names.map(async (name) => [name, await loadSchema(name)]),
  );
  return entries;
}

/**
 * Ajoute à une cible les contrats enregistrés pour la génération anticipée,
 * sans les rendre disponibles ni leur inventer une opération HTTP.
 */
async function generationContracts(profileEntries, target) {
  const entries = [...profileEntries];
  const seen = new Set(entries.map(([name]) => name));
  for (const contract of registry.contracts) {
    if (!contract.generationTargets?.includes(target)) {
      continue;
    }
    const name = contract.id.split("/").pop().split("@")[0];
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    entries.push([name, await loadSchema(name)]);
  }
  return entries;
}

// ── Utilitaires d'émission ──────────────────────────────────────────────────

function pascal(...parts) {
  return parts
    .filter((p) => p !== undefined && p !== null && p !== "")
    .map((part) =>
      String(part)
        .replace(/[^a-zA-Z0-9]+(.)?/g, (_m, c) => (c ? c.toUpperCase() : ""))
        .replace(/^(.)/, (c) => c.toUpperCase()),
    )
    .join("");
}

const RUST_KEYWORDS = new Set([
  "as",
  "break",
  "const",
  "continue",
  "crate",
  "dyn",
  "else",
  "enum",
  "extern",
  "false",
  "fn",
  "for",
  "if",
  "impl",
  "in",
  "let",
  "loop",
  "match",
  "mod",
  "move",
  "mut",
  "pub",
  "ref",
  "return",
  "static",
  "struct",
  "trait",
  "true",
  "type",
  "unsafe",
  "use",
  "where",
  "while",
]);

function snake(name) {
  const cleaned = String(name)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .toLowerCase();
  return RUST_KEYWORDS.has(cleaned) ? `r#${cleaned}` : cleaned;
}

function sanitizeIdentifier(name) {
  const cleaned = String(name).replace(/[^a-zA-Z0-9_]/g, "_");
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

function uniqueName(base, taken, disambiguator) {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  const candidate = `${base}${pascal(disambiguator)}`;
  taken.add(candidate);
  return candidate;
}

// ── Émetteur Rust ───────────────────────────────────────────────────────────

class RustEmitter {
  constructor() {
    this.declarations = [];
    this.checkers = new Map();
    this.names = new Set();
    this.contractNames = new Map();
    this.defTypeMemo = new Map();
  }

  checkerForConst(value) {
    const key = JSON.stringify(value);
    if (!this.checkers.has(key)) {
      const fn = `expect_const_${sanitizeIdentifier(
        snake(typeof value === "number" ? `u${value}` : value),
      )}`;
      this.checkers.set(key, fn);
    }
    return this.checkers.get(key);
  }

  checkerSource() {
    if (this.checkers.size === 0) {
      return "";
    }
    const lines = [
      "mod const_checkers {",
      "    use serde::de::{self, Deserialize, Deserializer};",
      "",
    ];
    for (const [key, fn] of this.checkers) {
      const value = JSON.parse(key);
      if (typeof value === "number") {
        lines.push(
          `    pub(super) fn ${fn}<'de, D>(deserializer: D) -> Result<u64, D::Error>`,
        );
        lines.push("    where");
        lines.push("        D: Deserializer<'de>,");
        lines.push("    {");
        lines.push("        let value = u64::deserialize(deserializer)?;");
        lines.push(
          `        if value == ${value} { Ok(value) } else { Err(de::Error::custom("unexpected constant")) }`,
        );
        lines.push("    }");
      } else if (typeof value === "boolean") {
        lines.push(
          `    pub(super) fn ${fn}<'de, D>(deserializer: D) -> Result<bool, D::Error>`,
        );
        lines.push("    where");
        lines.push("        D: Deserializer<'de>,");
        lines.push("    {");
        lines.push("        let value = bool::deserialize(deserializer)?;");
        lines.push(
          `        if value == ${value} { Ok(value) } else { Err(de::Error::custom("unexpected constant")) }`,
        );
        lines.push("    }");
      } else {
        lines.push(
          `    pub(super) fn ${fn}<'de, D>(deserializer: D) -> Result<String, D::Error>`,
        );
        lines.push("    where");
        lines.push("        D: Deserializer<'de>,");
        lines.push("    {");
        lines.push("        let value = String::deserialize(deserializer)?;");
        lines.push(
          `        if value == ${JSON.stringify(value)} { Ok(value) } else { Err(de::Error::custom("unexpected constant")) }`,
        );
        lines.push("    }");
      }
      lines.push("");
    }
    lines.push("}");
    lines.push("");
    return lines.join("\n");
  }

  /** Nom d'un type interne ($defs ou contrat référencé), en le générant si besoin. */
  typeName(name, schema, defsRoot) {
    if (this.contractNames.has(name)) {
      return this.contractNames.get(name);
    }
    const base = uniqueName(pascal(schema.title ?? name), this.names, name);
    this.contractNames.set(name, base);
    const declared = this.declare(schema, base, defsRoot);
    this.declarations.push(declared);
    return base;
  }

  fieldSchemaType(property, contextTitle) {
    if (property.const !== undefined) {
      return { kind: "const", value: property.const };
    }
    if (Array.isArray(property.enum)) {
      return { kind: "enum", values: property.enum, title: contextTitle };
    }
    if (property.oneOf !== undefined || property.anyOf !== undefined) {
      return {
        kind: "union",
        variants: property.oneOf ?? property.anyOf,
        title: contextTitle,
      };
    }
    const types = Array.isArray(property.type)
      ? property.type
      : [property.type];
    if (types.includes("null")) {
      const inner = { ...property, type: types.filter((t) => t !== "null") };
      if (inner.type.length === 0) {
        return { kind: "simple", rust: "serde_json::Value" };
      }
      const innerType = this.fieldSchemaType(inner, contextTitle);
      if (innerType.kind === "simple" || innerType.kind === "named") {
        return {
          kind: "simple",
          rust: `Option<${innerType.rust ?? innerType.name}>`,
        };
      }
      return innerType;
    }
    switch (types[0]) {
      case "string":
        return { kind: "simple", rust: "String" };
      case "integer":
        return { kind: "simple", rust: "u64" };
      case "number":
        return { kind: "simple", rust: "f64" };
      case "boolean":
        return { kind: "simple", rust: "bool" };
      case "array":
        return {
          kind: "array",
          items: property.items ?? {},
          title: contextTitle,
        };
      case "object": {
        if (property.additionalProperties instanceof Object) {
          return {
            kind: "map",
            values: property.additionalProperties,
            title: contextTitle,
          };
        }
        return { kind: "simple", rust: "serde_json::Value" };
      }
      default:
        throw new Error(`type JSON Schema non supporté : ${types[0]}`);
    }
  }

  rustTypeOf(property, contextTitle, _definitions, rootSchema) {
    if (property.$ref !== undefined) {
      if (property.$ref.startsWith("#/$defs/")) {
        const defName = property.$ref.slice("#/$defs/".length);
        const defSchema = rootSchema?.$defs?.[defName];
        if (defSchema === undefined) {
          throw new Error(`$defs manquant : ${property.$ref}`);
        }
        const memoKey = `${rootSchema.title}#${defName}`;
        if (!this.defTypeMemo.has(memoKey)) {
          const namedDefinition =
            defSchema.type === "object" ||
            defSchema.properties !== undefined ||
            defSchema.enum !== undefined ||
            defSchema.oneOf !== undefined ||
            defSchema.anyOf !== undefined;
          if (namedDefinition) {
            const typeName = uniqueName(
              pascal(rootSchema.title, defName),
              this.names,
              memoKey,
            );
            this.defTypeMemo.set(memoKey, typeName);
            this.declarations.push(
              this.declare(defSchema, typeName, rootSchema),
            );
          } else {
            const resolved = this.rustTypeOf(
              defSchema,
              pascal(rootSchema.title, defName),
              null,
              rootSchema,
            );
            this.defTypeMemo.set(
              memoKey,
              typeof resolved === "string" ? resolved : resolved.constChecker,
            );
          }
        }
        return this.defTypeMemo.get(memoKey);
      }
      const fileMatch = /schemas\/([a-z0-9.-]+)\.schema\.json$/.exec(
        property.$ref,
      );
      if (fileMatch === null) {
        throw new Error(`référence externe non supportée : ${property.$ref}`);
      }
      const contractName = fileMatch[1].replace(/\.schema$/, "");
      const schema = contractSchemaSync(contractName);
      return this.typeName(contractName, schema);
    }
    const shape = this.fieldSchemaType(property, contextTitle);
    switch (shape.kind) {
      case "simple":
        return shape.rust;
      case "const": {
        return { constValue: shape.value };
      }
      case "enum": {
        const enumName = uniqueName(pascal(contextTitle), this.names, "enum");
        this.declarations.push(this.enumSource(enumName, shape.values));
        return enumName;
      }
      case "array": {
        const inner = this.rustTypeOf(
          shape.items,
          contextTitle,
          null,
          rootSchema,
        );
        const innerType =
          typeof inner === "string" ? inner : inner.constChecker;
        return `Vec<${innerType}>`;
      }
      case "map": {
        const inner = this.rustTypeOf(
          shape.values,
          contextTitle,
          null,
          rootSchema,
        );
        const innerType =
          typeof inner === "string" ? inner : inner.constChecker;
        return `std::collections::BTreeMap<String, ${innerType}>`;
      }
      case "union": {
        return this.resolveUnion(shape.variants, contextTitle, rootSchema);
      }
      default:
        throw new Error(`forme non supportée : ${shape.kind}`);
    }
  }

  enumSource(name, values) {
    if (values.every((v) => typeof v === "string")) {
      const renames = values
        .map(
          (value) =>
            `    #[serde(rename = ${JSON.stringify(value)})]\n    ${sanitizeIdentifier(pascal(value))},`,
        )
        .join("\n");
      return [
        `#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]`,
        `#[serde(rename_all = "camelCase")]`,
        `pub enum ${name} {`,
        renames,
        `}`,
      ].join("\n");
    }
    const variants = values
      .map((value) => `    ${sanitizeIdentifier(pascal(String(value)))},`)
      .join("\n");
    return [
      `#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]`,
      `pub enum ${name} {`,
      variants,
      `}`,
    ].join("\n");
  }

  constDiscriminator(variant) {
    if (variant.properties === undefined) {
      return null;
    }
    for (const [property, propertySchema] of Object.entries(
      variant.properties,
    )) {
      if (
        propertySchema !== null &&
        typeof propertySchema === "object" &&
        propertySchema.const !== undefined
      ) {
        return { property, value: propertySchema.const };
      }
    }
    return null;
  }

  constDiscriminators(variants) {
    const candidates = Object.keys(variants[0]?.properties ?? {}).filter(
      (property) => variants[0].properties[property]?.const !== undefined,
    );
    for (const property of candidates) {
      const discriminators = variants.map((variant) => {
        const value = variant.properties?.[property]?.const;
        return value === undefined ? null : { property, value };
      });
      if (
        discriminators.every((value) => value !== null) &&
        new Set(discriminators.map(({ value }) => JSON.stringify(value)))
          .size === variants.length
      ) {
        return discriminators;
      }
    }
    return variants.map((variant) => this.constDiscriminator(variant));
  }

  refDefName(variant) {
    if (
      typeof variant.$ref === "string" &&
      variant.$ref.startsWith("#/$defs/")
    ) {
      return variant.$ref.slice("#/$defs/".length);
    }
    return null;
  }

  /**
   * Projette une union JSON Schema en type Rust :
   *   - variante nulle → Option ;
   *   - une seule variante contrainte → type porteur (contraintes au validateur) ;
   *   - variants primitifs homogènes → primitive commune ;
   *   - objets à discriminant const → enum untagged de structs nommés ;
   *   - objets sans discriminant → struct fusionné (propriétés union,
   *     requis = intersection).
   */
  resolveUnion(rawVariants, contextTitle, rootSchema) {
    const variants = rawVariants.filter(
      (v) => v.type !== "null" && v.const !== null,
    );
    const nullable = variants.length !== rawVariants.length;
    const wrap = (type) => (nullable ? `Option<${type}>` : type);

    if (variants.length === 1) {
      const inner = this.rustTypeOf(
        variants[0],
        contextTitle,
        null,
        rootSchema,
      );
      const innerType = typeof inner === "string" ? inner : inner.constChecker;
      return wrap(innerType);
    }

    const primitives = variants.map((v) => v.type);
    if (
      primitives.every((t) => t === "string") ||
      primitives.every((t) => t === "integer") ||
      primitives.every((t) => t === "boolean")
    ) {
      const rust =
        primitives[0] === "string"
          ? "String"
          : primitives[0] === "integer"
            ? "u64"
            : "bool";
      return wrap(rust);
    }

    const objects = variants.every(
      (v) =>
        v.type === "object" ||
        v.$ref !== undefined ||
        v.properties !== undefined,
    );
    if (!objects) {
      throw new Error(`union non projetable pour ${contextTitle}`);
    }
    const discriminators = this.constDiscriminators(variants);
    const discriminated = variants.every(
      (v, index) =>
        discriminators[index] !== null || this.refDefName(v) !== null,
    );
    if (discriminated) {
      const enumName = uniqueName(pascal(contextTitle), this.names, "union");
      const named = variants.map((variant, index) => {
        const defName = this.refDefName(variant);
        const discriminator = discriminators[index];
        const discriminatorName =
          typeof discriminator?.value === "boolean"
            ? `${contextTitle}${discriminator.value ? "Success" : "Failure"}`
            : discriminator?.value;
        const variantName =
          defName ?? discriminatorName ?? variant.title ?? "variant";
        const resolved =
          defName !== null
            ? (rootSchema?.$defs?.[defName] ?? variant)
            : variant;
        return [pascal(variantName), resolved];
      });
      this.declarations.push(this.unionSource(enumName, named, rootSchema));
      return enumName;
    }

    // Fusion d'objets sans discriminant (variants conditionnels d'un même objet).
    const structName = uniqueName(pascal(contextTitle), this.names, "merged");
    const merged = { type: "object", properties: {}, required: [] };
    const propertyMap = new Map();
    for (const variant of variants) {
      const resolved =
        this.refDefName(variant) !== null
          ? (rootSchema?.$defs?.[this.refDefName(variant)] ?? variant)
          : variant;
      for (const [property, propertySchema] of Object.entries(
        resolved.properties ?? {},
      )) {
        if (
          propertyMap.has(property) &&
          JSON.stringify(propertyMap.get(property)) !==
            JSON.stringify(propertySchema)
        ) {
          throw new Error(
            `conflit de propriété ${property} dans l'union ${contextTitle}`,
          );
        }
        propertyMap.set(property, propertySchema);
      }
    }
    const requiredCounts = new Map();
    for (const variant of variants) {
      const resolved =
        this.refDefName(variant) !== null
          ? (rootSchema?.$defs?.[this.refDefName(variant)] ?? variant)
          : variant;
      for (const field of resolved.required ?? []) {
        requiredCounts.set(field, (requiredCounts.get(field) ?? 0) + 1);
      }
    }
    merged.properties = Object.fromEntries(propertyMap);
    merged.required = [...requiredCounts.entries()]
      .filter(([, count]) => count === variants.length)
      .map(([field]) => field)
      .sort();
    this.declarations.push(this.structSource(structName, merged, merged));
    return wrap(structName);
  }

  unionSource(name, variants, rootSchema) {
    const variantTypes = [];
    for (const [variantName, variantSchema] of variants) {
      const typeName = this.typeName(variantName, variantSchema, rootSchema);
      variantTypes.push([pascal(variantName), typeName]);
    }
    const body = variantTypes
      .map(([variantName, typeName]) => `    ${variantName}(${typeName}),`)
      .join("\n");
    return [
      `#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]`,
      `#[serde(untagged)]`,
      `pub enum ${name} {`,
      body,
      `}`,
    ].join("\n");
  }

  structSource(name, schema, rootSchema) {
    const required = new Set(schema.required ?? []);
    const properties = Object.entries(schema.properties ?? {});
    const fields = [];
    for (const [property, propertySchema] of properties) {
      const rustName = snake(property);
      const rename = rustName === property ? null : property;
      const type = this.rustTypeOf(
        propertySchema,
        `${name}.${property}`,
        null,
        rootSchema,
      );
      if (typeof type === "object" && type.constValue !== undefined) {
        const checker = this.checkerForConst(type.constValue);
        const rustType =
          typeof type.constValue === "number"
            ? "u64"
            : typeof type.constValue === "boolean"
              ? "bool"
              : "String";
        fields.push(
          `    #[serde(rename = ${JSON.stringify(
            property,
          )}, deserialize_with = "const_checkers::${checker}")]`,
        );
        fields.push(`    pub ${rustName}: ${rustType},`);
        continue;
      }
      const optional = !required.has(property);
      // Une union Nullable produit déjà Option<…> ; pas de double enveloppe.
      const rustType =
        optional && !type.startsWith("Option<") ? `Option<${type}>` : type;
      const attributes = [];
      if (rename !== null) {
        attributes.push(`#[serde(rename = ${JSON.stringify(property)})]`);
      }
      if (optional) {
        attributes.push(
          '#[serde(default, skip_serializing_if = "Option::is_none")]',
        );
      }
      for (const attribute of attributes) {
        fields.push(`    ${attribute}`);
      }
      fields.push(`    pub ${rustName}: ${rustType},`);
    }
    if (fields.length === 0) {
      fields.push("    #[serde(flatten)]");
      fields.push("    pub extra: serde_json::Value,");
      return [
        `#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]`,
        `pub struct ${name} {`,
        ...fields,
        `}`,
      ].join("\n");
    }
    return [
      `#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]`,
      `#[serde(deny_unknown_fields, rename_all = "camelCase")]`,
      `pub struct ${name} {`,
      ...fields,
      `}`,
    ].join("\n");
  }

  declare(schema, name, defsRoot) {
    if (
      (schema.oneOf !== undefined || schema.anyOf !== undefined) &&
      schema.properties === undefined
    ) {
      // Les unions racine rejouent la résolution générale, puis l'émetteur
      // d'unions discriminateurs produit l'enum untagged portant ce nom.
      const variants = schema.oneOf ?? schema.anyOf;
      const discriminators = this.constDiscriminators(variants);
      const discriminated = variants.every(
        (v, index) =>
          discriminators[index] !== null || this.refDefName(v) !== null,
      );
      if (discriminated) {
        const named = variants.map((variant, index) => {
          const defName = this.refDefName(variant);
          const discriminator = discriminators[index];
          const discriminatorName =
            typeof discriminator?.value === "boolean"
              ? `${name}${discriminator.value ? "Success" : "Failure"}`
              : discriminator?.value;
          const variantName =
            defName ?? discriminatorName ?? variant.title ?? "variant";
          const resolved =
            defName !== null ? (schema.$defs?.[defName] ?? variant) : variant;
          return [pascal(variantName), resolved];
        });
        return this.unionSource(name, named, schema);
      }
      const merged = this.mergeObjectVariants(variants, name);
      return this.structSource(name, merged, schema);
    }
    if (schema.enum !== undefined) {
      return this.enumSource(name, schema.enum);
    }
    if ((schema.type ?? "object") === "object") {
      return this.structSource(name, schema, defsRoot ?? schema);
    }
    throw new Error(`schéma racine non supporté pour ${name}`);
  }

  mergeObjectVariants(variants, name) {
    const propertyVariants = new Map();
    const requiredCounts = new Map();
    const collect = (variant) => {
      const resolved =
        this.refDefName(variant) !== null
          ? (rootSchemaForMerge?.$defs?.[this.refDefName(variant)] ?? variant)
          : variant;
      for (const [property, propertySchema] of Object.entries(
        resolved.properties ?? {},
      )) {
        if (!propertyVariants.has(property)) {
          propertyVariants.set(property, []);
        }
        const bucket = propertyVariants.get(property);
        const serialized = JSON.stringify(propertySchema);
        if (!bucket.some((s) => JSON.stringify(s) === serialized)) {
          bucket.push(propertySchema);
        }
      }
      for (const field of resolved.required ?? []) {
        requiredCounts.set(field, (requiredCounts.get(field) ?? 0) + 1);
      }
    };
    const rootSchemaForMerge = null;
    for (const variant of variants) {
      collect(variant);
    }
    const propertyMap = new Map();
    for (const [property, schemas] of propertyVariants) {
      propertyMap.set(
        property,
        schemas.length === 1 ? schemas[0] : { anyOf: schemas },
      );
    }
    return {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(propertyMap),
      required: [...requiredCounts.entries()]
        .filter(([, count]) => count === variants.length)
        .map(([field]) => field)
        .sort(),
      $comment: `fusion des variants de ${name}`,
    };
  }
}

const schemaByName = new Map();
async function preload(contracts) {
  for (const [name] of contracts) {
    await loadSchema(name);
  }
  for (const [name, schema] of schemaCache) {
    schemaByName.set(name, schema);
  }
}
function contractSchemaSync(name) {
  const schema = schemaByName.get(name);
  if (schema === undefined) {
    throw new Error(`contrat non préchargé : ${name}`);
  }
  return schema;
}

function emitRust(contracts) {
  const emitter = new RustEmitter();
  const emitted = [];
  for (const [name] of contracts) {
    const typeName = uniqueName(
      pascal(schemaByName.get(name).title ?? name),
      emitter.names,
      name,
    );
    emitter.contractNames.set(name, typeName);
    emitted.push([typeName, schemaByName.get(name)]);
  }
  for (const [typeName, schema] of emitted) {
    emitter.declarations.push(emitter.declare(schema, typeName));
  }
  const decoder = [
    "/// Décode tout contrat du profil par le même chemin de production.",
    "pub fn decode_profile_contract(contract: &str, payload: serde_json::Value) -> Result<(), String> {",
    "    match contract {",
    ...contracts.map(([name, schema]) => {
      const typeName = emitter.contractNames.get(name);
      if (typeName === undefined) {
        throw new Error(`type Rust absent pour ${name}`);
      }
      const contractId = schema.$id ?? `punks://contracts/${name}@1`;
      return `        ${JSON.stringify(contractId)} => serde_json::from_value::<${typeName}>(payload).map(|_| ()).map_err(|error| error.to_string()),`;
    }),
    '        _ => Err(format!("contrat hors profil : {contract}")),',
    "    }",
    "}",
  ].join("\n");
  const header = [
    "// Profil `desktop-social-loop@1` — projection Rust des contrats Punks.",
    "// Généré par `cloudflare/packages/contracts/scripts/generate-artifacts.mjs`.",
    "// NE PAS ÉDITER : toute modification passe par les schémas canoniques.",
    "//",
    "// Ces types projettent la forme des contrats (champs, unions, constantes,",
    "// énumérations fermées, champs inconnus rejetés). Les contraintes de valeur",
    "// (pattern, bornes, longueurs, uniqueItems) restent portées par les",
    "// validateurs JSON Schema et le corpus commun de conformité.",
    "",
    "use serde::{Deserialize, Serialize};",
    "",
  ].join("\n");
  const body = [
    header,
    emitter.checkerSource(),
    ...emitter.declarations,
    decoder,
  ]
    .filter((part) => part !== "")
    .join("\n\n");
  return `${body}\n`;
}

// ── Émetteurs OpenAPI / AsyncAPI ────────────────────────────────────────────

const ROUTES = {
  checkCompatibility: {
    method: "post",
    path: "/api/v1/desktop/compatibility",
  },
  getSession: { method: "get", path: "/api/auth/v1/session" },
  startAuthentication: { method: "post", path: "/api/auth/v1/start" },
  logout: { method: "post", path: "/api/auth/v1/logout" },
  listWorkspaces: { method: "get", path: "/api/v1/workspaces" },
  listStreams: {
    method: "get",
    path: "/api/v1/workspaces/{workspaceId}/conversations",
  },
  getStream: {
    method: "get",
    path: "/api/v1/workspaces/{workspaceId}/conversations/{conversationId}",
  },
  getTimeline: {
    method: "get",
    path: "/api/v1/workspaces/{workspaceId}/conversations/{conversationId}/messages",
  },
  getThread: {
    method: "get",
    path: "/api/v1/workspaces/{workspaceId}/conversations/{conversationId}/messages",
  },
  resolveAuthors: {
    method: "post",
    path: "/api/v1/workspaces/{workspaceId}/authors/resolve",
  },
  postMessage: {
    method: "post",
    path: "/api/v1/workspaces/{workspaceId}/conversations/{conversationId}/messages",
  },
  addReaction: {
    method: "post",
    path: "/api/v1/workspaces/{workspaceId}/conversations/{conversationId}/messages/{messageId}/reactions/add",
  },
  removeReaction: {
    method: "post",
    path: "/api/v1/workspaces/{workspaceId}/conversations/{conversationId}/messages/{messageId}/reactions/remove",
  },
};

const CLIENT_CONTROLS = new Set([
  "openWorkspace",
  "closeWorkspace",
  "resolveWorkspace",
  "followConversation",
  "confirmFollowBatch",
]);

function contractReference(reference) {
  return {
    $ref: `#/components/schemas/${schemaTitle(reference.split("@")[0])}`,
  };
}

function successResponseSchemas(operation) {
  const responseContract = operation.responseContract;
  const contracted =
    responseContract === undefined ? null : contractReference(responseContract);
  let statuses = [200];
  let schema = contracted;
  switch (operation.name) {
    case "getSession":
      schema = {
        type: "object",
        additionalProperties: false,
        required: ["session"],
        properties: { session: contracted },
      };
      break;
    case "getStream":
      schema = {
        type: "object",
        additionalProperties: false,
        required: ["conversation", "canonicalPath"],
        properties: {
          conversation: {
            oneOf: [
              contractReference("conversation@1"),
              contractReference("conversation.view@1"),
            ],
          },
          canonicalPath: { type: "string" },
        },
      };
      break;
    case "logout":
      schema = {
        type: "object",
        additionalProperties: false,
        required: ["signedOut"],
        properties: { signedOut: { type: "boolean", const: true } },
      };
      break;
    case "startAuthentication":
      statuses = [201];
      break;
    case "postMessage":
    case "addReaction":
      statuses = [200, 201];
      break;
  }
  return Object.fromEntries(
    statuses.map((status) => [
      status,
      {
        description:
          status === 201
            ? "Ressource créée par le Worker."
            : "Réponse de succès du Worker.",
        ...(schema === null
          ? {}
          : {
              content: {
                "application/json": { schema },
              },
            }),
      },
    ]),
  );
}

function schemaTitle(name) {
  return pascal(schemaByName.get(name).title ?? name);
}

function openApiComponent(schema, rootName) {
  const clone = JSON.parse(
    JSON.stringify(schema, (key, value) =>
      key === "$comment" ||
      key === "$schema" ||
      key === "$id" ||
      key === "$defs"
        ? undefined
        : value,
    ),
  );
  return rewriteRefs(clone, rootName);
}

function rewriteRefs(node, rootName) {
  if (Array.isArray(node)) {
    return node.map((item) => rewriteRefs(item, rootName));
  }
  if (node !== null && typeof node === "object") {
    const result = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") {
        if (value.startsWith("#/$defs/")) {
          result.$ref = `#/components/schemas/${pascal(rootName, value.slice("#/$defs/".length))}`;
          continue;
        }
        const fileMatch = /schemas\/([a-z0-9.-]+)\.schema\.json$/.exec(value);
        if (fileMatch !== null) {
          const referenced = fileMatch[1].replace(/\.schema$/, "");
          result.$ref = `#/components/schemas/${schemaTitle(referenced)}`;
          continue;
        }
      }
      result[key] = rewriteRefs(value, rootName);
    }
    return result;
  }
  return node;
}

function addSchemaComponents(components, name, schema) {
  const rootName = schema.title ?? name;
  components[schemaTitle(name)] = openApiComponent(schema, rootName);
  for (const [definitionName, definition] of Object.entries(
    schema.$defs ?? {},
  )) {
    components[pascal(rootName, definitionName)] = openApiComponent(
      definition,
      rootName,
    );
  }
}

function operationParameters(operation, route) {
  const placeholders = [...route.path.matchAll(/\{([^}]+)\}/g)].map(
    (match) => match[1],
  );
  if (operation.requestContract === undefined) {
    if (placeholders.length > 0) {
      throw new Error(
        `${operation.name} : paramètres de chemin sans contrat de requête`,
      );
    }
    return [];
  }
  const requestName = operation.requestContract.split("@")[0];
  const requestSchema = schemaByName.get(requestName);
  const properties = requestSchema.properties ?? {};
  const parameters = [];
  for (const placeholder of placeholders) {
    const property = properties[placeholder];
    if (property === undefined) {
      throw new Error(
        `${operation.name} : paramètre de chemin ${placeholder} absent du contrat`,
      );
    }
    parameters.push({
      name: placeholder,
      in: "path",
      required: true,
      schema: openApiComponent(property, requestSchema.title ?? requestName),
    });
  }
  if (route.method === "get") {
    for (const [propertyName, property] of Object.entries(properties)) {
      if (propertyName === "contract" || placeholders.includes(propertyName)) {
        continue;
      }
      parameters.push({
        name: propertyName,
        in: "query",
        // Les routes Workers appliquent les valeurs par défaut du contrat
        // avant validation ; tous les query params du profil sont optionnels
        // sur le fil HTTP.
        required: false,
        schema: openApiComponent(property, requestSchema.title ?? requestName),
      });
    }
  }
  return parameters;
}

function collectComponents(rootNames) {
  const ordered = [];
  const seen = new Set();
  const visit = (name) => {
    if (seen.has(name)) {
      return;
    }
    seen.add(name);
    const schema = schemaByName.get(name);
    ordered.push([name, schema]);
    for (const ref of externalRefs(schema, new Set())) {
      visit(ref);
    }
  };
  for (const name of rootNames) {
    visit(name);
  }
  return ordered;
}

function emitOpenApi(contracts) {
  const components = {};
  for (const [name, schema] of collectComponents(
    contracts.map(([name]) => name),
  )) {
    addSchemaComponents(components, name, schema);
  }

  const paths = {};
  const routeContracts = new Map();
  for (const operation of profile.operations) {
    const route = ROUTES[operation.name];
    if (route === undefined) {
      if (!CLIENT_CONTROLS.has(operation.name)) {
        throw new Error(
          `route HTTP ou contrôle local manquant : ${operation.name}`,
        );
      }
      continue;
    }
    let path = paths[route.path];
    if (path === undefined) {
      path = {};
      paths[route.path] = path;
    }
    const operationObject = {
      operationId: operation.name,
      summary: `${operation.name} (${operation.owner} · ${operation.kind})`,
      tags: [operation.owner],
      parameters: operationParameters(operation, route),
      ...(operation.requestContract !== undefined && route.method !== "get"
        ? {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    $ref: `#/components/schemas/${schemaTitle(
                      operation.requestContract.split("@")[0],
                    )}`,
                  },
                },
              },
            },
          }
        : {}),
      responses: {
        ...successResponseSchemas(operation),
        default: {
          description: "Erreur fermée de la taxonomie Punks.",
          content: {
            "application/json": {
              schema: {
                $ref: `#/components/schemas/${schemaTitle("problem")}`,
              },
            },
          },
        },
      },
    };
    const routeKey = `${route.method} ${route.path}`;
    const contractSignature = JSON.stringify([
      operation.requestContract ?? null,
      operation.responseContract ?? null,
    ]);
    const existing = path[route.method];
    if (existing !== undefined) {
      if (routeContracts.get(routeKey) !== contractSignature) {
        throw new Error(
          `collision de route incompatible : ${routeKey} (${existing.operationId}, ${operation.name})`,
        );
      }
      existing["x-punks-operationIds"] = [
        ...(existing["x-punks-operationIds"] ?? [existing.operationId]),
        operation.name,
      ];
      continue;
    }
    routeContracts.set(routeKey, contractSignature);
    path[route.method] = operationObject;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Punks desktop-social-loop@1",
      version: "1.0.0",
      description: [
        "Surface HTTP vérifiée du profil `desktop-social-loop@1`, générée depuis",
        "le registre commun des contrats. Les routes reflètent",
        "`cloudflare/workers/api/src/router.ts` et le Auth Worker. Les opérations",
        "de contrôle client (openWorkspace, closeWorkspace, resolveWorkspace,",
        "followConversation, confirmFollowBatch) n'ont pas de route HTTP : elles",
        "sont locales à la session ou transportées par le canal FOLLOW (voir",
        "l'artefact AsyncAPI).",
      ].join(" "),
    },
    paths,
    components: { schemas: sortKeys(components) },
  };
}

function emitAsyncApi() {
  const frameName = "conversation.follow-server-frame";
  const clientFrameName = "conversation.follow-client-frame";
  const schemas = {};
  for (const [name, schema] of collectComponents([
    frameName,
    clientFrameName,
  ])) {
    addSchemaComponents(schemas, name, schema);
  }
  return {
    asyncapi: "2.6.0",
    info: {
      title: "Punks desktop-social-loop@1 — canal FOLLOW",
      version: "1.0.0",
      description: [
        "Canal WebSocket FOLLOW du profil `desktop-social-loop@1`, généré depuis",
        "le registre commun. Le serveur publie les trames",
        "`conversation.follow-server-frame@1` (accepted → changes* → ready → live,",
        "puis trames live ou terminal) ; le client n'émet que des accusés",
        "`conversation.follow-client-frame@1` après application atomique d'un lot.",
      ].join(" "),
    },
    servers: {
      punks: {
        url: "{origin}/api/v1",
        protocol: "websocket",
        variables: {
          origin: {
            description: "Origine Punks de la distribution.",
            default: "punks.bot",
          },
        },
      },
    },
    channels: {
      "workspaces/{workspaceId}/conversations/{conversationId}/follow": {
        description:
          "Miroir de la route GET /api/v1/workspaces/{workspaceId}/conversations/{conversationId}/follow du API Worker.",
        parameters: {
          workspaceId: {
            description: "UUID du Workspace autorisé.",
            schema: { type: "string", format: "uuid" },
          },
          conversationId: {
            description: "UUID de la Conversation suivie.",
            schema: { type: "string", format: "uuid" },
          },
        },
        subscribe: {
          operationId: "followConversation",
          message: {
            oneOf: [
              { $ref: `#/components/messages/${schemaTitle(frameName)}` },
            ],
          },
        },
        publish: {
          operationId: "confirmFollowBatch",
          message: {
            oneOf: [
              { $ref: `#/components/messages/${schemaTitle(clientFrameName)}` },
            ],
          },
        },
      },
    },
    components: {
      messages: {
        [schemaTitle(frameName)]: {
          payload: {
            $ref: `#/components/schemas/${schemaTitle(frameName)}`,
          },
        },
        [schemaTitle(clientFrameName)]: {
          payload: {
            $ref: `#/components/schemas/${schemaTitle(clientFrameName)}`,
          },
        },
      },
      schemas: sortKeys(schemas),
    },
  };
}

function sortKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      result[key] = sortKeys(value[key]);
    }
    return result;
  }
  return value;
}

function stableJson(value) {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

// ── Écriture / vérification ─────────────────────────────────────────────────

const profileContractEntries = await profileContracts();
const rustContracts = await generationContracts(profileContractEntries, "rust");
const dartContracts = await generationContracts(profileContractEntries, "dart");
const openApiContracts = await generationContracts(
  profileContractEntries,
  "openapi",
);
const contractsToPreload = [
  ...new Map(
    [...rustContracts, ...dartContracts, ...openApiContracts].map((entry) => [
      entry[0],
      entry,
    ]),
  ).values(),
];
await preload(contractsToPreload);

const targets = [
  {
    path: "generated/rust/punks_contracts.rs",
    content: emitRust(rustContracts),
  },
  {
    path: "generated/dart/punks_contracts.dart",
    content: emitFaithfulDart(dartContracts, {
      pascal,
      uniqueName,
      contractSchemaSync,
    }),
  },
  {
    path: "generated/openapi/desktop-social-loop@1.json",
    content: stableJson(emitOpenApi(openApiContracts)),
  },
  {
    path: "generated/asyncapi/desktop-social-loop@1.json",
    content: stableJson(emitAsyncApi()),
  },
  {
    path: "conformance/desktop-social-loop-operations.json",
    content: stableJson(generateOperationCorpus(profile, schemaByName)),
  },
];

// Le code Rust généré doit être rustfmt-idempotent : le générateur l'écrit
// formaté quand rustfmt est disponible ; sinon il reste brut et le --check
// compare le brut (rustfmt est présent derrière Hermit dans tous les gates).
function formatRust(source) {
  try {
    return execFileSync("rustfmt", ["--edition", "2021", "--emit", "stdout"], {
      encoding: "utf8",
      input: source,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    return source;
  }
}

let stale = 0;
for (const target of targets) {
  const targetPath = resolve(packageRoot, target.path);
  let content = target.content;
  if (target.path.endsWith(".rs")) {
    content = formatRust(content);
  }
  if (checkOnly) {
    let existing = null;
    try {
      existing = await readFile(targetPath, "utf8");
    } catch {
      // absent => périmé
    }
    if (existing !== content) {
      console.error(`artefact périmé ou manquant : ${target.path}`);
      stale += 1;
    }
    continue;
  }
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, "utf8");
  console.log(`artefact généré : ${target.path}`);
}
if (stale > 0) {
  process.exit(1);
}

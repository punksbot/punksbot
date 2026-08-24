const DART_KEYWORDS = new Set([
  "abstract",
  "as",
  "assert",
  "async",
  "await",
  "base",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "covariant",
  "default",
  "deferred",
  "do",
  "dynamic",
  "else",
  "enum",
  "export",
  "extends",
  "extension",
  "external",
  "factory",
  "false",
  "final",
  "finally",
  "for",
  "function",
  "get",
  "hide",
  "if",
  "implements",
  "import",
  "in",
  "interface",
  "is",
  "late",
  "library",
  "mixin",
  "new",
  "null",
  "of",
  "on",
  "operator",
  "part",
  "required",
  "rethrow",
  "return",
  "sealed",
  "set",
  "show",
  "static",
  "super",
  "switch",
  "sync",
  "this",
  "throw",
  "true",
  "try",
  "typedef",
  "var",
  "void",
  "when",
  "while",
  "with",
  "yield",
]);

function dartIdentifier(value, pascal, upper = false) {
  const converted = pascal(value);
  const candidate = upper
    ? converted
    : `${converted.charAt(0).toLowerCase()}${converted.slice(1)}`;
  const safe = /^[0-9]/.test(candidate) ? `_${candidate}` : candidate;
  return DART_KEYWORDS.has(safe) ? `${safe}_` : safe;
}

const literal = (value) => JSON.stringify(value);

function localDefinitionName(reference) {
  return typeof reference === "string" && reference.startsWith("#/$defs/")
    ? reference.slice("#/$defs/".length)
    : null;
}

function externalContractName(reference) {
  const match = /schemas\/([a-z0-9.-]+)\.schema\.json$/.exec(reference ?? "");
  return match?.[1]?.replace(/\.schema$/, "") ?? null;
}

class DartEmitter {
  constructor({ pascal, uniqueName, contractSchemaSync }) {
    this.pascal = pascal;
    this.uniqueName = uniqueName;
    this.contractSchemaSync = contractSchemaSync;
    this.declarations = [];
    this.names = new Set();
    this.named = new Map();
    this.contractNames = new Map();
    this.inlineCounter = 0;
  }

  reserve(preferred, disambiguator) {
    return this.uniqueName(this.pascal(preferred), this.names, disambiguator);
  }

  nullable(descriptor) {
    if (descriptor.kind === "nullable") return descriptor;
    return {
      kind: "nullable",
      dart: descriptor.dart.endsWith("?")
        ? descriptor.dart
        : `${descriptor.dart}?`,
      inner: descriptor,
    };
  }

  primitive(type) {
    const dart = {
      string: "String",
      integer: "int",
      number: "num",
      boolean: "bool",
    }[type];
    return dart === undefined
      ? null
      : { kind: "primitive", dart, primitive: type };
  }

  constDescriptor(value) {
    const primitive =
      typeof value === "string"
        ? "string"
        : typeof value === "number" && Number.isInteger(value)
          ? "integer"
          : typeof value === "number"
            ? "number"
            : typeof value === "boolean"
              ? "boolean"
              : null;
    if (primitive === null) {
      throw new Error(`constante Dart non supportée : ${literal(value)}`);
    }
    return { ...this.primitive(primitive), kind: "const", value };
  }

  descriptor(schema, contextName, rootSchema) {
    if (schema.$ref !== undefined) {
      const local = localDefinitionName(schema.$ref);
      if (local !== null) {
        const definition = rootSchema?.$defs?.[local];
        if (definition === undefined)
          throw new Error(`$defs Dart manquant : ${schema.$ref}`);
        return this.ensureNamed(
          `def:${rootSchema.title}:${local}`,
          this.pascal(rootSchema.title, local),
          definition,
          rootSchema,
        );
      }
      const external = externalContractName(schema.$ref);
      if (external === null)
        throw new Error(`référence Dart non supportée : ${schema.$ref}`);
      const externalSchema = this.contractSchemaSync(external);
      const name =
        this.contractNames.get(external) ??
        this.reserve(externalSchema.title ?? external, external);
      this.contractNames.set(external, name);
      return this.ensureNamed(
        `contract:${external}`,
        name,
        externalSchema,
        externalSchema,
      );
    }
    if (schema.const !== undefined) return this.constDescriptor(schema.const);
    if (Array.isArray(schema.enum)) {
      const name = this.reserve(contextName, "enum");
      const result = { kind: "enum", dart: name, values: schema.enum };
      this.declarations.push(this.enumSource(name, schema.enum));
      return result;
    }
    if (
      (schema.oneOf !== undefined || schema.anyOf !== undefined) &&
      schema.properties === undefined
    ) {
      return this.unionDescriptor(
        schema.oneOf ?? schema.anyOf,
        contextName,
        rootSchema,
      );
    }
    if (Array.isArray(schema.type)) {
      return this.unionDescriptor(
        schema.type.map((type) => ({ ...schema, type })),
        contextName,
        rootSchema,
      );
    }
    const primitive = this.primitive(schema.type);
    if (primitive !== null) return primitive;
    if (schema.type === "array") {
      const item = this.descriptor(
        schema.items ?? {},
        this.pascal(contextName, "item"),
        rootSchema,
      );
      return { kind: "list", dart: `List<${item.dart}>`, item };
    }
    if (schema.type === "object" || schema.properties !== undefined) {
      if (
        schema.additionalProperties !== null &&
        typeof schema.additionalProperties === "object"
      ) {
        const value = this.descriptor(
          schema.additionalProperties,
          this.pascal(contextName, "value"),
          rootSchema,
        );
        return { kind: "map", dart: `Map<String, ${value.dart}>`, value };
      }
      if (schema.properties !== undefined) {
        const suffix = this.inlineCounter++;
        const name = this.reserve(contextName, `inline${suffix}`);
        return this.ensureNamed(
          `inline:${contextName}:${suffix}`,
          name,
          schema,
          rootSchema,
        );
      }
      return { kind: "json", dart: "Map<String, Object?>" };
    }
    throw new Error(`forme JSON Schema Dart non supportée : ${contextName}`);
  }

  ensureNamed(key, preferredName, schema, rootSchema, superclass = null) {
    if (this.named.has(key)) return this.named.get(key);
    if (schema.const !== undefined) return this.constDescriptor(schema.const);
    if (Array.isArray(schema.enum)) {
      const name = this.names.has(preferredName)
        ? preferredName
        : this.reserve(preferredName, key);
      const result = { kind: "enum", dart: name, values: schema.enum };
      this.named.set(key, result);
      this.declarations.push(this.enumSource(name, schema.enum));
      return result;
    }
    if (
      (schema.oneOf !== undefined || schema.anyOf !== undefined) &&
      schema.properties === undefined
    ) {
      return this.unionDescriptor(
        schema.oneOf ?? schema.anyOf,
        preferredName,
        rootSchema,
        key,
      );
    }
    const primitive = this.primitive(schema.type);
    if (primitive !== null) {
      this.named.set(key, primitive);
      return primitive;
    }
    const name = this.names.has(preferredName)
      ? preferredName
      : this.reserve(preferredName, key);
    const result = { kind: "class", dart: name };
    this.named.set(key, result);
    this.declarations.push(
      this.classSource(name, schema, rootSchema, superclass),
    );
    return result;
  }

  resolvedVariant(variant, rootSchema) {
    const local = localDefinitionName(variant.$ref);
    if (local === null) return { schema: variant, local: null };
    const schema = rootSchema?.$defs?.[local];
    if (schema === undefined)
      throw new Error(`variant Dart absent : ${variant.$ref}`);
    return { schema, local };
  }

  discriminator(schema) {
    for (const [property, propertySchema] of Object.entries(
      schema.properties ?? {},
    )) {
      if (propertySchema.const !== undefined)
        return { property, value: propertySchema.const };
    }
    return null;
  }

  unionDiscriminators(resolved) {
    const firstProperties = Object.entries(
      resolved[0]?.schema.properties ?? {},
    );
    for (const [property, propertySchema] of firstProperties) {
      if (propertySchema.const === undefined) continue;
      const values = resolved.map(
        ({ schema }) => schema.properties?.[property]?.const,
      );
      if (
        values.every((value) => value !== undefined) &&
        new Set(values.map((value) => JSON.stringify(value))).size ===
          values.length
      ) {
        return values.map((value) => ({ property, value }));
      }
    }
    return resolved.map(({ schema }) => this.discriminator(schema));
  }

  unionDescriptor(rawVariants, contextName, rootSchema, namedKey = null) {
    const nonNull = rawVariants.filter(
      (variant) => variant.type !== "null" && variant.const !== null,
    );
    const isNullable = nonNull.length !== rawVariants.length;
    if (nonNull.length === 1) {
      const inner = this.descriptor(nonNull[0], contextName, rootSchema);
      const result = isNullable ? this.nullable(inner) : inner;
      if (namedKey !== null) this.named.set(namedKey, result);
      return result;
    }
    const primitiveKinds = nonNull.map((variant) =>
      variant.const !== undefined
        ? this.constDescriptor(variant.const).primitive
        : variant.type,
    );
    if (
      primitiveKinds.length > 0 &&
      primitiveKinds.every((kind) => kind === primitiveKinds[0]) &&
      ["string", "integer", "number", "boolean"].includes(primitiveKinds[0])
    ) {
      const inner = this.primitive(primitiveKinds[0]);
      const result = isNullable ? this.nullable(inner) : inner;
      if (namedKey !== null) this.named.set(namedKey, result);
      return result;
    }
    const resolved = nonNull.map((variant) =>
      this.resolvedVariant(variant, rootSchema),
    );
    const discriminators = this.unionDiscriminators(resolved);
    const objectUnion = resolved.every(
      ({ schema }) =>
        schema.type === "object" || schema.properties !== undefined,
    );
    if (objectUnion && discriminators.every((value) => value !== null)) {
      const preferred = this.pascal(contextName);
      const name = this.names.has(preferred)
        ? preferred
        : this.reserve(preferred, namedKey ?? "union");
      const result = { kind: "union", dart: name };
      if (namedKey !== null) this.named.set(namedKey, result);
      const discriminatorProperty = discriminators[0].property;
      if (
        !discriminators.every(
          (value) => value.property === discriminatorProperty,
        )
      ) {
        throw new Error(`discriminants Dart incompatibles : ${contextName}`);
      }
      const variants = resolved.map(({ schema, local }, index) => {
        const discriminator = discriminators[index];
        const suffix = local ?? discriminator.value ?? `variant${index + 1}`;
        const variantName = this.pascal(name, suffix);
        const key =
          local === null
            ? `union:${name}:${index}`
            : `def:${rootSchema.title}:${local}`;
        const variantDescriptor = this.ensureNamed(
          key,
          variantName,
          schema,
          rootSchema,
          name,
        );
        return {
          name: variantDescriptor.dart,
          discriminator: discriminator.value,
        };
      });
      this.declarations.push(
        this.unionSource(name, discriminatorProperty, variants),
      );
      return isNullable ? this.nullable(result) : result;
    }
    if (objectUnion) {
      const merged = this.mergeObjects(resolved.map(({ schema }) => schema));
      const result = this.ensureNamed(
        namedKey ?? `merged:${contextName}`,
        this.pascal(contextName),
        merged,
        merged,
      );
      return isNullable ? this.nullable(result) : result;
    }
    throw new Error(`union Dart non projetable : ${contextName}`);
  }

  mergeObjects(variants) {
    const properties = new Map();
    const requiredCounts = new Map();
    for (const schema of variants) {
      for (const [name, property] of Object.entries(schema.properties ?? {})) {
        const previous = properties.get(name);
        if (previous === undefined) {
          properties.set(name, property);
        } else if (JSON.stringify(previous) !== JSON.stringify(property)) {
          const variants = previous.anyOf ?? [previous];
          if (
            !variants.some(
              (candidate) =>
                JSON.stringify(candidate) === JSON.stringify(property),
            )
          ) {
            variants.push(property);
          }
          properties.set(name, { anyOf: variants });
        }
      }
      for (const name of schema.required ?? []) {
        requiredCounts.set(name, (requiredCounts.get(name) ?? 0) + 1);
      }
    }
    return {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(properties),
      required: [...requiredCounts]
        .filter(([, count]) => count === variants.length)
        .map(([name]) => name),
    };
  }

  enumSource(name, values) {
    const used = new Set();
    const members = values.map((value, index) => {
      const base = dartIdentifier(String(value), this.pascal);
      const member = used.has(base) ? `${base}${index + 1}` : base;
      used.add(member);
      return `  ${member}(${literal(value)}),`;
    });
    const valueType = values.every((value) => typeof value === "string")
      ? "String"
      : values.every(
            (value) => typeof value === "number" && Number.isInteger(value),
          )
        ? "int"
        : values.every((value) => typeof value === "number")
          ? "num"
          : values.every((value) => typeof value === "boolean")
            ? "bool"
            : "Object";
    return [
      `enum ${name} {`,
      ...members,
      "  ;",
      "",
      `  const ${name}(this.value);`,
      "",
      `  final ${valueType} value;`,
      "",
      `  factory ${name}.fromJson(Object? value, String path) {`,
      "    for (final candidate in values) {",
      "      if (candidate.value == value) return candidate;",
      "    }",
      `    throw FormatException('$path must be a ${name} value');`,
      "  }",
      "",
      `  ${valueType} toJson() => value;`,
      "}",
    ].join("\n");
  }

  unionSource(name, discriminator, variants) {
    return [
      `sealed class ${name} {`,
      `  const ${name}();`,
      "",
      `  factory ${name}.fromJson(Map<String, Object?> json) {`,
      `    switch (json[${literal(discriminator)}]) {`,
      ...variants.flatMap((variant) => [
        `      case ${literal(variant.discriminator)}:`,
        `        return ${variant.name}.fromJson(json);`,
      ]),
      "      default:",
      `        throw FormatException('${name}.${discriminator} has no matching variant');`,
      "    }",
      "  }",
      "",
      "  Map<String, Object?> toJson();",
      "}",
    ].join("\n");
  }

  decode(descriptor, expression, path) {
    switch (descriptor.kind) {
      case "nullable":
        return `${expression} == null ? null : ${this.decode(descriptor.inner, expression, path)}`;
      case "const": {
        const helper = {
          string: "_expectStringConst",
          integer: "_expectIntConst",
          number: "_expectNumConst",
          boolean: "_expectBoolConst",
        }[descriptor.primitive];
        return `${helper}(${expression}, ${literal(descriptor.value)}, ${literal(path)})`;
      }
      case "primitive": {
        const helper = {
          string: "_asString",
          integer: "_asInt",
          number: "_asNum",
          boolean: "_asBool",
        }[descriptor.primitive];
        return `${helper}(${expression}, ${literal(path)})`;
      }
      case "enum":
        return `${descriptor.dart}.fromJson(${expression}, ${literal(path)})`;
      case "class":
      case "union":
        return `${descriptor.dart}.fromJson(_asMap(${expression}, ${literal(path)}))`;
      case "list":
        return `_asList(${expression}, ${literal(path)}).map((item) => ${this.decode(descriptor.item, "item", `${path}[]`)}).toList(growable: false)`;
      case "map":
        return `_asMap(${expression}, ${literal(path)}).map((key, value) => MapEntry(key, ${this.decode(descriptor.value, "value", `${path}.*`)}))`;
      case "json":
        return `_asMap(${expression}, ${literal(path)})`;
      default:
        throw new Error(`decodeur Dart inconnu : ${descriptor.kind}`);
    }
  }

  encode(descriptor, expression) {
    switch (descriptor.kind) {
      case "nullable":
        return `${expression} == null ? null : ${this.encode(descriptor.inner, `${expression}!`)}`;
      case "enum":
      case "class":
      case "union":
        return `${expression}.toJson()`;
      case "list":
        return `${expression}.map((item) => ${this.encode(descriptor.item, "item")}).toList(growable: false)`;
      case "map":
        return `${expression}.map((key, value) => MapEntry(key, ${this.encode(descriptor.value, "value")}))`;
      default:
        return expression;
    }
  }

  schemaCondition(schema, expression, rootSchema) {
    if (schema.$ref !== undefined) {
      const local = localDefinitionName(schema.$ref);
      if (local === null) return "true";
      const definition = rootSchema?.$defs?.[local];
      if (definition === undefined) {
        throw new Error(`$defs Dart manquant : ${schema.$ref}`);
      }
      return this.schemaCondition(definition, expression, rootSchema);
    }
    const checks = [];
    const types = Array.isArray(schema.type)
      ? schema.type
      : schema.type === undefined
        ? []
        : [schema.type];
    if (types.length > 0) {
      const typeChecks = types.map((type) => {
        switch (type) {
          case "null":
            return `${expression} == null`;
          case "string":
            return `${expression} is String`;
          case "integer":
            return `${expression} is int`;
          case "number":
            return `${expression} is num`;
          case "boolean":
            return `${expression} is bool`;
          case "array":
            return `${expression} is List<Object?>`;
          case "object":
            return `${expression} is Map<String, Object?>`;
          default:
            throw new Error(`type conditionnel Dart non supporté : ${type}`);
        }
      });
      checks.push(`(${typeChecks.join(" || ")})`);
    }
    if (schema.const !== undefined) {
      checks.push(`${expression} == ${literal(schema.const)}`);
    }
    if (Array.isArray(schema.enum)) {
      checks.push(
        `const <Object?>[${schema.enum.map((value) => literal(value)).join(", ")}].contains(${expression})`,
      );
    }
    for (const required of schema.required ?? []) {
      checks.push(`_hasKey(${expression}, ${literal(required)})`);
    }
    for (const [property, propertySchema] of Object.entries(
      schema.properties ?? {},
    )) {
      const value = `_valueAt(${expression}, ${literal(property)})`;
      checks.push(
        `(!_hasKey(${expression}, ${literal(property)}) || (${this.schemaCondition(propertySchema, value, rootSchema)}))`,
      );
    }
    if (Array.isArray(schema.allOf)) {
      checks.push(
        ...schema.allOf.map(
          (variant) =>
            `(${this.schemaCondition(variant, expression, rootSchema)})`,
        ),
      );
    }
    if (Array.isArray(schema.anyOf)) {
      checks.push(
        `(<bool>[${schema.anyOf.map((variant) => this.schemaCondition(variant, expression, rootSchema)).join(", ")}].any((match) => match))`,
      );
    }
    if (Array.isArray(schema.oneOf)) {
      checks.push(
        `(<bool>[${schema.oneOf.map((variant) => this.schemaCondition(variant, expression, rootSchema)).join(", ")}].where((match) => match).length == 1)`,
      );
    }
    if (schema.not !== undefined) {
      checks.push(
        `!(${this.schemaCondition(schema.not, expression, rootSchema)})`,
      );
    }
    if (schema.if !== undefined) {
      const condition = this.schemaCondition(schema.if, expression, rootSchema);
      const thenCondition = this.schemaCondition(
        schema.then ?? {},
        expression,
        rootSchema,
      );
      const elseCondition = this.schemaCondition(
        schema.else ?? {},
        expression,
        rootSchema,
      );
      checks.push(`((${condition}) ? (${thenCondition}) : (${elseCondition}))`);
    }
    return checks.length === 0 ? "true" : checks.join(" && ");
  }

  classSource(name, schema, rootSchema, superclass) {
    const required = new Set(schema.required ?? []);
    const fields = Object.entries(schema.properties ?? {}).map(
      ([jsonName, propertySchema]) => {
        const fieldName = dartIdentifier(jsonName, this.pascal);
        const baseDescriptor = this.descriptor(
          propertySchema,
          this.pascal(name, jsonName),
          rootSchema,
        );
        const isRequired = required.has(jsonName);
        return {
          jsonName,
          fieldName,
          required: isRequired,
          valueDescriptor: baseDescriptor,
          descriptor: isRequired
            ? baseDescriptor
            : this.nullable(baseDescriptor),
        };
      },
    );
    const lines = [
      `class ${name}${superclass === null ? "" : ` extends ${superclass}`} {`,
      ...fields.map(
        (field) => `  final ${field.descriptor.dart} ${field.fieldName};`,
      ),
      "",
      `  const ${name}({`,
      ...fields.map(
        (field) =>
          `    ${field.required ? "required " : ""}this.${field.fieldName},`,
      ),
      `  })${superclass === null ? ";" : " : super();"}`,
      "",
      `  factory ${name}.fromJson(Map<String, Object?> json) {`,
    ];
    if (schema.additionalProperties === false) {
      lines.push(
        `    _rejectUnknownKeys(json, const {${fields.map((field) => literal(field.jsonName)).join(", ")}}, ${literal(name)});`,
      );
    }
    if (
      schema.oneOf !== undefined ||
      schema.anyOf !== undefined ||
      schema.allOf !== undefined
    ) {
      const structuralSchema = {};
      if (schema.oneOf !== undefined) structuralSchema.oneOf = schema.oneOf;
      if (schema.anyOf !== undefined) structuralSchema.anyOf = schema.anyOf;
      if (schema.allOf !== undefined) structuralSchema.allOf = schema.allOf;
      const condition = this.schemaCondition(
        structuralSchema,
        "json",
        rootSchema,
      );
      lines.push(
        `    if (!(${condition})) {`,
        `      throw FormatException(${literal(`${name} violates its structural alternatives`)});`,
        "    }",
      );
    }
    lines.push(`    return ${name}(`);
    for (const field of fields) {
      const raw = field.required
        ? `_requiredKey(json, ${literal(field.jsonName)}, ${literal(name)})`
        : `json[${literal(field.jsonName)}]`;
      const decoded = this.decode(
        field.valueDescriptor,
        raw,
        `${name}.${field.jsonName}`,
      );
      lines.push(
        `      ${field.fieldName}: ${field.required ? decoded : `json.containsKey(${literal(field.jsonName)}) ? ${decoded} : null`},`,
      );
    }
    lines.push("    );", "  }", "");
    if (superclass !== null) lines.push("  @override");
    lines.push(
      "  Map<String, Object?> toJson() {",
      "    final json = <String, Object?>{",
    );
    for (const field of fields.filter((field) => field.required)) {
      lines.push(
        `      ${literal(field.jsonName)}: ${this.encode(field.descriptor, field.fieldName)},`,
      );
    }
    lines.push("    };");
    for (const field of fields.filter((field) => !field.required)) {
      lines.push(`    if (${field.fieldName} != null) {`);
      lines.push(
        `      json[${literal(field.jsonName)}] = ${this.encode(field.descriptor.inner, `${field.fieldName}!`)};`,
      );
      lines.push("    }");
    }
    lines.push("    return json;", "  }", "}");
    return lines.join("\n");
  }

  emit(contracts) {
    for (const [contractName, schema] of contracts) {
      this.contractNames.set(
        contractName,
        this.reserve(schema.title ?? contractName, contractName),
      );
    }
    for (const [contractName, schema] of contracts) {
      this.ensureNamed(
        `contract:${contractName}`,
        this.contractNames.get(contractName),
        schema,
        schema,
      );
    }
    const header = [
      "// Profil `desktop-social-loop@1` — projection Dart des contrats Punks.",
      "// Généré par `cloudflare/packages/contracts/scripts/generate-artifacts.mjs`.",
      "// NE PAS ÉDITER : toute modification passe par les schémas canoniques.",
      "//",
      "// Les objets, champs optionnels, constantes, enums et unions fermées",
      "// projettent fidèlement la forme JSON Schema. Les contraintes de valeur",
      "// restent vérifiées par le registre et le corpus commun de conformité.",
      "",
      ...DART_RUNTIME_HELPERS,
      "",
    ];
    return `${header.join("\n")}\n${this.declarations.join("\n\n")}\n`;
  }
}

const DART_RUNTIME_HELPERS = [
  "Never _invalid(String path, String expected) =>",
  "    throw FormatException('$path must be $expected');",
  "",
  "Object? _requiredKey(Map<String, Object?> json, String key, String typeName) {",
  "  if (!json.containsKey(key)) {",
  "    throw FormatException('$typeName.$key is required');",
  "  }",
  "  return json[key];",
  "}",
  "",
  "bool _hasKey(Object? value, String key) =>",
  "    value is Map<String, Object?> && value.containsKey(key);",
  "",
  "Object? _valueAt(Object? value, String key) =>",
  "    value is Map<String, Object?> ? value[key] : null;",
  "",
  "void _rejectUnknownKeys(Map<String, Object?> json, Set<String> allowed, String typeName) {",
  "  final unknown = json.keys.where((key) => !allowed.contains(key)).toList();",
  "  if (unknown.isNotEmpty) {",
  "    throw FormatException('$typeName contains unknown field $" +
    "{unknown.first}');",
  "  }",
  "}",
  "",
  "String _asString(Object? value, String path) => value is String ? value : _invalid(path, 'a string');",
  "int _asInt(Object? value, String path) => value is int ? value : _invalid(path, 'an integer');",
  "num _asNum(Object? value, String path) => value is num ? value : _invalid(path, 'a number');",
  "bool _asBool(Object? value, String path) => value is bool ? value : _invalid(path, 'a boolean');",
  "List<Object?> _asList(Object? value, String path) => value is List<Object?> ? value : _invalid(path, 'a JSON array');",
  "Map<String, Object?> _asMap(Object? value, String path) => value is Map<String, Object?> ? value : _invalid(path, 'a JSON object');",
  "",
  "String _expectStringConst(Object? value, String expected, String path) {",
  "  final actual = _asString(value, path);",
  "  if (actual != expected) _invalid(path, expected);",
  "  return actual;",
  "}",
  "",
  "int _expectIntConst(Object? value, int expected, String path) {",
  "  final actual = _asInt(value, path);",
  "  if (actual != expected) _invalid(path, expected.toString());",
  "  return actual;",
  "}",
  "",
  "// ignore: unused_element",
  "num _expectNumConst(Object? value, num expected, String path) {",
  "  final actual = _asNum(value, path);",
  "  if (actual != expected) _invalid(path, expected.toString());",
  "  return actual;",
  "}",
  "",
  "// ignore: unused_element",
  "bool _expectBoolConst(Object? value, bool expected, String path) {",
  "  final actual = _asBool(value, path);",
  "  if (actual != expected) _invalid(path, expected.toString());",
  "  return actual;",
  "}",
];

export function emitDart(contracts, dependencies) {
  return new DartEmitter(dependencies).emit(contracts);
}

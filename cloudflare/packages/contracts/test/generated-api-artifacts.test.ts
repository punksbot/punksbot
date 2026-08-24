import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import asyncApiJson from "../generated/asyncapi/desktop-social-loop@1.json";
import openApiJson from "../generated/openapi/desktop-social-loop@1.json";
import profileJson from "../profiles/desktop-social-loop@1.json";

type JsonObject = Record<string, unknown>;

function objectEntries(value: unknown): Array<[string, unknown]> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.entries(value)
    : [];
}

function localReferences(value: unknown, references: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) localReferences(item, references);
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (
        key === "$ref" &&
        typeof child === "string" &&
        child.startsWith("#/")
      ) {
        references.push(child);
      } else {
        localReferences(child, references);
      }
    }
  }
  return references;
}

function resolvesPointer(document: unknown, pointer: string): boolean {
  let current = document;
  for (const encoded of pointer.slice(2).split("/")) {
    const segment = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    if (
      current === null ||
      typeof current !== "object" ||
      Array.isArray(current) ||
      !(segment in current)
    ) {
      return false;
    }
    current = (current as JsonObject)[segment];
  }
  return true;
}

describe("artefacts API générés desktop-social-loop@1", () => {
  it.each([
    ["OpenAPI", openApiJson],
    ["AsyncAPI", asyncApiJson],
  ])("%s : toutes les références locales se résolvent", (_name, document) => {
    const unresolved = localReferences(document).filter(
      (reference) => !resolvesPointer(document, reference),
    );
    expect([...new Set(unresolved)]).toEqual([]);
  });

  it("OpenAPI : aucune opération HTTP du profil n’est perdue par collision", () => {
    const localOperations = new Set([
      "openWorkspace",
      "closeWorkspace",
      "resolveWorkspace",
      "followConversation",
      "confirmFollowBatch",
    ]);
    const expected = profileJson.operations
      .map((operation) => operation.name)
      .filter((name) => !localOperations.has(name));
    const represented = new Set<string>();
    for (const [, pathItem] of objectEntries(openApiJson.paths)) {
      for (const [, operation] of objectEntries(pathItem)) {
        const operationObject = operation as JsonObject;
        if (typeof operationObject.operationId === "string") {
          represented.add(operationObject.operationId);
        }
        const aliases = operationObject["x-punks-operationIds"];
        if (Array.isArray(aliases)) {
          for (const alias of aliases) {
            if (typeof alias === "string") represented.add(alias);
          }
        }
      }
    }
    expect([...represented].sort()).toEqual([...expected].sort());
  });

  it("OpenAPI : les paramètres de chemin sont déclarés et les GET n’ont pas de body", () => {
    for (const [path, pathItem] of objectEntries(openApiJson.paths)) {
      const placeholders = [...path.matchAll(/\{([^}]+)\}/g)].map(
        (match) => match[1],
      );
      for (const [method, operation] of objectEntries(pathItem)) {
        const operationObject = operation as JsonObject;
        const parameters = Array.isArray(operationObject.parameters)
          ? (operationObject.parameters as JsonObject[])
          : [];
        const pathParameters = parameters
          .filter((parameter) => parameter.in === "path")
          .map((parameter) => parameter.name);
        expect(pathParameters, `${method.toUpperCase()} ${path}`).toEqual(
          placeholders,
        );
        if (method === "get") {
          expect(operationObject, `GET ${path}`).not.toHaveProperty(
            "requestBody",
          );
        }
      }
    }
  });

  it("OpenAPI : les paramètres query optionnels du routeur restent optionnels", () => {
    for (const [path, pathItem] of objectEntries(openApiJson.paths)) {
      for (const [method, operation] of objectEntries(pathItem)) {
        const operationObject = operation as JsonObject;
        const parameters = Array.isArray(operationObject.parameters)
          ? (operationObject.parameters as JsonObject[])
          : [];
        for (const parameter of parameters.filter(
          (candidate) => candidate.in === "query",
        )) {
          expect(
            parameter.required,
            `${method.toUpperCase()} ${path} query ${String(parameter.name)}`,
          ).toBe(false);
        }
      }
    }
  });

  it("OpenAPI : conserve les enveloppes et statuts de succès réellement servis", () => {
    const paths = openApiJson.paths as JsonObject;
    const operation = (path: string, method: string) =>
      (paths[path] as JsonObject)[method] as JsonObject;
    const responses = (path: string, method: string) =>
      operation(path, method).responses as JsonObject;
    const responseSchema = (path: string, method: string, status: string) =>
      (
        ((responses(path, method)[status] as JsonObject).content as JsonObject)[
          "application/json"
        ] as JsonObject
      ).schema as JsonObject;

    expect(responseSchema("/api/auth/v1/session", "get", "200")).toMatchObject({
      type: "object",
      required: ["session"],
      properties: {
        session: { $ref: "#/components/schemas/AuthSession" },
      },
    });
    expect(Object.keys(responses("/api/auth/v1/start", "post"))).toContain(
      "201",
    );
    expect(responseSchema("/api/auth/v1/logout", "post", "200")).toMatchObject({
      type: "object",
      required: ["signedOut"],
      properties: { signedOut: { type: "boolean", const: true } },
    });
    expect(
      responseSchema(
        "/api/v1/workspaces/{workspaceId}/conversations/{conversationId}",
        "get",
        "200",
      ),
    ).toMatchObject({
      type: "object",
      required: ["conversation", "canonicalPath"],
      properties: {
        conversation: {
          oneOf: [
            { $ref: "#/components/schemas/Conversation" },
            { $ref: "#/components/schemas/ConversationView" },
          ],
        },
        canonicalPath: { type: "string" },
      },
    });
    expect(
      Object.keys(
        responses(
          "/api/v1/workspaces/{workspaceId}/conversations/{conversationId}/messages",
          "post",
        ),
      ),
    ).toEqual(expect.arrayContaining(["200", "201", "default"]));
  });

  it("AsyncAPI : chaque variable du canal FOLLOW est déclarée", () => {
    for (const [channelName, channel] of objectEntries(asyncApiJson.channels)) {
      const placeholders = [...channelName.matchAll(/\{([^}]+)\}/g)].map(
        (match) => match[1],
      );
      const parameters = Object.keys(
        ((channel as JsonObject).parameters as JsonObject | undefined) ?? {},
      );
      expect(parameters.toSorted(), channelName).toEqual(
        placeholders.toSorted(),
      );
    }
  });

  it("Dart : la projection conserve options, enums, objets imbriqués et unions FOLLOW", () => {
    const dart = readFileSync(
      fileURLToPath(
        new URL("../generated/dart/punks_contracts.dart", import.meta.url),
      ),
      "utf8",
    );

    expect(dart).toContain("enum PunksProblemCode");
    expect(dart).toContain("final String? detail;");
    expect(dart).toMatch(/const PunksProblem\(\{[\s\S]*?\s+this\.detail,/);
    expect(dart).not.toMatch(/required this\.detail/);
    expect(dart).toContain("class AuthSessionPunk");
    expect(dart).toContain("sealed class ConversationFollowServerFrame");
    expect(dart).toContain(
      "class ConversationFollowServerFrameAccepted extends ConversationFollowServerFrame",
    );
    expect(dart).toMatch(
      /class MessageHistoryQuery \{[\s\S]*?final String contract;[\s\S]*?final String workspaceId;[\s\S]*?final int limit;/,
    );
    expect(dart).not.toMatch(/final Object\??\s+[A-Za-z_][A-Za-z0-9_]*;/);
  });

  it("Dart : chaque objet fermé rejette les champs inconnus et valide les constantes", () => {
    const dart = readFileSync(
      fileURLToPath(
        new URL("../generated/dart/punks_contracts.dart", import.meta.url),
      ),
      "utf8",
    );

    expect(dart).toContain("void _rejectUnknownKeys(");
    expect(dart).toContain("_expectStringConst(");
    expect(dart).toContain("_expectIntConst(");
    expect(dart.match(/_rejectUnknownKeys\(/g)?.length ?? 0).toBeGreaterThan(
      20,
    );
  });

  it("projette les contrats du Plan de Fusion dans Rust, Dart et OpenAPI sans route active", () => {
    const rust = readFileSync(
      fileURLToPath(
        new URL("../generated/rust/punks_contracts.rs", import.meta.url),
      ),
      "utf8",
    );
    const dart = readFileSync(
      fileURLToPath(
        new URL("../generated/dart/punks_contracts.dart", import.meta.url),
      ),
      "utf8",
    );
    const components = openApiJson.components.schemas as JsonObject;

    for (const typeName of [
      "AccountMergeFreshProof",
      "CreateAccountMergePlanCommand",
      "AccountMergePlan",
      "AccountMergePlanResponse",
    ]) {
      expect(rust).toContain(typeName);
      expect(dart).toContain(typeName);
      expect(components).toHaveProperty(typeName);
    }
    expect(rust).toContain("pub ok: bool");
    expect(rust).toContain(
      "AccountMergePlanResponseSuccess(AccountMergePlanResponseSuccess)",
    );
    expect(rust).toContain(
      "AccountMergePlanResponseFailure(AccountMergePlanResponseFailure)",
    );
    expect(rust).not.toMatch(/\b(?:True|False)\((?:True|False)\)/);
    expect(rust).toContain("pub claims: Vec<AccountMergePlanClaimEffect>");
    expect(rust).toContain("pub rights: Vec<AccountMergePlanRightEffect>");
    expect(rust).not.toMatch(
      /pub enum AccountMergePlanResponse \{\s+AccountMergePlanResponse1\([^\n]+\),\s+AccountMergePlanResponse1\(/,
    );
    expect(openApiJson.paths).not.toHaveProperty("/api/v1/account/merge/plans");
  });

  it("Dart : la CI propre bootstrappe le SDK épinglé du dépôt", () => {
    const checker = readFileSync(
      fileURLToPath(new URL("../scripts/check-dart.mjs", import.meta.url)),
      "utf8",
    );
    const workflow = readFileSync(
      fileURLToPath(
        new URL(
          "../../../../.github/workflows/punks-cloudflare.yml",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    expect(checker).toContain("hermitWrapper");
    expect(workflow).toContain("./bin/dart --version");
  });

  it("Rust : le décodeur généré couvre chaque contrat du profil", () => {
    const rust = readFileSync(
      fileURLToPath(
        new URL("../generated/rust/punks_contracts.rs", import.meta.url),
      ),
      "utf8",
    );
    expect(rust).toContain("pub fn decode_profile_contract(");
    const contracts = new Set(
      profileJson.operations.flatMap(({ requestContract, responseContract }) =>
        [requestContract, responseContract].filter(
          (contract): contract is string => contract !== undefined,
        ),
      ),
    );
    for (const contract of contracts) {
      expect(rust).toContain(`"punks://contracts/${contract}" =>`);
    }
  });
});

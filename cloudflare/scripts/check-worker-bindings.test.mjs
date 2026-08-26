import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateWorkerBindings } from "./check-worker-bindings.mjs";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

async function writeWorker(root, directory, config, source) {
  const workerRoot = join(root, "cloudflare/workers", directory);
  await mkdir(join(workerRoot, "src"), { recursive: true });
  await writeFile(
    join(workerRoot, "wrangler.jsonc"),
    `${JSON.stringify(config, null, 2)}\n`,
  );
  await writeFile(join(workerRoot, "src/index.ts"), source);
}

async function writeRpcEntrypointFixture(
  root,
  { entrypoint, projectorSource, supportingSources = [] },
) {
  await writeWorker(
    root,
    "projector",
    {
      name: "punks-projector",
      main: "src/index.ts",
      env: { staging: { name: "punks-projector-staging" } },
    },
    projectorSource,
  );
  for (const [filename, source] of supportingSources) {
    await writeFile(
      join(root, "cloudflare/workers/projector/src", filename),
      source,
    );
  }
  await writeWorker(
    root,
    "api",
    {
      name: "punks-api",
      main: "src/index.ts",
      services: [
        {
          binding: "PROJECTION_DIRECTORY",
          service: "punks-projector",
          entrypoint,
        },
      ],
      env: {
        staging: {
          name: "punks-api-staging",
          services: [
            {
              binding: "PROJECTION_DIRECTORY",
              service: "punks-projector-staging",
              entrypoint,
            },
          ],
        },
      },
    },
    "export default {};\n",
  );
}

test("rejects a service binding whose public RPC entrypoint is absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "punks-worker-bindings-"));
  await writeRpcEntrypointFixture(root, {
    entrypoint: "MissingDirectoryService",
    projectorSource:
      "export class ProjectionDirectoryService {}\nexport default {};\n",
  });

  await assert.rejects(
    validateWorkerBindings(root),
    /api local service binding PROJECTION_DIRECTORY targets missing export MissingDirectoryService on punks-projector/,
  );
});

test("does not accept a public RPC entrypoint mentioned only in a comment", async () => {
  const root = await mkdtemp(join(tmpdir(), "punks-worker-bindings-"));
  await writeRpcEntrypointFixture(root, {
    entrypoint: "MissingDirectoryService",
    projectorSource:
      "// export class MissingDirectoryService {}\nexport default {};\n",
  });

  await assert.rejects(
    validateWorkerBindings(root),
    /api local service binding PROJECTION_DIRECTORY targets missing export MissingDirectoryService on punks-projector/,
  );
});

test("does not accept a type-only re-export as a public RPC entrypoint", async () => {
  const root = await mkdtemp(join(tmpdir(), "punks-worker-bindings-"));
  await writeRpcEntrypointFixture(root, {
    entrypoint: "ProjectionDirectoryService",
    projectorSource:
      'export type { ProjectionDirectoryService } from "./directory-service";\nexport default {};\n',
    supportingSources: [
      ["directory-service.ts", "export class ProjectionDirectoryService {}\n"],
    ],
  });

  await assert.rejects(
    validateWorkerBindings(root),
    /api local service binding PROJECTION_DIRECTORY targets missing export ProjectionDirectoryService on punks-projector/,
  );
});

test("does not accept a type-only star re-export as a public RPC entrypoint", async () => {
  const root = await mkdtemp(join(tmpdir(), "punks-worker-bindings-"));
  await writeRpcEntrypointFixture(root, {
    entrypoint: "ProjectionDirectoryService",
    projectorSource:
      'export type * from "./directory-service";\nexport default {};\n',
    supportingSources: [
      ["directory-service.ts", "export class ProjectionDirectoryService {}\n"],
    ],
  });

  await assert.rejects(
    validateWorkerBindings(root),
    /api local service binding PROJECTION_DIRECTORY targets missing export ProjectionDirectoryService on punks-projector/,
  );
});

test("does not let a runtime star mask a separate type-only RPC export", async () => {
  const root = await mkdtemp(join(tmpdir(), "punks-worker-bindings-"));
  await writeRpcEntrypointFixture(root, {
    entrypoint: "ProjectionDirectoryService",
    projectorSource:
      'export * from "./runtime-service";\nexport type { ProjectionDirectoryService } from "./type-only-service";\nexport default {};\n',
    supportingSources: [
      ["runtime-service.ts", "export class UnrelatedRuntimeService {}\n"],
      ["type-only-service.ts", "export class ProjectionDirectoryService {}\n"],
    ],
  });

  await assert.rejects(
    validateWorkerBindings(root),
    /api local service binding PROJECTION_DIRECTORY targets missing export ProjectionDirectoryService on punks-projector/,
  );
});

test("validates every local and staging Worker service binding", async () => {
  await assert.doesNotReject(async () => {
    const result = await validateWorkerBindings(repositoryRoot);
    assert.deepEqual(result, { workerCount: 8, bindingCount: 41 });
  });
});

test("rejects a managed Queue producer without its Worker consumer", async () => {
  const root = await mkdtemp(join(tmpdir(), "punks-worker-bindings-"));
  await writeWorker(
    root,
    "api",
    {
      name: "punks-api",
      main: "src/index.ts",
      queues: {
        producers: [
          { binding: "PROJECTION_QUEUE", queue: "punks-projection-local" },
        ],
      },
      env: {
        staging: {
          name: "punks-api-staging",
          queues: {
            producers: [
              {
                binding: "PROJECTION_QUEUE",
                queue: "punks-projection-staging",
              },
            ],
          },
        },
      },
    },
    "export default {};\n",
  );
  await writeWorker(
    root,
    "projector",
    {
      name: "punks-projector",
      main: "src/index.ts",
      queues: { consumers: [{ queue: "wrong-projection-local" }] },
      env: {
        staging: {
          name: "punks-projector-staging",
          queues: { consumers: [{ queue: "wrong-projection-staging" }] },
        },
      },
    },
    "export default {};\n",
  );

  await assert.rejects(
    validateWorkerBindings(root),
    /api local Queue binding PROJECTION_QUEUE has no consumer for punks-projection-local/,
  );
});

test("rejects a Workflow binding whose Worker class is not exported", async () => {
  const root = await mkdtemp(join(tmpdir(), "punks-worker-bindings-"));
  await writeWorker(
    root,
    "bot-runtime",
    {
      name: "punks-bot-runtime",
      main: "src/index.ts",
      workflows: [
        {
          binding: "BOT_WAKE_WORKFLOW",
          name: "punks-bot-wake-local",
          class_name: "MissingBotWakeWorkflow",
        },
      ],
      env: {
        staging: {
          name: "punks-bot-runtime-staging",
          ai: { binding: "AI" },
          workflows: [
            {
              binding: "BOT_WAKE_WORKFLOW",
              name: "punks-bot-wake-staging",
              class_name: "MissingBotWakeWorkflow",
            },
          ],
        },
      },
    },
    "export class BotWakeWorkflow {}\nexport default {};\n",
  );

  await assert.rejects(
    validateWorkerBindings(root),
    /bot-runtime local Workflow binding BOT_WAKE_WORKFLOW targets missing export MissingBotWakeWorkflow/,
  );
});

test("rejects a staging service graph that omits a local binding", async () => {
  const root = await mkdtemp(join(tmpdir(), "punks-worker-bindings-"));
  await writeWorker(
    root,
    "projector",
    {
      name: "punks-projector",
      main: "src/index.ts",
      env: { staging: { name: "punks-projector-staging" } },
    },
    "export class ProjectionDirectoryService {}\nexport default {};\n",
  );
  await writeWorker(
    root,
    "api",
    {
      name: "punks-api",
      main: "src/index.ts",
      services: [
        {
          binding: "PROJECTION_DIRECTORY",
          service: "punks-projector",
          entrypoint: "ProjectionDirectoryService",
        },
      ],
      env: {
        staging: {
          name: "punks-api-staging",
          services: [],
        },
      },
    },
    "export default {};\n",
  );

  await assert.rejects(
    validateWorkerBindings(root),
    /api staging Service bindings differ from local \(missing: PROJECTION_DIRECTORY; unexpected: none\)/,
  );
});

test("rejects a deployable Worker whose complete staging environment is absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "punks-worker-bindings-"));
  await writeWorker(
    root,
    "api",
    {
      name: "punks-api",
      main: "src/index.ts",
      vars: { ENVIRONMENT: "local" },
    },
    "export default {};\n",
  );

  await assert.rejects(
    validateWorkerBindings(root),
    /api has no staging environment/,
  );
});

test("rejects a Worker whose required named local environment is absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "punks-worker-bindings-"));
  await writeWorker(
    root,
    "erasure",
    {
      name: "punks-erasure",
      main: "src/index.ts",
      r2_buckets: [
        {
          binding: "ERASURE_TOMBSTONES",
          bucket_name: "punks-erasure-local",
        },
      ],
      env: {
        staging: {
          name: "punks-erasure-staging",
          r2_buckets: [
            {
              binding: "ERASURE_TOMBSTONES",
              bucket_name: "punks-erasure-staging",
            },
          ],
        },
      },
    },
    "export default {};\n",
  );

  await assert.rejects(
    validateWorkerBindings(root),
    /erasure has no named local environment/,
  );
});

test("rejects staging when non-Service binding families disappear", async () => {
  const root = await mkdtemp(join(tmpdir(), "punks-worker-bindings-"));
  await writeWorker(
    root,
    "api",
    {
      name: "punks-api",
      main: "src/index.ts",
      vars: { ENVIRONMENT: "local", CURSOR_TTL: "60" },
      secrets: { required: ["CURSOR_KEY"] },
      r2_buckets: [
        { binding: "CONTENT_BUCKET", bucket_name: "punks-content-local" },
      ],
      d1_databases: [
        {
          binding: "PROJECTION_DB",
          database_name: "punks-projection-local",
          database_id: "00000000-0000-0000-0000-000000000000",
        },
      ],
      durable_objects: {
        bindings: [{ name: "WORKSPACES", class_name: "WorkspaceDO" }],
      },
      env: {
        staging: {
          name: "punks-api-staging",
          vars: { ENVIRONMENT: "staging" },
          secrets: { required: [] },
          r2_buckets: [],
          d1_databases: [],
          durable_objects: { bindings: [] },
        },
      },
    },
    "export class WorkspaceDO {}\nexport default {};\n",
  );

  await assert.rejects(
    validateWorkerBindings(root),
    /api staging variable bindings differ from local \(missing: CURSOR_TTL;/,
  );
});

test("rejects a named local environment that drops a root binding", async () => {
  const root = await mkdtemp(join(tmpdir(), "punks-worker-bindings-"));
  await writeWorker(
    root,
    "erasure",
    {
      name: "punks-erasure",
      main: "src/index.ts",
      r2_buckets: [
        {
          binding: "ERASURE_TOMBSTONES",
          bucket_name: "punks-erasure-local",
        },
      ],
      env: {
        local: { name: "punks-erasure-local", r2_buckets: [] },
        staging: {
          name: "punks-erasure-staging",
          r2_buckets: [
            {
              binding: "ERASURE_TOMBSTONES",
              bucket_name: "punks-erasure-staging",
            },
          ],
        },
      },
    },
    "export default {};\n",
  );

  await assert.rejects(
    validateWorkerBindings(root),
    /erasure named local R2 bindings differ from local \(missing: ERASURE_TOMBSTONES;/,
  );
});

test("rejects staging when the Queue and Workflow graph is removed together", async () => {
  const root = await mkdtemp(join(tmpdir(), "punks-worker-bindings-"));
  await writeWorker(
    root,
    "api",
    {
      name: "punks-api",
      main: "src/index.ts",
      queues: {
        producers: [
          { binding: "BOT_WAKE_QUEUE", queue: "punks-bot-wake-local" },
        ],
      },
      env: {
        staging: {
          name: "punks-api-staging",
          queues: { producers: [] },
        },
      },
    },
    "export default {};\n",
  );
  await writeWorker(
    root,
    "bot-runtime",
    {
      name: "punks-bot-runtime",
      main: "src/index.ts",
      workflows: [
        {
          binding: "BOT_WAKE_WORKFLOW",
          name: "punks-bot-wake-local",
          class_name: "BotWakeWorkflow",
        },
      ],
      queues: {
        consumers: [
          {
            queue: "punks-bot-wake-local",
            dead_letter_queue: "punks-bot-wake-local-dlq",
          },
        ],
      },
      env: {
        staging: {
          name: "punks-bot-runtime-staging",
          ai: { binding: "AI" },
          workflows: [],
          queues: { consumers: [] },
        },
      },
    },
    "export class BotWakeWorkflow {}\nexport default {};\n",
  );

  await assert.rejects(
    validateWorkerBindings(root),
    /api staging Queue producer bindings differ from local \(missing: BOT_WAKE_QUEUE;/,
  );
});

test("rejects a Queue consumer that loses its dead-letter Queue", async () => {
  const root = await mkdtemp(join(tmpdir(), "punks-worker-bindings-"));
  await writeWorker(
    root,
    "api",
    {
      name: "punks-api",
      main: "src/index.ts",
      queues: {
        producers: [
          { binding: "BOT_WAKE_QUEUE", queue: "punks-bot-wake-local" },
        ],
      },
      env: {
        staging: {
          name: "punks-api-staging",
          queues: {
            producers: [
              {
                binding: "BOT_WAKE_QUEUE",
                queue: "punks-bot-wake-staging",
              },
            ],
          },
        },
      },
    },
    "export default {};\n",
  );
  await writeWorker(
    root,
    "bot-runtime",
    {
      name: "punks-bot-runtime",
      main: "src/index.ts",
      queues: {
        consumers: [
          {
            queue: "punks-bot-wake-local",
            dead_letter_queue: "punks-bot-wake-local-dlq",
          },
        ],
      },
      env: {
        staging: {
          name: "punks-bot-runtime-staging",
          ai: { binding: "AI" },
          queues: { consumers: [{ queue: "punks-bot-wake-staging" }] },
        },
      },
    },
    "export default {};\n",
  );

  await assert.rejects(
    validateWorkerBindings(root),
    /bot-runtime staging Queue consumer binding punks-bot-wake-<environment> changes configuration/,
  );
});

test("rejects multiple producers for the same managed Queue", async () => {
  const root = await mkdtemp(join(tmpdir(), "punks-worker-bindings-"));
  const producerConfig = (name) => ({
    name: `punks-${name}`,
    main: "src/index.ts",
    queues: {
      producers: [{ binding: "BOT_WAKE_QUEUE", queue: "punks-bot-wake-local" }],
    },
    env: {
      staging: {
        name: `punks-${name}-staging`,
        queues: {
          producers: [
            {
              binding: "BOT_WAKE_QUEUE",
              queue: "punks-bot-wake-staging",
            },
          ],
        },
      },
    },
  });
  await writeWorker(root, "api", producerConfig("api"), "export default {};\n");
  await writeWorker(
    root,
    "rogue",
    producerConfig("rogue"),
    "export default {};\n",
  );
  await writeWorker(
    root,
    "bot-runtime",
    {
      name: "punks-bot-runtime",
      main: "src/index.ts",
      queues: {
        consumers: [
          {
            queue: "punks-bot-wake-local",
            dead_letter_queue: "punks-bot-wake-local-dlq",
          },
        ],
      },
      env: {
        staging: {
          name: "punks-bot-runtime-staging",
          ai: { binding: "AI" },
          queues: {
            consumers: [
              {
                queue: "punks-bot-wake-staging",
                dead_letter_queue: "punks-bot-wake-staging-dlq",
              },
            ],
          },
        },
      },
    },
    "export default {};\n",
  );

  await assert.rejects(
    validateWorkerBindings(root),
    /local Queue punks-bot-wake-local has multiple producers: api\.BOT_WAKE_QUEUE, rogue\.BOT_WAKE_QUEUE/,
  );
});

test("rejects staging service props that widen a private caller role", async () => {
  const root = await mkdtemp(join(tmpdir(), "punks-worker-bindings-"));
  await writeWorker(
    root,
    "auth",
    {
      name: "punks-auth",
      main: "src/index.ts",
      env: { staging: { name: "punks-auth-staging" } },
    },
    "export class BotInvocationIssuer {}\nexport default {};\n",
  );
  await writeWorker(
    root,
    "bot-runtime",
    {
      name: "punks-bot-runtime",
      main: "src/index.ts",
      services: [
        {
          binding: "BOT_INVOCATION_ISSUER",
          service: "punks-auth",
          entrypoint: "BotInvocationIssuer",
          props: { role: "punks-bot-runtime", environment: "local" },
        },
      ],
      env: {
        staging: {
          name: "punks-bot-runtime-staging",
          ai: { binding: "AI" },
          services: [
            {
              binding: "BOT_INVOCATION_ISSUER",
              service: "punks-auth-staging",
              entrypoint: "BotInvocationIssuer",
              props: { role: "punks-owner", environment: "staging" },
            },
          ],
        },
      },
    },
    "export default {};\n",
  );

  await assert.rejects(
    validateWorkerBindings(root),
    /bot-runtime staging Service binding BOT_INVOCATION_ISSUER changes configuration/,
  );
});

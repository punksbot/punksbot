# Punks Bot

Punks Bot is a Cloudflare-native, multi-Workspace collaboration platform where
people are **Punks** and agents are **Bots**. It is being built from the complete
local history of `punksbot/punksbot`, frozen at
`da818eddc2f470c006a1073c8c5452f8a989f272`, while replacing every server-side
runtime dependency with managed Cloudflare services.

The target product is a Grok Bot-like global Bot that can be installed in
Workspaces, backed by the collaboration surface inherited from Punks and a new
Punks UI. The current repository is an implementation in progress, not a claim
of complete Punks parity or a production deployment.

## Non-negotiable runtime boundary

The Punks backend is restricted to managed Cloudflare primitives such as
Workers, Durable Objects, D1, R2, Queues and Workflows. It does not run
Cloudflare Containers, Docker, PostgreSQL, Redis, MinIO or the imported Punks
relay in production, development or CI.

The complete upstream code remains in the repository for functional migration
and differential tests. Its workflow definitions are frozen under
`.github/legacy-workflows`, outside GitHub's active workflow directory. The
original upstream README is preserved at
[`docs/upstream/PUNKS_README.md`](docs/upstream/PUNKS_README.md).

## Implemented foundation

- canonical language-independent JSON Schema contract registry;
- authoritative Workspace and Conversation Durable Objects with signed internal
  Nostr journals and sealed R2 archive segments;
- isolated D1 projections and a Conversation-scoped public Message search
  that revalidates authorization and current encrypted content;
- Google and GitHub authentication, opaque sessions and
  explicit identity linking;
- Conversation membership, metadata, archive/restore, TTL and immutable direct
  Message participant-set identity;
- encrypted Message post/edit/retract/restore/final erasure, authorized
  high-water history and hibernable realtime FOLLOW;
- authoritative Punk and Installation Message Reactions, actor-aware signed
  authority cursors, D1 presence/count/visibility projections and bounded
  FOLLOW patches;
- a Punks-operated global Bot catalogue and Workspace-local Installation
  aggregates, with split Auth issuer/verifier entrypoints, durable
  Admission/delivery/completion and sealed Bot/Installation journal archives;
- a Reaction-only Bot Harness implemented in source and tested at each
  `workerd` seam: one private known-Installation trigger, Conversation
  candidate/outbox, authoritative Installation Wake ledger with grants and
  budgets, an exact opaque Queue body, a deterministic Workflow, a zero-retry
  sensitive read/model step and reuse of the admitted Reaction action path;
- autonomous content-finalization saga and external create-only erasure registry
  that prevents Durable Object PITR from restoring readable keys.

The current Harness accepts only a private trigger carrying a known
`{installationId, conversationId, messageId}`. It performs no Installation
discovery or fan-out, and that source-only named entrypoint has no configured
caller binding. Its Message plaintext exists only while the sensitive Workflow
step reads context and asks the fixed Reaction model; it is absent from Queue
and Workflow payloads, journals, D1, R2, receipts, logs and errors. Tests use a
deterministic `workerd` fake and have performed no remote model inference.
The proof is currently seam-by-seam across focused `workerd` suites; no
multi-Worker end-to-end test is claimed.

Public trigger integration, discovery, prompts beyond the fixed Reaction
release, memory, schedules, consequential and critical approval flows, unread
state, attachments, general product workflows and GitHub App repository access
remain under active migration. The Punks desktop client owns the implemented
`desktop-social-loop@1` profile. The exact ledger is
maintained in
[`cloudflare/PARITY.md`](cloudflare/PARITY.md).

## Local verification

Requires Node.js 24 and pnpm 11. From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm punks:check
```

This gate checks the managed-only boundary, generated runtime/contract types,
formatting, TypeScript, all Cloudflare `workerd` suites, the rich Punks desktop
entry and its Punks-only Rust/Tauri graph. It must not start or contact any
legacy server dependency.

To start the functional local Punks desktop application from the repository
root:

```bash
pnpm punks:dev
```

The command prepares and starts the eight-Worker Cloudflare graph, waits for its
exact health response, then launches the native `Punks Bot Local` Tauri window.
If a healthy local graph is already listening on `127.0.0.1:8787`, it is reused
and left running when the Tauri window closes. The first UI bootstrap creates an
idempotent local-only Punk session, a private `Punks Bot local` Workspace and
its empty `general` Conversation through the same authoritative APIs used by
the client. Messages appear only after a Punk publishes them through the UI.

The local runtime is autonomous after dependencies are installed: its desktop
CSP permits only the two loopback origins, OAuth browser ceremonies are
disabled, updater endpoints are empty, Workers AI selects the deterministic
local model, and Wrangler telemetry, error reporting and update prompts are
disabled. Staging and production keep their separately configured external
authorities; none of them are used by `pnpm punks:dev`.

For backend-only diagnostics, the components remain independently runnable:

```bash
pnpm cloudflare:local:prepare
pnpm cloudflare:dev
pnpm cloudflare:smoke:local
```

`cloudflare:local:prepare` idempotently creates or repairs the ignored
local-only Worker variables and applies all D1 migrations through
`0010_membership_delta_projection.sql` to the four local shards. The graph is
served behind the local development gateway at `http://127.0.0.1:8787`.
Opening that URL displays a diagnostic page, not the product UI. The product UI
is served by Vite at `http://localhost:1420` inside the Tauri window.

To run only the native shell against an already-running backend:

```bash
pnpm --dir desktop punks:dev
```

The gateway forwards ordinary requests to the API. It also exposes the strictly
local `POST /__dev/bot-wakes` test seam for a known lower-case UUIDv8
`installationId`, `conversationId` and `messageId`; it is not configured in
staging or production. Local Bot decisions are deterministic and never invoke
Workers AI.

The Punks graphical client uses the single rich `desktop/src/main.tsx` entry.
Its build graph contains only the Punks semantic client and typed native
commands; the isolated mini-client entry has been retired. The imported `web/`
and `mobile/` packages still implement the legacy Punks protocol and remain
available only as migration sources; they are not started by `pnpm punks:dev`.

Useful documentation:

- [`CONTEXT.md`](CONTEXT.md) — canonical domain language;
- [`cloudflare/ARCHITECTURE.md`](cloudflare/ARCHITECTURE.md) — implemented
  authority and data paths;
- [`docs/adr`](docs/adr) — architectural decisions;
- [`cloudflare/OPERATIONS.md`](cloudflare/OPERATIONS.md) — staging inventory and
  deployment gates.

## Deployment status

The four isolated staging D1 databases are provisioned and administratively
migrated through `0010_membership_delta_projection.sql`. The Bot Wake Queue and
its dead-letter Queue are provisioned with 14-day retention. Every Worker and
the Bot Wake Workflow remain configured but not deployed. R2 is not enabled on
the Punks Cloudflare account, so the configured erasure, journal, media and
future sharing buckets have not been provisioned. No remote AI inference has
been run.

Staging activation still requires the operator to enable R2, confirm the
Workers subscription, create the staging OAuth applications, provide the
pending secrets, provision the required R2 buckets, deploy the Workers in
dependency order and verify the private Service Bindings. The guarded setup
wizard drives that process and refuses to deploy before its human gates are
complete:

```bash
./cloudflare/scripts/setup-staging.sh
```

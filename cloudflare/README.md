# Punks Bot — Cloudflare Native

This directory is the replacement backend for the imported Buzz server. It is
deliberately isolated from the legacy Rust relay: local development and CI must
not start Docker, PostgreSQL, Redis, MinIO, or the Buzz relay.

The imported Buzz workflow definitions are frozen in
`.github/legacy-workflows`. The two active Punks workflows are the managed
Workers gate and the signed desktop-candidate pipeline; the boundary guard
validates both before package or Worker checks run.

## Deterministic backend gate

Run the complete Punks backend gate from the repository root:

```bash
pnpm cloudflare:check
```

The gate fixes one serial order beginning with the managed-only boundary, then
runs tooling tests, validates every local/staging Worker binding family and RPC
entrypoint, checks generated runtime types, and executes every package and
Worker `check` script under `cloudflare/`. It inventories the package manifests
before starting, emits a heartbeat while a long `workerd` suite is still
progressing, and applies a per-step timeout. A failure reports the numbered step
and its package, Worker, binding, or contract target before returning a non-zero
exit code.

This command runs only Node tooling and the Cloudflare implementations used by
the packages' `workerd` suites. It does not start the Buzz relay or any Docker,
PostgreSQL, Redis, MinIO, Helm, or Kubernetes service.

Every tranche proof dossier must record a complete green
`pnpm cloudflare:check` result for the exact candidate SHA. A focused package
check, a missing result, a timeout, or a result from another SHA cannot satisfy
that backend prerequisite. A flaky run with a failed, skipped, or cancelled
test remains invalid even when a later rerun is green; the dossier must retain
that failure instead of presenting the rerun as the candidate's proof.

## Layout

- `contracts`: canonical, language-neutral JSON Schemas and generated TypeScript.
- `core`: deterministic domain decisions and reducers with no Cloudflare bindings.
- `workers/auth`: global Punk identities and browser-bound Google/GitHub OAuth
  ceremonies, explicit identity linking, and opaque sessions.
- `workers/api`: modular HTTP API and authoritative Durable Objects.
- `workers/attestation`: private internal Nostr event and archive-seal
  attestation service.
- `workers/bot-runtime`: private Reaction-only Queue consumer, deterministic
  Bot Wake Workflow, bounded Workers AI adapter and existing action seam for
  Punks-operated Bots; the Worker has no route, storage or secret.
- `workers/projector`: idempotent D1 projection consumer.
- `workers/search`: private, Conversation-scoped D1 candidate lookup service.
- `workers/erasure`: private create-only anti-PITR registry for Message
  erasure tombstones and terminal Account Merge receipts.
- `workers/dev-gateway`: local-only HTTP gateway for the API and the private
  known-Installation Bot Wake test seam; it has no staging deployment target.

Implemented Workers slices cover Workspace, Conversation, encrypted Message,
Search, Reaction and hibernable FOLLOW authority, with signed internal
journals, D1 projections and sealed Workspace, Conversation, Bot and
Installation journal archives.

Global Punk authentication covers Google and GitHub identity-only OAuth,
explicit linking and opaque sessions. Passkey authentication and registration
are retired; see [ADR-0064](../docs/adr/0064-limiter-la-connexion-a-google-et-github.md).

Account Merge application is implemented as an Auth-owned fenced saga. The
private Erasure Worker records a terminal create-only envelope before any
authority changes. Its public result remains the minimal receipt, while an
exact private recovery descriptor lets Auth reconstruct a lost Plan/manifest
and the Punk/Workspace fences. Durable Objects then roll forward idempotently,
and restored absorbed Sessions fail as `account_merged`.

### Commit or recover an Account Merge

`POST /api/v1/account-merges/{intentId}` accepts only a current Session for the
surviving Compte Punks. Send an `account-merge.commit@1` body whose `intentId`
matches the path and whose `survivorPunkId` matches that Session, plus an
`Idempotency-Key` header exactly equal to the body `commandId`. The command must
repeat the immutable `planId`, Plan digest, both account revisions and the
literal `merge_accounts_irreversibly` confirmation. A typed
`account-merge.commit-response@1` is returned with HTTP 202 while work remains
and HTTP 200 at `completed`.

After an ambiguous response or a fresh sign-in, read the same bounded state
with `GET /api/v1/account-merges/{intentId}?planId={planId}`. The query must
contain exactly that one `planId`, and only the current surviving Punk can read
it. If PITR removed the intent's local Plan, first resubmit the exact original
POST so Auth can locate the cold descriptor by absorbed Punk and reconstruct
the Plan/manifest; GET can then observe the resumed cursor. Both methods
disable caching. Failures use the generated `problem@1`
contract: 400 for malformed input or idempotency, 401 without authentication,
403 when the POST Session is not the survivor, 404 when the Plan/state is not
available to the caller, 409 for revision or idempotency conflicts before the
terminal decision, and 503 for an unavailable authority. Once the receipt
exists, retries always roll forward even if the Plan has since expired.

This recovery surface does not advertise Account Merge as a generally
available desktop capability. The desktop currently handles only the terminal
`account_merged` state by discarding the absorbed Session and requiring a fresh
sign-in.

The first autonomous Bot slice is implemented and tested in source. A narrow
private trigger accepts only one known
`{installationId, conversationId, messageId}`; there is no discovery or
fan-out. `ConversationDO` owns the Wake subscription, derives a candidate from
the exact committed Message and repairs its outbox. `BotInstallationDO` owns
the accepted Wake, exact `messages.read-context` plus `messages.react` grants,
open/hot and daily budgets, opaque Queue outbox, deterministic Turn and
create-only cold terminal receipt. Queue carries exactly
`{installationId, wakeId}`. The Workflow claims the Wake, performs private
Message read and model decision in one sensitive step with zero retries, then
uses the existing admitted Reaction path and completes the Wake.

Message plaintext is transient inside that sensitive step only; it is never a
Queue or Workflow parameter or persisted output and never enters journals, D1,
R2, receipts, logs or errors. The immutable first release allows only a strict
`skip | react` decision. Its Workers AI adapter is enabled only for staging and
production; local development and `workerd` tests select deterministic models
and perform no remote inference.
Focused `workerd` suites prove the Conversation, Installation, private service,
Queue consumer, Workflow, model and action seams independently. They are not a
claim of one multi-Worker end-to-end pool test.

The API producer, Runtime consumer, Workflow and Runtime-to-API/Auth private
Service Bindings are configured for local and staging. The source-only trigger
named entrypoint has no staging caller binding. R2 is enabled and the configured
staging buckets are provisioned. The historical Bot Runtime, Queue consumer and
Workflow observation is recorded canonically in [OPERATIONS.md](OPERATIONS.md);
it is not proof of the current candidate and no remote inference is claimed. No
public trigger, Punks client integration, Installation discovery, general
prompt surface, memory or schedules are claimed. This is not a claim of Buzz
feature parity; subsequent slices preserve the same authority and projection
boundaries.

## Run the local backend

From the repository root, prepare the ignored local Worker variables and the
four D1 shards, then start the complete eight-configuration graph:

```bash
pnpm cloudflare:local:prepare
pnpm cloudflare:dev
```

The local development gateway listens on `http://127.0.0.1:8787`, serves a
local-only diagnostic/status page at `/`, and forwards other ordinary HTTP
requests to the API. The page includes the known-Installation Wake form but is
not the Punks product UI. In another terminal:

```bash
pnpm cloudflare:smoke:local
```

For a known local fixture, the local-only Wake seam accepts:

```http
POST /__dev/bot-wakes
Content-Type: application/json

{
  "installationId": "<lower-case-uuidv8>",
  "conversationId": "<lower-case-uuidv8>",
  "messageId": "<lower-case-uuidv8>"
}
```

The endpoint is deliberately absent from staging and production. The imported
Buzz `web/`, `desktop/` and `mobile/` clients have not yet been migrated to the
Punks API, so this command launches the backend test surface rather than a
Punks graphical client.

## Prepare staging

Run the guarded operator wizard:

```bash
./cloudflare/scripts/setup-staging.sh
```

It records the human R2/subscription and OAuth prerequisites, generates local
machine secrets without committing them, runs the full gates and dry-runs,
uploads the minimum per-Worker secret sets, and requests explicit confirmation
before the ordered deployment. It does not trigger a remote Workers AI
inference.

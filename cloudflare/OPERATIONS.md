# Cloudflare staging operations

The Cloudflare account is pinned in every Wrangler configuration. Resource IDs
and non-secret names are recorded in `staging.resources.json`. That file is a
versioned operational snapshot, not the authenticated remote proof for a
future candidate; the candidate workflow reobserves Cloudflare independently.
Secrets never belong in Git or `.dev.vars` committed to the repository.

The four D1 shards are provisioned and verified through
`0010_membership_delta_projection.sql`. R2 and Workers Paid are active on the
Punks account, and the erasure, journal, media and future sharing buckets are
provisioned. The versioned material records a historical deployment snapshot.
A read-only observation on 2026-08-26 found all seven canonical Workers at
100 percent on historical SHA
`ee88eaed2ad68e23e9e586253f902794d86982ef`; the compatibility endpoint still
returned `compatible:false` with no capabilities. The current source candidate
is therefore not deployed or activated. The isolated staging manifest sets
`DESKTOP_SOCIAL_LOOP_ENABLED=true` only so a future installed, signed candidate
bound to its exact deployment can execute the promotion stories. Local
manifests remain fail-closed. The updater stays inactive until the complete
dossier, attestation and tranche receipt exist.

<!-- punks-staging-observation {"kind":"bot-runtime-history","observedAt":"2026-08-26","sourceSha":"ee88eaed2ad68e23e9e586253f902794d86982ef"} -->

A read-only observation on 2026-08-26 found the Bot Wake Queue with one producer
and one consumer, and found `punks-bot-runtime-staging` plus the
`punks-bot-wake-staging` Workflow deployed at historical source SHA
`ee88eaed2ad68e23e9e586253f902794d86982ef`. This corrects the older snapshot;
it does not prove the current candidate and no Workers AI inference is claimed.
The current Bot Runtime manifest still has no runtime kill switch. Wake traffic
must remain disabled, and no trigger, inference or redeployment may proceed
until Queue/Workflow resumability is verified and separate approval authorizes
the exact disposable inference.

The preferred staging path is the guarded operator wizard:

```sh
./cloudflare/scripts/setup-staging.sh
```

It pauses for the R2/subscription and OAuth steps that require an operator,
generates the ignored mode-`0600` staging material, runs the complete gates and
dry-runs, uploads only each Worker's required secrets, and asks for explicit
confirmation before the ordered deployment. The wizard does not enqueue a Bot
Wake itself, but the current all-Worker deploy attaches the Runtime consumer and
Workers AI binding. Until a runtime kill switch exists, operators must stop
before Bot Runtime unless the Wake Queue is proven empty, no Workflow instance
can resume and the separate remote-inference approval has been granted.

## Validation before deployment

```sh
pnpm cloudflare:types
pnpm cloudflare:check
SOURCE_SHA="$(git rev-parse --verify HEAD)"
pnpm cloudflare:staging:dry-run --source-sha "$SOURCE_SHA"
```

These commands validate source and generated deployment bundles only. A
successful dry-run neither provisions R2 nor deploys the Workflow or a Worker,
and it performs no remote inference. Both dry-run and deploy reject a dirty
checkout or a SHA different from `HEAD`; every uploaded Worker version receives
the exact `punks-source-sha:<40-character SHA>` message later required by the
remote deployment-proof gate.

The protected GitHub environment `punks-staging-promotion` must also contain a
read-only `PUNKS_CLOUDFLARE_API_TOKEN`. The signed desktop candidate workflow
uses that token in one isolated step to reobserve all seven Worker versions and
deployments, recompute the aggregate deployment ID, and preserve the resulting
JSON in the attested candidate. A digest supplied at dispatch is never trusted
on its own. The token should be scoped to Workers Scripts read access for only
the canonical Punks account.

The candidate workflow stages an immutable, retryable **draft** release. It
does not publish the release, mark it latest, or activate the updater. Those
actions remain blocked until the installed four-platform candidate has produced
the complete promotion dossier and the required tranche receipt.

## Required deployment order

1. R2 and the Workers Paid subscription are active on the Punks account. Run
   `pnpm cloudflare:staging:provision` before later deployments to idempotently
   verify the existing Wake Queues and the three currently bound R2 buckets.
2. Install the staging attestation private key as
   `ATTESTATION_PRIVATE_KEY`. Derive the corresponding x-only public key
   outside the repository and install the strict, environment-keyed
   `ATTESTATION_PUBLIC_KEYS_JSON` binding independently on the API and
   Projector Workers. Install `BOT_INVOCATION_CURRENT_SECRET` only on the Auth
   Worker; it must be independent, random and at least 32 bytes. Never expose
   that issuer secret to the API, Projector or Bot Runtime. Install the
   Operator bearer secret as
   `OPERATOR_PROVISIONING_TOKEN` (at least 32 characters), and install an
   independent random API secret of at least 32 bytes as
   `MESSAGE_SEARCH_MASTER_KEY` plus another independent random API secret of at
   least 32 bytes as `MESSAGE_SEARCH_CURSOR_KEY` and a third independent random
   API secret of at least 32 bytes as `MESSAGE_HISTORY_CURSOR_KEY`. Install a
   fourth independent API secret of at least 32 bytes as
   `DIRECTORY_CURSOR_KEY` for Punk-bound Workspace and Stream continuations.
   Install a fifth independent API secret of at least 32 bytes as
   `MEDIA_UPLOAD_GRANT_KEY`; it signs only short, intention-scoped upload
   grants and must not be reused for cursors, Sessions or R2 credentials.
   Never echo any of these values in a terminal log. These API secrets are
   deliberately absent from Wrangler vars and are not provisioned by this
   repository.
3. Register separate staging OAuth applications whose only callback URLs are
   `https://staging.punks.bot/api/auth/v1/oauth/google/callback` and
   `https://staging.punks.bot/api/auth/v1/oauth/github/callback`. Install
   `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
   `GITHUB_OAUTH_CLIENT_ID`, and `GITHUB_OAUTH_CLIENT_SECRET` as Auth Worker
   secrets. The GitHub OAuth application is identity-only and must not be the
   GitHub App later used for Repository capabilities.
4. Deploy `punks-auth-staging` and verify OAuth transaction expiry, state
   binding, sign-in, reauthentication, explicit linking, and logout with
   disposable staging identities. Never authorize a production GitHub account
   or request repository scopes during this smoke test. Confirm that passkey
   start requests return `400 invalid_input` and the removed passkey routes
   return `404 not_found`. The Auth migration `v6` permanently
   deletes only the `PasskeyCeremonyDO` and `PasskeyCredentialDO` namespaces;
   their historical migration entries must remain in the configuration. OAuth
   identities, active Sessions and signed account history are not deleted.
5. Deploy `punks-attestation-staging`. It has no route, preview URL, or
   `workers.dev` URL and is reachable only through a Service Binding.
6. Deploy `punks-erasure-staging` with its exclusive `ERASURE_TOMBSTONES`
   binding to the newly provisioned `punks-erasure-staging` R2 bucket. This
   Worker needs no secret, route, preview URL, or `workers.dev` URL. Before the
   API can use erasure, verify the configured `ERASURE_REGISTRY` Service Binding
   from the API Worker to this Worker; never give the API or a Durable Object a
   direct R2 binding. Historical deployments exist, but only the candidate's
   authenticated remote observation and installed exercise may prove its exact
   runtime binding.
7. Confirm every D1 migration through the filename recorded in
   `staging.resources.json` is applied on all four projection shards, then
   deploy `punks-projector-staging` so the Queue has a consumer before producers
   start. Verify `D1_SHARD_COUNT=4`, every binding `PROJECTION_DB_0..3`, and the
   Workspace, Conversation, Message, membership, Reaction and FTS tables with
   read-only queries on each database. Also verify `bot_projection`,
   `bot_search`, `bot_event_projection`, `bot_installation_projection`,
   `bot_installation_grant_projection`,
   `bot_installation_event_projection` and
   `bot_action_admission_projection`. The global Bot catalogue must be consumed
   only on shard 0; Installation, grant and Admission rows must use the fixed
   Workspace shard.
8. Deploy `punks-search-staging`. It has no route, preview URL, or
   `workers.dev` URL and exposes only the bounded `searchMessages` RPC through
   a Service Binding. Verify the API's `MESSAGE_SEARCH` binding before exposing
   the public search route; the API, not this Worker, must sign public cursors,
   reauthorize every candidate, and decrypt only authorized active Messages.
9. Verify the already provisioned isolated `punks-bot-wake-staging` Queue and
   `punks-bot-wake-staging-dlq` dead-letter Queue, their recorded identifiers
   and their 14-day retention before deploying either Wake producer or
   consumer. Keep Wake traffic disabled. The Workflow named
   `punks-bot-wake-staging` uses `BotWakeWorkflow`; both the Workflow and the
   Runtime consumer were observed historically on
   `ee88eaed2ad68e23e9e586253f902794d86982ef`. Reverify them
   against the exact candidate instead of inferring them from a dry-run.
   Confirm the Queue body contract is exactly `{installationId,wakeId}`, the
   Runtime is the sole consumer and the API is the sole producer.
10. Deploy `punks-api-staging`, then verify `/api/health` through
   `staging.punks.bot`. Before enabling Bot action traffic, confirm that its
   `JOURNAL_ARCHIVE_BUCKET` binding resolves to the recorded
   `punks-journal-staging` bucket. With a disposable Installation, complete an
   action, let the Durable Object alarm drain its receipt archive outbox, then
   verify one canonical `application/json` object under the opaque
   `bot-action-receipts/v1/` prefix and replay the exact terminal Admission and
   original `50320` proof. Exercise a temporary R2 failure too: replay,
   validation, completion and same-`actionId` admission must fail closed while
   the hot receipt remains available for retry. Alert on a non-draining receipt
   archive outbox or an Installation approaching 1024 hot receipts. The source
   uses create-only writes and exact validation, but
   `staging.resources.json` does not establish R2 bucket lock, retention or
   protection from administrative deletion; verify such controls externally
   before making any stronger durability claim.
    Keep `BotWakeTriggerService` unreachable from ordinary callers: it is a
    source-only known-Installation named entrypoint with no configured caller
    binding, not a public ingestion surface.
11. Deploy `punks-bot-runtime-staging` only after the API
    `BotActionService`/`BotHarnessService`, Auth `BotInvocationIssuer`, Wake
    Queue and dead-letter Queue are reachable through their exact private
    bindings. The Runtime has no route, preview URL, storage or secret. Verify
    that all three Runtime Service Bindings — Auth `BOT_INVOCATION_ISSUER`, API
    `BOT_ACTION_SERVICE` and API `BOT_HARNESS_SERVICE` — carry exactly
    `{role:"punks-bot-runtime",environment:"staging"}`. Verify that the API can
    reach only `BotInvocationVerifier`, that ordinary API session resolution
    reaches only `PunkSessionService`, and that deployment provisioned the
    `punks-bot-wake-staging` Workflow with `BotWakeWorkflow` plus the configured
    Queue consumer and DLQ. These resources were observed historically on
    `ee88eaed2ad68e23e9e586253f902794d86982ef`; reverify the exact candidate
    before enabling any Wake traffic.
12. Keep Wake traffic disabled until a separate approval explicitly authorizes
    one Workers AI staging inference. After that approval, verify the Harness
    without widening its trigger: with a disposable Installation and a caller
    explicitly bound as
    `{role:"punks-bot-wake-trigger",environment:"staging"}`, offer exactly one
    known `{installationId,conversationId,messageId}`. Confirm Conversation
    candidate/outbox repair, Installation Wake claim and budgets, the exact
    two-field Queue body, deterministic Workflow/Turn IDs, and a terminal
    create-only receipt under the opaque `bot-wake-receipts/v1/` prefix. The
    sensitive read/model step must have zero retries and Message plaintext must
    be absent from Queue and Workflow state, R2, D1, journals, receipts,
    metrics, errors and logs. Verify a Reaction only through the existing
    50320 → 50210/50211 → 50321 path and its exact Admission/action digest.
    Until that separate approval, the deterministic `workerd` fake is the only
    executed model coverage. The current migration has run no remote inference.
13. Run a provisioning smoke test with a disposable Workspace command and
   verify its signed event in D1. Do not use a production Punk or repository.

The API deployment must be withheld if an API or attestation secret is absent,
if the internal attestation verification registry is absent or does not match
the private attestation key, if the API is bound to the Auth issuer rather than
only the Verifier and Punk Session entrypoints, if any of the three Message
secrets is absent, or if the private `ERASURE_REGISTRY` Service Binding cannot
complete both `lookup` and create-only `record` RPCs. The Bot Runtime deployment
must be withheld if `BOT_INVOCATION_CURRENT_SECRET` is absent from Auth, if the
issuer is reachable outside the exact Runtime binding, if either
`BOT_INVOCATION_ISSUER` or `BOT_ACTION_SERVICE` has non-exact props, if
`BOT_HARNESS_SERVICE` is absent or has non-exact props, or if
`BotActionService` and completion delivery cannot be verified end to end. Bot
action traffic must also remain disabled if the API cannot perform create-only
writes and exact reads through
`JOURNAL_ARCHIVE_BUCKET`, or if a corrupt or unavailable receipt archive is
ever reported as `not_found`; object lock and a full-aggregate PITR recovery
process remain separate operator controls rather than guarantees of this code
path.
Bot Wake traffic must remain disabled while the Workflow is absent from the
remote inventory; if either provisioned Queue no longer matches its recorded
identifier or retention; if the API producer and Runtime consumer names differ;
if Queue or Workflow parameters contain anything beyond
`{installationId,wakeId}`; if the known-Installation trigger becomes publicly
reachable or performs discovery/fan-out; if either exact grant can be bypassed;
if the sensitive read/model step can retry; or if any plaintext can enter a
persisted or observable surface.
`stage`, `finalize`, `readAuthorized`, and `destroyGeneration` intentionally
fail closed when this dependency is corrupt or unavailable. Those per-Message
operations are serialized by the Durable Object across registry and R2 I/O to
close the read/destroy race; Cloudflare applies a 30-second
`blockConcurrencyWhile` timeout, so registry latency and errors must be
monitored before API rollout. The Auth deployment must be withheld if any OAuth
credential is absent. It must also be withheld unless its private
`ACCOUNT_MERGE_RECEIPTS` binding can perform exact lookup/create-only replay and
its `ACCOUNT_MERGE_WORKSPACES` binding resolves the environment-scoped API
entrypoint. Deploy first the additive Erasure RPC, then the additive API
entrypoint, then Auth with both bindings, and finally the API routes that call
the new Auth RPC; do not remove the older entrypoints during this expansion.
Exercise a disposable two-Punk merge,
force at least one alarm resume, verify the cold minimal receipt, then restore
the intent before its Plan and confirm that the exact private recovery lookup
reconstructs the Plan/manifest and completes roll-forward. The erasure registry
itself has no secret; its security
boundary is the exclusive R2 binding and private Worker reachability. Realtime,
media and sharing Workers will be added as their vertical slices become
deployable. The Auth Worker and native client now contain the recoverable
Google/GitHub desktop ceremony and its local/workerd coverage; the
installed, signed multi-platform proof against the exact staging deployment
remains the responsibility of the tranche promotion workflow. Already provisioned
isolated resources and successful dry-runs are not evidence that those
capabilities or Workers are deployed.

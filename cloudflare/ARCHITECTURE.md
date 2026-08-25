# Punks Bot Cloudflare architecture

This document describes implemented behavior. ADRs remain the authority for
decisions and `PARITY.md` remains the authority for migration status.

## Authority map

| Data | Authority | Derived or archived copies |
| --- | --- | --- |
| Workspace state, roles, cursor, recent journal | `WorkspaceDO(workspaceId)` SQLite | D1 projection; sealed R2 segments |
| Global slug claim or redirect | `WorkspaceSlugDO(slug)` SQLite | Workspace D1 projection for listing/search |
| Global Bot definition, lifecycle, cursor and recent journal | `BotDO(botId)` SQLite | Global catalogue and FTS5 on D1 shard 0; sealed R2 segments |
| Global Bot slug claim or redirect | `BotSlugDO(slug)` SQLite | Bot catalogue projection on D1 shard 0 |
| Workspace-local Bot Installation, configuration, grants, authority generation, Wake/Turn ledger and budgets, Admissions, JTI ledger and delivery outboxes | `BotInstallationDO(installationId)` SQLite | Installation, grant and Admission projections on the Workspace shard; sealed journal segments and exact create-only terminal Wake receipts in R2 |
| Private Bot invocation credential | Auth `BotInvocationIssuer` and `BotInvocationVerifier`; no invocation session DO | Short-lived `pbi1` credential only; consumed-JTI authority belongs to the Installation |
| Conversation metadata, members, cursor, recent journal, Bot Wake subscriptions and candidate outbox | `ConversationDO(conversationId)` SQLite | D1 projection/FTS5 for Conversation state only; sealed R2 journal segments; no Wake projection |
| Bot Wake delivery and Turn orchestration | No business authority: Queue transports the exact opaque pair and Workflow coordinates one deterministic Turn | Queue body and Workflow parameters contain only `{installationId, wakeId}`; the Installation remains authoritative |
| Message Reaction presence, command ledger, counts and visibility | The target `ConversationDO(conversationId)` SQLite | D1 presence, absolute count and visibility projections; never an actor roster |
| Bot Reaction effect and compact target replay binding | The target `ConversationDO(conversationId)` SQLite | Reaction projections; no action payload, credential or Installation configuration |
| Direct Conversation participant-set identity | `ConversationIdentityDO(workspaceId, participantSetHash)` SQLite | No eventually consistent security copy |
| Message content keys and version lifecycle | `MessageContentDO(messageId)` SQLite | AES-GCM ciphertext create-only in R2; no plaintext projection |
| Global Punk identity | `PunkDO(punkId)` SQLite | Deliberately no public identity projection yet |
| Provider subject and verified e-mail ownership | One opaque `IdentityClaimDO` or `EmailClaimDO` per claim | No eventually consistent security copy |
| OAuth transaction and Punk session | One `AuthTransactionDO` or `SessionDO` per opaque credential | No KV session authority |
| Passkey ceremony and credential | One short-lived `PasskeyCeremonyDO` or authoritative `PasskeyCredentialDO` per credential | Punk identity link only; no reusable private material |
| Git objects and refs | GitHub | Future authorized Punks caches only |
| Internal event signature | Private attestation Worker | Internal verification-key history, signed event and R2 seal |

D1 is never consulted to decide a command. Queue delivery is at least once and
may be out of order. A bounded aggregate may project a bounded snapshot; every
unbounded collection uses cursor-guarded deltas. Neither representation may
advance unless its cursor is greater than the stored cursor.

Projection storage uses one fixed ring of exactly four D1 bindings,
`PROJECTION_DB_0..3`. Workspace-scoped projections use
`FNV-1a-32(UTF-8(workspaceId)) modulo 4`; the global Bot catalogue is routed
exclusively to shard 0. Local and staging use the same mapping, and neither
environment can resize or remap the ring through configuration. A Workspace
never fans out across shards.

## Conversation command path

1. The API derives the Punk actor only from the opaque session and requires an
   `Idempotency-Key` equal to the command UUID.
2. The Workspace UUID plus command UUID deterministically derive the globally
   unique Conversation UUID, so reusing a command UUID in two Workspaces cannot
   alias their aggregates. For a DM,
   `ConversationIdentityDO` first claims the hash of the Workspace ID and the
   sorted, deduplicated set of two to nine Punk IDs. The set is immutable and a
   repeated set resolves to the existing active Conversation.
3. `ConversationDO` asks the authoritative `WorkspaceDO` for the actor's role
   and required permission. It records the exact Workspace cursor and role in
   the event before any local transition; D1 is never used for authorization.
4. Initial invitees and later invite targets are separately proven to be
   active Workspace members through `WorkspaceDO`.
5. The persisted-intent, attestation, synchronous commit, outbox, Queue and
   cursor-guarded D1 flow is the same as the Workspace command path, but the
   Conversation has its own total cursor order and contention domain.
6. Open Conversations expose a redacted view according to the enclosing
   Workspace visibility. Private Conversations and DMs require both current
   Workspace membership and explicit Conversation membership. A removed
   Workspace member therefore cannot retain Conversation access.
7. Metadata updates apply name, description, visibility, topic, purpose,
   topic requirement, member limit and TTL as one aggregate transition. A
   Conversation owner or manager, or a Punk carrying Workspace moderation,
   can update or archive it. Archived Conversations reject every ordinary
   mutation; restore is the sole lifecycle exception.
8. An active ephemeral Conversation carries an absolute `ttlDeadline`. Every
   durable aggregate transition renews that deadline, the DO alarm submits one
   deterministic idempotent archive command when it expires, and restore
   starts a fresh deadline. D1 stores the deadline only as a projection and
   never decides expiration.

Conversation membership is social application state only. It cannot grant,
infer, copy, or redistribute any GitHub authorization.

## Workspace command path

1. The API validates the canonical JSON Schema and authenticates the applicable
   authority: Operator bearer for initial provisioning, or an opaque Punk
   session for member mutations.
2. A create `commandId` deterministically derives one opaque Workspace UUID.
3. The target `WorkspaceSlugDO` reserves the globally unique slug.
4. `WorkspaceDO.execute()` computes a payload fingerprint, checks completed and
   pending idempotency records, and decides the transition. When the bounded hot
   journal is full, an ordinary or authority-expanding command first attempts
   one archive step; after that external I/O it rechecks both the committed
   state snapshot and the absence of another pending command before writing its
   immutable intent. A failed archive leaves the command unapplied.
5. Member removal and strict role reduction are revoke-first exceptions. They
   may persist while archive storage is unavailable, and their exact pending
   decision is recomputed from the committed state, command and unsigned event
   before it can affect a read or authorization. A reduced role takes effect
   immediately, but authorization continues to cite the last committed
   Workspace cursor until the reduction event is attested and committed.
6. The DO calls the private attestation Worker. While that I/O is pending, a
   different command receives `command_in_progress`; the same command may
   safely resume.
7. A synchronous SQLite transaction commits state, signed journal event,
   idempotency result, and projection outbox, then clears the pending intent.
8. The slug claim is activated. A lost API response is repaired by retry; slug
   and Workspace alarms also complete their local portions.
9. The DO sends the outbox message to Queue. Duplicate sends are expected.
10. The projector validates cross-field invariants and atomically inserts the
   event plus cursor-guarded D1 state and membership snapshots. An older Queue
   delivery cannot resurrect a removed member. SQLite triggers maintain FTS5.

The external archive and attestation calls are deliberately outside
`blockConcurrencyWhile`. Snapshot fences around the archive wait and the
persisted pending intent around attestation are the serialization barriers, so
an isolate crash or interleaving request cannot skip, reuse or reorder a
committed cursor. Conversation, Bot and Bot Installation management use the
same capacity-and-snapshot discipline. Conversation member removal and strict
access reduction, Bot suspension/withdrawal or action reduction, and
Installation revoke/grant disable expose only a locally recomputed,
fail-closed effective overlay while their signed event is pending.

## Journal archive path

Workspace, Conversation, Bot and Bot Installation aggregates archive bounded
contiguous prefixes of their hot signed journals. Each segment hash binds its
aggregate coordinates, cursor range, previous segment hash and ordered signed
events. The private attestation Worker signs the aggregate-specific seal; Bot
uses kind 50302 and Bot Installation uses kind 50313.

The pending seal is persisted and synchronized before external R2 I/O. R2 is
written with a create-only condition. If a crash occurred after the write,
retry reads the existing object and verifies its canonical bytes, content type,
metadata, aggregate scope, hash chain, events, preserved unsigned seal and
Schnorr signature instead of overwriting it. Only then does a synchronous
SQLite transaction append the contiguous manifest entry and remove the
archived hot rows. Alarm repair resumes pending seals, R2 writes, manifest
commits and capacity-driven archiving after isolate eviction. These four
archive paths are implemented and tested in source; no staging Worker is
deployed.

## Message content path

1. `MessageContentDO(messageId)` accepts a plaintext version only through a
   private RPC scoped to the Workspace, Conversation, Message and stable
   generation. The canonical UTF-8 envelope containing body and topic is
   limited to 64 KiB and is never logged or persisted as plaintext.
2. The DO creates an independent 256-bit root and 96-bit IV per version, then
   derives separate AES-256-GCM and HMAC-SHA-256 subkeys with HKDF.
   Its AAD binds the complete scope, version, content-key identifier and final
   R2 object key.
3. R2 receives a create-only ciphertext at an immutable, Workspace-scoped
   path. A retry verifies the existing object's digest and never overwrites it.
4. The Conversation orchestrator may commit only the keyed content commitment,
   ciphertext reference and key identifier. Before commit it fences the staged
   version against garbage collection, then atomically records a durable
   finalization ledger with the authoritative Message transition. The alarm
   retries finalization and blocks projection until success. An unclaimed orphan
   expires after fifteen minutes; a claimed preparation remains fenced until
   `finalize` or an explicit `releaseCommitClaim`. Failed release after a revoked
   authorization keeps the pending cleanup durable for alarm retry.
5. An authorized service asks the DO to decrypt a finalized version for
   display, lexical indexing, moderation or Bot context. This RPC is not an
   authorization boundary: the caller must first prove current access against
   the authoritative aggregate.
6. Retraction immediately removes readable projections. At final erasure, the
   `ConversationDO` schedules an exact retraction generation and acquires the
   same durable Message-command mutex used by writes. `MessageContentDO` first
   records a create-only tombstone through the private Erasure Worker for the
   canonical union of committed and historical orphan key identifiers, then
   atomically destroys every local root and IV and returns an integrity proof.
   `stage`, `finalize` and `readAuthorized` consult this external registry
   fail-closed, so a Durable Object PITR cannot resurrect readable content. The
   Conversation retries attestation autonomously and only then commits a
   content-free erasure marker, removes its version references and releases the
   ordered projection; remaining R2 ciphertext is unusable.
7. Garbage collection moves each expired, unclaimed preparation to an additive
   key-identifier history before releasing its logical version slot. This keeps
   old operation replay terminal and makes a later edit of the same logical
   version possible without losing PITR coverage. A Message generation accepts
   at most 1,000 total historical key identifiers, including abandoned edits;
   the vault refuses the next stage before key creation or R2 I/O.

Message edit, retract and restore use the same authoritative Conversation
cursor and idempotence ledger as post. Edit is the only one that creates a new
encrypted version and therefore uses the fenced finalization saga. Retraction
immediately publishes a bounded tombstone and recomputes thread counters from
active descendants. Restore is allowed only strictly before the seven-day
deadline, re-derives opaque search tokens from an authorized vault read, then
rechecks access, status and deadline immediately before its synchronous commit.
The public API always renders the current authoritative Message after the
write; replay never returns plaintext from a historical command result.

Authorized Message history is served by the authoritative `ConversationDO`,
ordered by immutable `createdCursor`. Its HMAC cursor binds Workspace,
Conversation, optional thread filter, creation high-water, position and
direction. Each page revalidates access after decryption, rechecks the current
Message status/version before returning plaintext, clears attachment IDs from
tombstones, and remains below one MiB serialized UTF-8.

Message search projects only deterministic HMAC-SHA-256 lexical tokens scoped
to one Workspace **and one Conversation** under the indivisible
`hmac-sha256-conversation-v2` algorithm. Query terms go through the same
normalization. The public surface is a 4 KiB-bounded `POST` body on one already
authorized Conversation, so neither plaintext query nor continuation cursor is
placed in the URL. The body is the exact `message.search@1` contract: scope,
query, explicit nullable cursor and limit are all required, with no transport
defaults outside the registry. Its AEAD cursor binds the Punk, Workspace,
Conversation, normalized query, algorithm and public limit. The API calls the private Search
Worker only after current authorization and sends it opaque tokens rather than
the Punk, query, cookie or public cursor. D1 FTS5 never stores plaintext or
precomputed snippets and remains only a candidate source. `ConversationDO`
decrypts each current version through `MessageContentDO`, rechecks lexical
matching and authorization, and synchronously stabilizes active `MessageView`
items before returning a page below one MiB. Retraction removes the active
tokens, restoration before erasure may recreate them, and erasure prevents
their regeneration. Search, vault or candidate-integrity failures fail the
whole page without advancing a public cursor.

## Bot catalogue, Installation, Wake and action path

1. The Punks Operator publishes or updates a global Bot through internal
   management routes. `BotDO` owns its stable identity and definition;
   `BotSlugDO` owns the globally unique mutable slug and redirects. The D1
   catalogue is reconstructible and lives only on shard 0.
2. A Workspace owner carrying `bots.install` installs the published Bot. The
   Installation ID is deterministically derived from `{workspaceId, botId}`.
   `BotInstallationDO` owns the strict release-defined configuration,
   normalized grants, status, revision, cursor and `authorityGeneration`. Only
   the immutable Punks-owned `punks.reaction-turn.v1` release is executable by
   this Harness.
3. A Wake subscription is grant-last and revoke-first. `ConversationDO`
   prepares an exact Installation subscription at a captured visible
   high-water, then `BotInstallationDO` commits both
   `messages.read-context` and `messages.react` before an outbox activates the
   epoch. Reduction or Installation revocation removes authority first and a
   repairable outbox disables every affected Conversation epoch. A late
   activation cannot revive an older generation.
4. The source-only private `BotWakeTriggerService` requires exact
   `{role:"punks-bot-wake-trigger", environment}` props and accepts only a
   caller-supplied `{installationId, conversationId, messageId}`. It routes to
   that one `ConversationDO`; it performs no Installation discovery, index
   query or fan-out. No runtime or production caller binding is configured.
5. `ConversationDO` accepts only the exact current, active and unmodified
   committed Message beyond the subscription high-water. It reconstructs and
   verifies the signed source, deterministically derives one candidate and
   commits it with a bounded repairable outbox. The candidate contains
   coordinates and digests but no Message plaintext.
6. `BotInstallationDO` revalidates the candidate, active pinned release,
   subscription epoch and both exact grants. It atomically admits the Wake and
   its Queue outbox, bounds hot/open Wakes and daily claims, and derives stable
   Wake, Workflow and Turn identifiers. An offered Wake whose authority is
   revoked before Queue delivery is terminalized instead of starting a Turn.
7. Queue delivery is at least once and contains exactly
   `{installationId, wakeId}`. The Runtime validates poison messages, derives
   the deterministic Workflow ID, batches idempotent Workflow creation and
   neither widens nor enriches the Workflow parameters. The Installation keeps
   its opaque Queue outbox row as a 60-second watchdog lease until the Wake is
   terminal and periodically redelivers it. An offered Wake revoked before
   delivery is terminalized locally; a claimed Wake is redelivered so its
   Workflow can record the revoked terminal. A redelivery inspects the
   deterministic Workflow instance and restarts it only when its status is
   `errored`; an inspection or restart that cannot be proven retries the Queue
   delivery.
   Local and staging Wrangler configure the producer, consumer, dead-letter
   Queue and Workflow; those three remote resources are not provisioned and no
   Worker is deployed.
8. The Workflow claims the Wake through the private `BotHarnessService` and
   receives authoritative coordinates only from the Installation. One
   sensitive `read-context-and-decide` step reauthorizes the Installation,
   reads the exact Message through `ConversationDO` with purpose `bot-context`,
   rechecks both authorities after decryption, and invokes the fixed model. The
   sensitive step has zero retries; its plaintext and output are not persisted.
9. The Workers AI adapter fixes provider, model, prompt digest, strict
   `skip | react` JSON Schema, Reaction allowlist, temperature, token budget
   and deadline in the immutable release. `workerd` tests select a deterministic
   fake, retain no content and have performed no remote inference.
10. A validated `skip` completes the Wake without an action. A validated
   `react` derives one stable `actionId` and calls the existing private
   `BotRuntimeService.invokeReaction`; no second action mechanism exists.
11. `BotRuntimeService` has no public route, storage or secret. For every
   Reaction attempt it derives a fresh `invocationId`, asks Auth's mint-only
   `BotInvocationIssuer` for a credential, then calls the API's private
   `BotActionService`.
12. `BotActionService` accepts only exact Service Binding props containing
   `role: "punks-bot-runtime"` and the configured environment. It verifies the
   credential through Auth's verify-only `BotInvocationVerifier`. The
   credential is bound to the environment, invocation, Workspace,
   Installation, Bot and authority generation and expires within sixty
   seconds.
13. `BotInstallationDO` consumes the credential JTI, derives capability, risk
   and resource from the exact action contract, checks the active Installation
   and Conversation-scoped `messages.react` grant, then atomically commits the
   Admission, signed kind-50320 event, action receipt, projection outbox and
   bounded private delivery outbox. A JTI cannot be rebound to another action
   and is garbage-collected only after expiry without deleting a pending
   Admission's fence.
14. The target `ConversationDO` verifies the 50320 Schnorr proof, reconstructs
   the Admission command and action digest, verifies every derived identifier
   locally and commits the Reaction without another distant authority lookup.
   An Admission committed before revocation can finish; revocation prevents new
   Admissions.
15. The Reaction effect and a compact target replay binding are committed
   synchronously. Completion is retried back to `BotInstallationDO`, which
   records kind 50321 and deletes the transient delivery payload. The
   Conversation completion backlog is capped and poison rows use independent
   backoff. The Workflow then completes the exact Turn with the resulting
   Admission/action digest. Terminal Wake receipts move create-only to an
   opaque R2 path and are read cold-first; an exact cold receipt defeats stale
   live state restored by PITR, while corrupt or unavailable cold state fails
   closed.

Message plaintext exists only in memory inside the sensitive Workflow step. It
is absent from Queue and Workflow persisted parameters or outputs, internal
journals, D1, R2, terminal receipts, errors, metrics and logs. This vertical
slice supports only a fixed-model `skip` or one Message Reaction toggle. It
does not implement public triggering, Installation discovery, Conversation
history, authors, topics, attachments, memory, schedules, ACP/MCP, arbitrary
Bot code, GitHub tools or the Punks UI. It is implemented and tested in source;
the Workers and Bot Wake resources are not deployed or provisioned remotely.

## Message Reaction path

1. The public Message Reaction route accepts canonical add, remove and toggle
   commands from an authenticated Punk. It derives that Punk from the opaque
   session and requires the `Idempotency-Key` to equal the command UUID. A Bot
   remains denied on this public route. The implemented internal path accepts
   only the canonical private delivery contract backed by an exact signed
   Admission for an Installation carrying the Conversation-scoped
   `messages.react` grant.
2. `ConversationDO` owns one stable Reaction identity for each Workspace,
   Conversation, Message, actor and canonical reaction value. It checks the
   active target Message and current Workspace/Conversation access, then uses a
   durable command-result ledger and pending intent to make add, remove and
   toggle retries idempotent. A semantic no-op records its result without
   consuming a Conversation cursor or emitting an event.
3. An applied transition is attested as kind `50210` (add) or `50211` (remove),
   including either side of toggle. Authority tags are actor-aware: a Punk
   effect carries the authoritative `workspace_cursor`; a Bot effect carries
   `installation_cursor`, `admission` and the exact action ID/digest. Both
   branches bind the Conversation cursor. The synchronous commit binds the
   signed event, Reaction row, absolute local count, journal, outbox and command
   result. Neither plaintext Message content, cryptographic material nor an
   actor roster enters the event.
4. The Queue projector verifies the exact signed Workspace, Conversation,
   Message, actor-specific authority branch, cursor, Reaction entity, contract,
   event kind and projection delta before updating D1. It never treats an
   Installation cursor as a Workspace cursor. It preserves one presence row per
   coordinate, rejects identity collisions or stale deliveries, and derives a
   bounded absolute count without materializing a roster.
5. Message retraction changes the collection overlay to
   `temporarily-hidden`; restoration makes still-active presences visible
   again. Final Message erasure sets `permanently-hidden`, which no later or
   out-of-order delivery may reverse. These overlays are derived directly from
   the Message projection and do not require a new Reaction event.

The implemented Reaction extension to realtime FOLLOW carries at most 100
absolute count patches with only the current Punk's `reactedByPunk` boolean,
plus at most 100 collection visibility/refresh patches. It exposes no actor
identity, roster, signed event, plaintext or cryptographic material. It is
implemented and tested in Workers source but has not been deployed.

## Conversation realtime follow path

The public FOLLOW surface upgrades one authenticated connection per active
Conversation to a hibernable WebSocket. `ConversationDO` captures a visible
high-water `H`, sends `accepted(H)`, replays only authorized `MessageView` and
bounded thread patches through `H`, then sends `ready(H)` before switching to
live delivery. A content-finalization fence prevents the high-water from
crossing a Message whose encrypted content is not yet readable. Every content
read is followed by current session, Workspace and Conversation authorization
and a synchronous final Message/version check before a frame is emitted.

Message, thread, Reaction count and Reaction collection delivery are
implemented and follow the same cursor and ACK discipline.

The attachment contains only bounded scope, cursor, phase and deadline state.
One outstanding batch requires a monotone ACK within thirty seconds. Slow
consumers close resumably with `1013`; an archived Conversation sends a terminal
frame and evicts the socket. A durable pump watchdog is recorded before any
external RPC. If an isolate restarts in `pumping-*`, its constructor advances
the watchdog and the alarm normalizes and resumes the exact catch-up or live
phase without relying on an in-memory socket registry.

## Punk authentication path

1. The Auth Worker accepts a canonical `auth.start@1` command from the Punks
   origin. Reauthentication and linking additionally require the current opaque
   session; linking requires a reauthentication performed in the last five
   minutes.
2. A transaction receives independent 256-bit `state`, browser-binding, and
   PKCE verifier values. Only opaque hashes or derived UUIDs are used as Durable
   Object names.
3. `AuthTransactionDO` stores the browser-binding hash and verifier, expires in
   ten minutes, and atomically consumes the callback once.
4. Google or GitHub exchanges happen only after the browser binding matches.
   GitHub is restricted to `read:user user:email`; any additional scope,
   including `repo`, fails closed. Provider access tokens are discarded after
   the verified profile is read.
5. `IdentityClaimDO` and `EmailClaimDO` serialize global ownership. A verified
   e-mail collision yields `link_required` or `merge_required`; it never links
   or merges accounts automatically.
6. `PunkDO` provisions the global Punk or links a new method only after an
   existing method was reauthenticated. Claim alarms repair a crash between
   Punk commit and claim activation.
7. `SessionDO` stores an opaque, revocable session with bounded expiry. The
   browser receives only a random `__Host-` cookie, never a provider subject,
   e-mail, Punk ID, or OAuth token.
8. Passkey registration additionally requires recent reauthentication. A
   five-minute browser-bound ceremony verifies origin, RP ID, challenge, user
   presence and user verification. `PasskeyCredentialDO` stores the public key,
   transports, backup state and monotonically verified counter, and serializes
   assertions before issuing a fresh session.

The packaged desktop uses a separate `DesktopAuthFlowDO`, never a browser
Session transfer. Rust generates a 256-bit verifier and sends only its PKCE
S256 commitment to `desktop-auth.start@1`. The system browser completes OAuth
or WebAuthn under its HttpOnly browser binding, then returns only a flow UUID
through the environment-specific protocol handler. Native `status`, `claim`,
`confirm`, and `cancel` are idempotent and require the compiled distribution
header. A claimed Session remains `prepared`: only `/api/auth/v1/session` may
read it for quarantine validation, while every collaborative authority rejects
it until native secure-storage reread and `confirm`. `SessionRevocationDO`
holds a separate revoke-only capability; `SessionRotationDO` implements the
same prepare/readback/confirm discipline for foreground renewal. Target-bound
five-minute `DesktopReauthGrantDO` grants replace a generic recent-reauth flag
for identity linking and passkey registration.

## Desktop compatibility runtime identity

`POST /api/v1/desktop/compatibility` expose les identités d'exécution
uniquement lorsque la requête est compatible et que l'API tourne en staging.
La réponse 200 porte alors deux en-têtes non mis en cache :

- `x-punks-worker-version-id` contient l'UUID de version de l'API Worker ;
- `x-punks-worker-versions` contient, sans padding, le JSON canonique encodé en
  base64url des sept objets `{name, versionId}` dans l'ordre fermé Auth,
  Attestation, Erasure, Projector, Search, API, Bot Runtime.

Les six identités non-API proviennent de named Service Bindings privées dont
la surface HTTP répond seulement 404 `no-store`. Une identité absente,
malformée ou indisponible produit une réponse 500 sans aucun de ces en-têtes.
Les réponses locales, production ou incompatibles ne sondent pas ces bindings
et n'exposent pas les identités runtime.

## Security boundaries

- Nostr envelopes, kinds and signatures are internal journal and attestation
  formats only. There is no public Nostr relay, general external-NIP
  compatibility claim or Punk-held signing key.
- The attestation Worker has no route, preview URL, or `workers.dev` URL.
- Its private key is a secret available only in that Worker.
- Application Workers receive signatures through a Service Binding and never
  receive key material.
- Operator provisioning fails closed when its secret is missing or shorter
  than 32 characters.
- JSON bodies are streamed through explicit byte ceilings before parsing.
- OAuth callbacks are browser-bound, PKCE-protected, expire after ten minutes,
  and are consumed at most once.
- Desktop completion schemes, keyring namespaces, native request headers,
  OAuth clients and WebAuthn RP IDs are distinct for local, staging and
  production. The browser never receives a desktop Session cookie or a
  revoke-only capability.
- Auth sessions and security claims are authoritative Durable Objects, never KV.
- The Bot Runtime has no route, storage or secret. Only its exact private
  Service Bindings can reach Auth's mint-only `BotInvocationIssuer` and the
  API's `BotActionService`.
- The Bot Harness and known-Installation trigger named entrypoints have no HTTP
  surface. The Runtime binding reaches only the exact claim/read/complete RPCs;
  the trigger requires a distinct exact role and is not bound to a production
  caller.
- The API reaches Auth's `BotInvocationVerifier` and `PunkSessionService`, not
  the issuer. Public Bot mutation routes remain absent. Bot credentials, JTI
  values, action payloads and Installation configuration never enter signed
  journals or D1 projections.
- The Auth Worker never stores provider access tokens. Its GitHub OAuth flow
  rejects every scope outside `read:user user:email`.
- Passkeys are discoverable and user-verified. Staging uses the narrower
  `staging.punks.bot` RP ID so its credentials cannot authenticate production.
- Workspaces default to private. The API resolves opaque sessions through a
  Service Binding to the Auth Worker: private reads require membership, `punks`
  reads require any authenticated Punk and return a redacted view, and public
  reads remain anonymous. Operator provisioning remains a separate authority.
- Conversation writes are authorized against the authoritative Workspace role
  at a recorded cursor. Metadata and lifecycle changes additionally require
  local owner/manager access or Workspace moderation. DMs are private, have
  immutable participant identity metadata and participant sets, and are
  deduplicated under a strongly consistent identity claim.
- Repository access is not yet implemented. Future code must prove each Punk's
  own GitHub authorization and must not infer access from Workspace membership,
  another Punk, a Bot, or a derived projection.
- Message plaintext and AES keys never enter the Conversation journal, Queue,
  D1, R2 metadata, logs or caches. R2 stores authenticated ciphertext only.
- Bot context plaintext additionally never enters Wake candidates, Queue or
  Workflow parameters and persisted outputs, Wake/Turn receipts, model errors
  or observability. Both Installation and Conversation authority are rechecked
  after decryption before the sensitive step may use it.

## Local and CI boundary

Tests use Cloudflare's Vitest pool and real `workerd` implementations of Durable
Objects, SQLite, R2, D1, Queue bindings, alarms, and Service Bindings. They must
not start or contact the imported Buzz relay, Docker, PostgreSQL, Redis, MinIO,
or any other legacy server dependency. Bot Harness tests use the deterministic
`workerd` model fake; tests and deployment dry-runs never call Workers AI or
perform remote inference. Focused suites exercise each authority, service,
Queue, Workflow, model and action seam; no single-pool multi-Worker end-to-end
test is claimed.

Only `.github/workflows/punks-cloudflare.yml` is active. The complete imported
Buzz workflow sources are retained under `.github/legacy-workflows` where
GitHub cannot register them. `cloudflare:check-boundary` fails CI if an active
workflow or any package script in the Punks Cloudflare workspace reintroduces a
legacy runtime dependency.

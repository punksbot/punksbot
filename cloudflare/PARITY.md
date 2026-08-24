# Buzz → Punks Bot parity ledger

Frozen source: `block/buzz@da818eddc2f470c006a1073c8c5452f8a989f272`.

## Index immuable des Reçus de release

Chaque Reçu post-promotion présent dans le graphe de release possède ici un
marqueur canonique contenant son identifiant, son SHA-256 intégral et son
verdict. `pnpm migration:check` refuse un marqueur manquant, divergent,
réécrit ou orphelin ; `scripts/receipt-publish.mjs` refuse la publication
GitHub/R2 tant que l'index complet ne correspond pas au graphe validé.

Le candidat actuel est encore en préparation : aucun Reçu post-promotion
n'existe donc à indexer. Les marqueurs create-only seront ajoutés sous ce
paragraphe par la modification qui scellera la première exécution, sous la
forme exacte imprimée par le publisher.

“Provisioned” means that an isolated Cloudflare resource exists. It does not
mean that the corresponding product capability is implemented. “Foundation”
means contracts or infrastructure exist but an end user cannot yet rely on
full production behavior.

| Capability | Current Punks status | Remaining work before parity |
| --- | --- | --- |
| Complete Buzz source and history | Implemented locally | Keep all remotes absent unless the user changes policy. |
| Cloudflare-native runtime boundary | Implemented for the new backend; active CI is Workers-only and guarded, while legacy workflow source is archived under `.github/legacy-workflows/` | Keep the boundary guard mandatory and prevent every production/dev/CI path from starting the legacy relay, Docker, PostgreSQL, Redis, or MinIO. |
| Canonical contract registry | Implemented | Add schemas and generated Rust/Dart/OpenAPI/AsyncAPI artifacts for every migrated slice. |
| Workspace identity, slug, visibility | Implemented first slice | Add Owner self-service mutation routes, membership lifecycle, deletion, and listing. |
| Strong aggregate journal | Implemented for Workspace, Conversation, Bot and Bot Installation aggregates, with aggregate-local total cursors, persisted intents, signed internal events and idempotent projection outboxes | Add reconstruction and operator-verification tooling, then apply the same aggregate discipline to each newly migrated capability. |
| Dedicated Nostr attestation | Implemented, configured and not deployed | Provision the environment-scoped verification-key history independently on the API and Projector, deploy the attestation Worker privately, and exercise rotation. The registry is internal runtime configuration, not a public Nostr API. |
| Signed/hash-chained R2 journal archive | Implemented and tested in source for Workspace, Conversation, Bot and Bot Installation journals, including persisted signed seals, create-only R2 writes, exact existing-object recovery and alarm repair; R2 is not enabled on the Punks account, no bucket is provisioned and no Worker is deployed | Enable R2, provision the configured buckets, then add administrative restore/verification tooling, retention policy and production-scale evidence. |
| D1 projection and FTS5 | Implemented for Workspaces, Conversation metadata/members, Message state/version/thread/search-token deltas, Reaction presence/count/visibility, the global Bot catalogue and FTS5 index, Workspace-sharded Bot Installations, normalized grants and compact Admission projections. The ring is fixed at exactly four shards; the global Bot catalogue is routed only to shard 0. Migration `0010_membership_delta_projection.sql` has been administratively applied and verified on all four isolated staging databases. No Worker deployment is implied. | Add projection-lag contracts, rebuild tooling and remaining entities. |
| Punk authentication | Google/GitHub and optional passkey backend connected to Workspace reads, not deployed | Add recovery, explicit two-account merge, abuse controls, key/secret rotation, client ceremonies, and positive virtual-authenticator/staging coverage. |
| Workspace memberships and four role bundles | Owner add/change/remove vertical slice implemented | Add invitations/acceptance, primary ownership transfer, voluntary leave, bulk/abuse controls, moderation boundaries, notifications, and UI. |
| Conversations, channels, threads, messages | Conversation authority/create/read/join/invite/remove plus atomic metadata, archive/restore and sliding TTL implemented; Message post/edit/retract/restore, seven-day alarm-driven final erasure, encrypted body/topic, thread counters, authorized high-water history and Search, hibernable realtime follow including bounded absolute Reaction patches, anti-PITR erasure registry and D1 Message projection are implemented and tested in Workers source | Add production scale evidence, pins, bookmarks, unread state, deployment and clients. |
| Reactions | `ConversationDO` owns authoritative presence, bounded counts, lifecycle visibility and an idempotent command ledger; the public Punk API implements add/remove/toggle while public Bot mutation remains denied. The private Bot path admits an exact Conversation-scoped `messages.react` grant in `BotInstallationDO`, binds it to a signed kind-50320 proof, durably delivers the effect as kind 50210/50211 and completes it as kind 50321. The autonomous Harness can propose one toggle only through this same action path. Punk events carry `workspace_cursor`; Bot events carry `installation_cursor`, `admission` and the exact action ID/digest. Queue projects both actor branches idempotently into D1 and FOLLOW carries bounded absolute patches. The slice is implemented in source and configured but not deployed; all four staging shards carry migrations through 0010. | Add client rendering, further Bot action contracts, deployment/runtime verification and production-scale evidence. |
| Direct messages and encrypted Buzz formats | Strong participant-set identity, 2–9 immutable members, private access slice implemented | Add hide/unhide, pagination/activity, create-new-DM-on-participant-add flow, encrypted Buzz import compatibility where functionally required, notifications, and clients. |
| Presence and activity feed | Not migrated | Presence DOs, ephemeral fan-out, feed projections, pagination, and visibility filters. |
| Media and attachments | Message body/topic ciphertext storage is implemented separately; the configured media bucket is not provisioned because R2 is not enabled | Enable R2 and provision the bucket, then add attachment upload grants, R2 multipart lifecycle, scanning, metadata, quotas, expiry, and authorized delivery. |
| Search | Conversation-scoped v2 HMAC token production, D1 FTS projection, encrypted Punk/Workspace/Conversation-bound cursor codec, private bounded candidate Worker and public POST/query/decrypt/reauthorize surface are implemented; the four staging shards carry the v2 schema | Add rebuild tooling, projection-lag observability, then ranking and media/project search without weakening Conversation isolation. |
| Git and repositories | Auth-only GitHub OAuth boundary implemented | Add a distinct GitHub App connection, many-to-many connections, per-Punk access proof, Bot PR workflow, webhooks, and derived caches. Never reuse the auth-only token or infer access from Punks state. No Punks smart-HTTP proxy. |
| Canvases and projects | Not migrated | Aggregate contracts, journal, projections, realtime collaboration, attachments, and clients. |
| Bots, ACP/MCP, prompts, memory | First autonomous Reaction-only Bot Harness implemented in source and proven seam-by-seam by focused `workerd` suites, not deployed: private known-Installation trigger with no discovery/fan-out; grant-last/revoke-first Conversation subscription; exact Message candidate and repairable outbox; authoritative Installation Wake/Turn ledger, `messages.read-context` plus `messages.react` grants, open/hot and daily budgets, Queue watchdog lease and cold-receipt outbox; exact `{installationId,wakeId}` Queue body; deterministic Workflow with repair of an existing errored instance; fixed Workers AI Reaction release; zero-retry sensitive read/model step; existing credential → Admission 50320 → Reaction 50210/50211 → completion 50321 action path; create-only cold terminal receipts; and plaintext exclusion from persisted/observable surfaces. Tests and local development use deterministic models and have performed no remote inference. The staging Wake Queue and DLQ are provisioned, while the Workflow and Workers are not deployed. No multi-Worker end-to-end pool test is claimed. This is not ACP/MCP, a general prompt surface, memory, schedules or arbitrary Bot code. | Enable R2, deploy and verify the Bot Wake Workflow and Workers, configure an authorized private trigger caller, verify all private bindings and one separately approved disposable staging inference; then add discovery, broader harness behavior, memory, schedules, consequential/critical approvals, further action contracts, ACP/MCP compatibility where required and Punks UI. |
| Workflows, approvals, reminders | Only the narrow deterministic Bot Wake Workflow is implemented in source and configured for local/staging. Its staging Queue and dead-letter Queue are provisioned, but the Workflow and Workers are not deployed. General product workflows, approvals and reminders are not migrated. | Deploy and verify the Bot Wake Workflow without treating it as business authority; add general durable Workflow definitions/runs, Punk approval events, schedules and notifications separately. |
| Huddles | Not migrated | Cloudflare Realtime SFU integration, HuddleDO, token grants, track state, recording policy, and clients. |
| Moderation and reports | Not migrated | Report/ban/resolve aggregates, audit views, rate limits, and visibility enforcement. |
| Sharing/public snapshots | Future R2 bucket name configured only; R2 is not enabled and no sharing resource is provisioned | Enable R2, then add an immutable snapshot contract, authorization downgrade checks, publication/revocation, and a public Worker. |
| Notifications and APNs | Not migrated | Queue-driven preferences, dedupe, web push/APNs gateway replacement, retries, and device lifecycle. |
| Admin web | Not migrated | Punks Operator provisioning, diagnostics, projection lag, moderation, keys, Bots, and audit log. |
| Desktop/web/mobile clients | Imported legacy Buzz clients only; they are not connected to the local or staging Punks backend | Rename/rebrand, replace the relay protocol with Punks contracts, implement `/w/<slug>`, auth, accessibility, and UX specs. |
| Differential/golden verification | Foundation | Add a golden fixture for every Buzz behavior without running the prohibited legacy server. |

Full parity is reached only when every row required by ADR-0002 is implemented,
tested in the Workers runtime, deployed in isolated staging, and verified from
the Punks clients. The current milestone is deliberately not labeled complete
parity.

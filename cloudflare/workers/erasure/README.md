# Punks erasure registry

Private Cloudflare Worker that records the irreversible Message-erasure
decision described by ADR 0049. It has no public route: `workers_dev` and
preview URLs are disabled, and `fetch()` always returns `404`. Authorized Punks
services will call it through a service binding.

## RPC contract

- `record(input)` conditionally creates one canonical tombstone. An exact replay
  returns the original tombstone with `replayed: true`; a different command,
  scope, or content-key set fails closed.
- `lookup(scope)` returns the validated tombstone or `null`. Invalid or corrupt
  state never looks like absence.

Both RPCs require `generationId === messageId`. The registry accepts only
canonical lowercase UUIDs, requires 1–1000 unique content-key IDs, and persists
this exact metadata:
`schemaVersion`, the Workspace/Conversation/Message/generation scope,
`erasureCommandId`, the sorted content-key IDs, `recordedAt`, and
`tombstoneHash`. It rejects extra fields so plaintext, plaintext hashes, raw
keys, and ciphertext references cannot enter the object.

Objects are create-only at:

```text
workspaces/{workspaceId}/conversations/{conversationId}/messages/{messageId}/erasure-tombstone.json
```

The conditional R2 write uses `etagDoesNotMatch: "*"`. There is deliberately no
delete or overwrite RPC.

## Local verification

```bash
pnpm check
pnpm dry-run:staging
```

`local` binds an emulated `punks-erasure-local` bucket while `staging` binds the
dedicated `punks-erasure-staging` bucket. A dry run only validates and bundles
the Worker; it does not provision or deploy anything. The staging bucket exists and the
API configuration declares the private service binding, but deployment and
binding verification remain separate administrative operations.

## MessageContentDO integration

The API/`MessageContentDO` runtime calls `record` before nullifying a
generation's keys. Stage, finalize and authorized-read paths call `lookup` and
fail closed when a tombstone exists or the registry cannot prove absence;
destruction stays replayable so a Durable Object restored by PITR can be
re-nullified. Neither caller receives a direct binding to the R2 bucket. This
code path is covered locally, but it is not operational in staging until both
Workers are deployed and the service binding is verified there.

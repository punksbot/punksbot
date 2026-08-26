/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface PunksProblem {
type: string
title: string
status: number
code: ("invalid_input" | "payload_too_large" | "unauthenticated" | "account_merged" | "forbidden" | "not_found" | "slug_claimed" | "idempotency_conflict" | "identity_conflict" | "revision_conflict" | "invalid_transition" | "invite_invalid" | "invite_expired" | "invite_exhausted" | "invite_revoked" | "invite_role_forbidden" | "query_too_short" | "command_in_progress" | "storage_unavailable" | "upload_hash_invalid" | "upload_conflict" | "upload_ambiguous" | "upload_expired" | "attestation_failed" | "temporarily_unavailable" | "internal")
detail?: string
correlationId: string
retry: ("never" | "same_command" | "later")
retryAfterMs?: number
}

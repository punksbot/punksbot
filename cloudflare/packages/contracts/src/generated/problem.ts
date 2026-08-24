/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface PunksProblem {
type: string
title: string
status: number
code: ("invalid_input" | "payload_too_large" | "unauthenticated" | "forbidden" | "not_found" | "slug_claimed" | "idempotency_conflict" | "identity_conflict" | "command_in_progress" | "attestation_failed" | "temporarily_unavailable" | "internal")
detail?: string
correlationId: string
retry: ("never" | "same_command" | "later")
retryAfterMs?: number
}

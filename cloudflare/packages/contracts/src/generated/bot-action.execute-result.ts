/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type ExecuteBotActionResult = ({
ok: true
admissionId: OpaqueUuid
replayed: boolean
} | {
ok: false
code: ("invalid_request" | "invalid_credential" | "idempotency_conflict" | "command_in_progress" | "not_found" | "forbidden" | "invalid_transition" | "conflict" | "admission_limit" | "attestation_failed" | "temporarily_unavailable" | "internal")
})
export type OpaqueUuid = string

/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type OpaqueUuid = string
export type Terminal = ({
outcome: "succeeded"
decision: "skip"
reason: "model_selected_skip"
} | {
outcome: "succeeded"
decision: "react"
actionId: OpaqueUuid
admissionId: OpaqueUuid
actionDigest: HexDigest
} | {
outcome: "failed"
code: ("revoked" | "not_found" | "content_unavailable" | "model_timeout" | "model_invalid" | "action_failed" | "budget_exhausted" | "internal")
})
export type HexDigest = string

export interface CompleteBotWakeCommand {
contract: "bot-wake.complete@1"
installationId: OpaqueUuid
wakeId: OpaqueUuid
turnId: OpaqueUuid
terminal: Terminal
}

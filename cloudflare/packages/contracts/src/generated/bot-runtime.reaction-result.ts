/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type InvokeBotRuntimeReactionResult = ({
contract: "bot-runtime.reaction-result@1"
ok: true
invocationId: OpaqueUuid
actionId: OpaqueUuid
admissionId: OpaqueUuid
replayed: boolean
} | {
contract: "bot-runtime.reaction-result@1"
ok: false
code: ("invalid_request" | "credential_unavailable" | "action_rejected" | "temporarily_unavailable")
})
export type OpaqueUuid = string

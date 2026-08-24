/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type DeliverBotActionResult = ({
contract: "bot-action.delivery-result@1"
ok: true
replayed: boolean
} | {
contract: "bot-action.delivery-result@1"
ok: false
code: ("invalid_request" | "not_found" | "forbidden" | "conflict" | "command_in_progress" | "attestation_failed" | "temporarily_unavailable" | "internal")
})

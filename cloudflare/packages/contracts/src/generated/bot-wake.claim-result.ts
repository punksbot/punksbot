/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type ClaimBotWakeResult = ({
contract: "bot-wake.claim-result@1"
ok: true
status: "terminal"
receipt: Receipt
replayed: true
} | {
contract: "bot-wake.claim-result@1"
ok: true
status: "claimed"
offer: Offer
turnId: OpaqueUuid
claimedAt: Timestamp
replayed: boolean
} | {
contract: "bot-wake.claim-result@1"
ok: false
code: ("invalid_request" | "not_found" | "authority_revoked" | "conflict" | "temporarily_unavailable" | "internal")
})
export type OpaqueUuid = string
export type PositiveCursor = number
export type HexDigest = string
export type Timestamp = string
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

export interface Receipt {
schemaVersion: 1
offer: Offer
turnId: OpaqueUuid
claimedAt: Timestamp
completedAt: Timestamp
terminal: Terminal
}
export interface Offer {
contract: "bot-wake.offer@1"
wakeId: OpaqueUuid
workspaceId: OpaqueUuid
installationId: OpaqueUuid
botId: OpaqueUuid
conversationId: OpaqueUuid
messageId: OpaqueUuid
messageCursor: PositiveCursor
subscriptionEpoch: PositiveCursor
runtimeRelease: RuntimeRelease
sourceEventId: HexDigest
sourceEventDigest: HexDigest
createdAt: Timestamp
}
export interface RuntimeRelease {
releaseId: string
releaseDigest: HexDigest
}

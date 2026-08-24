/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type OpaqueUuid = string
export type PositiveCursor = number
export type HexDigest = string
export type Timestamp = string

export interface BotWakeOffer {
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

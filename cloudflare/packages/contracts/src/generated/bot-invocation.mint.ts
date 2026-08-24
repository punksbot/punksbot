/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type OpaqueUuid = string

export interface MintBotInvocationCredentialCommand {
contract: "bot-invocation.mint@1"
invocationId: OpaqueUuid
workspaceId: OpaqueUuid
installationId: OpaqueUuid
botId: OpaqueUuid
authorityGeneration: number
}

/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type OpaqueUuid = string

export interface VerifyBotInvocationCredentialQuery {
contract: "bot-invocation.verify@1"
credential: string
invocationId: OpaqueUuid
workspaceId: OpaqueUuid
installationId: OpaqueUuid
botId: OpaqueUuid
authorityGeneration: number
}

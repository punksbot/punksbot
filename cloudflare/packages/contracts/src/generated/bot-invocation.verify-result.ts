/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type VerifyBotInvocationCredentialResult = ({
ok: true
principal: Claims
} | {
ok: false
code: ("invalid_request" | "invalid_credential" | "expired" | "not_yet_valid" | "configuration_invalid")
})
export type OpaqueUuid = string

export interface Claims {
schemaVersion: 1
environment: ("local" | "staging" | "production")
audience: "punks-bot-action"
kid: string
jti: OpaqueUuid
invocationId: OpaqueUuid
workspaceId: OpaqueUuid
installationId: OpaqueUuid
botId: OpaqueUuid
authorityGeneration: number
issuedAt: number
notBefore: number
expiresAt: number
}

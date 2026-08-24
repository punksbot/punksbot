/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type Installation = ({
[k: string]: unknown | undefined
} & {
id: string
workspaceId: string
botId: string
status: ("active" | "revoked")
runtimeRelease?: (RuntimeReleaseRef | null)
config: {
contractId: "punks://contracts/bot.config.empty@1"
value: {

}
}
grantCount: number
openAdmissionCount: number
authorityGeneration: number
revision: number
cursor: number
createdAt: string
updatedAt: string
revokedAt: (string | null)
})

export interface BotInstallationCommandReceiptArchive {
schemaVersion: 1
aggregate: "bot-installation"
installationId: string
commandId: string
payloadHash: string
terminal: (Committed | Rejected)
}
export interface Committed {
kind: "committed"
value: {
state: Installation
event: BoundedSignedEvent
}
}
export interface RuntimeReleaseRef {
releaseId: "punks.reaction-turn.v1"
releaseDigest: "fe075600eab020932774516439f643e8b83f62a10245e6388ee25bbf61aa837f"
}
export interface BoundedSignedEvent {
id: string
pubkey: string
created_at: number
kind: (50310 | 50311 | 50312)
/**
 * @maxItems 8
 */
tags: []|[[string]|[string, string]|[string, string, string]|[string, string, string, string]]|[[string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string]]|[[string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string]]|[[string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string]]|[[string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string]]|[[string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string]]|[[string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string]]|[[string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string]]
content: string
sig: string
}
export interface Rejected {
kind: "rejected"
code: ("not_found" | "forbidden" | "invalid_transition" | "conflict")
}

/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type BotActionAdmission = ({
[k: string]: unknown | undefined
} & {
id: string
actionId: string
actionDigest: string
workspaceId: string
installationId: string
botId: string
actionContract: ("message.reaction-add@1" | "message.reaction-remove@1" | "message.reaction-toggle@1")
capability: "messages.react"
risk: ("routine" | "consequential" | "critical")
resource: {
kind: "message"
conversationId: string
messageId: string
}
status: ("admitted" | "completed")
outcome: (("succeeded" | "failed") | null)
installationCursor: number
authorityGeneration: number
admittedCursor: number
completedCursor: (number | null)
admittedAt: string
completedAt: (string | null)
})

export interface BotInstallationProjectionEnvelope {
contract: "bot-installation.projection@1"
workspaceId: string
installationId: string
cursor: number
event: SignedNostrEvent
delta: (UpsertInstallation | SetGrant | RevokeInstallation | AdmitAction | CompleteAction)
}
export interface SignedNostrEvent {
id: string
pubkey: string
created_at: number
kind: number
tags: [string, ...(string)[]][]
content: string
sig: string
}
export interface UpsertInstallation {
operation: ("installed" | "reinstalled" | "configured")
installation: InstallationSummary
}
export interface InstallationSummary {
id: string
workspaceId: string
botId: string
status: ("active" | "revoked")
runtimeRelease?: (RuntimeReleaseRef | null)
configContractId: "punks://contracts/bot.config.empty@1"
configDigest: string
grantCount: number
openAdmissionCount: number
authorityGeneration: number
revision: number
cursor: number
createdAt: string
updatedAt: string
revokedAt: (string | null)
}
export interface RuntimeReleaseRef {
releaseId: "punks.reaction-turn.v1"
releaseDigest: "fe075600eab020932774516439f643e8b83f62a10245e6388ee25bbf61aa837f"
}
export interface SetGrant {
operation: "set-grant"
capability: ("messages.react" | "messages.read-context")
resource: {
kind: "conversation"
conversationId: string
}
enabled: boolean
authorityGeneration: number
revision: number
cursor: number
}
export interface RevokeInstallation {
operation: "revoked"
installation: InstallationSummary
}
export interface AdmitAction {
operation: "action-admitted"
admission: BotActionAdmission
}
export interface CompleteAction {
operation: "action-completed"
admission: BotActionAdmission
}

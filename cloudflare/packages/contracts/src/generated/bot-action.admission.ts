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

/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type MessageHistoryQuery = ({
contract: "message.history@1"
workspaceId: string
conversationId: string
threadRootMessageId?: string
cursor: (string | null)
limit: number
direction?: ("older" | "newer")
} & ({
cursor?: null
direction: ("older" | "newer")
[k: string]: unknown | undefined
} | {
cursor?: string
[k: string]: unknown | undefined
}))

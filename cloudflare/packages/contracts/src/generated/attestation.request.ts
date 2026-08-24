/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface AttestationRequest {
purpose: ("workspace-journal" | "workspace-journal-segment" | "conversation-journal" | "conversation-journal-segment" | "message-journal" | "bot-journal" | "bot-journal-segment" | "bot-installation-journal" | "bot-installation-journal-segment")
event: {
created_at: number
kind: number
tags: [string, ...(string)[]][]
content: string
}
}

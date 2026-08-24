/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type Bot = ({
[k: string]: unknown | undefined
} & {
id: string
slug: string
name: string
description: string
status: ("published" | "suspended" | "withdrawn")
configContractId: "punks://contracts/bot.config.empty@1"
runtimeRelease?: (RuntimeReleaseRef | null)
/**
 * @minItems 1
 * @maxItems 3
 */
supportedActionContracts: [("message.reaction-add@1" | "message.reaction-remove@1" | "message.reaction-toggle@1")]|[("message.reaction-add@1" | "message.reaction-remove@1" | "message.reaction-toggle@1"), ("message.reaction-add@1" | "message.reaction-remove@1" | "message.reaction-toggle@1")]|[("message.reaction-add@1" | "message.reaction-remove@1" | "message.reaction-toggle@1"), ("message.reaction-add@1" | "message.reaction-remove@1" | "message.reaction-toggle@1"), ("message.reaction-add@1" | "message.reaction-remove@1" | "message.reaction-toggle@1")]
revision: number
cursor: number
createdAt: string
updatedAt: string
suspendedAt: (string | null)
withdrawnAt: (string | null)
})

export interface BotCommandReceiptArchive {
schemaVersion: 1
aggregate: "bot"
botId: string
commandId: string
payloadHash: string
terminal: Committed
}
export interface Committed {
kind: "committed"
value: Value
}
export interface Value {
state: Bot
event: BoundedSignedEvent
previousSlug: (string | null)
}
export interface RuntimeReleaseRef {
releaseId: "punks.reaction-turn.v1"
releaseDigest: "fe075600eab020932774516439f643e8b83f62a10245e6388ee25bbf61aa837f"
}
export interface BoundedSignedEvent {
id: string
pubkey: string
created_at: number
kind: (50300 | 50301)
/**
 * @maxItems 8
 */
tags: []|[[string]|[string, string]|[string, string, string]|[string, string, string, string]]|[[string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string]]|[[string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string]]|[[string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string]]|[[string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string]]|[[string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string]]|[[string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string]]|[[string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string], [string]|[string, string]|[string, string, string]|[string, string, string, string]]
content: string
sig: string
}

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

export interface RuntimeReleaseRef {
releaseId: "punks.reaction-turn.v1"
releaseDigest: "fe075600eab020932774516439f643e8b83f62a10245e6388ee25bbf61aa837f"
}

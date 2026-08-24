/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type SetMetadata = (SetMetadata1 & {
operation: "set-metadata"
name?: string
description?: string
})
export type SetMetadata1 = {
[k: string]: unknown | undefined
}

export interface UpdateBotCommand {
contract: "bot.update@1"
commandId: string
botId: string
actor: Actor
payload: (SetSlug | SetMetadata | SetStatus | SetActions | SetRuntimeRelease)
}
export interface Actor {
kind: "punk"
punkId: string
}
export interface SetSlug {
operation: "set-slug"
slug: string
}
export interface SetStatus {
operation: "set-status"
status: ("published" | "suspended" | "withdrawn")
}
export interface SetActions {
operation: "set-actions"
/**
 * @minItems 1
 * @maxItems 3
 */
supportedActionContracts: [("message.reaction-add@1" | "message.reaction-remove@1" | "message.reaction-toggle@1")]|[("message.reaction-add@1" | "message.reaction-remove@1" | "message.reaction-toggle@1"), ("message.reaction-add@1" | "message.reaction-remove@1" | "message.reaction-toggle@1")]|[("message.reaction-add@1" | "message.reaction-remove@1" | "message.reaction-toggle@1"), ("message.reaction-add@1" | "message.reaction-remove@1" | "message.reaction-toggle@1"), ("message.reaction-add@1" | "message.reaction-remove@1" | "message.reaction-toggle@1")]
}
export interface SetRuntimeRelease {
operation: "set-runtime-release"
runtimeRelease: RuntimeReleaseRef
}
export interface RuntimeReleaseRef {
releaseId: "punks.reaction-turn.v1"
releaseDigest: "fe075600eab020932774516439f643e8b83f62a10245e6388ee25bbf61aa837f"
}

/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface PublishBotCommand {
contract: "bot.publish@1"
commandId: string
actor: Actor
payload: Payload
}
export interface Actor {
kind: "punk"
punkId: string
}
export interface Payload {
slug: string
name: string
description: string
configContractId: "punks://contracts/bot.config.empty@1"
runtimeRelease: RuntimeReleaseRef
/**
 * @minItems 1
 * @maxItems 3
 */
supportedActionContracts: [("message.reaction-add@1" | "message.reaction-remove@1" | "message.reaction-toggle@1")]|[("message.reaction-add@1" | "message.reaction-remove@1" | "message.reaction-toggle@1"), ("message.reaction-add@1" | "message.reaction-remove@1" | "message.reaction-toggle@1")]|[("message.reaction-add@1" | "message.reaction-remove@1" | "message.reaction-toggle@1"), ("message.reaction-add@1" | "message.reaction-remove@1" | "message.reaction-toggle@1"), ("message.reaction-add@1" | "message.reaction-remove@1" | "message.reaction-toggle@1")]
}
export interface RuntimeReleaseRef {
releaseId: "punks.reaction-turn.v1"
releaseDigest: "fe075600eab020932774516439f643e8b83f62a10245e6388ee25bbf61aa837f"
}

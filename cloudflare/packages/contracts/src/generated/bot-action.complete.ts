/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface CompleteBotActionCommand {
contract: "bot-action.complete@1"
commandId: string
admissionId: string
actionId: string
actionDigest: string
workspaceId: string
installationId: string
actor: Actor
outcome: ("succeeded" | "failed")
}
export interface Actor {
kind: "bot"
installationId: string
}

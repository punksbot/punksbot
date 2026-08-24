/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface ReplayBotActionCommand {
contract: "bot-action.replay@1"
commandId: string
admissionId: string
actionId: string
actionDigest: string
workspaceId: string
installationId: string
actor: Actor
}
export interface Actor {
kind: "bot"
installationId: string
}

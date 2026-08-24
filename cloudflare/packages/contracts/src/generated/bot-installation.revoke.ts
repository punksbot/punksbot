/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface RevokeBotInstallationCommand {
contract: "bot-installation.revoke@1"
commandId: string
workspaceId: string
installationId: string
actor: Actor
payload: {
cause: string
}
}
export interface Actor {
kind: "punk"
punkId: string
}

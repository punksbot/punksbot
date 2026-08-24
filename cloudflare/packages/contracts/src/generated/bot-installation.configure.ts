/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface ConfigureBotInstallationCommand {
contract: "bot-installation.configure@1"
commandId: string
workspaceId: string
installationId: string
actor: Actor
payload: (ReplaceConfig | SetGrant | PinRuntimeRelease)
}
export interface Actor {
kind: "punk"
punkId: string
}
export interface ReplaceConfig {
operation: "replace-config"
config: Config
}
export interface Config {
contractId: "punks://contracts/bot.config.empty@1"
value: {

}
}
export interface SetGrant {
operation: "set-grant"
grant: {
capability: ("messages.react" | "messages.read-context")
resource: {
kind: "conversation"
conversationId: string
}
enabled: boolean
}
}
export interface PinRuntimeRelease {
operation: "pin-runtime-release"
}

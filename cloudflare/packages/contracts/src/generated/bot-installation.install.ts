/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface InstallBotCommand {
contract: "bot-installation.install@1"
commandId: string
workspaceId: string
botId: string
actor: Actor
payload: {
config: Config
}
}
export interface Actor {
kind: "punk"
punkId: string
}
export interface Config {
contractId: "punks://contracts/bot.config.empty@1"
value: {

}
}

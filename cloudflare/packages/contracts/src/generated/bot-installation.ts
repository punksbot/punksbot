/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type BotInstallation = ({
[k: string]: unknown | undefined
} & {
id: string
workspaceId: string
botId: string
status: ("active" | "revoked")
runtimeRelease?: (RuntimeReleaseRef | null)
config: Config
grantCount: number
openAdmissionCount: number
authorityGeneration: number
revision: number
cursor: number
createdAt: string
updatedAt: string
revokedAt: (string | null)
})

export interface RuntimeReleaseRef {
releaseId: "punks.reaction-turn.v1"
releaseDigest: "fe075600eab020932774516439f643e8b83f62a10245e6388ee25bbf61aa837f"
}
export interface Config {
contractId: "punks://contracts/bot.config.empty@1"
value: {

}
}

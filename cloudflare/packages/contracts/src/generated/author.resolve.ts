/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type Actor = ({
kind: "punk"
punkId: string
} | {
kind: "bot"
installationId: string
})

export interface ResolveAuthorsQuery {
contract: "author.resolve@1"
workspaceId: string
/**
 * @minItems 1
 * @maxItems 100
 */
authors: [Actor, ...(Actor)[]]
}

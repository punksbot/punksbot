/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type AuthorSummary = ({
kind: "punk"
punkId: string
displayName: string
avatarUrl: (string | null)
} | {
kind: "bot"
installationId: string
displayName: string
avatarUrl: (string | null)
})

export interface ResolveAuthorsResponse {
contract: "author.resolve-response@1"
workspaceId: string
/**
 * @maxItems 100
 */
authors: AuthorSummary[]
}

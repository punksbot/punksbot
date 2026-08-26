/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type Transition = ({
type: "created"
} | {
type: "renamed"
previousSlug: string
} | MemberUpsertedTransition | {
type: "member-removed"
targetPunkId: string
previousRole: WorkspaceRole
} | {
type: "ownership-transferred"
/**
 * @minItems 2
 * @maxItems 2
 */
memberTransitions: [MemberUpsertedTransition, MemberUpsertedTransition]
})
export type NullableWorkspaceRole = (WorkspaceRole | null)
export type WorkspaceRole = ("owner" | "moderator" | "member" | "guest")

export interface WorkspaceEventContentV2 {
schemaVersion: 2
workspace: WorkspaceMetadata
transition: Transition
membershipCommitment: MembershipCommitment
}
export interface WorkspaceMetadata {
id: string
slug: string
name: string
visibility: ("private" | "punks" | "public")
status: ("active" | "deleting" | "deleted")
ownerPunkId: string
memberCount: number
revision: number
cursor: number
createdAt: string
updatedAt: string
}
export interface MemberUpsertedTransition {
type: "member-upserted"
targetPunkId: string
previousRole: NullableWorkspaceRole
role: WorkspaceRole
}
export interface MembershipCommitment {
algorithm: "sha256-canonical-json"
deltaDigest: string
deltaCount: number
chunkCount: number
/**
 * @minItems 1
 * @maxItems 64
 */
chunkDigests: [string, ...(string)[]]
}

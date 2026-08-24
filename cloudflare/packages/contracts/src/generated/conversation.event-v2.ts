/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type NullableText4000 = (string | null)
export type NullableText255 = (string | null)
export type NullablePositiveInteger = (number | null)
export type Transition = ({
type: "created"
} | {
type: "member-joined"
targetPunkId: string
access: ConversationAccess
} | {
type: "member-access-set"
targetPunkId: string
previousAccess: NullableConversationAccess
access: ConversationAccess
} | {
type: "member-removed"
targetPunkId: string
previousAccess: ConversationAccess
} | {
type: "metadata-updated"
changedFields: ("name" | "description" | "visibility" | "topic" | "purpose" | "topicRequired" | "maxMembers" | "ttlSeconds")[]
previousMetadata: {
name?: string
description?: NullableText4000
visibility?: ("open" | "private")
topic?: NullableText255
purpose?: NullableText4000
topicRequired?: boolean
maxMembers?: (number | null)
ttlSeconds?: NullablePositiveInteger
}
} | {
type: "archived"
cause: ("manual" | "ttl_expired")
} | {
type: "restored"
})
export type ConversationAccess = ("owner" | "manager" | "member" | "guest")
export type NullableConversationAccess = (ConversationAccess | null)

export interface ConversationEventContentV2 {
schemaVersion: 2
conversation: ConversationMetadata
transition: Transition
membershipCommitment: MembershipCommitment
}
export interface ConversationMetadata {
id: string
workspaceId: string
name: string
type: ("stream" | "forum" | "dm" | "workflow")
visibility: ("open" | "private")
description: NullableText4000
topic: NullableText255
purpose: NullableText4000
topicRequired: boolean
maxMembers: (number | null)
ttlSeconds: NullablePositiveInteger
ttlDeadline: (string | null)
ownerPunkId: string
memberCount: number
status: ("active" | "archived" | "deleting" | "deleted")
revision: number
cursor: number
createdAt: string
updatedAt: string
archivedAt: (string | null)
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

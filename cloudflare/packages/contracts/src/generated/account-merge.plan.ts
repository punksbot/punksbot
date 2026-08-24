/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type Uuid = string
export type HexDigest = string
export type Timestamp = string
export type Revision = number
export type Origin = ("survivor" | "absorbed")

export interface AccountMergePlan {
contract: "account-merge.plan@1"
schemaVersion: 1
planId: Uuid
intentId: Uuid
planDigest: HexDigest
status: "planned"
generatedAt: Timestamp
expiresAt: Timestamp
validForSeconds: number
holderBindingHash: HexDigest
strategy: "preserve-origin"
survivorPunkId: Uuid
absorbedPunkId: Uuid
accountRevisions: AccountRevisions
proofBindings: ProofBindings
/**
 * @maxItems 64
 */
claims: ClaimEffect[]
/**
 * @maxItems 512
 */
rights: RightEffect[]
/**
 * @maxItems 128
 */
sessions: SessionEffect[]
/**
 * @maxItems 64
 */
handoffs: HandoffEffect[]
/**
 * @maxItems 256
 */
conflicts: Conflict[]
}
export interface AccountRevisions {
survivor: Revision
absorbed: Revision
}
export interface ProofBindings {
survivorProofId: Uuid
absorbedProofId: Uuid
}
export interface ClaimEffect {
claimBindingHash: HexDigest
kind: ("provider-subject" | "verified-email" | "passkey-credential")
provider: ("google" | "github" | "passkey")
origin: Origin
disposition: ("preserve" | "transfer" | "deduplicate")
duplicateOfBindingHash: (HexDigest | null)
expectedRevision: Revision
}
export interface RightEffect {
rightBindingHash: HexDigest
kind: ("workspace-membership" | "workspace-invitation" | "account-owned-resource" | "local-resource-binding" | "local-tool-authorization" | "repository-access-proof")
authorityBindingHash: HexDigest
origin: Origin
originPunkId: Uuid
disposition: ("preserve" | "transfer" | "deduplicate" | "retarget" | "invalidate")
role: (("owner" | "moderator" | "member" | "guest") | null)
resultingRole: (("owner" | "moderator" | "member" | "guest") | null)
expectedRevision: Revision
}
export interface SessionEffect {
sessionBindingHash: HexDigest
origin: Origin
clientKind: ("browser" | "desktop" | "mobile" | "api")
action: "revoke"
authenticatedAt: Timestamp
expiresAt: Timestamp
}
export interface HandoffEffect {
handoffBindingHash: HexDigest
origin: Origin
kind: ("desktop-auth-flow" | "oauth-transaction" | "passkey-ceremony" | "reauth-authorization" | "session-renewal" | "account-link")
state: ("pending" | "prepared" | "deliverable")
action: "cancel"
expiresAt: Timestamp
}
export interface Conflict {
conflictBindingHash: HexDigest
kind: ("identical-claim" | "workspace-role" | "workspace-owner" | "duplicate-invitation" | "account-owned-resource" | "in-flight-sensitive-action" | "missing-strategy" | "alias-cycle" | "authority-unavailable")
authorityBindingHash: HexDigest
resolution: ("deduplicate" | "strongest-role" | "retarget-invitation" | "preserve-workspace-ownership" | "await-terminal" | "requires-adapter" | "reject-plan")
blocking: boolean
}

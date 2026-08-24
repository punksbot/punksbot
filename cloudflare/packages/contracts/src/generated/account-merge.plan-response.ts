/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type AccountMergePlanResponse = ({
contract: "account-merge.plan-response@1"
ok: true
status: "planned"
plan: AccountMergePlan
} | {
contract: "account-merge.plan-response@1"
ok: false
code: "plan_unavailable"
correlationId: string
})

export interface AccountMergePlan {
contract: "account-merge.plan@1"
schemaVersion: 1
planId: string
intentId: string
planDigest: string
status: "planned"
generatedAt: string
expiresAt: string
validForSeconds: number
holderBindingHash: string
strategy: "preserve-origin"
survivorPunkId: string
absorbedPunkId: string
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
survivor: number
absorbed: number
}
export interface ProofBindings {
survivorProofId: string
absorbedProofId: string
}
export interface ClaimEffect {
claimBindingHash: string
kind: ("provider-subject" | "verified-email" | "passkey-credential")
provider: ("google" | "github" | "passkey")
origin: ("survivor" | "absorbed")
disposition: ("preserve" | "transfer" | "deduplicate")
duplicateOfBindingHash: (string | null)
expectedRevision: number
}
export interface RightEffect {
rightBindingHash: string
kind: ("workspace-membership" | "workspace-invitation" | "account-owned-resource" | "local-resource-binding" | "local-tool-authorization" | "repository-access-proof")
authorityBindingHash: string
origin: ("survivor" | "absorbed")
originPunkId: string
disposition: ("preserve" | "transfer" | "deduplicate" | "retarget" | "invalidate")
role: (("owner" | "moderator" | "member" | "guest") | null)
resultingRole: (("owner" | "moderator" | "member" | "guest") | null)
expectedRevision: number
}
export interface SessionEffect {
sessionBindingHash: string
origin: ("survivor" | "absorbed")
clientKind: ("browser" | "desktop" | "mobile" | "api")
action: "revoke"
authenticatedAt: string
expiresAt: string
}
export interface HandoffEffect {
handoffBindingHash: string
origin: ("survivor" | "absorbed")
kind: ("desktop-auth-flow" | "oauth-transaction" | "passkey-ceremony" | "reauth-authorization" | "session-renewal" | "account-link")
state: ("pending" | "prepared" | "deliverable")
action: "cancel"
expiresAt: string
}
export interface Conflict {
conflictBindingHash: string
kind: ("identical-claim" | "workspace-role" | "workspace-owner" | "duplicate-invitation" | "account-owned-resource" | "in-flight-sensitive-action" | "missing-strategy" | "alias-cycle" | "authority-unavailable")
authorityBindingHash: string
resolution: ("deduplicate" | "strongest-role" | "retarget-invitation" | "preserve-workspace-ownership" | "await-terminal" | "requires-adapter" | "reject-plan")
blocking: boolean
}

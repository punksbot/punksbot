/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type AccountMergeCommitResponse = ({
contract: "account-merge.commit-response@1"
ok: true
state: AccountMergeState
replayed: boolean
} | {
contract: "account-merge.commit-response@1"
ok: false
code: ("invalid_request" | "plan_unavailable" | "plan_expired" | "revision_conflict" | "blocking_conflict" | "authority_unavailable" | "idempotency_conflict" | "receipt_conflict")
correlationId: string
})
export type AccountMergeState = ({
[k: string]: unknown | undefined
} & {
contract: "account-merge.state@1"
schemaVersion: 1
intentId: string
planId: string
planDigest: string
status: ("planned" | "preparing" | "committed" | "applying" | "completed")
survivorPunkId: string
absorbedPunkId: string
applicationCursor: number
applicationTotal: number
receipt: (Receipt | null)
lastFailure: (Failure | null)
committedAt: (string | null)
completedAt: (string | null)
updatedAt: string
})

export interface Receipt {
contract: "account-merge.receipt@1"
schemaVersion: 1
receiptId: string
intentId: string
planId: string
planDigest: string
commitCommandId: string
survivorPunkId: string
absorbedPunkId: string
accountRevisions: AccountRevisions
committedAt: string
receiptHash: string
}
export interface AccountRevisions {
survivor: number
absorbed: number
}
export interface Failure {
code: ("plan_expired" | "revision_conflict" | "blocking_conflict" | "authority_unavailable" | "idempotency_conflict" | "receipt_conflict" | "application_pending")
correlationId: string
recordedAt: string
}

/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type AccountMergeState = ({
[k: string]: unknown | undefined
} & {
contract: "account-merge.state@1"
schemaVersion: 1
intentId: Uuid
planId: Uuid
planDigest: HexDigest
status: ("planned" | "preparing" | "committed" | "applying" | "completed")
survivorPunkId: Uuid
absorbedPunkId: Uuid
applicationCursor: number
applicationTotal: number
receipt: (Receipt | null)
lastFailure: (Failure | null)
committedAt: (Timestamp | null)
completedAt: (Timestamp | null)
updatedAt: Timestamp
})
export type Uuid = string
export type HexDigest = string
export type Revision = number
export type Timestamp = string

export interface Receipt {
contract: "account-merge.receipt@1"
schemaVersion: 1
receiptId: Uuid
intentId: Uuid
planId: Uuid
planDigest: HexDigest
commitCommandId: Uuid
survivorPunkId: Uuid
absorbedPunkId: Uuid
accountRevisions: AccountRevisions
committedAt: Timestamp
receiptHash: HexDigest
}
export interface AccountRevisions {
survivor: Revision
absorbed: Revision
}
export interface Failure {
code: ("plan_expired" | "revision_conflict" | "blocking_conflict" | "authority_unavailable" | "idempotency_conflict" | "receipt_conflict" | "application_pending")
correlationId: string
recordedAt: Timestamp
}

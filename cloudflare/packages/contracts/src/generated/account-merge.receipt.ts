/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type Uuid = string
export type HexDigest = string
export type Revision = number
export type Timestamp = string

export interface AccountMergeReceipt {
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

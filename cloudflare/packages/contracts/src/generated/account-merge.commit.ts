/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type Uuid = string
export type HexDigest = string
export type Revision = number

export interface CommitAccountMergeCommand {
contract: "account-merge.commit@1"
commandId: Uuid
intentId: Uuid
planId: Uuid
planDigest: HexDigest
survivorPunkId: Uuid
absorbedPunkId: Uuid
accountRevisions: AccountRevisions
confirmation: "merge_accounts_irreversibly"
}
export interface AccountRevisions {
survivor: Revision
absorbed: Revision
}

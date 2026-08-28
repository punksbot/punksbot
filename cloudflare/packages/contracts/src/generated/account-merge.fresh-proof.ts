/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type Uuid = string
export type Revision = number
export type HexDigest = string
export type Timestamp = string

export interface AccountMergeFreshProof {
contract: "account-merge.fresh-proof@1"
proofId: Uuid
intentId: Uuid
accountRole: ("survivor" | "absorbed")
punkId: Uuid
accountRevision: Revision
holderBindingHash: HexDigest
authenticationMethod: ("google" | "github")
providerSubjectBindingHash: HexDigest
authenticatedAt: Timestamp
expiresAt: Timestamp
validForSeconds: 300
}

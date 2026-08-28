/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface CreateAccountMergePlanCommand {
contract: "account-merge.plan-create@1"
commandId: string
intentId: string
survivorPunkId: string
absorbedPunkId: string
holderBindingHash: string
/**
 * @minItems 2
 * @maxItems 2
 */
proofs: ({
[k: string]: unknown | undefined
} & [AccountMergeFreshProof, AccountMergeFreshProof])
}
export interface AccountMergeFreshProof {
contract: "account-merge.fresh-proof@1"
proofId: string
intentId: string
accountRole: ("survivor" | "absorbed")
punkId: string
accountRevision: number
holderBindingHash: string
authenticationMethod: ("google" | "github")
providerSubjectBindingHash: string
authenticatedAt: string
expiresAt: string
validForSeconds: 300
}

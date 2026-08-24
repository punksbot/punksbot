/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface Punk {
id: string
status: ("active" | "merged" | "deleting" | "deleted")
displayName: string
avatarUrl: (string | null)
/**
 * @minItems 1
 */
identities: [{
provider: ("google" | "github" | "passkey")
subjectHash: string
emailHash: string
verifiedEmail: (string | null)
username: (string | null)
credentialId: (string | null)
linkedAt: string
}, ...({
provider: ("google" | "github" | "passkey")
subjectHash: string
emailHash: string
verifiedEmail: (string | null)
username: (string | null)
credentialId: (string | null)
linkedAt: string
})[]]
mergedInto: (string | null)
revision: number
createdAt: string
updatedAt: string
}

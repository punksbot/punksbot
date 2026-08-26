/* Generated from the canonical Punks JSON Schema. Do not edit. */

export type MediaUploadStatus = ({
[k: string]: unknown | undefined
} & {
contract: "media-upload.status@1"
uploadId: string
workspaceId: string
punkId: string
purpose: "message_attachment"
byteLength: number
contentType: string
sha256: string
issuedAt: string
expiresAt: string
partSize: 8388608
partCount: number
state: ("uploading" | "finalizing" | "candidate" | "cleanup_pending" | "abandoned" | "expired" | "rejected")
/**
 * @maxItems 32
 */
uploadedParts: {
partNumber: number
byteLength: number
sha256: string
}[]
candidate: (Candidate | null)
failure: (Failure | null)
})

export interface Candidate {
mediaId: string
byteLength: number
contentType: string
sha256: string
finalizedAt: string
}
export interface Failure {
code: ("storage_unavailable" | "hash_invalid" | "conflict" | "ambiguous" | "expired" | "abandoned" | "authorization_lost")
retry: ("same_command" | "later" | "new_intent" | "never")
}

/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface CreateMediaUploadGrantCommand {
contract: "media-upload.grant-create@1"
commandId: string
workspaceId: string
actor: {
kind: "punk"
punkId: string
}
payload: {
purpose: "message_attachment"
byteLength: number
contentType: ("application/json" | "application/pdf" | "application/zip" | "audio/mpeg" | "audio/ogg" | "audio/wav" | "audio/webm" | "image/avif" | "image/gif" | "image/jpeg" | "image/png" | "image/webp" | "text/csv" | "text/markdown" | "text/plain" | "video/mp4" | "video/quicktime" | "video/webm")
sha256: string
}
}

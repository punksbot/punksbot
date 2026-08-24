/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface PasskeyOptionsResponse {
ceremonyId: string
purpose: ("registration" | "authentication")
expiresAt: string
publicKey: {
[k: string]: unknown | undefined
}
}

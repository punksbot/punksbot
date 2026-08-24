/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface DesktopSessionResponse {
session: Session
}
export interface Session {
sessionId: string
punkId: string
authenticatedAt: string
expiresAt: string
recentReauthUntil: (string | null)
punk: {
id: string
displayName: string
avatarUrl: (string | null)
}
}

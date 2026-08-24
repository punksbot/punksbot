/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface WorkspaceProjectionMessage {
schemaVersion: 1
workspaceId: string
cursor: number
event: {
id: string
pubkey: string
created_at: number
kind: number
tags: [string, ...(string)[]][]
content: string
sig: string
}
state: {
id: string
slug: string
name: string
visibility: ("private" | "punks" | "public")
status: ("active" | "deleting" | "deleted")
ownerPunkId: string
/**
 * @minItems 1
 */
members: [{
punkId: string
role: ("owner" | "moderator" | "member" | "guest")
}, ...({
punkId: string
role: ("owner" | "moderator" | "member" | "guest")
})[]]
revision: number
cursor: number
createdAt: string
updatedAt: string
}
}

/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface ConversationView {
id: string
workspaceId: string
name: string
type: ("stream" | "forum" | "dm" | "workflow")
visibility: ("open" | "private")
description: (string | null)
topic: (string | null)
purpose: (string | null)
topicRequired: boolean
maxMembers: (number | null)
ttlSeconds: (number | null)
ttlDeadline: (string | null)
status: ("active" | "archived" | "deleting" | "deleted")
revision: number
cursor: number
createdAt: string
updatedAt: string
archivedAt: (string | null)
}

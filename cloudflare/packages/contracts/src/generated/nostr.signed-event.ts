/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface SignedNostrEvent {
id: string
pubkey: string
created_at: number
kind: number
tags: [string, ...(string)[]][]
content: string
sig: string
}

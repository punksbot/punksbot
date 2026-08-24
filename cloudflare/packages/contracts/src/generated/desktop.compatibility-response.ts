/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface DesktopCompatibilityResponse {
contract: "desktop.compatibility-response@1"
compatible: boolean
profile: "desktop-social-loop@1"
registryVersion: 1
minimumClientVersion: string
environment: ("local" | "staging" | "production")
origin: string
/**
 * @maxItems 32
 */
capabilities: string[]
}

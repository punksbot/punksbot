/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface StartDesktopAuthCommand {
contract: "auth.desktop-start@1"
provider: ("google" | "github")
intent: "sign_in"
installationId: string
environment: ("local" | "staging" | "production")
}

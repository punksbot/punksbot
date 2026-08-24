/* Generated from the canonical Punks JSON Schema. Do not edit. */

export interface StartAuthCommand {
contract: "auth.start@1"
provider: ("google" | "github")
intent: ("sign_in" | "reauthenticate" | "link")
returnTo: string
}

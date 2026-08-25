// Profil `desktop-social-loop@1` — projection Rust des contrats Punks.
// Généré par `cloudflare/packages/contracts/scripts/generate-artifacts.mjs`.
// NE PAS ÉDITER : toute modification passe par les schémas canoniques.
//
// Ces types projettent la forme des contrats (champs, unions, constantes,
// énumérations fermées, champs inconnus rejetés). Les contraintes de valeur
// (pattern, bornes, longueurs, uniqueItems) restent portées par les
// validateurs JSON Schema et le corpus commun de conformité.

use serde::{Deserialize, Serialize};

mod const_checkers {
    use serde::de::{self, Deserialize, Deserializer};

    pub(super) fn expect_const_desktop_compatibility_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "desktop.compatibility@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_desktop_social_loop_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "desktop-social-loop@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_desktop_compatibility_response_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "desktop.compatibility-response@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_u1<'de, D>(deserializer: D) -> Result<u64, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = u64::deserialize(deserializer)?;
        if value == 1 {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_desktop_auth_start_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "desktop-auth.start@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_request<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "request" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_response<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "response" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_started<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "started" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_desktop_auth_status_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "desktop-auth.status@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_desktop_auth_claim_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "desktop-auth.claim@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_delivering<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "delivering" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_session<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "session" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_reauthorization<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "reauthorization" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_reauthenticate<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "reauthenticate" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_desktop_auth_confirm_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "desktop-auth.confirm@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_confirmed<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "confirmed" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_desktop_auth_cancel_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "desktop-auth.cancel@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_cancelled<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "cancelled" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_desktop_session_renew_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "desktop-session.renew@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_prepare<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "prepare" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_prepared<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "prepared" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_confirm<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "confirm" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_desktop_session_revoke_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "desktop-session.revoke@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_r_true<'de, D>(deserializer: D) -> Result<bool, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = bool::deserialize(deserializer)?;
        if value == true {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_workspace_list_1<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "workspace.list@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_workspace_list_response_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "workspace.list-response@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_workspace_get_1<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "workspace.get@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_conversation_list_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "conversation.list@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_stream<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "stream" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_active<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "active" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_conversation_list_response_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "conversation.list-response@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_conversation_get_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "conversation.get@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_message_history_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "message.history@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_created_cursor_ascending<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "createdCursor-ascending" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_punk<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "punk" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_bot<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "bot" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_author_resolve_1<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "author.resolve@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_author_resolve_response_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "author.resolve-response@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_conversation_follow_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "conversation.follow@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_accepted<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "accepted" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_changes<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "changes" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_ready<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "ready" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_resync_required<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "resync-required" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_conversation_unavailable<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "conversation-unavailable" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_archived<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "archived" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_ack<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "ack" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_message_post_1<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "message.post@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_message_reaction_add_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "message.reaction-add@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_message_reaction_remove_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "message.reaction-remove@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_account_merge_fresh_proof_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "account-merge.fresh-proof@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_u300<'de, D>(deserializer: D) -> Result<u64, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = u64::deserialize(deserializer)?;
        if value == 300 {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_account_merge_plan_create_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "account-merge.plan-create@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_account_merge_plan_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "account-merge.plan@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_planned<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "planned" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_preserve_origin<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "preserve-origin" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_revoke<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "revoke" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_cancel<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "cancel" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_account_merge_plan_response_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "account-merge.plan-response@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_r_false<'de, D>(deserializer: D) -> Result<bool, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = bool::deserialize(deserializer)?;
        if value == false {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_plan_unavailable<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "plan_unavailable" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DesktopCompatibilityQueryDistribution {
    #[serde(rename = "development")]
    Development,
    #[serde(rename = "staging")]
    Staging,
    #[serde(rename = "production")]
    Production,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DesktopCompatibilityQueryPlatform {
    #[serde(rename = "macos-arm64")]
    MacosArm64,
    #[serde(rename = "macos-x64")]
    MacosX64,
    #[serde(rename = "linux-x64")]
    LinuxX64,
    #[serde(rename = "windows-x64")]
    WindowsX64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DesktopCompatibilityQuery {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_desktop_compatibility_1"
    )]
    pub contract: String,
    #[serde(
        rename = "profile",
        deserialize_with = "const_checkers::expect_const_desktop_social_loop_1"
    )]
    pub profile: String,
    #[serde(rename = "clientVersion")]
    pub client_version: String,
    pub distribution: DesktopCompatibilityQueryDistribution,
    pub platform: DesktopCompatibilityQueryPlatform,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DesktopCompatibilityResponseEnvironment {
    #[serde(rename = "local")]
    Local,
    #[serde(rename = "staging")]
    Staging,
    #[serde(rename = "production")]
    Production,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DesktopCompatibilityResponse {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_desktop_compatibility_response_1"
    )]
    pub contract: String,
    pub compatible: bool,
    #[serde(
        rename = "profile",
        deserialize_with = "const_checkers::expect_const_desktop_social_loop_1"
    )]
    pub profile: String,
    #[serde(
        rename = "registryVersion",
        deserialize_with = "const_checkers::expect_const_u1"
    )]
    pub registry_version: u64,
    #[serde(rename = "minimumClientVersion")]
    pub minimum_client_version: String,
    pub environment: DesktopCompatibilityResponseEnvironment,
    pub origin: String,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AuthSession {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "punkId")]
    pub punk_id: String,
    #[serde(rename = "authenticatedAt")]
    pub authenticated_at: String,
    #[serde(rename = "expiresAt")]
    pub expires_at: String,
    #[serde(rename = "recentReauthUntil")]
    pub recent_reauth_until: Option<String>,
    pub punk: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DesktopAuthStartRequestIntent {
    #[serde(rename = "sign_in")]
    SignIn,
    #[serde(rename = "switch_account")]
    SwitchAccount,
    #[serde(rename = "reauthenticate")]
    Reauthenticate,
    #[serde(rename = "link_google")]
    LinkGoogle,
    #[serde(rename = "link_github")]
    LinkGithub,
    #[serde(rename = "register_passkey")]
    RegisterPasskey,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DesktopAuthStartRequestMethod {
    #[serde(rename = "google")]
    Google,
    #[serde(rename = "github")]
    Github,
    #[serde(rename = "passkey")]
    Passkey,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DesktopAuthStartRequestPurpose {
    #[serde(rename = "link_google")]
    LinkGoogle,
    #[serde(rename = "link_github")]
    LinkGithub,
    #[serde(rename = "register_passkey")]
    RegisterPasskey,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DesktopAuthStartRequest {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_desktop_auth_start_1"
    )]
    pub contract: String,
    #[serde(
        rename = "message",
        deserialize_with = "const_checkers::expect_const_request"
    )]
    pub message: String,
    pub intent: DesktopAuthStartRequestIntent,
    pub method: DesktopAuthStartRequestMethod,
    #[serde(rename = "verifierCommitment")]
    pub verifier_commitment: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub purpose: Option<DesktopAuthStartRequestPurpose>,
    #[serde(rename = "authorizationId")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authorization_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DesktopAuthStartResponseIntent {
    #[serde(rename = "sign_in")]
    SignIn,
    #[serde(rename = "switch_account")]
    SwitchAccount,
    #[serde(rename = "reauthenticate")]
    Reauthenticate,
    #[serde(rename = "link_google")]
    LinkGoogle,
    #[serde(rename = "link_github")]
    LinkGithub,
    #[serde(rename = "register_passkey")]
    RegisterPasskey,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DesktopAuthStartResponseMethod {
    #[serde(rename = "google")]
    Google,
    #[serde(rename = "github")]
    Github,
    #[serde(rename = "passkey")]
    Passkey,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DesktopAuthStartResponse {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_desktop_auth_start_1"
    )]
    pub contract: String,
    #[serde(
        rename = "message",
        deserialize_with = "const_checkers::expect_const_response"
    )]
    pub message: String,
    #[serde(rename = "flowId")]
    pub flow_id: String,
    #[serde(
        rename = "phase",
        deserialize_with = "const_checkers::expect_const_started"
    )]
    pub phase: String,
    pub intent: DesktopAuthStartResponseIntent,
    pub method: DesktopAuthStartResponseMethod,
    #[serde(rename = "browserUrl")]
    pub browser_url: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "expiresAt")]
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum DesktopAuthStartExchange {
    Request(DesktopAuthStartRequest),
    Response(DesktopAuthStartResponse),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DesktopAuthStatusRequest {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_desktop_auth_status_1"
    )]
    pub contract: String,
    #[serde(
        rename = "message",
        deserialize_with = "const_checkers::expect_const_request"
    )]
    pub message: String,
    #[serde(rename = "flowId")]
    pub flow_id: String,
    #[serde(rename = "verifierCommitment")]
    pub verifier_commitment: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DesktopAuthStatusResponsePhase {
    #[serde(rename = "started")]
    Started,
    #[serde(rename = "browser_complete")]
    BrowserComplete,
    #[serde(rename = "ready")]
    Ready,
    #[serde(rename = "delivering")]
    Delivering,
    #[serde(rename = "confirmed")]
    Confirmed,
    #[serde(rename = "cancelled")]
    Cancelled,
    #[serde(rename = "expired")]
    Expired,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DesktopAuthStatusResponseResult {
    #[serde(rename = "success")]
    Success,
    #[serde(rename = "human_action_required")]
    HumanActionRequired,
    #[serde(rename = "security_failure")]
    SecurityFailure,
    #[serde(rename = "transient_interruption")]
    TransientInterruption,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DesktopAuthStatusResponseOutcomeCode {
    #[serde(rename = "account_created")]
    AccountCreated,
    #[serde(rename = "account_creation_confirmation_required")]
    AccountCreationConfirmationRequired,
    #[serde(rename = "authenticated")]
    Authenticated,
    #[serde(rename = "cancelled")]
    Cancelled,
    #[serde(rename = "expired")]
    Expired,
    #[serde(rename = "link_required")]
    LinkRequired,
    #[serde(rename = "link_pending")]
    LinkPending,
    #[serde(rename = "linked")]
    Linked,
    #[serde(rename = "merge_required")]
    MergeRequired,
    #[serde(rename = "passkey_authenticated")]
    PasskeyAuthenticated,
    #[serde(rename = "passkey_invalid")]
    PasskeyInvalid,
    #[serde(rename = "passkey_registration_pending")]
    PasskeyRegistrationPending,
    #[serde(rename = "passkey_registered")]
    PasskeyRegistered,
    #[serde(rename = "passkey_unknown_or_invalid")]
    PasskeyUnknownOrInvalid,
    #[serde(rename = "provider_error")]
    ProviderError,
    #[serde(rename = "reauthenticated")]
    Reauthenticated,
    #[serde(rename = "reauthentication_failed")]
    ReauthenticationFailed,
    #[serde(rename = "session_expired")]
    SessionExpired,
    #[serde(rename = "temporarily_unavailable")]
    TemporarilyUnavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DesktopAuthStatusExchangeDecision {
    #[serde(rename = "oldSessionUsable")]
    pub old_session_usable: bool,
    #[serde(rename = "revokePreparedSession")]
    pub revoke_prepared_session: bool,
    #[serde(rename = "destroyWorkspaceContext")]
    pub destroy_workspace_context: bool,
    #[serde(rename = "retrySameRequest")]
    pub retry_same_request: bool,
    #[serde(rename = "freshHumanActionRequired")]
    pub fresh_human_action_required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DesktopAuthStatusResponse {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_desktop_auth_status_1"
    )]
    pub contract: String,
    #[serde(
        rename = "message",
        deserialize_with = "const_checkers::expect_const_response"
    )]
    pub message: String,
    #[serde(rename = "flowId")]
    pub flow_id: String,
    pub phase: DesktopAuthStatusResponsePhase,
    pub terminal: bool,
    #[serde(rename = "expiresAt")]
    pub expires_at: String,
    pub result: DesktopAuthStatusResponseResult,
    #[serde(rename = "outcomeCode")]
    pub outcome_code: Option<DesktopAuthStatusResponseOutcomeCode>,
    pub decision: DesktopAuthStatusExchangeDecision,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum DesktopAuthStatusExchange {
    Request(DesktopAuthStatusRequest),
    Response(DesktopAuthStatusResponse),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DesktopAuthClaimRequest {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_desktop_auth_claim_1"
    )]
    pub contract: String,
    #[serde(
        rename = "message",
        deserialize_with = "const_checkers::expect_const_request"
    )]
    pub message: String,
    #[serde(
        rename = "deliveryKind",
        deserialize_with = "const_checkers::expect_const_request"
    )]
    pub delivery_kind: String,
    #[serde(rename = "flowId")]
    pub flow_id: String,
    pub verifier: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DesktopAuthClaimExchangeSession {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "punkId")]
    pub punk_id: String,
    #[serde(rename = "authenticatedAt")]
    pub authenticated_at: String,
    #[serde(rename = "expiresAt")]
    pub expires_at: String,
    #[serde(rename = "recentReauthUntil")]
    pub recent_reauth_until: Option<String>,
    pub punk: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DesktopAuthClaimExchangeCapability {
    pub token: String,
    #[serde(rename = "expiresAt")]
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DesktopAuthClaimResponse {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_desktop_auth_claim_1"
    )]
    pub contract: String,
    #[serde(
        rename = "message",
        deserialize_with = "const_checkers::expect_const_response"
    )]
    pub message: String,
    #[serde(rename = "flowId")]
    pub flow_id: String,
    #[serde(
        rename = "phase",
        deserialize_with = "const_checkers::expect_const_delivering"
    )]
    pub phase: String,
    #[serde(
        rename = "deliveryKind",
        deserialize_with = "const_checkers::expect_const_session"
    )]
    pub delivery_kind: String,
    #[serde(rename = "deliveryId")]
    pub delivery_id: String,
    pub session: DesktopAuthClaimExchangeSession,
    #[serde(rename = "revokeCapability")]
    pub revoke_capability: DesktopAuthClaimExchangeCapability,
    #[serde(rename = "deliveryExpiresAt")]
    pub delivery_expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DesktopAuthClaimExchangeAuthorizationTargetMethod {
    #[serde(rename = "link_google")]
    LinkGoogle,
    #[serde(rename = "link_github")]
    LinkGithub,
    #[serde(rename = "register_passkey")]
    RegisterPasskey,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DesktopAuthClaimExchangeAuthorization {
    #[serde(rename = "authorizationId")]
    pub authorization_id: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "punkId")]
    pub punk_id: String,
    #[serde(
        rename = "intent",
        deserialize_with = "const_checkers::expect_const_reauthenticate"
    )]
    pub intent: String,
    #[serde(rename = "targetMethod")]
    pub target_method: DesktopAuthClaimExchangeAuthorizationTargetMethod,
    #[serde(rename = "handoffId")]
    pub handoff_id: String,
    #[serde(rename = "expiresAt")]
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DesktopAuthClaimReauthorizationResponse {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_desktop_auth_claim_1"
    )]
    pub contract: String,
    #[serde(
        rename = "message",
        deserialize_with = "const_checkers::expect_const_response"
    )]
    pub message: String,
    #[serde(rename = "flowId")]
    pub flow_id: String,
    #[serde(
        rename = "phase",
        deserialize_with = "const_checkers::expect_const_delivering"
    )]
    pub phase: String,
    #[serde(
        rename = "deliveryKind",
        deserialize_with = "const_checkers::expect_const_reauthorization"
    )]
    pub delivery_kind: String,
    #[serde(rename = "deliveryId")]
    pub delivery_id: String,
    pub authorization: DesktopAuthClaimExchangeAuthorization,
    #[serde(rename = "deliveryExpiresAt")]
    pub delivery_expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum DesktopAuthClaimExchange {
    Request(DesktopAuthClaimRequest),
    SessionResponse(DesktopAuthClaimResponse),
    ReauthorizationResponse(DesktopAuthClaimReauthorizationResponse),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DesktopAuthConfirmRequest {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_desktop_auth_confirm_1"
    )]
    pub contract: String,
    #[serde(
        rename = "message",
        deserialize_with = "const_checkers::expect_const_request"
    )]
    pub message: String,
    #[serde(rename = "flowId")]
    pub flow_id: String,
    pub verifier: String,
    #[serde(rename = "deliveryId")]
    pub delivery_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DesktopAuthConfirmResponse {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_desktop_auth_confirm_1"
    )]
    pub contract: String,
    #[serde(
        rename = "message",
        deserialize_with = "const_checkers::expect_const_response"
    )]
    pub message: String,
    #[serde(rename = "flowId")]
    pub flow_id: String,
    #[serde(
        rename = "phase",
        deserialize_with = "const_checkers::expect_const_confirmed"
    )]
    pub phase: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "confirmedAt")]
    pub confirmed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum DesktopAuthConfirmExchange {
    Request(DesktopAuthConfirmRequest),
    Response(DesktopAuthConfirmResponse),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DesktopAuthCancelRequest {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_desktop_auth_cancel_1"
    )]
    pub contract: String,
    #[serde(
        rename = "message",
        deserialize_with = "const_checkers::expect_const_request"
    )]
    pub message: String,
    #[serde(rename = "flowId")]
    pub flow_id: String,
    pub verifier: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DesktopAuthCancelResponse {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_desktop_auth_cancel_1"
    )]
    pub contract: String,
    #[serde(
        rename = "message",
        deserialize_with = "const_checkers::expect_const_response"
    )]
    pub message: String,
    #[serde(rename = "flowId")]
    pub flow_id: String,
    #[serde(
        rename = "phase",
        deserialize_with = "const_checkers::expect_const_cancelled"
    )]
    pub phase: String,
    #[serde(rename = "cancelledAt")]
    pub cancelled_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum DesktopAuthCancelExchange {
    Request(DesktopAuthCancelRequest),
    Response(DesktopAuthCancelResponse),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DesktopSessionRenewPrepareRequest {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_desktop_session_renew_1"
    )]
    pub contract: String,
    #[serde(
        rename = "message",
        deserialize_with = "const_checkers::expect_const_request"
    )]
    pub message: String,
    #[serde(
        rename = "action",
        deserialize_with = "const_checkers::expect_const_prepare"
    )]
    pub action: String,
    #[serde(rename = "commandId")]
    pub command_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DesktopSessionRenewExchangeSession {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "punkId")]
    pub punk_id: String,
    #[serde(rename = "authenticatedAt")]
    pub authenticated_at: String,
    #[serde(rename = "expiresAt")]
    pub expires_at: String,
    #[serde(rename = "recentReauthUntil")]
    pub recent_reauth_until: Option<String>,
    pub punk: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DesktopSessionRenewExchangeCapability {
    pub token: String,
    #[serde(rename = "expiresAt")]
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DesktopSessionRenewPreparedResponse {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_desktop_session_renew_1"
    )]
    pub contract: String,
    #[serde(
        rename = "message",
        deserialize_with = "const_checkers::expect_const_response"
    )]
    pub message: String,
    #[serde(
        rename = "action",
        deserialize_with = "const_checkers::expect_const_prepared"
    )]
    pub action: String,
    #[serde(rename = "commandId")]
    pub command_id: String,
    #[serde(rename = "rotationId")]
    pub rotation_id: String,
    pub session: DesktopSessionRenewExchangeSession,
    #[serde(rename = "revokeCapability")]
    pub revoke_capability: DesktopSessionRenewExchangeCapability,
    #[serde(rename = "confirmBy")]
    pub confirm_by: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DesktopSessionRenewConfirmRequest {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_desktop_session_renew_1"
    )]
    pub contract: String,
    #[serde(
        rename = "message",
        deserialize_with = "const_checkers::expect_const_request"
    )]
    pub message: String,
    #[serde(
        rename = "action",
        deserialize_with = "const_checkers::expect_const_confirm"
    )]
    pub action: String,
    #[serde(rename = "commandId")]
    pub command_id: String,
    #[serde(rename = "rotationId")]
    pub rotation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DesktopSessionRenewConfirmedResponse {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_desktop_session_renew_1"
    )]
    pub contract: String,
    #[serde(
        rename = "message",
        deserialize_with = "const_checkers::expect_const_response"
    )]
    pub message: String,
    #[serde(
        rename = "action",
        deserialize_with = "const_checkers::expect_const_confirmed"
    )]
    pub action: String,
    #[serde(rename = "commandId")]
    pub command_id: String,
    #[serde(rename = "rotationId")]
    pub rotation_id: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "confirmedAt")]
    pub confirmed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum DesktopSessionRenewExchange {
    PrepareRequest(DesktopSessionRenewPrepareRequest),
    PreparedResponse(DesktopSessionRenewPreparedResponse),
    ConfirmRequest(DesktopSessionRenewConfirmRequest),
    ConfirmedResponse(DesktopSessionRenewConfirmedResponse),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DesktopSessionRevokeRequest {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_desktop_session_revoke_1"
    )]
    pub contract: String,
    #[serde(
        rename = "message",
        deserialize_with = "const_checkers::expect_const_request"
    )]
    pub message: String,
    pub capability: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DesktopSessionRevokeResponse {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_desktop_session_revoke_1"
    )]
    pub contract: String,
    #[serde(
        rename = "message",
        deserialize_with = "const_checkers::expect_const_response"
    )]
    pub message: String,
    #[serde(
        rename = "revoked",
        deserialize_with = "const_checkers::expect_const_r_true"
    )]
    pub revoked: bool,
    pub expired: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum DesktopSessionRevokeExchange {
    Request(DesktopSessionRevokeRequest),
    Response(DesktopSessionRevokeResponse),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ListWorkspacesQuery {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_workspace_list_1"
    )]
    pub contract: String,
    pub limit: u64,
    pub cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ListWorkspacesResponseWorkspaceSummaryVisibility {
    #[serde(rename = "private")]
    Private,
    #[serde(rename = "punks")]
    Punks,
    #[serde(rename = "public")]
    Public,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ListWorkspacesResponseWorkspaceSummaryRole {
    #[serde(rename = "owner")]
    Owner,
    #[serde(rename = "moderator")]
    Moderator,
    #[serde(rename = "member")]
    Member,
    #[serde(rename = "guest")]
    Guest,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ListWorkspacesResponseWorkspaceSummary {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub visibility: ListWorkspacesResponseWorkspaceSummaryVisibility,
    pub role: ListWorkspacesResponseWorkspaceSummaryRole,
    pub revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ListWorkspacesResponse {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_workspace_list_response_1"
    )]
    pub contract: String,
    pub items: Vec<ListWorkspacesResponseWorkspaceSummary>,
    #[serde(rename = "nextCursor")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GetWorkspaceQuery {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_workspace_get_1"
    )]
    pub contract: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceVisibility {
    #[serde(rename = "private")]
    Private,
    #[serde(rename = "punks")]
    Punks,
    #[serde(rename = "public")]
    Public,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceStatus {
    #[serde(rename = "active")]
    Active,
    #[serde(rename = "deleting")]
    Deleting,
    #[serde(rename = "deleted")]
    Deleted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub visibility: WorkspaceVisibility,
    pub status: WorkspaceStatus,
    #[serde(rename = "ownerPunkId")]
    pub owner_punk_id: String,
    pub members: Vec<serde_json::Value>,
    pub revision: u64,
    pub cursor: u64,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ListConversationsQuery {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_conversation_list_1"
    )]
    pub contract: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    #[serde(
        rename = "type",
        deserialize_with = "const_checkers::expect_const_stream"
    )]
    pub r#type: String,
    #[serde(
        rename = "status",
        deserialize_with = "const_checkers::expect_const_active"
    )]
    pub status: String,
    pub limit: u64,
    pub cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ListConversationsResponseConversationSummaryVisibility {
    #[serde(rename = "open")]
    Open,
    #[serde(rename = "private")]
    Private,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ListConversationsResponseConversationSummary {
    pub id: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    pub name: String,
    #[serde(
        rename = "type",
        deserialize_with = "const_checkers::expect_const_stream"
    )]
    pub r#type: String,
    pub visibility: ListConversationsResponseConversationSummaryVisibility,
    pub description: Option<String>,
    pub topic: Option<String>,
    pub purpose: Option<String>,
    #[serde(rename = "topicRequired")]
    pub topic_required: bool,
    #[serde(rename = "ttlSeconds")]
    pub ttl_seconds: Option<u64>,
    #[serde(rename = "ttlDeadline")]
    pub ttl_deadline: Option<String>,
    pub revision: u64,
    pub cursor: u64,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ListConversationsResponse {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_conversation_list_response_1"
    )]
    pub contract: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    pub items: Vec<ListConversationsResponseConversationSummary>,
    #[serde(rename = "nextCursor")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GetConversationQuery {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_conversation_get_1"
    )]
    pub contract: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    #[serde(rename = "conversationId")]
    pub conversation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ConversationViewType {
    #[serde(rename = "stream")]
    Stream,
    #[serde(rename = "forum")]
    Forum,
    #[serde(rename = "dm")]
    Dm,
    #[serde(rename = "workflow")]
    Workflow,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ConversationViewVisibility {
    #[serde(rename = "open")]
    Open,
    #[serde(rename = "private")]
    Private,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ConversationViewStatus {
    #[serde(rename = "active")]
    Active,
    #[serde(rename = "archived")]
    Archived,
    #[serde(rename = "deleting")]
    Deleting,
    #[serde(rename = "deleted")]
    Deleted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ConversationView {
    pub id: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub r#type: ConversationViewType,
    pub visibility: ConversationViewVisibility,
    pub description: Option<String>,
    pub topic: Option<String>,
    pub purpose: Option<String>,
    #[serde(rename = "topicRequired")]
    pub topic_required: bool,
    #[serde(rename = "maxMembers")]
    pub max_members: Option<u64>,
    #[serde(rename = "ttlSeconds")]
    pub ttl_seconds: Option<u64>,
    #[serde(rename = "ttlDeadline")]
    pub ttl_deadline: Option<String>,
    pub status: ConversationViewStatus,
    pub revision: u64,
    pub cursor: u64,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    #[serde(rename = "archivedAt")]
    pub archived_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum MessageHistoryQueryDirection {
    #[serde(rename = "older")]
    Older,
    #[serde(rename = "newer")]
    Newer,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MessageHistoryQuery {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_message_history_1"
    )]
    pub contract: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    #[serde(rename = "conversationId")]
    pub conversation_id: String,
    #[serde(rename = "threadRootMessageId")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_root_message_id: Option<String>,
    pub cursor: Option<String>,
    pub limit: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direction: Option<MessageHistoryQueryDirection>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Punk {
    #[serde(
        rename = "kind",
        deserialize_with = "const_checkers::expect_const_punk"
    )]
    pub kind: String,
    #[serde(rename = "punkId")]
    pub punk_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Bot {
    #[serde(rename = "kind", deserialize_with = "const_checkers::expect_const_bot")]
    pub kind: String,
    #[serde(rename = "installationId")]
    pub installation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum MessageViewActor {
    Punk(Punk),
    Bot(Bot),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum MessageViewMessageType {
    #[serde(rename = "stream-message")]
    StreamMessage,
    #[serde(rename = "forum-post")]
    ForumPost,
    #[serde(rename = "forum-comment")]
    ForumComment,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum MessageViewStatus {
    #[serde(rename = "active")]
    Active,
    #[serde(rename = "retracted")]
    Retracted,
    #[serde(rename = "erased")]
    Erased,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum MessageViewRetractionKind {
    #[serde(rename = "author")]
    Author,
    #[serde(rename = "moderation")]
    Moderation,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MessageView {
    pub id: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    #[serde(rename = "conversationId")]
    pub conversation_id: String,
    pub author: MessageViewActor,
    #[serde(rename = "messageType")]
    pub message_type: MessageViewMessageType,
    pub status: MessageViewStatus,
    pub content: Option<String>,
    pub topic: Option<String>,
    #[serde(rename = "mentionedPunkIds")]
    pub mentioned_punk_ids: Vec<String>,
    #[serde(rename = "mediaIds")]
    pub media_ids: Vec<String>,
    #[serde(rename = "parentMessageId")]
    pub parent_message_id: Option<String>,
    #[serde(rename = "threadRootMessageId")]
    pub thread_root_message_id: String,
    #[serde(rename = "threadDepth")]
    pub thread_depth: u64,
    pub broadcast: bool,
    #[serde(rename = "replyCount")]
    pub reply_count: u64,
    #[serde(rename = "descendantCount")]
    pub descendant_count: u64,
    #[serde(rename = "lastReplyAt")]
    pub last_reply_at: Option<String>,
    #[serde(rename = "currentVersion")]
    pub current_version: Option<u64>,
    #[serde(rename = "retractionKind")]
    pub retraction_kind: Option<MessageViewRetractionKind>,
    #[serde(rename = "retractedAt")]
    pub retracted_at: Option<String>,
    #[serde(rename = "eraseAfter")]
    pub erase_after: Option<String>,
    #[serde(rename = "publicReason")]
    pub public_reason: Option<String>,
    #[serde(rename = "erasedAt")]
    pub erased_at: Option<String>,
    pub revision: u64,
    #[serde(rename = "createdCursor")]
    pub created_cursor: u64,
    pub cursor: u64,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    #[serde(rename = "editedAt")]
    pub edited_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MessageHistoryResponse {
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    #[serde(rename = "conversationId")]
    pub conversation_id: String,
    #[serde(rename = "highWaterCursor")]
    pub high_water_cursor: u64,
    #[serde(
        rename = "order",
        deserialize_with = "const_checkers::expect_const_created_cursor_ascending"
    )]
    pub order: String,
    pub items: Vec<MessageView>,
    #[serde(rename = "nextCursor")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PunkPunk {
    #[serde(
        rename = "kind",
        deserialize_with = "const_checkers::expect_const_punk"
    )]
    pub kind: String,
    #[serde(rename = "punkId")]
    pub punk_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BotBot {
    #[serde(rename = "kind", deserialize_with = "const_checkers::expect_const_bot")]
    pub kind: String,
    #[serde(rename = "installationId")]
    pub installation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum ResolveAuthorsQueryActor {
    Punk(PunkPunk),
    Bot(BotBot),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ResolveAuthorsQuery {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_author_resolve_1"
    )]
    pub contract: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    pub authors: Vec<ResolveAuthorsQueryActor>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PunkPunk2 {
    #[serde(
        rename = "kind",
        deserialize_with = "const_checkers::expect_const_punk"
    )]
    pub kind: String,
    #[serde(rename = "punkId")]
    pub punk_id: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "avatarUrl")]
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BotBot2 {
    #[serde(rename = "kind", deserialize_with = "const_checkers::expect_const_bot")]
    pub kind: String,
    #[serde(rename = "installationId")]
    pub installation_id: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "avatarUrl")]
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum ResolveAuthorsResponseAuthorSummary {
    Punk(PunkPunk2),
    Bot(BotBot2),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ResolveAuthorsResponse {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_author_resolve_response_1"
    )]
    pub contract: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    pub authors: Vec<ResolveAuthorsResponseAuthorSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FollowConversationQuery {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_conversation_follow_1"
    )]
    pub contract: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    #[serde(rename = "conversationId")]
    pub conversation_id: String,
    #[serde(rename = "afterCursor")]
    pub after_cursor: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Accepted {
    #[serde(
        rename = "schemaVersion",
        deserialize_with = "const_checkers::expect_const_u1"
    )]
    pub schema_version: u64,
    #[serde(
        rename = "type",
        deserialize_with = "const_checkers::expect_const_accepted"
    )]
    pub r#type: String,
    #[serde(rename = "resumeAfterCursor")]
    pub resume_after_cursor: u64,
    #[serde(rename = "targetHighWaterCursor")]
    pub target_high_water_cursor: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ConversationFollowServerFrameThreadPatch {
    #[serde(rename = "messageId")]
    pub message_id: String,
    #[serde(rename = "replyCount")]
    pub reply_count: u64,
    #[serde(rename = "descendantCount")]
    pub descendant_count: u64,
    #[serde(rename = "lastReplyAt")]
    pub last_reply_at: Option<String>,
    pub revision: u64,
    pub cursor: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ConversationFollowServerFrameCanonicalReaction {
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ConversationFollowServerFrameReactionPatch {
    #[serde(rename = "messageId")]
    pub message_id: String,
    pub reaction: ConversationFollowServerFrameCanonicalReaction,
    pub count: u64,
    #[serde(rename = "reactedByPunk")]
    pub reacted_by_punk: bool,
    pub cursor: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ConversationFollowServerFrameReactionCollectionPatchVisibility {
    #[serde(rename = "visible")]
    Visible,
    #[serde(rename = "temporarily-hidden")]
    TemporarilyHidden,
    #[serde(rename = "permanently-hidden")]
    PermanentlyHidden,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ConversationFollowServerFrameReactionCollectionPatch {
    #[serde(rename = "messageId")]
    pub message_id: String,
    pub visibility: ConversationFollowServerFrameReactionCollectionPatchVisibility,
    pub cursor: u64,
    #[serde(rename = "refreshRequired")]
    pub refresh_required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Changes {
    #[serde(
        rename = "schemaVersion",
        deserialize_with = "const_checkers::expect_const_u1"
    )]
    pub schema_version: u64,
    #[serde(
        rename = "type",
        deserialize_with = "const_checkers::expect_const_changes"
    )]
    pub r#type: String,
    #[serde(rename = "fromExclusiveCursor")]
    pub from_exclusive_cursor: u64,
    #[serde(rename = "throughCursor")]
    pub through_cursor: u64,
    pub messages: Vec<MessageView>,
    #[serde(rename = "threadPatches")]
    pub thread_patches: Vec<ConversationFollowServerFrameThreadPatch>,
    #[serde(rename = "reactionPatches")]
    pub reaction_patches: Vec<ConversationFollowServerFrameReactionPatch>,
    #[serde(rename = "reactionCollectionPatches")]
    pub reaction_collection_patches: Vec<ConversationFollowServerFrameReactionCollectionPatch>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Ready {
    #[serde(
        rename = "schemaVersion",
        deserialize_with = "const_checkers::expect_const_u1"
    )]
    pub schema_version: u64,
    #[serde(
        rename = "type",
        deserialize_with = "const_checkers::expect_const_ready"
    )]
    pub r#type: String,
    #[serde(rename = "highWaterCursor")]
    pub high_water_cursor: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ResyncRequiredReason {
    #[serde(rename = "history_required")]
    HistoryRequired,
    #[serde(rename = "slow_consumer")]
    SlowConsumer,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ResyncRequired {
    #[serde(
        rename = "schemaVersion",
        deserialize_with = "const_checkers::expect_const_u1"
    )]
    pub schema_version: u64,
    #[serde(
        rename = "type",
        deserialize_with = "const_checkers::expect_const_resync_required"
    )]
    pub r#type: String,
    pub reason: ResyncRequiredReason,
    #[serde(rename = "afterCursor")]
    pub after_cursor: u64,
    #[serde(rename = "highWaterCursor")]
    pub high_water_cursor: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ConversationUnavailable {
    #[serde(
        rename = "schemaVersion",
        deserialize_with = "const_checkers::expect_const_u1"
    )]
    pub schema_version: u64,
    #[serde(
        rename = "type",
        deserialize_with = "const_checkers::expect_const_conversation_unavailable"
    )]
    pub r#type: String,
    #[serde(
        rename = "reason",
        deserialize_with = "const_checkers::expect_const_archived"
    )]
    pub reason: String,
    pub cursor: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum ConversationFollowServerFrame {
    Accepted(Accepted),
    Changes(Changes),
    Ready(Ready),
    ResyncRequired(ResyncRequired),
    ConversationUnavailable(ConversationUnavailable),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ConversationFollowClientFrame {
    #[serde(
        rename = "schemaVersion",
        deserialize_with = "const_checkers::expect_const_u1"
    )]
    pub schema_version: u64,
    #[serde(rename = "type", deserialize_with = "const_checkers::expect_const_ack")]
    pub r#type: String,
    #[serde(rename = "throughCursor")]
    pub through_cursor: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PunkPunk3 {
    #[serde(
        rename = "kind",
        deserialize_with = "const_checkers::expect_const_punk"
    )]
    pub kind: String,
    #[serde(rename = "punkId")]
    pub punk_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BotBot3 {
    #[serde(rename = "kind", deserialize_with = "const_checkers::expect_const_bot")]
    pub kind: String,
    #[serde(rename = "installationId")]
    pub installation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum PostMessageCommandActor {
    Punk(PunkPunk3),
    Bot(BotBot3),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PostMessageCommand {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_message_post_1"
    )]
    pub contract: String,
    #[serde(rename = "commandId")]
    pub command_id: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    #[serde(rename = "conversationId")]
    pub conversation_id: String,
    pub actor: PostMessageCommandActor,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PostMessageResponse {
    pub message: MessageView,
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PunkPunk4 {
    #[serde(
        rename = "kind",
        deserialize_with = "const_checkers::expect_const_punk"
    )]
    pub kind: String,
    #[serde(rename = "punkId")]
    pub punk_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BotBot4 {
    #[serde(rename = "kind", deserialize_with = "const_checkers::expect_const_bot")]
    pub kind: String,
    #[serde(rename = "installationId")]
    pub installation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum AddMessageReactionCommandActor {
    Punk(PunkPunk4),
    Bot(BotBot4),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AddMessageReactionCommandPayload {
    pub reaction: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AddMessageReactionCommand {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_message_reaction_add_1"
    )]
    pub contract: String,
    #[serde(rename = "commandId")]
    pub command_id: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    #[serde(rename = "conversationId")]
    pub conversation_id: String,
    #[serde(rename = "messageId")]
    pub message_id: String,
    pub actor: AddMessageReactionCommandActor,
    pub payload: AddMessageReactionCommandPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PunkPunk5 {
    #[serde(
        rename = "kind",
        deserialize_with = "const_checkers::expect_const_punk"
    )]
    pub kind: String,
    #[serde(rename = "punkId")]
    pub punk_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BotBot5 {
    #[serde(rename = "kind", deserialize_with = "const_checkers::expect_const_bot")]
    pub kind: String,
    #[serde(rename = "installationId")]
    pub installation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum MessageReactionMutationResponseActor {
    Punk(PunkPunk5),
    Bot(BotBot5),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MessageReactionMutationResponseCanonicalReaction {
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MessageReactionMutationResponseView {
    pub id: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    #[serde(rename = "conversationId")]
    pub conversation_id: String,
    #[serde(rename = "messageId")]
    pub message_id: String,
    pub actor: MessageReactionMutationResponseActor,
    pub reaction: MessageReactionMutationResponseCanonicalReaction,
    #[serde(rename = "reactedAt")]
    pub reacted_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum MessageReactionMutationResponseEffect {
    #[serde(rename = "added")]
    Added,
    #[serde(rename = "removed")]
    Removed,
    #[serde(rename = "unchanged")]
    Unchanged,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MessageReactionMutationResponse {
    pub reaction: Option<MessageReactionMutationResponseView>,
    pub effect: MessageReactionMutationResponseEffect,
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PunkPunk6 {
    #[serde(
        rename = "kind",
        deserialize_with = "const_checkers::expect_const_punk"
    )]
    pub kind: String,
    #[serde(rename = "punkId")]
    pub punk_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BotBot6 {
    #[serde(rename = "kind", deserialize_with = "const_checkers::expect_const_bot")]
    pub kind: String,
    #[serde(rename = "installationId")]
    pub installation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum RemoveMessageReactionCommandActor {
    Punk(PunkPunk6),
    Bot(BotBot6),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RemoveMessageReactionCommandPayload {
    pub reaction: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RemoveMessageReactionCommand {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_message_reaction_remove_1"
    )]
    pub contract: String,
    #[serde(rename = "commandId")]
    pub command_id: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    #[serde(rename = "conversationId")]
    pub conversation_id: String,
    #[serde(rename = "messageId")]
    pub message_id: String,
    pub actor: RemoveMessageReactionCommandActor,
    pub payload: RemoveMessageReactionCommandPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ConversationType {
    #[serde(rename = "stream")]
    Stream,
    #[serde(rename = "forum")]
    Forum,
    #[serde(rename = "dm")]
    Dm,
    #[serde(rename = "workflow")]
    Workflow,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ConversationVisibility {
    #[serde(rename = "open")]
    Open,
    #[serde(rename = "private")]
    Private,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ConversationStatus {
    #[serde(rename = "active")]
    Active,
    #[serde(rename = "archived")]
    Archived,
    #[serde(rename = "deleting")]
    Deleting,
    #[serde(rename = "deleted")]
    Deleted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub r#type: ConversationType,
    pub visibility: ConversationVisibility,
    pub description: Option<String>,
    pub topic: Option<String>,
    pub purpose: Option<String>,
    #[serde(rename = "topicRequired")]
    pub topic_required: bool,
    #[serde(rename = "maxMembers")]
    pub max_members: Option<u64>,
    #[serde(rename = "ttlSeconds")]
    pub ttl_seconds: Option<u64>,
    #[serde(rename = "ttlDeadline")]
    pub ttl_deadline: Option<String>,
    #[serde(rename = "ownerPunkId")]
    pub owner_punk_id: String,
    pub members: Vec<serde_json::Value>,
    pub status: ConversationStatus,
    pub revision: u64,
    pub cursor: u64,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    #[serde(rename = "archivedAt")]
    pub archived_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PunksProblemCode {
    #[serde(rename = "invalid_input")]
    InvalidInput,
    #[serde(rename = "payload_too_large")]
    PayloadTooLarge,
    #[serde(rename = "unauthenticated")]
    Unauthenticated,
    #[serde(rename = "forbidden")]
    Forbidden,
    #[serde(rename = "not_found")]
    NotFound,
    #[serde(rename = "slug_claimed")]
    SlugClaimed,
    #[serde(rename = "idempotency_conflict")]
    IdempotencyConflict,
    #[serde(rename = "identity_conflict")]
    IdentityConflict,
    #[serde(rename = "command_in_progress")]
    CommandInProgress,
    #[serde(rename = "attestation_failed")]
    AttestationFailed,
    #[serde(rename = "temporarily_unavailable")]
    TemporarilyUnavailable,
    #[serde(rename = "internal")]
    Internal,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PunksProblemRetry {
    #[serde(rename = "never")]
    Never,
    #[serde(rename = "same_command")]
    SameCommand,
    #[serde(rename = "later")]
    Later,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PunksProblem {
    #[serde(rename = "type")]
    pub r#type: String,
    pub title: String,
    pub status: u64,
    pub code: PunksProblemCode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(rename = "correlationId")]
    pub correlation_id: String,
    pub retry: PunksProblemRetry,
    #[serde(rename = "retryAfterMs")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_after_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AccountMergeFreshProofAccountRole {
    #[serde(rename = "survivor")]
    Survivor,
    #[serde(rename = "absorbed")]
    Absorbed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AccountMergeFreshProofAuthenticationMethod {
    #[serde(rename = "google")]
    Google,
    #[serde(rename = "github")]
    Github,
    #[serde(rename = "passkey")]
    Passkey,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AccountMergeFreshProof {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_account_merge_fresh_proof_1"
    )]
    pub contract: String,
    #[serde(rename = "proofId")]
    pub proof_id: String,
    #[serde(rename = "intentId")]
    pub intent_id: String,
    #[serde(rename = "accountRole")]
    pub account_role: AccountMergeFreshProofAccountRole,
    #[serde(rename = "punkId")]
    pub punk_id: String,
    #[serde(rename = "accountRevision")]
    pub account_revision: u64,
    #[serde(rename = "holderBindingHash")]
    pub holder_binding_hash: String,
    #[serde(rename = "authenticationMethod")]
    pub authentication_method: AccountMergeFreshProofAuthenticationMethod,
    #[serde(rename = "providerSubjectBindingHash")]
    pub provider_subject_binding_hash: String,
    #[serde(rename = "authenticatedAt")]
    pub authenticated_at: String,
    #[serde(rename = "expiresAt")]
    pub expires_at: String,
    #[serde(
        rename = "validForSeconds",
        deserialize_with = "const_checkers::expect_const_u300"
    )]
    pub valid_for_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CreateAccountMergePlanCommand {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_account_merge_plan_create_1"
    )]
    pub contract: String,
    #[serde(rename = "commandId")]
    pub command_id: String,
    #[serde(rename = "intentId")]
    pub intent_id: String,
    #[serde(rename = "survivorPunkId")]
    pub survivor_punk_id: String,
    #[serde(rename = "absorbedPunkId")]
    pub absorbed_punk_id: String,
    #[serde(rename = "holderBindingHash")]
    pub holder_binding_hash: String,
    pub proofs: Vec<AccountMergeFreshProof>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AccountMergePlanAccountRevisions {
    pub survivor: u64,
    pub absorbed: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AccountMergePlanProofBindings {
    #[serde(rename = "survivorProofId")]
    pub survivor_proof_id: String,
    #[serde(rename = "absorbedProofId")]
    pub absorbed_proof_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AccountMergePlanClaimEffectKind {
    #[serde(rename = "provider-subject")]
    ProviderSubject,
    #[serde(rename = "verified-email")]
    VerifiedEmail,
    #[serde(rename = "passkey-credential")]
    PasskeyCredential,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AccountMergePlanClaimEffectProvider {
    #[serde(rename = "google")]
    Google,
    #[serde(rename = "github")]
    Github,
    #[serde(rename = "passkey")]
    Passkey,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AccountMergePlanOrigin {
    #[serde(rename = "survivor")]
    Survivor,
    #[serde(rename = "absorbed")]
    Absorbed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AccountMergePlanClaimEffectDisposition {
    #[serde(rename = "preserve")]
    Preserve,
    #[serde(rename = "transfer")]
    Transfer,
    #[serde(rename = "deduplicate")]
    Deduplicate,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AccountMergePlanClaimEffect {
    #[serde(rename = "claimBindingHash")]
    pub claim_binding_hash: String,
    pub kind: AccountMergePlanClaimEffectKind,
    pub provider: AccountMergePlanClaimEffectProvider,
    pub origin: AccountMergePlanOrigin,
    pub disposition: AccountMergePlanClaimEffectDisposition,
    #[serde(rename = "duplicateOfBindingHash")]
    pub duplicate_of_binding_hash: Option<String>,
    #[serde(rename = "expectedRevision")]
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AccountMergePlanRightEffectKind {
    #[serde(rename = "workspace-membership")]
    WorkspaceMembership,
    #[serde(rename = "workspace-invitation")]
    WorkspaceInvitation,
    #[serde(rename = "account-owned-resource")]
    AccountOwnedResource,
    #[serde(rename = "local-resource-binding")]
    LocalResourceBinding,
    #[serde(rename = "local-tool-authorization")]
    LocalToolAuthorization,
    #[serde(rename = "repository-access-proof")]
    RepositoryAccessProof,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AccountMergePlanRightEffectDisposition {
    #[serde(rename = "preserve")]
    Preserve,
    #[serde(rename = "transfer")]
    Transfer,
    #[serde(rename = "deduplicate")]
    Deduplicate,
    #[serde(rename = "retarget")]
    Retarget,
    #[serde(rename = "invalidate")]
    Invalidate,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AccountMergePlanRightEffectRole {
    #[serde(rename = "owner")]
    Owner,
    #[serde(rename = "moderator")]
    Moderator,
    #[serde(rename = "member")]
    Member,
    #[serde(rename = "guest")]
    Guest,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AccountMergePlanRightEffectResultingRole {
    #[serde(rename = "owner")]
    Owner,
    #[serde(rename = "moderator")]
    Moderator,
    #[serde(rename = "member")]
    Member,
    #[serde(rename = "guest")]
    Guest,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AccountMergePlanRightEffect {
    #[serde(rename = "rightBindingHash")]
    pub right_binding_hash: String,
    pub kind: AccountMergePlanRightEffectKind,
    #[serde(rename = "authorityBindingHash")]
    pub authority_binding_hash: String,
    pub origin: AccountMergePlanOrigin,
    #[serde(rename = "originPunkId")]
    pub origin_punk_id: String,
    pub disposition: AccountMergePlanRightEffectDisposition,
    pub role: Option<AccountMergePlanRightEffectRole>,
    #[serde(rename = "resultingRole")]
    pub resulting_role: Option<AccountMergePlanRightEffectResultingRole>,
    #[serde(rename = "expectedRevision")]
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AccountMergePlanSessionEffectClientKind {
    #[serde(rename = "browser")]
    Browser,
    #[serde(rename = "desktop")]
    Desktop,
    #[serde(rename = "mobile")]
    Mobile,
    #[serde(rename = "api")]
    Api,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AccountMergePlanSessionEffect {
    #[serde(rename = "sessionBindingHash")]
    pub session_binding_hash: String,
    pub origin: AccountMergePlanOrigin,
    #[serde(rename = "clientKind")]
    pub client_kind: AccountMergePlanSessionEffectClientKind,
    #[serde(
        rename = "action",
        deserialize_with = "const_checkers::expect_const_revoke"
    )]
    pub action: String,
    #[serde(rename = "authenticatedAt")]
    pub authenticated_at: String,
    #[serde(rename = "expiresAt")]
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AccountMergePlanHandoffEffectKind {
    #[serde(rename = "desktop-auth-flow")]
    DesktopAuthFlow,
    #[serde(rename = "oauth-transaction")]
    OauthTransaction,
    #[serde(rename = "passkey-ceremony")]
    PasskeyCeremony,
    #[serde(rename = "reauth-authorization")]
    ReauthAuthorization,
    #[serde(rename = "session-renewal")]
    SessionRenewal,
    #[serde(rename = "account-link")]
    AccountLink,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AccountMergePlanHandoffEffectState {
    #[serde(rename = "pending")]
    Pending,
    #[serde(rename = "prepared")]
    Prepared,
    #[serde(rename = "deliverable")]
    Deliverable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AccountMergePlanHandoffEffect {
    #[serde(rename = "handoffBindingHash")]
    pub handoff_binding_hash: String,
    pub origin: AccountMergePlanOrigin,
    pub kind: AccountMergePlanHandoffEffectKind,
    pub state: AccountMergePlanHandoffEffectState,
    #[serde(
        rename = "action",
        deserialize_with = "const_checkers::expect_const_cancel"
    )]
    pub action: String,
    #[serde(rename = "expiresAt")]
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AccountMergePlanConflictKind {
    #[serde(rename = "identical-claim")]
    IdenticalClaim,
    #[serde(rename = "workspace-role")]
    WorkspaceRole,
    #[serde(rename = "workspace-owner")]
    WorkspaceOwner,
    #[serde(rename = "duplicate-invitation")]
    DuplicateInvitation,
    #[serde(rename = "account-owned-resource")]
    AccountOwnedResource,
    #[serde(rename = "in-flight-sensitive-action")]
    InFlightSensitiveAction,
    #[serde(rename = "missing-strategy")]
    MissingStrategy,
    #[serde(rename = "alias-cycle")]
    AliasCycle,
    #[serde(rename = "authority-unavailable")]
    AuthorityUnavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AccountMergePlanConflictResolution {
    #[serde(rename = "deduplicate")]
    Deduplicate,
    #[serde(rename = "strongest-role")]
    StrongestRole,
    #[serde(rename = "retarget-invitation")]
    RetargetInvitation,
    #[serde(rename = "preserve-workspace-ownership")]
    PreserveWorkspaceOwnership,
    #[serde(rename = "await-terminal")]
    AwaitTerminal,
    #[serde(rename = "requires-adapter")]
    RequiresAdapter,
    #[serde(rename = "reject-plan")]
    RejectPlan,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AccountMergePlanConflict {
    #[serde(rename = "conflictBindingHash")]
    pub conflict_binding_hash: String,
    pub kind: AccountMergePlanConflictKind,
    #[serde(rename = "authorityBindingHash")]
    pub authority_binding_hash: String,
    pub resolution: AccountMergePlanConflictResolution,
    pub blocking: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AccountMergePlan {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_account_merge_plan_1"
    )]
    pub contract: String,
    #[serde(
        rename = "schemaVersion",
        deserialize_with = "const_checkers::expect_const_u1"
    )]
    pub schema_version: u64,
    #[serde(rename = "planId")]
    pub plan_id: String,
    #[serde(rename = "intentId")]
    pub intent_id: String,
    #[serde(rename = "planDigest")]
    pub plan_digest: String,
    #[serde(
        rename = "status",
        deserialize_with = "const_checkers::expect_const_planned"
    )]
    pub status: String,
    #[serde(rename = "generatedAt")]
    pub generated_at: String,
    #[serde(rename = "expiresAt")]
    pub expires_at: String,
    #[serde(rename = "validForSeconds")]
    pub valid_for_seconds: u64,
    #[serde(rename = "holderBindingHash")]
    pub holder_binding_hash: String,
    #[serde(
        rename = "strategy",
        deserialize_with = "const_checkers::expect_const_preserve_origin"
    )]
    pub strategy: String,
    #[serde(rename = "survivorPunkId")]
    pub survivor_punk_id: String,
    #[serde(rename = "absorbedPunkId")]
    pub absorbed_punk_id: String,
    #[serde(rename = "accountRevisions")]
    pub account_revisions: AccountMergePlanAccountRevisions,
    #[serde(rename = "proofBindings")]
    pub proof_bindings: AccountMergePlanProofBindings,
    pub claims: Vec<AccountMergePlanClaimEffect>,
    pub rights: Vec<AccountMergePlanRightEffect>,
    pub sessions: Vec<AccountMergePlanSessionEffect>,
    pub handoffs: Vec<AccountMergePlanHandoffEffect>,
    pub conflicts: Vec<AccountMergePlanConflict>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AccountMergePlanResponseSuccess {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_account_merge_plan_response_1"
    )]
    pub contract: String,
    #[serde(
        rename = "ok",
        deserialize_with = "const_checkers::expect_const_r_true"
    )]
    pub ok: bool,
    #[serde(
        rename = "status",
        deserialize_with = "const_checkers::expect_const_planned"
    )]
    pub status: String,
    pub plan: AccountMergePlan,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AccountMergePlanResponseFailure {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_account_merge_plan_response_1"
    )]
    pub contract: String,
    #[serde(
        rename = "ok",
        deserialize_with = "const_checkers::expect_const_r_false"
    )]
    pub ok: bool,
    #[serde(
        rename = "code",
        deserialize_with = "const_checkers::expect_const_plan_unavailable"
    )]
    pub code: String,
    #[serde(rename = "correlationId")]
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum AccountMergePlanResponse {
    AccountMergePlanResponseSuccess(AccountMergePlanResponseSuccess),
    AccountMergePlanResponseFailure(AccountMergePlanResponseFailure),
}

/// Décode tout contrat du profil par le même chemin de production.
pub fn decode_profile_contract(contract: &str, payload: serde_json::Value) -> Result<(), String> {
    match contract {
        "punks://contracts/desktop.compatibility@1" => {
            serde_json::from_value::<DesktopCompatibilityQuery>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/desktop.compatibility-response@1" => {
            serde_json::from_value::<DesktopCompatibilityResponse>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/auth.session@1" => serde_json::from_value::<AuthSession>(payload)
            .map(|_| ())
            .map_err(|error| error.to_string()),
        "punks://contracts/desktop-auth.start@1" => {
            serde_json::from_value::<DesktopAuthStartExchange>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/desktop-auth.status@1" => {
            serde_json::from_value::<DesktopAuthStatusExchange>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/desktop-auth.claim@1" => {
            serde_json::from_value::<DesktopAuthClaimExchange>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/desktop-auth.confirm@1" => {
            serde_json::from_value::<DesktopAuthConfirmExchange>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/desktop-auth.cancel@1" => {
            serde_json::from_value::<DesktopAuthCancelExchange>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/desktop-session.renew@1" => {
            serde_json::from_value::<DesktopSessionRenewExchange>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/desktop-session.revoke@1" => {
            serde_json::from_value::<DesktopSessionRevokeExchange>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/workspace.list@1" => {
            serde_json::from_value::<ListWorkspacesQuery>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/workspace.list-response@1" => {
            serde_json::from_value::<ListWorkspacesResponse>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/workspace.get@1" => serde_json::from_value::<GetWorkspaceQuery>(payload)
            .map(|_| ())
            .map_err(|error| error.to_string()),
        "punks://contracts/workspace@1" => serde_json::from_value::<Workspace>(payload)
            .map(|_| ())
            .map_err(|error| error.to_string()),
        "punks://contracts/conversation.list@1" => {
            serde_json::from_value::<ListConversationsQuery>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/conversation.list-response@1" => {
            serde_json::from_value::<ListConversationsResponse>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/conversation.get@1" => {
            serde_json::from_value::<GetConversationQuery>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/conversation.view@1" => {
            serde_json::from_value::<ConversationView>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/message.history@1" => {
            serde_json::from_value::<MessageHistoryQuery>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/message.history-response@1" => {
            serde_json::from_value::<MessageHistoryResponse>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/author.resolve@1" => {
            serde_json::from_value::<ResolveAuthorsQuery>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/author.resolve-response@1" => {
            serde_json::from_value::<ResolveAuthorsResponse>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/conversation.follow@1" => {
            serde_json::from_value::<FollowConversationQuery>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/conversation.follow-server-frame@1" => {
            serde_json::from_value::<ConversationFollowServerFrame>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/conversation.follow-client-frame@1" => {
            serde_json::from_value::<ConversationFollowClientFrame>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/message.post@1" => serde_json::from_value::<PostMessageCommand>(payload)
            .map(|_| ())
            .map_err(|error| error.to_string()),
        "punks://contracts/message.post-response@1" => {
            serde_json::from_value::<PostMessageResponse>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/message.reaction-add@1" => {
            serde_json::from_value::<AddMessageReactionCommand>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/message.reaction-mutation-response@1" => {
            serde_json::from_value::<MessageReactionMutationResponse>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/message.reaction-remove@1" => {
            serde_json::from_value::<RemoveMessageReactionCommand>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/conversation@1" => serde_json::from_value::<Conversation>(payload)
            .map(|_| ())
            .map_err(|error| error.to_string()),
        "punks://contracts/problem@1" => serde_json::from_value::<PunksProblem>(payload)
            .map(|_| ())
            .map_err(|error| error.to_string()),
        "punks://contracts/account-merge.fresh-proof@1" => {
            serde_json::from_value::<AccountMergeFreshProof>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/account-merge.plan-create@1" => {
            serde_json::from_value::<CreateAccountMergePlanCommand>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/account-merge.plan@1" => {
            serde_json::from_value::<AccountMergePlan>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/account-merge.plan-response@1" => {
            serde_json::from_value::<AccountMergePlanResponse>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        _ => Err(format!("contrat hors profil : {contract}")),
    }
}

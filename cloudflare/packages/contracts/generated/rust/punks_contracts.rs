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

    pub(super) fn expect_const_typing<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "typing" {
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

    pub(super) fn expect_const_media_upload_grant_create_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "media-upload.grant-create@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_message_attachment<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "message_attachment" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_media_upload_grant_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "media-upload.grant@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_punks_upload<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "PunksUpload" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_media_upload_part_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "media-upload.part@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_media_upload_finalize_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "media-upload.finalize@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_media_upload_abandon_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "media-upload.abandon@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_media_upload_status_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "media-upload.status@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_u8388608<'de, D>(deserializer: D) -> Result<u64, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = u64::deserialize(deserializer)?;
        if value == 8388608 {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_punk_get_1<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "punk.get@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_punk_update_1<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "punk.update@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_punk_summary_batch_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "punk.summary-batch@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_punk_summary_batch_response_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "punk.summary-batch-response@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_punk_search_1<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "punk.search@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_prefix<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "prefix" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_punk_id<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "punk_id" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_punk_search_response_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "punk.search-response@1" {
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

    pub(super) fn expect_const_account_merge_commit_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "account-merge.commit@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_merge_accounts_irreversibly<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "merge_accounts_irreversibly" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_account_merge_receipt_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "account-merge.receipt@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_account_merge_state_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "account-merge.state@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_account_merge_commit_response_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "account-merge.commit-response@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_workspace_member_set_role_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "workspace.member-set-role@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_workspace_governance_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "workspace.governance@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_workspace_governance_view_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "workspace.governance-view@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_workspace_governance_response_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "workspace.governance-response@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_workspace_member_remove_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "workspace.member-remove@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_workspace_leave_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "workspace.leave@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_workspace_transfer_ownership_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "workspace.transfer-ownership@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_workspace_membership_mutation_response_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "workspace.membership-mutation-response@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_workspace_membership_lifecycle_response_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "workspace.membership-lifecycle-response@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_workspace_invitation_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "workspace.invitation@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_workspace_invite_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "workspace.invite@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_workspace_invite_get_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "workspace.invite-get@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_workspace_invite_response_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "workspace.invite-response@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_workspace_invite_revoke_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "workspace.invite-revoke@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_workspace_invite_revoke_response_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "workspace.invite-revoke-response@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_workspace_invite_claim_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "workspace.invite-claim@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_workspace_invite_claim_response_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "workspace.invite-claim-response@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_presence_hold_1<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "presence.hold@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_hold<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "hold" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_heartbeat<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "heartbeat" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_presence_status_set_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "presence.status.set@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_presence_typing_signal_1<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "presence.typing.signal@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_presence<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "presence" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_realtime_degraded<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "realtime-degraded" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_realtime_degradedRealtimeDegraded<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "realtime_degraded" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_message_search_1<'de, D>(deserializer: D) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "message.search@1" {
            Ok(value)
        } else {
            Err(de::Error::custom("unexpected constant"))
        }
    }

    pub(super) fn expect_const_created_cursor_descending<'de, D>(
        deserializer: D,
    ) -> Result<String, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == "createdCursor-descending" {
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
pub struct AuthSessionPunk {
    pub id: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "avatarUrl")]
    pub avatar_url: Option<String>,
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
    pub punk: AuthSessionPunk,
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
    #[serde(rename = "transfer_workspace_ownership")]
    TransferWorkspaceOwnership,
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
pub struct DesktopAuthClaimExchangeSessionPunk {
    pub id: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "avatarUrl")]
    pub avatar_url: Option<String>,
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
    pub punk: DesktopAuthClaimExchangeSessionPunk,
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
    #[serde(rename = "transfer_workspace_ownership")]
    TransferWorkspaceOwnership,
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
pub struct DesktopSessionRenewExchangeSessionPunk {
    pub id: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "avatarUrl")]
    pub avatar_url: Option<String>,
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
    pub punk: DesktopSessionRenewExchangeSessionPunk,
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
#[serde(rename_all = "camelCase")]
pub enum WorkspaceMembersRole {
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
pub struct WorkspaceMembers {
    #[serde(rename = "punkId")]
    pub punk_id: String,
    pub role: WorkspaceMembersRole,
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
    pub members: Vec<WorkspaceMembers>,
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
pub struct Bot {
    #[serde(rename = "kind", deserialize_with = "const_checkers::expect_const_bot")]
    pub kind: String,
    #[serde(rename = "installationId")]
    pub installation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum MessageViewActor {
    Punk(PunkPunk),
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
pub struct PunkPunk2 {
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
    Punk(PunkPunk2),
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
pub struct PunkPunk3 {
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
    Punk(PunkPunk3),
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
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ConversationFollowServerFrameCanonicalReaction {}

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
pub struct Typing {
    #[serde(
        rename = "schemaVersion",
        deserialize_with = "const_checkers::expect_const_u1"
    )]
    pub schema_version: u64,
    #[serde(
        rename = "type",
        deserialize_with = "const_checkers::expect_const_typing"
    )]
    pub r#type: String,
    pub patch: PresenceTypingPatch,
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
    Typing(Typing),
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
pub struct BotBot3 {
    #[serde(rename = "kind", deserialize_with = "const_checkers::expect_const_bot")]
    pub kind: String,
    #[serde(rename = "installationId")]
    pub installation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum PostMessageCommandActor {
    Punk(PunkPunk4),
    Bot(BotBot3),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PostMessageCommandPayload {
    pub content: String,
    #[serde(rename = "replyToMessageId")]
    pub reply_to_message_id: Option<String>,
    pub broadcast: bool,
    pub topic: Option<String>,
    #[serde(rename = "mentionedPunkIds")]
    pub mentioned_punk_ids: Vec<String>,
    #[serde(rename = "mediaIds")]
    pub media_ids: Vec<String>,
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
    pub payload: PostMessageCommandPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PostMessageResponse {
    pub message: MessageView,
    pub replayed: bool,
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
pub struct BotBot4 {
    #[serde(rename = "kind", deserialize_with = "const_checkers::expect_const_bot")]
    pub kind: String,
    #[serde(rename = "installationId")]
    pub installation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum AddMessageReactionCommandActor {
    Punk(PunkPunk5),
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
pub struct BotBot5 {
    #[serde(rename = "kind", deserialize_with = "const_checkers::expect_const_bot")]
    pub kind: String,
    #[serde(rename = "installationId")]
    pub installation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum MessageReactionMutationResponseActor {
    Punk(PunkPunk6),
    Bot(BotBot5),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MessageReactionMutationResponseCanonicalReaction {}

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
pub struct PunkPunk7 {
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
    Punk(PunkPunk7),
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
pub enum ConversationMembersAccess {
    #[serde(rename = "owner")]
    Owner,
    #[serde(rename = "manager")]
    Manager,
    #[serde(rename = "member")]
    Member,
    #[serde(rename = "guest")]
    Guest,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ConversationMembers {
    #[serde(rename = "punkId")]
    pub punk_id: String,
    pub access: ConversationMembersAccess,
    #[serde(rename = "joinedAt")]
    pub joined_at: String,
    #[serde(rename = "invitedByPunkId")]
    pub invited_by_punk_id: Option<String>,
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
    pub members: Vec<ConversationMembers>,
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
    #[serde(rename = "account_merged")]
    AccountMerged,
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
    #[serde(rename = "revision_conflict")]
    RevisionConflict,
    #[serde(rename = "invalid_transition")]
    InvalidTransition,
    #[serde(rename = "invite_invalid")]
    InviteInvalid,
    #[serde(rename = "invite_expired")]
    InviteExpired,
    #[serde(rename = "invite_exhausted")]
    InviteExhausted,
    #[serde(rename = "invite_revoked")]
    InviteRevoked,
    #[serde(rename = "invite_role_forbidden")]
    InviteRoleForbidden,
    #[serde(rename = "query_too_short")]
    QueryTooShort,
    #[serde(rename = "command_in_progress")]
    CommandInProgress,
    #[serde(rename = "storage_unavailable")]
    StorageUnavailable,
    #[serde(rename = "upload_hash_invalid")]
    UploadHashInvalid,
    #[serde(rename = "upload_conflict")]
    UploadConflict,
    #[serde(rename = "upload_ambiguous")]
    UploadAmbiguous,
    #[serde(rename = "upload_expired")]
    UploadExpired,
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
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CreateMediaUploadGrantCommandActor {
    #[serde(
        rename = "kind",
        deserialize_with = "const_checkers::expect_const_punk"
    )]
    pub kind: String,
    #[serde(rename = "punkId")]
    pub punk_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum CreateMediaUploadGrantCommandPayloadContentType {
    #[serde(rename = "application/json")]
    ApplicationJson,
    #[serde(rename = "application/pdf")]
    ApplicationPdf,
    #[serde(rename = "application/zip")]
    ApplicationZip,
    #[serde(rename = "audio/mpeg")]
    AudioMpeg,
    #[serde(rename = "audio/ogg")]
    AudioOgg,
    #[serde(rename = "audio/wav")]
    AudioWav,
    #[serde(rename = "audio/webm")]
    AudioWebm,
    #[serde(rename = "image/avif")]
    ImageAvif,
    #[serde(rename = "image/gif")]
    ImageGif,
    #[serde(rename = "image/jpeg")]
    ImageJpeg,
    #[serde(rename = "image/png")]
    ImagePng,
    #[serde(rename = "image/webp")]
    ImageWebp,
    #[serde(rename = "text/csv")]
    TextCsv,
    #[serde(rename = "text/markdown")]
    TextMarkdown,
    #[serde(rename = "text/plain")]
    TextPlain,
    #[serde(rename = "video/mp4")]
    VideoMp4,
    #[serde(rename = "video/quicktime")]
    VideoQuicktime,
    #[serde(rename = "video/webm")]
    VideoWebm,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CreateMediaUploadGrantCommandPayload {
    #[serde(
        rename = "purpose",
        deserialize_with = "const_checkers::expect_const_message_attachment"
    )]
    pub purpose: String,
    #[serde(rename = "byteLength")]
    pub byte_length: u64,
    #[serde(rename = "contentType")]
    pub content_type: CreateMediaUploadGrantCommandPayloadContentType,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CreateMediaUploadGrantCommand {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_media_upload_grant_create_1"
    )]
    pub contract: String,
    #[serde(rename = "commandId")]
    pub command_id: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    pub actor: CreateMediaUploadGrantCommandActor,
    pub payload: CreateMediaUploadGrantCommandPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MediaUploadGrantCredential {
    #[serde(
        rename = "scheme",
        deserialize_with = "const_checkers::expect_const_punks_upload"
    )]
    pub scheme: String,
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MediaUploadGrantEndpoints {
    #[serde(rename = "partUrlTemplate")]
    pub part_url_template: String,
    #[serde(rename = "finalizeUrl")]
    pub finalize_url: String,
    #[serde(rename = "statusUrl")]
    pub status_url: String,
    #[serde(rename = "abandonUrl")]
    pub abandon_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MediaUploadGrant {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_media_upload_grant_1"
    )]
    pub contract: String,
    pub status: MediaUploadStatus,
    pub credential: MediaUploadGrantCredential,
    pub endpoints: MediaUploadGrantEndpoints,
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MediaUploadPart {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_media_upload_part_1"
    )]
    pub contract: String,
    #[serde(rename = "uploadId")]
    pub upload_id: String,
    #[serde(rename = "partNumber")]
    pub part_number: u64,
    #[serde(rename = "byteLength")]
    pub byte_length: u64,
    pub sha256: String,
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FinalizeMediaUploadCommandActor {
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
pub struct FinalizeMediaUploadCommand {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_media_upload_finalize_1"
    )]
    pub contract: String,
    #[serde(rename = "commandId")]
    pub command_id: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    #[serde(rename = "uploadId")]
    pub upload_id: String,
    pub actor: FinalizeMediaUploadCommandActor,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AbandonMediaUploadCommandActor {
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
pub struct AbandonMediaUploadCommand {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_media_upload_abandon_1"
    )]
    pub contract: String,
    #[serde(rename = "commandId")]
    pub command_id: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    #[serde(rename = "uploadId")]
    pub upload_id: String,
    pub actor: AbandonMediaUploadCommandActor,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum MediaUploadStatusState {
    #[serde(rename = "uploading")]
    Uploading,
    #[serde(rename = "finalizing")]
    Finalizing,
    #[serde(rename = "candidate")]
    Candidate,
    #[serde(rename = "cleanup_pending")]
    CleanupPending,
    #[serde(rename = "abandoned")]
    Abandoned,
    #[serde(rename = "expired")]
    Expired,
    #[serde(rename = "rejected")]
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MediaUploadStatusUploadedParts {
    #[serde(rename = "partNumber")]
    pub part_number: u64,
    #[serde(rename = "byteLength")]
    pub byte_length: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MediaUploadStatusCandidate {
    #[serde(rename = "mediaId")]
    pub media_id: String,
    #[serde(rename = "byteLength")]
    pub byte_length: u64,
    #[serde(rename = "contentType")]
    pub content_type: String,
    pub sha256: String,
    #[serde(rename = "finalizedAt")]
    pub finalized_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum MediaUploadStatusFailureCode {
    #[serde(rename = "storage_unavailable")]
    StorageUnavailable,
    #[serde(rename = "hash_invalid")]
    HashInvalid,
    #[serde(rename = "conflict")]
    Conflict,
    #[serde(rename = "ambiguous")]
    Ambiguous,
    #[serde(rename = "expired")]
    Expired,
    #[serde(rename = "abandoned")]
    Abandoned,
    #[serde(rename = "authorization_lost")]
    AuthorizationLost,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum MediaUploadStatusFailureRetry {
    #[serde(rename = "same_command")]
    SameCommand,
    #[serde(rename = "later")]
    Later,
    #[serde(rename = "new_intent")]
    NewIntent,
    #[serde(rename = "never")]
    Never,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MediaUploadStatusFailure {
    pub code: MediaUploadStatusFailureCode,
    pub retry: MediaUploadStatusFailureRetry,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MediaUploadStatus {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_media_upload_status_1"
    )]
    pub contract: String,
    #[serde(rename = "uploadId")]
    pub upload_id: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    #[serde(rename = "punkId")]
    pub punk_id: String,
    #[serde(
        rename = "purpose",
        deserialize_with = "const_checkers::expect_const_message_attachment"
    )]
    pub purpose: String,
    #[serde(rename = "byteLength")]
    pub byte_length: u64,
    #[serde(rename = "contentType")]
    pub content_type: String,
    pub sha256: String,
    #[serde(rename = "issuedAt")]
    pub issued_at: String,
    #[serde(rename = "expiresAt")]
    pub expires_at: String,
    #[serde(
        rename = "partSize",
        deserialize_with = "const_checkers::expect_const_u8388608"
    )]
    pub part_size: u64,
    #[serde(rename = "partCount")]
    pub part_count: u64,
    pub state: MediaUploadStatusState,
    #[serde(rename = "uploadedParts")]
    pub uploaded_parts: Vec<MediaUploadStatusUploadedParts>,
    pub candidate: Option<MediaUploadStatusCandidate>,
    pub failure: Option<MediaUploadStatusFailure>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PunkStatus {
    #[serde(rename = "active")]
    Active,
    #[serde(rename = "merged")]
    Merged,
    #[serde(rename = "deleting")]
    Deleting,
    #[serde(rename = "deleted")]
    Deleted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PunkIdentitiesProvider {
    #[serde(rename = "google")]
    Google,
    #[serde(rename = "github")]
    Github,
    #[serde(rename = "passkey")]
    Passkey,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PunkIdentities {
    pub provider: PunkIdentitiesProvider,
    #[serde(rename = "subjectHash")]
    pub subject_hash: String,
    #[serde(rename = "emailHash")]
    pub email_hash: String,
    #[serde(rename = "verifiedEmail")]
    pub verified_email: Option<String>,
    pub username: Option<String>,
    #[serde(rename = "credentialId")]
    pub credential_id: Option<String>,
    #[serde(rename = "linkedAt")]
    pub linked_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Punk {
    pub id: String,
    pub status: PunkStatus,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "avatarUrl")]
    pub avatar_url: Option<String>,
    pub identities: Vec<PunkIdentities>,
    #[serde(rename = "mergedInto")]
    pub merged_into: Option<String>,
    pub revision: u64,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GetPunkProfileQuery {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_punk_get_1"
    )]
    pub contract: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct UpdatePunkProfileCommand {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_punk_update_1"
    )]
    pub contract: String,
    #[serde(rename = "commandId")]
    pub command_id: String,
    #[serde(rename = "expectedRevision")]
    pub expected_revision: u64,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "avatarUrl")]
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PunkPublicSummary {
    #[serde(rename = "punkId")]
    pub punk_id: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "avatarUrl")]
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PunkSummaryBatchQuery {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_punk_summary_batch_1"
    )]
    pub contract: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    #[serde(rename = "punkIds")]
    pub punk_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PunkSummaryBatchResponseSummary {
    #[serde(rename = "punkId")]
    pub punk_id: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "avatarUrl")]
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PunkSummaryBatchResponse {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_punk_summary_batch_response_1"
    )]
    pub contract: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    pub items: Vec<PunkSummaryBatchResponseSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Prefix {
    #[serde(
        rename = "kind",
        deserialize_with = "const_checkers::expect_const_prefix"
    )]
    pub kind: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PunkId {
    #[serde(
        rename = "kind",
        deserialize_with = "const_checkers::expect_const_punk_id"
    )]
    pub kind: String,
    #[serde(rename = "punkId")]
    pub punk_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum PunkSearchQueryQuery {
    Prefix(Prefix),
    PunkId(PunkId),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PunkSearchQuery {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_punk_search_1"
    )]
    pub contract: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    pub query: PunkSearchQueryQuery,
    pub limit: u64,
    pub cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PunkSearchResponseSummary {
    #[serde(rename = "punkId")]
    pub punk_id: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "avatarUrl")]
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PunkSearchResponse {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_punk_search_response_1"
    )]
    pub contract: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    pub items: Vec<PunkSearchResponseSummary>,
    #[serde(rename = "nextCursor")]
    pub next_cursor: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CommitAccountMergeCommandAccountRevisions {
    pub survivor: u64,
    pub absorbed: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CommitAccountMergeCommand {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_account_merge_commit_1"
    )]
    pub contract: String,
    #[serde(rename = "commandId")]
    pub command_id: String,
    #[serde(rename = "intentId")]
    pub intent_id: String,
    #[serde(rename = "planId")]
    pub plan_id: String,
    #[serde(rename = "planDigest")]
    pub plan_digest: String,
    #[serde(rename = "survivorPunkId")]
    pub survivor_punk_id: String,
    #[serde(rename = "absorbedPunkId")]
    pub absorbed_punk_id: String,
    #[serde(rename = "accountRevisions")]
    pub account_revisions: CommitAccountMergeCommandAccountRevisions,
    #[serde(
        rename = "confirmation",
        deserialize_with = "const_checkers::expect_const_merge_accounts_irreversibly"
    )]
    pub confirmation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AccountMergeReceiptAccountRevisions {
    pub survivor: u64,
    pub absorbed: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AccountMergeReceipt {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_account_merge_receipt_1"
    )]
    pub contract: String,
    #[serde(
        rename = "schemaVersion",
        deserialize_with = "const_checkers::expect_const_u1"
    )]
    pub schema_version: u64,
    #[serde(rename = "receiptId")]
    pub receipt_id: String,
    #[serde(rename = "intentId")]
    pub intent_id: String,
    #[serde(rename = "planId")]
    pub plan_id: String,
    #[serde(rename = "planDigest")]
    pub plan_digest: String,
    #[serde(rename = "commitCommandId")]
    pub commit_command_id: String,
    #[serde(rename = "survivorPunkId")]
    pub survivor_punk_id: String,
    #[serde(rename = "absorbedPunkId")]
    pub absorbed_punk_id: String,
    #[serde(rename = "accountRevisions")]
    pub account_revisions: AccountMergeReceiptAccountRevisions,
    #[serde(rename = "committedAt")]
    pub committed_at: String,
    #[serde(rename = "receiptHash")]
    pub receipt_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AccountMergeStateStatus {
    #[serde(rename = "planned")]
    Planned,
    #[serde(rename = "preparing")]
    Preparing,
    #[serde(rename = "committed")]
    Committed,
    #[serde(rename = "applying")]
    Applying,
    #[serde(rename = "completed")]
    Completed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AccountMergeStateAccountRevisions {
    pub survivor: u64,
    pub absorbed: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AccountMergeStateReceipt {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_account_merge_receipt_1"
    )]
    pub contract: String,
    #[serde(
        rename = "schemaVersion",
        deserialize_with = "const_checkers::expect_const_u1"
    )]
    pub schema_version: u64,
    #[serde(rename = "receiptId")]
    pub receipt_id: String,
    #[serde(rename = "intentId")]
    pub intent_id: String,
    #[serde(rename = "planId")]
    pub plan_id: String,
    #[serde(rename = "planDigest")]
    pub plan_digest: String,
    #[serde(rename = "commitCommandId")]
    pub commit_command_id: String,
    #[serde(rename = "survivorPunkId")]
    pub survivor_punk_id: String,
    #[serde(rename = "absorbedPunkId")]
    pub absorbed_punk_id: String,
    #[serde(rename = "accountRevisions")]
    pub account_revisions: AccountMergeStateAccountRevisions,
    #[serde(rename = "committedAt")]
    pub committed_at: String,
    #[serde(rename = "receiptHash")]
    pub receipt_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AccountMergeStateFailureCode {
    #[serde(rename = "plan_expired")]
    PlanExpired,
    #[serde(rename = "revision_conflict")]
    RevisionConflict,
    #[serde(rename = "blocking_conflict")]
    BlockingConflict,
    #[serde(rename = "authority_unavailable")]
    AuthorityUnavailable,
    #[serde(rename = "idempotency_conflict")]
    IdempotencyConflict,
    #[serde(rename = "receipt_conflict")]
    ReceiptConflict,
    #[serde(rename = "application_pending")]
    ApplicationPending,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AccountMergeStateFailure {
    pub code: AccountMergeStateFailureCode,
    #[serde(rename = "correlationId")]
    pub correlation_id: String,
    #[serde(rename = "recordedAt")]
    pub recorded_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AccountMergeState {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_account_merge_state_1"
    )]
    pub contract: String,
    #[serde(
        rename = "schemaVersion",
        deserialize_with = "const_checkers::expect_const_u1"
    )]
    pub schema_version: u64,
    #[serde(rename = "intentId")]
    pub intent_id: String,
    #[serde(rename = "planId")]
    pub plan_id: String,
    #[serde(rename = "planDigest")]
    pub plan_digest: String,
    pub status: AccountMergeStateStatus,
    #[serde(rename = "survivorPunkId")]
    pub survivor_punk_id: String,
    #[serde(rename = "absorbedPunkId")]
    pub absorbed_punk_id: String,
    #[serde(rename = "applicationCursor")]
    pub application_cursor: u64,
    #[serde(rename = "applicationTotal")]
    pub application_total: u64,
    pub receipt: Option<AccountMergeStateReceipt>,
    #[serde(rename = "lastFailure")]
    pub last_failure: Option<AccountMergeStateFailure>,
    #[serde(rename = "committedAt")]
    pub committed_at: Option<String>,
    #[serde(rename = "completedAt")]
    pub completed_at: Option<String>,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AccountMergeCommitResponseSuccess {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_account_merge_commit_response_1"
    )]
    pub contract: String,
    #[serde(
        rename = "ok",
        deserialize_with = "const_checkers::expect_const_r_true"
    )]
    pub ok: bool,
    pub state: AccountMergeState,
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AccountMergeCommitResponseFailureCode {
    #[serde(rename = "invalid_request")]
    InvalidRequest,
    #[serde(rename = "plan_unavailable")]
    PlanUnavailable,
    #[serde(rename = "plan_expired")]
    PlanExpired,
    #[serde(rename = "revision_conflict")]
    RevisionConflict,
    #[serde(rename = "blocking_conflict")]
    BlockingConflict,
    #[serde(rename = "authority_unavailable")]
    AuthorityUnavailable,
    #[serde(rename = "idempotency_conflict")]
    IdempotencyConflict,
    #[serde(rename = "receipt_conflict")]
    ReceiptConflict,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AccountMergeCommitResponseFailure {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_account_merge_commit_response_1"
    )]
    pub contract: String,
    #[serde(
        rename = "ok",
        deserialize_with = "const_checkers::expect_const_r_false"
    )]
    pub ok: bool,
    pub code: AccountMergeCommitResponseFailureCode,
    #[serde(rename = "correlationId")]
    pub correlation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum AccountMergeCommitResponse {
    AccountMergeCommitResponseSuccess(AccountMergeCommitResponseSuccess),
    AccountMergeCommitResponseFailure(AccountMergeCommitResponseFailure),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SetWorkspaceMemberRoleCommandActor {
    #[serde(
        rename = "kind",
        deserialize_with = "const_checkers::expect_const_punk"
    )]
    pub kind: String,
    #[serde(rename = "punkId")]
    pub punk_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SetWorkspaceMemberRoleCommandPayloadRole {
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
pub struct SetWorkspaceMemberRoleCommandPayload {
    #[serde(rename = "targetPunkId")]
    pub target_punk_id: String,
    pub role: SetWorkspaceMemberRoleCommandPayloadRole,
    #[serde(rename = "expectedRevision")]
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SetWorkspaceMemberRoleCommand {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_workspace_member_set_role_1"
    )]
    pub contract: String,
    #[serde(rename = "commandId")]
    pub command_id: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    pub actor: SetWorkspaceMemberRoleCommandActor,
    pub payload: SetWorkspaceMemberRoleCommandPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GetWorkspaceGovernanceQuery {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_workspace_governance_1"
    )]
    pub contract: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    pub limit: u64,
    pub cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceGovernanceViewVisibility {
    #[serde(rename = "private")]
    Private,
    #[serde(rename = "punks")]
    Punks,
    #[serde(rename = "public")]
    Public,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WorkspaceGovernanceView {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_workspace_governance_view_1"
    )]
    pub contract: String,
    pub id: String,
    pub slug: String,
    pub name: String,
    pub visibility: WorkspaceGovernanceViewVisibility,
    #[serde(
        rename = "status",
        deserialize_with = "const_checkers::expect_const_active"
    )]
    pub status: String,
    #[serde(rename = "ownerPunkId")]
    pub owner_punk_id: String,
    #[serde(rename = "memberCount")]
    pub member_count: u64,
    pub revision: u64,
    pub cursor: u64,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceGovernanceResponseMemberRole {
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
pub struct WorkspaceGovernanceResponseMember {
    #[serde(rename = "punkId")]
    pub punk_id: String,
    pub role: WorkspaceGovernanceResponseMemberRole,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WorkspaceGovernanceResponse {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_workspace_governance_response_1"
    )]
    pub contract: String,
    pub workspace: WorkspaceGovernanceView,
    pub members: Vec<WorkspaceGovernanceResponseMember>,
    #[serde(rename = "nextCursor")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RemoveWorkspaceMemberCommandActor {
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
pub struct RemoveWorkspaceMemberCommandPayload {
    #[serde(rename = "targetPunkId")]
    pub target_punk_id: String,
    #[serde(rename = "expectedRevision")]
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RemoveWorkspaceMemberCommand {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_workspace_member_remove_1"
    )]
    pub contract: String,
    #[serde(rename = "commandId")]
    pub command_id: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    pub actor: RemoveWorkspaceMemberCommandActor,
    pub payload: RemoveWorkspaceMemberCommandPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LeaveWorkspaceCommandActor {
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
pub struct LeaveWorkspaceCommandPayload {}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LeaveWorkspaceCommand {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_workspace_leave_1"
    )]
    pub contract: String,
    #[serde(rename = "commandId")]
    pub command_id: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    pub actor: LeaveWorkspaceCommandActor,
    pub payload: LeaveWorkspaceCommandPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TransferWorkspaceOwnershipCommandActor {
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
pub struct TransferWorkspaceOwnershipCommandPayload {
    #[serde(rename = "targetPunkId")]
    pub target_punk_id: String,
    #[serde(rename = "expectedRevision")]
    pub expected_revision: u64,
    #[serde(rename = "reauthorizationId")]
    pub reauthorization_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TransferWorkspaceOwnershipCommand {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_workspace_transfer_ownership_1"
    )]
    pub contract: String,
    #[serde(rename = "commandId")]
    pub command_id: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    pub actor: TransferWorkspaceOwnershipCommandActor,
    pub payload: TransferWorkspaceOwnershipCommandPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PresentWorkspaceMemberDeltaRole {
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
pub struct PresentWorkspaceMemberDelta {
    #[serde(rename = "punkId")]
    pub punk_id: String,
    #[serde(
        rename = "present",
        deserialize_with = "const_checkers::expect_const_r_true"
    )]
    pub present: bool,
    pub role: PresentWorkspaceMemberDeltaRole,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RemovedWorkspaceMemberDelta {
    #[serde(rename = "punkId")]
    pub punk_id: String,
    #[serde(
        rename = "present",
        deserialize_with = "const_checkers::expect_const_r_false"
    )]
    pub present: bool,
    pub role: (),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum WorkspaceMembershipMutationResponseMemberDeltas {
    WorkspaceMembershipMutationResponseMemberDeltasSuccess(PresentWorkspaceMemberDelta),
    WorkspaceMembershipMutationResponseMemberDeltasFailure(RemovedWorkspaceMemberDelta),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WorkspaceMembershipMutationResponse {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_workspace_membership_mutation_response_1"
    )]
    pub contract: String,
    pub workspace: WorkspaceGovernanceView,
    #[serde(rename = "memberDeltas")]
    pub member_deltas: Vec<WorkspaceMembershipMutationResponseMemberDeltas>,
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceMembershipLifecycleResponseOutcome {
    #[serde(rename = "left")]
    Left,
    #[serde(rename = "ownership_transferred")]
    OwnershipTransferred,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WorkspaceMembershipLifecycleResponse {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_workspace_membership_lifecycle_response_1"
    )]
    pub contract: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    pub revision: u64,
    pub outcome: WorkspaceMembershipLifecycleResponseOutcome,
    pub role: Option<String>,
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WorkspaceInvitationViewWorkspace {
    pub id: String,
    pub slug: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceInvitationViewRole {
    #[serde(rename = "member")]
    Member,
    #[serde(rename = "guest")]
    Guest,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceInvitationViewStatus {
    #[serde(rename = "issued")]
    Issued,
    #[serde(rename = "revoked")]
    Revoked,
    #[serde(rename = "expired")]
    Expired,
    #[serde(rename = "exhausted")]
    Exhausted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WorkspaceInvitationView {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_workspace_invitation_1"
    )]
    pub contract: String,
    #[serde(rename = "invitationId")]
    pub invitation_id: String,
    pub workspace: WorkspaceInvitationViewWorkspace,
    #[serde(rename = "workspaceRevision")]
    pub workspace_revision: u64,
    pub role: WorkspaceInvitationViewRole,
    pub status: WorkspaceInvitationViewStatus,
    #[serde(rename = "issuedAt")]
    pub issued_at: String,
    #[serde(rename = "expiresAt")]
    pub expires_at: String,
    #[serde(rename = "revokedAt")]
    pub revoked_at: Option<String>,
    #[serde(rename = "maxUses")]
    pub max_uses: u64,
    pub uses: u64,
    #[serde(rename = "usesRemaining")]
    pub uses_remaining: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CreateWorkspaceInvitationCommandActor {
    #[serde(
        rename = "kind",
        deserialize_with = "const_checkers::expect_const_punk"
    )]
    pub kind: String,
    #[serde(rename = "punkId")]
    pub punk_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum CreateWorkspaceInvitationCommandPayloadRole {
    #[serde(rename = "member")]
    Member,
    #[serde(rename = "guest")]
    Guest,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CreateWorkspaceInvitationCommandPayload {
    pub role: CreateWorkspaceInvitationCommandPayloadRole,
    #[serde(rename = "expectedRevision")]
    pub expected_revision: u64,
    #[serde(rename = "ttlSeconds")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ttl_seconds: Option<u64>,
    #[serde(rename = "maxUses")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_uses: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CreateWorkspaceInvitationCommand {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_workspace_invite_1"
    )]
    pub contract: String,
    #[serde(rename = "commandId")]
    pub command_id: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    pub actor: CreateWorkspaceInvitationCommandActor,
    pub payload: CreateWorkspaceInvitationCommandPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GetWorkspaceInvitationQuery {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_workspace_invite_get_1"
    )]
    pub contract: String,
    pub code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CreateWorkspaceInvitationResponse {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_workspace_invite_response_1"
    )]
    pub contract: String,
    pub invitation: WorkspaceInvitationView,
    pub code: String,
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RevokeWorkspaceInvitationCommandActor {
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
pub struct RevokeWorkspaceInvitationCommandPayload {
    #[serde(rename = "invitationId")]
    pub invitation_id: String,
    #[serde(rename = "expectedRevision")]
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RevokeWorkspaceInvitationCommand {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_workspace_invite_revoke_1"
    )]
    pub contract: String,
    #[serde(rename = "commandId")]
    pub command_id: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    pub actor: RevokeWorkspaceInvitationCommandActor,
    pub payload: RevokeWorkspaceInvitationCommandPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RevokeWorkspaceInvitationResponse {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_workspace_invite_revoke_response_1"
    )]
    pub contract: String,
    pub invitation: WorkspaceInvitationView,
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ClaimWorkspaceInvitationCommandActor {
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
pub struct ClaimWorkspaceInvitationCommandPayload {
    pub code: String,
    #[serde(rename = "expectedRevision")]
    pub expected_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ClaimWorkspaceInvitationCommand {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_workspace_invite_claim_1"
    )]
    pub contract: String,
    #[serde(rename = "commandId")]
    pub command_id: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    pub actor: ClaimWorkspaceInvitationCommandActor,
    pub payload: ClaimWorkspaceInvitationCommandPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ClaimWorkspaceInvitationResponseResult {
    #[serde(rename = "joined")]
    Joined,
    #[serde(rename = "already_member")]
    AlreadyMember,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ClaimWorkspaceInvitationResponseWorkspaceVisibility {
    #[serde(rename = "private")]
    Private,
    #[serde(rename = "punks")]
    Punks,
    #[serde(rename = "public")]
    Public,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ClaimWorkspaceInvitationResponseWorkspaceRole {
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
pub struct ClaimWorkspaceInvitationResponseWorkspace {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub visibility: ClaimWorkspaceInvitationResponseWorkspaceVisibility,
    pub role: ClaimWorkspaceInvitationResponseWorkspaceRole,
    pub revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ClaimWorkspaceInvitationResponse {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_workspace_invite_claim_response_1"
    )]
    pub contract: String,
    pub result: ClaimWorkspaceInvitationResponseResult,
    pub workspace: ClaimWorkspaceInvitationResponseWorkspace,
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Hold {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_presence_hold_1"
    )]
    pub contract: String,
    #[serde(
        rename = "type",
        deserialize_with = "const_checkers::expect_const_hold"
    )]
    pub r#type: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    #[serde(rename = "deviceId")]
    pub device_id: String,
    #[serde(rename = "clientGeneration")]
    pub client_generation: u64,
    #[serde(rename = "holdId")]
    pub hold_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Heartbeat {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_presence_hold_1"
    )]
    pub contract: String,
    #[serde(
        rename = "type",
        deserialize_with = "const_checkers::expect_const_heartbeat"
    )]
    pub r#type: String,
    #[serde(rename = "leaseToken")]
    pub lease_token: String,
    pub sequence: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum PresenceHoldFrame {
    Hold(Hold),
    Heartbeat(Heartbeat),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SetPresenceStatusSignal {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_presence_status_set_1"
    )]
    pub contract: String,
    #[serde(rename = "leaseToken")]
    pub lease_token: String,
    pub sequence: u64,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PresenceTypingSignal {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_presence_typing_signal_1"
    )]
    pub contract: String,
    #[serde(rename = "leaseToken")]
    pub lease_token: String,
    pub sequence: u64,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    #[serde(rename = "conversationId")]
    pub conversation_id: String,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PresenceViewState {
    #[serde(rename = "online")]
    Online,
    #[serde(rename = "away")]
    Away,
    #[serde(rename = "offline")]
    Offline,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PresenceView {
    #[serde(rename = "punkId")]
    pub punk_id: String,
    pub state: PresenceViewState,
    pub status: Option<String>,
    #[serde(rename = "leaseGeneration")]
    pub lease_generation: u64,
    pub sequence: u64,
    #[serde(rename = "expiresAt")]
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AcceptedAccepted {
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
    #[serde(rename = "leaseToken")]
    pub lease_token: String,
    #[serde(rename = "leaseGeneration")]
    pub lease_generation: u64,
    #[serde(rename = "clientGeneration")]
    pub client_generation: u64,
    #[serde(rename = "heartbeatIntervalMs")]
    pub heartbeat_interval_ms: u64,
    #[serde(rename = "awayAfterMs")]
    pub away_after_ms: u64,
    #[serde(rename = "expiresAfterMs")]
    pub expires_after_ms: u64,
    pub presences: Vec<PresenceView>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Presence {
    #[serde(
        rename = "schemaVersion",
        deserialize_with = "const_checkers::expect_const_u1"
    )]
    pub schema_version: u64,
    #[serde(
        rename = "type",
        deserialize_with = "const_checkers::expect_const_presence"
    )]
    pub r#type: String,
    pub presence: PresenceView,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum RealtimeDegradedReason {
    #[serde(rename = "authorization_unavailable")]
    AuthorizationUnavailable,
    #[serde(rename = "capacity_unavailable")]
    CapacityUnavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RealtimeDegraded {
    #[serde(
        rename = "schemaVersion",
        deserialize_with = "const_checkers::expect_const_u1"
    )]
    pub schema_version: u64,
    #[serde(
        rename = "type",
        deserialize_with = "const_checkers::expect_const_realtime_degraded"
    )]
    pub r#type: String,
    pub reason: RealtimeDegradedReason,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum PresenceHoldServerFrame {
    Accepted(AcceptedAccepted),
    Presence(Presence),
    RealtimeDegraded(RealtimeDegraded),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PresenceTypingPatch {
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    #[serde(rename = "conversationId")]
    pub conversation_id: String,
    #[serde(rename = "punkId")]
    pub punk_id: String,
    pub active: bool,
    #[serde(rename = "leaseGeneration")]
    pub lease_generation: u64,
    pub sequence: u64,
    #[serde(rename = "expiresAt")]
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AcceptedAccepted2 {
    #[serde(
        rename = "kind",
        deserialize_with = "const_checkers::expect_const_accepted"
    )]
    pub kind: String,
    #[serde(rename = "clientGeneration")]
    pub client_generation: u64,
    #[serde(rename = "leaseGeneration")]
    pub lease_generation: u64,
    #[serde(rename = "heartbeatIntervalMs")]
    pub heartbeat_interval_ms: u64,
    #[serde(rename = "awayAfterMs")]
    pub away_after_ms: u64,
    #[serde(rename = "expiresAfterMs")]
    pub expires_after_ms: u64,
    pub presences: Vec<PresenceView>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PresencePresence {
    #[serde(
        rename = "kind",
        deserialize_with = "const_checkers::expect_const_presence"
    )]
    pub kind: String,
    pub presence: PresenceView,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum RealtimeDegradedRealtimeDegradedReason {
    #[serde(rename = "authorization_unavailable")]
    AuthorizationUnavailable,
    #[serde(rename = "capacity_unavailable")]
    CapacityUnavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RealtimeDegradedRealtimeDegraded {
    #[serde(
        rename = "kind",
        deserialize_with = "const_checkers::expect_const_realtime_degradedRealtimeDegraded"
    )]
    pub kind: String,
    pub reason: RealtimeDegradedRealtimeDegradedReason,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum DesktopPresenceDelivery {
    Accepted(AcceptedAccepted2),
    Presence(PresencePresence),
    RealtimeDegraded(RealtimeDegradedRealtimeDegraded),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MessageSearchQuery {
    #[serde(
        rename = "contract",
        deserialize_with = "const_checkers::expect_const_message_search_1"
    )]
    pub contract: String,
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    #[serde(rename = "conversationId")]
    pub conversation_id: String,
    #[serde(rename = "threadRootMessageId")]
    pub thread_root_message_id: Option<String>,
    pub query: String,
    pub cursor: Option<String>,
    pub limit: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum MessageSearchResponseCompleteness {
    #[serde(rename = "complete")]
    Complete,
    #[serde(rename = "partial")]
    Partial,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum MessageSearchResponsePartialReason {
    #[serde(rename = "index_lagging")]
    IndexLagging,
    #[serde(rename = "index_unavailable")]
    IndexUnavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MessageSearchResponse {
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    #[serde(rename = "conversationId")]
    pub conversation_id: String,
    #[serde(rename = "threadRootMessageId")]
    pub thread_root_message_id: Option<String>,
    #[serde(
        rename = "order",
        deserialize_with = "const_checkers::expect_const_created_cursor_descending"
    )]
    pub order: String,
    pub completeness: MessageSearchResponseCompleteness,
    #[serde(rename = "partialReason")]
    pub partial_reason: Option<MessageSearchResponsePartialReason>,
    pub items: Vec<MessageView>,
    #[serde(rename = "nextCursor")]
    pub next_cursor: Option<String>,
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
        "punks://contracts/media-upload.grant-create@1" => {
            serde_json::from_value::<CreateMediaUploadGrantCommand>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/media-upload.grant@1" => {
            serde_json::from_value::<MediaUploadGrant>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/media-upload.part@1" => {
            serde_json::from_value::<MediaUploadPart>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/media-upload.finalize@1" => {
            serde_json::from_value::<FinalizeMediaUploadCommand>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/media-upload.abandon@1" => {
            serde_json::from_value::<AbandonMediaUploadCommand>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/media-upload.status@1" => {
            serde_json::from_value::<MediaUploadStatus>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/punk@1" => serde_json::from_value::<Punk>(payload)
            .map(|_| ())
            .map_err(|error| error.to_string()),
        "punks://contracts/punk.get@1" => serde_json::from_value::<GetPunkProfileQuery>(payload)
            .map(|_| ())
            .map_err(|error| error.to_string()),
        "punks://contracts/punk.update@1" => {
            serde_json::from_value::<UpdatePunkProfileCommand>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/punk.summary@1" => serde_json::from_value::<PunkPublicSummary>(payload)
            .map(|_| ())
            .map_err(|error| error.to_string()),
        "punks://contracts/punk.summary-batch@1" => {
            serde_json::from_value::<PunkSummaryBatchQuery>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/punk.summary-batch-response@1" => {
            serde_json::from_value::<PunkSummaryBatchResponse>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/punk.search@1" => serde_json::from_value::<PunkSearchQuery>(payload)
            .map(|_| ())
            .map_err(|error| error.to_string()),
        "punks://contracts/punk.search-response@1" => {
            serde_json::from_value::<PunkSearchResponse>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
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
        "punks://contracts/account-merge.commit@1" => {
            serde_json::from_value::<CommitAccountMergeCommand>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/account-merge.receipt@1" => {
            serde_json::from_value::<AccountMergeReceipt>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/account-merge.state@1" => {
            serde_json::from_value::<AccountMergeState>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/account-merge.commit-response@1" => {
            serde_json::from_value::<AccountMergeCommitResponse>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/workspace.member-set-role@1" => {
            serde_json::from_value::<SetWorkspaceMemberRoleCommand>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/workspace.governance@1" => {
            serde_json::from_value::<GetWorkspaceGovernanceQuery>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/workspace.governance-view@1" => {
            serde_json::from_value::<WorkspaceGovernanceView>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/workspace.governance-response@1" => {
            serde_json::from_value::<WorkspaceGovernanceResponse>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/workspace.member-remove@1" => {
            serde_json::from_value::<RemoveWorkspaceMemberCommand>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/workspace.leave@1" => {
            serde_json::from_value::<LeaveWorkspaceCommand>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/workspace.transfer-ownership@1" => {
            serde_json::from_value::<TransferWorkspaceOwnershipCommand>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/workspace.membership-mutation-response@1" => {
            serde_json::from_value::<WorkspaceMembershipMutationResponse>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/workspace.membership-lifecycle-response@1" => {
            serde_json::from_value::<WorkspaceMembershipLifecycleResponse>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/workspace.invitation@1" => {
            serde_json::from_value::<WorkspaceInvitationView>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/workspace.invite@1" => {
            serde_json::from_value::<CreateWorkspaceInvitationCommand>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/workspace.invite-get@1" => {
            serde_json::from_value::<GetWorkspaceInvitationQuery>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/workspace.invite-response@1" => {
            serde_json::from_value::<CreateWorkspaceInvitationResponse>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/workspace.invite-revoke@1" => {
            serde_json::from_value::<RevokeWorkspaceInvitationCommand>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/workspace.invite-revoke-response@1" => {
            serde_json::from_value::<RevokeWorkspaceInvitationResponse>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/workspace.invite-claim@1" => {
            serde_json::from_value::<ClaimWorkspaceInvitationCommand>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/workspace.invite-claim-response@1" => {
            serde_json::from_value::<ClaimWorkspaceInvitationResponse>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/presence.hold@1" => serde_json::from_value::<PresenceHoldFrame>(payload)
            .map(|_| ())
            .map_err(|error| error.to_string()),
        "punks://contracts/presence.status.set@1" => {
            serde_json::from_value::<SetPresenceStatusSignal>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/presence.typing.signal@1" => {
            serde_json::from_value::<PresenceTypingSignal>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/presence.view@1" => serde_json::from_value::<PresenceView>(payload)
            .map(|_| ())
            .map_err(|error| error.to_string()),
        "punks://contracts/presence.hold-server-frame@1" => {
            serde_json::from_value::<PresenceHoldServerFrame>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/presence.typing.patch@1" => {
            serde_json::from_value::<PresenceTypingPatch>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/desktop.presence-delivery@1" => {
            serde_json::from_value::<DesktopPresenceDelivery>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/message.search@1" => {
            serde_json::from_value::<MessageSearchQuery>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        "punks://contracts/message.search-response@1" => {
            serde_json::from_value::<MessageSearchResponse>(payload)
                .map(|_| ())
                .map_err(|error| error.to_string())
        }
        _ => Err(format!("contrat hors profil : {contract}")),
    }
}

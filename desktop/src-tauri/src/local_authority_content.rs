use nostr::Event;
use serde_json::json;

use super::{required_tag, tag_value, LocalAuthority};

impl LocalAuthority {
    pub(super) fn validate_content_marker(&self, event: &Event) -> Result<(), String> {
        let kind = event.kind.as_u16() as u32;
        let channel_id = required_tag(event, "h")?;
        let target_id = required_tag(event, "e")?;
        let target = self
            .query(&[json!({"ids": [&target_id], "limit": 1})])?
            .into_iter()
            .next()
            .ok_or_else(|| "content marker target was not found".to_string())?;
        if tag_value(&target, "h").as_deref() != Some(channel_id.as_str()) {
            return Err("content marker target belongs to another Conversation".to_string());
        }
        let valid_action = match kind {
            40_004 => matches!(event.content.as_str(), "pinned" | "unpinned"),
            40_005 => matches!(event.content.as_str(), "bookmarked" | "unbookmarked"),
            _ => false,
        };
        if !valid_action {
            return Err("content marker action is invalid".to_string());
        }
        if kind == 40_004 {
            let role = self
                .channel_members(&channel_id)?
                .into_iter()
                .find(|(pubkey, _)| pubkey.eq_ignore_ascii_case(&event.pubkey.to_hex()))
                .map(|(_, role)| role);
            if !matches!(role.as_deref(), Some("owner" | "admin")) {
                return Err("forbidden: pin management requires owner or admin".to_string());
            }
        }
        Ok(())
    }
}

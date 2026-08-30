use nostr::Event;
use serde_json::Value;

use super::{has_tag, tag_value, LocalAuthority};

impl LocalAuthority {
    pub(super) fn query_for_actor(
        &self,
        actor_pubkey: &str,
        filters: &[Value],
    ) -> Result<Vec<Event>, String> {
        self.assert_member_can_authenticate(actor_pubkey)?;
        self.query(filters).map(|events| {
            events
                .into_iter()
                .filter(|event| self.event_visible_to(event, actor_pubkey).unwrap_or(false))
                .collect()
        })
    }

    pub(super) fn event_visible_to(
        &self,
        event: &Event,
        actor_pubkey: &str,
    ) -> Result<bool, String> {
        let actor_pubkey = actor_pubkey.to_ascii_lowercase();
        let kind = event.kind.as_u16() as u32;
        if kind == 40_005 {
            return Ok(event.pubkey.to_hex() == actor_pubkey);
        }
        if kind == 41_010 {
            return Ok(event.pubkey.to_hex() == actor_pubkey
                || event.tags.iter().any(|tag| {
                    let values = tag.as_slice();
                    values.first().map(String::as_str) == Some("p")
                        && values
                            .get(1)
                            .is_some_and(|pubkey| pubkey.eq_ignore_ascii_case(&actor_pubkey))
                }));
        }

        let channel_id = tag_value(event, "h").or_else(|| {
            matches!(kind, 39_000..=39_002)
                .then(|| tag_value(event, "d"))
                .flatten()
        });
        let Some(channel_id) = channel_id else {
            return Ok(true);
        };
        let metadata = if kind == 39_000 {
            Some(event.clone())
        } else {
            self.channel_metadata(&channel_id)?
        };
        let is_private = metadata
            .as_ref()
            .is_some_and(|metadata| has_tag(metadata, "private") || has_tag(metadata, "hidden"));
        if !is_private {
            return Ok(true);
        }
        let is_member = self
            .channel_members(&channel_id)?
            .iter()
            .any(|(pubkey, _)| pubkey.eq_ignore_ascii_case(&actor_pubkey));
        if !is_member {
            return Ok(false);
        }
        if metadata
            .as_ref()
            .is_some_and(|metadata| tag_value(metadata, "t").as_deref() == Some("dm"))
            && self.dm_is_hidden(&actor_pubkey, &channel_id)?
        {
            return Ok(false);
        }
        Ok(true)
    }

    pub(super) fn assert_event_channel_access(&self, event: &Event) -> Result<(), String> {
        let Some(channel_id) = tag_value(event, "h") else {
            return Ok(());
        };
        let members = self.channel_members(&channel_id)?;
        if members.is_empty()
            || members
                .iter()
                .any(|(pubkey, _)| pubkey.eq_ignore_ascii_case(&event.pubkey.to_hex()))
        {
            return Ok(());
        }
        Err("forbidden: identity is not a member of this Conversation".to_string())
    }
}

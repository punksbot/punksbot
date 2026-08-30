use nostr::Event;
use rusqlite::params;
use serde_json::json;
use uuid::Uuid;

use super::{has_tag, required_tag, tag_value, upsert_member, LocalAuthority};

impl LocalAuthority {
    pub(super) fn open_dm(&self, event: &Event) -> Result<String, String> {
        let mut participants = event
            .tags
            .iter()
            .filter_map(|tag| {
                let values = tag.as_slice();
                (values.first().map(String::as_str) == Some("p"))
                    .then(|| values.get(1).cloned())
                    .flatten()
            })
            .collect::<Vec<_>>();
        let actor = event.pubkey.to_hex();
        participants.push(actor.clone());
        participants.sort();
        participants.dedup();
        if !(2..=9).contains(&participants.len()) {
            return Err("direct Conversations require two to nine distinct Punks".to_string());
        }
        for participant in &participants {
            self.assert_member_can_authenticate(participant)
                .map_err(|_| "direct Conversation participant is not an active Punk".to_string())?;
        }
        let channel_id = self.ensure_dm_channel(participants)?;
        self.set_dm_hidden(&actor, &channel_id, false)?;
        Ok(format!("response:{}", json!({"channel_id": channel_id})))
    }

    pub(super) fn open_workflow_dm(
        &self,
        actor_pubkey: &str,
        recipient_pubkey: &str,
    ) -> Result<String, String> {
        let participants = vec![
            actor_pubkey.to_ascii_lowercase(),
            recipient_pubkey.to_ascii_lowercase(),
            self.workflow_signer.public_key().to_hex(),
        ];
        for participant in &participants {
            self.assert_member_can_authenticate(participant)
                .map_err(|_| "workflow DM participant is not an active Punk".to_string())?;
        }
        self.ensure_dm_channel(participants)
    }

    fn ensure_dm_channel(&self, mut participants: Vec<String>) -> Result<String, String> {
        participants.sort();
        participants.dedup();
        if !(2..=9).contains(&participants.len()) {
            return Err("direct Conversations require two to nine distinct Punks".to_string());
        }
        let channel_id =
            Uuid::new_v5(&Uuid::NAMESPACE_OID, participants.join(":").as_bytes()).to_string();
        if self.channel_metadata(&channel_id)?.is_none() {
            let members = participants
                .into_iter()
                .map(|pubkey| (pubkey, "member".to_string()))
                .collect::<Vec<_>>();
            self.publish_channel_snapshot(
                &channel_id,
                "direct-message",
                "",
                "dm",
                "private",
                false,
                &members,
            )?;
        }
        Ok(channel_id)
    }

    pub(super) fn add_dm_member(&self, event: &Event) -> Result<(), String> {
        let channel_id = required_tag(event, "h")?;
        let target = required_tag(event, "p")?.to_ascii_lowercase();
        self.assert_member_can_authenticate(&target)
            .map_err(|_| "direct Conversation participant is not an active Punk".to_string())?;
        let metadata = self
            .channel_metadata(&channel_id)?
            .filter(|metadata| tag_value(metadata, "t").as_deref() == Some("dm"))
            .ok_or_else(|| "direct Conversation was not found".to_string())?;
        let mut members = self.channel_members(&channel_id)?;
        if !members
            .iter()
            .any(|(pubkey, _)| pubkey.eq_ignore_ascii_case(&event.pubkey.to_hex()))
        {
            return Err("forbidden: only a DM participant can add another Punk".to_string());
        }
        upsert_member(&mut members, target, "member".to_string());
        if members.len() > 9 {
            return Err("direct Conversations support at most nine Punks".to_string());
        }
        self.publish_channel_snapshot(
            &channel_id,
            &tag_value(&metadata, "name").unwrap_or_else(|| "direct-message".to_string()),
            &tag_value(&metadata, "about").unwrap_or_default(),
            "dm",
            "private",
            tag_value(&metadata, "archived").as_deref() == Some("true"),
            &members,
        )
    }

    pub(super) fn hide_dm(&self, event: &Event) -> Result<(), String> {
        let channel_id = required_tag(event, "h")?;
        let actor = event.pubkey.to_hex();
        let metadata = self
            .channel_metadata(&channel_id)?
            .filter(|metadata| tag_value(metadata, "t").as_deref() == Some("dm"))
            .ok_or_else(|| "direct Conversation was not found".to_string())?;
        if !has_tag(&metadata, "private")
            || !self
                .channel_members(&channel_id)?
                .iter()
                .any(|(pubkey, _)| pubkey.eq_ignore_ascii_case(&actor))
        {
            return Err("forbidden: only a DM participant can hide it".to_string());
        }
        self.set_dm_hidden(&actor, &channel_id, true)
    }

    pub(super) fn dm_is_hidden(&self, pubkey: &str, channel_id: &str) -> Result<bool, String> {
        let database = self
            .database
            .lock()
            .map_err(|error| format!("lock local authority database: {error}"))?;
        database
            .query_row(
                "SELECT hidden FROM dm_visibility WHERE pubkey = ?1 AND channel_id = ?2",
                params![pubkey.to_ascii_lowercase(), channel_id],
                |row| row.get::<_, bool>(0),
            )
            .or_else(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => Ok(false),
                other => Err(other),
            })
            .map_err(|error| format!("read direct Conversation visibility: {error}"))
    }

    fn set_dm_hidden(&self, pubkey: &str, channel_id: &str, hidden: bool) -> Result<(), String> {
        let database = self
            .database
            .lock()
            .map_err(|error| format!("lock local authority database: {error}"))?;
        database
            .execute(
                "INSERT INTO dm_visibility(pubkey, channel_id, hidden, updated_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(pubkey, channel_id) DO UPDATE SET
                   hidden = excluded.hidden, updated_at = excluded.updated_at",
                params![
                    pubkey.to_ascii_lowercase(),
                    channel_id,
                    hidden,
                    chrono::Utc::now().timestamp()
                ],
            )
            .map_err(|error| format!("update direct Conversation visibility: {error}"))?;
        Ok(())
    }
}

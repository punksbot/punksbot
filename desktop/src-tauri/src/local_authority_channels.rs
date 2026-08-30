use nostr::{Event, EventBuilder, Kind, Tag};
use serde_json::json;
use uuid::Uuid;

use super::{
    channel_ttl, has_tag, parse_tag, required_tag, tag_value, upsert_member, LocalAuthority,
};

impl LocalAuthority {
    pub(super) fn create_channel(&self, event: &Event) -> Result<String, String> {
        let channel_id = tag_value(event, "h").unwrap_or_else(|| Uuid::new_v4().to_string());
        let name = tag_value(event, "name").unwrap_or_else(|| "new-stream".to_string());
        let about = tag_value(event, "about").unwrap_or_default();
        let channel_type = tag_value(event, "channel_type").unwrap_or_else(|| "stream".to_string());
        let visibility = tag_value(event, "visibility").unwrap_or_else(|| "open".to_string());
        let ttl = tag_value(event, "ttl")
            .filter(|value| !value.is_empty())
            .map(|ttl| {
                channel_ttl::new_deadline(&ttl, event.created_at.as_secs() as i64)
                    .map(|deadline| (ttl, deadline))
            })
            .transpose()?;
        self.publish_channel_snapshot(
            &channel_id,
            &name,
            &about,
            &channel_type,
            &visibility,
            false,
            &[(event.pubkey.to_hex(), "owner".to_string())],
        )?;
        if let Some((ttl, deadline)) = ttl {
            self.publish_channel_metadata_fields(
                &channel_id,
                &[
                    ("ttl", Some(ttl.as_str())),
                    ("ttl_deadline", Some(deadline.as_str())),
                ],
            )?;
        }
        Ok(format!("response:{}", json!({"channel_id": channel_id})))
    }

    pub(super) fn update_channel(&self, event: &Event) -> Result<(), String> {
        let channel_id = required_tag(event, "h")?;
        let current = self.channel_metadata(&channel_id)?;
        let name = tag_value(event, "name")
            .or_else(|| current.as_ref().and_then(|item| tag_value(item, "name")))
            .unwrap_or_else(|| "stream".to_string());
        let about = tag_value(event, "about")
            .or_else(|| current.as_ref().and_then(|item| tag_value(item, "about")))
            .unwrap_or_default();
        let channel_type = current
            .as_ref()
            .and_then(|item| tag_value(item, "t"))
            .unwrap_or_else(|| "stream".to_string());
        let visibility = tag_value(event, "visibility")
            .or_else(|| {
                current.as_ref().map(|item| {
                    if has_tag(item, "private") {
                        "private".to_string()
                    } else {
                        "open".to_string()
                    }
                })
            })
            .unwrap_or_else(|| "open".to_string());
        let was_archived = current
            .as_ref()
            .is_some_and(|item| tag_value(item, "archived").as_deref() == Some("true"));
        let archived = match tag_value(event, "archived").as_deref() {
            Some("true") => true,
            Some("false") => false,
            _ => was_archived,
        };
        let topic = tag_value(event, "topic")
            .or_else(|| current.as_ref().and_then(|item| tag_value(item, "topic")));
        let purpose = tag_value(event, "purpose")
            .or_else(|| current.as_ref().and_then(|item| tag_value(item, "purpose")));
        let ttl_was_updated = event
            .tags
            .iter()
            .any(|tag| tag.as_slice().first().map(String::as_str) == Some("ttl"));
        let (ttl, ttl_deadline) = if ttl_was_updated {
            let ttl = tag_value(event, "ttl").filter(|value| !value.is_empty());
            let deadline = ttl
                .as_deref()
                .map(|ttl| channel_ttl::new_deadline(ttl, event.created_at.as_secs() as i64))
                .transpose()?;
            (ttl, deadline)
        } else {
            let ttl = current.as_ref().and_then(|item| tag_value(item, "ttl"));
            let deadline = if was_archived && !archived {
                ttl.as_deref()
                    .map(|ttl| channel_ttl::new_deadline(ttl, event.created_at.as_secs() as i64))
                    .transpose()?
            } else {
                current
                    .as_ref()
                    .and_then(|item| tag_value(item, "ttl_deadline"))
            };
            (ttl, deadline)
        };
        let members = self.channel_members(&channel_id)?;
        self.publish_channel_snapshot(
            &channel_id,
            &name,
            &about,
            &channel_type,
            &visibility,
            archived,
            &members,
        )?;
        self.publish_channel_metadata_fields(
            &channel_id,
            &[
                ("topic", topic.as_deref()),
                ("purpose", purpose.as_deref()),
                ("ttl", ttl.as_deref()),
                ("ttl_deadline", ttl_deadline.as_deref()),
            ],
        )
    }

    pub(super) fn publish_channel_metadata_fields(
        &self,
        channel_id: &str,
        replacements: &[(&str, Option<&str>)],
    ) -> Result<(), String> {
        let current = self
            .channel_metadata(channel_id)?
            .ok_or_else(|| "Conversation metadata was not found".to_string())?;
        let mut tags = current
            .tags
            .iter()
            .filter(|tag| {
                let name = tag.as_slice().first().map(String::as_str);
                !replacements
                    .iter()
                    .any(|(replacement, _)| name == Some(*replacement))
            })
            .cloned()
            .collect::<Vec<Tag>>();
        for (name, value) in replacements {
            if let Some(value) = value.filter(|value| !value.trim().is_empty()) {
                tags.push(parse_tag([*name, value])?);
            }
        }
        let metadata = EventBuilder::new(Kind::Custom(39_000), "")
            .tags(tags)
            .allow_self_tagging()
            .custom_created_at(self.next_snapshot_timestamp(39_000, channel_id)?)
            .sign_with_keys(&self.signer)
            .map_err(|error| format!("sign local Conversation metadata: {error}"))?;
        self.persist_and_publish(metadata)?;
        Ok(())
    }

    pub(super) fn set_channel_topic_snapshot(
        &self,
        channel_id: &str,
        topic: &str,
    ) -> Result<(), String> {
        self.publish_channel_metadata_fields(channel_id, &[("topic", Some(topic))])
    }

    pub(super) fn ensure_workflow_bot_channel_member(
        &self,
        channel_id: &str,
        actor_pubkey: &str,
    ) -> Result<(), String> {
        let mut members = self.channel_members(channel_id)?;
        if !members
            .iter()
            .any(|(pubkey, _)| pubkey.eq_ignore_ascii_case(actor_pubkey))
        {
            return Err("forbidden: workflow actor is not a Conversation member".to_string());
        }
        let workflow_pubkey = self.workflow_signer.public_key().to_hex();
        if members.iter().any(|(pubkey, _)| pubkey == &workflow_pubkey) {
            return Ok(());
        }
        let metadata = self
            .channel_metadata(channel_id)?
            .ok_or_else(|| "workflow Conversation metadata is missing".to_string())?;
        let topic = tag_value(&metadata, "topic");
        let purpose = tag_value(&metadata, "purpose");
        let ttl = tag_value(&metadata, "ttl");
        upsert_member(&mut members, workflow_pubkey, "bot".to_string());
        self.publish_channel_snapshot(
            channel_id,
            &tag_value(&metadata, "name").unwrap_or_else(|| "stream".to_string()),
            &tag_value(&metadata, "about").unwrap_or_default(),
            &tag_value(&metadata, "t").unwrap_or_else(|| "stream".to_string()),
            if has_tag(&metadata, "private") {
                "private"
            } else {
                "open"
            },
            tag_value(&metadata, "archived").as_deref() == Some("true"),
            &members,
        )?;
        self.publish_channel_metadata_fields(
            channel_id,
            &[
                ("topic", topic.as_deref()),
                ("purpose", purpose.as_deref()),
                ("ttl", ttl.as_deref()),
            ],
        )
    }
}

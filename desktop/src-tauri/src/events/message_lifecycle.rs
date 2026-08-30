use nostr::{EventBuilder, EventId, Kind, Tag};
use uuid::Uuid;

use super::tag;

fn lifecycle_tags(channel_id: Uuid, target_event_id: EventId) -> Result<Vec<Tag>, String> {
    Ok(vec![
        tag(vec!["h", &channel_id.to_string()])?,
        tag(vec!["e", &target_event_id.to_hex()])?,
    ])
}

pub fn build_message_restore(
    channel_id: Uuid,
    target_event_id: EventId,
) -> Result<EventBuilder, String> {
    Ok(EventBuilder::new(Kind::Custom(40009), "")
        .tags(lifecycle_tags(channel_id, target_event_id)?))
}

pub fn build_message_erase(
    channel_id: Uuid,
    target_event_id: EventId,
) -> Result<EventBuilder, String> {
    Ok(EventBuilder::new(Kind::Custom(40010), "")
        .tags(lifecycle_tags(channel_id, target_event_id)?))
}

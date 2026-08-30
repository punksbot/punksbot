use nostr::{EventBuilder, EventId, Kind};
use uuid::Uuid;

use super::tag;

pub fn build_message_pin(
    channel_id: Uuid,
    target_event_id: EventId,
    pinned: bool,
) -> Result<EventBuilder, String> {
    let tags = vec![
        tag(vec!["h", &channel_id.to_string()])?,
        tag(vec!["e", &target_event_id.to_hex()])?,
    ];
    Ok(EventBuilder::new(
        Kind::Custom(40004),
        if pinned { "pinned" } else { "unpinned" },
    )
    .tags(tags))
}

pub fn build_message_bookmark(
    channel_id: Uuid,
    target_event_id: EventId,
    bookmarked: bool,
) -> Result<EventBuilder, String> {
    let tags = vec![
        tag(vec!["h", &channel_id.to_string()])?,
        tag(vec!["e", &target_event_id.to_hex()])?,
    ];
    Ok(EventBuilder::new(
        Kind::Custom(40005),
        if bookmarked {
            "bookmarked"
        } else {
            "unbookmarked"
        },
    )
    .tags(tags))
}

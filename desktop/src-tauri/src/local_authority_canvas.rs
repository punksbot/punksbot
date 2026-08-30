use nostr::Event;
use serde_json::json;

use super::{required_tag, tag_value, LocalAuthority};

impl LocalAuthority {
    pub(super) fn validate_canvas_revision(&self, event: &Event) -> Result<(), String> {
        let channel_id = required_tag(event, "h")?;
        let current = self
            .query(&[json!({
                "kinds": [40100],
                "#h": [&channel_id],
                "limit": 1
            })])?
            .into_iter()
            .next();
        if current
            .as_ref()
            .is_some_and(|current| current.id == event.id)
        {
            return Ok(());
        }
        let expected = tag_value(event, "expected-revision");
        match (current, expected) {
            (None, None) => Ok(()),
            (None, Some(_)) => Err("conflict: Canvas does not have a current revision".to_string()),
            (Some(_), None) => {
                Err("conflict: Canvas update requires expected-revision".to_string())
            }
            (Some(current), Some(expected)) if current.id.to_hex() == expected => Ok(()),
            (Some(_), Some(_)) => Err("conflict: Canvas changed since it was loaded".to_string()),
        }
    }
}

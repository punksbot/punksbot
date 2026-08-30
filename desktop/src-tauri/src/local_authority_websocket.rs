use std::{collections::HashMap, sync::Arc};

use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use nostr::{Event, JsonUtil};
use serde_json::{json, Value};
use uuid::Uuid;

use super::{query_index::event_matches_filter, LocalAuthority};

pub(super) async fn session(socket: WebSocket, authority: Arc<LocalAuthority>) {
    let (mut sender, mut receiver) = socket.split();
    let challenge = format!("punks-local-{}", Uuid::new_v4());
    if sender
        .send(Message::Text(json!(["AUTH", challenge]).to_string().into()))
        .await
        .is_err()
    {
        return;
    }
    let mut authenticated_pubkey: Option<String> = None;
    let mut subscriptions: HashMap<String, Vec<Value>> = HashMap::new();
    let mut live_events = authority.live_events.subscribe();

    loop {
        tokio::select! {
            incoming = receiver.next() => {
                let Some(Ok(Message::Text(text))) = incoming else { return };
                let Ok(frame) = serde_json::from_str::<Value>(&text) else { continue };
                let Some(items) = frame.as_array() else { continue };
                match items.first().and_then(Value::as_str) {
                    Some("AUTH") => {
                        let Some(raw_event) = items.get(1) else { continue };
                        let Ok(event) = Event::from_json(raw_event.to_string()) else { continue };
                        let challenge_valid = event.kind.as_u16() as u32 == 22242
                            && event.verify_id()
                            && event.verify_signature()
                            && event.tags.iter().any(|tag| {
                                let values = tag.as_slice();
                                values.first().map(String::as_str) == Some("challenge")
                                    && values.get(1).map(String::as_str) == Some(challenge.as_str())
                            });
                        let admission = if challenge_valid {
                            authority.assert_member_can_authenticate(&event.pubkey.to_hex())
                        } else {
                            Err("auth-required: invalid challenge".to_string())
                        };
                        let valid = admission.is_ok();
                        if valid {
                            authenticated_pubkey = Some(event.pubkey.to_hex());
                        }
                        let message = admission.err().unwrap_or_default();
                        let reply = json!(["OK", event.id.to_hex(), valid, message]);
                        if sender.send(Message::Text(reply.to_string().into())).await.is_err() { return; }
                    }
                    Some("REQ") if authenticated_pubkey.is_some() => {
                        let Some(id) = items.get(1).and_then(Value::as_str).map(str::to_string) else { continue };
                        let filters = items.iter().skip(2).cloned().collect::<Vec<_>>();
                        subscriptions.insert(id.clone(), filters.clone());
                        let actor = authenticated_pubkey.as_deref().unwrap_or_default();
                        match authority.query_for_actor(actor, &filters) {
                            Ok(events) => {
                                for event in events {
                                    let reply = json!(["EVENT", id, event]);
                                    if sender.send(Message::Text(reply.to_string().into())).await.is_err() { return; }
                                }
                                if sender.send(Message::Text(json!(["EOSE", id]).to_string().into())).await.is_err() { return; }
                            }
                            Err(error) => {
                                if sender.send(Message::Text(json!(["CLOSED", id, error]).to_string().into())).await.is_err() { return; }
                            }
                        }
                    }
                    Some("CLOSE") => {
                        if let Some(id) = items.get(1).and_then(Value::as_str) {
                            subscriptions.remove(id);
                        }
                    }
                    Some("EVENT") if authenticated_pubkey.is_some() => {
                        let Some(raw_event) = items.get(1) else { continue };
                        let Ok(event) = Event::from_json(raw_event.to_string()) else { continue };
                        let id = event.id.to_hex();
                        let same_signer = authenticated_pubkey.as_deref() == Some(event.pubkey.to_hex().as_str());
                        let outcome = if same_signer { authority.submit(event) } else { Err("authenticated signer does not match event".to_string()) };
                        let (accepted, message) = match outcome {
                            Ok(response) => (response.accepted, response.message),
                            Err(error) => (false, error),
                        };
                        if sender.send(Message::Text(json!(["OK", id, accepted, message]).to_string().into())).await.is_err() { return; }
                    }
                    _ => {}
                }
            }
            live = live_events.recv() => {
                let Ok(event) = live else { continue };
                let Some(actor) = authenticated_pubkey.as_deref() else { continue };
                if !authority.event_visible_to(&event, actor).unwrap_or(false) {
                    continue;
                }
                for (id, filters) in &subscriptions {
                    if filters.iter().any(|filter| event_matches_filter(&event, filter, false))
                        && sender.send(Message::Text(json!(["EVENT", id, event]).to_string().into())).await.is_err()
                    {
                        return;
                    }
                }
            }
        }
    }
}

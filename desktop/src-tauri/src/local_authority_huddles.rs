use std::{collections::HashMap, sync::Mutex};

use axum::{
    extract::{ws::Message, Extension, Path, WebSocketUpgrade},
    response::Response,
};
use futures_util::{SinkExt, StreamExt};
use nostr::{Event, JsonUtil};
use serde::Serialize;
use serde_json::{json, Value};
use tokio::sync::broadcast;
use uuid::Uuid;

use super::{tag_value, LocalAuthority};

const MAX_AUDIO_FRAME_BYTES: usize = 4 * 1024;
const ROOM_CAPACITY: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct HuddlePeer {
    pub peer_id: Uuid,
    pub peer_index: u8,
    pub pubkey: String,
    pub epoch: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ForwardedAudio {
    pub sender_peer_id: Uuid,
    pub payload: Vec<u8>,
}

#[derive(Debug, Clone)]
enum ControlFrame {
    Roster(Vec<HuddlePeer>),
    Left(u8),
}

struct HuddleRoom {
    peers: HashMap<Uuid, HuddlePeer>,
    next_epoch: u8,
    audio: broadcast::Sender<ForwardedAudio>,
    control: broadcast::Sender<ControlFrame>,
}

impl HuddleRoom {
    fn new() -> Self {
        let (audio, _) = broadcast::channel(256);
        let (control, _) = broadcast::channel(64);
        Self {
            peers: HashMap::new(),
            next_epoch: 0,
            audio,
            control,
        }
    }
}

#[derive(Default)]
pub(crate) struct LocalHuddleHub {
    rooms: Mutex<HashMap<String, HuddleRoom>>,
}

pub(crate) struct HuddleJoin {
    pub peer_id: Uuid,
    pub peer_index: u8,
    pub epoch: u8,
    pub peers: Vec<HuddlePeer>,
    pub receiver: broadcast::Receiver<ForwardedAudio>,
    control_receiver: broadcast::Receiver<ControlFrame>,
}

impl LocalHuddleHub {
    pub(crate) fn join(&self, channel_id: &str, pubkey: String) -> Result<HuddleJoin, String> {
        let mut rooms = self
            .rooms
            .lock()
            .map_err(|error| format!("lock local Huddle hub: {error}"))?;
        let room = rooms
            .entry(channel_id.to_string())
            .or_insert_with(HuddleRoom::new);
        if room.peers.len() >= ROOM_CAPACITY {
            return Err("Huddle is full".to_string());
        }
        let peer_index = (0_u8..=254)
            .find(|candidate| {
                !room
                    .peers
                    .values()
                    .any(|peer| peer.peer_index == *candidate)
            })
            .ok_or_else(|| "Huddle has no free peer index".to_string())?;
        room.next_epoch = room.next_epoch.wrapping_add(1);
        let peer = HuddlePeer {
            peer_id: Uuid::new_v4(),
            peer_index,
            pubkey,
            epoch: room.next_epoch,
        };
        let receiver = room.audio.subscribe();
        let control_receiver = room.control.subscribe();
        room.peers.insert(peer.peer_id, peer.clone());
        let peers = sorted_peers(room);
        let _ = room.control.send(ControlFrame::Roster(peers.clone()));
        Ok(HuddleJoin {
            peer_id: peer.peer_id,
            peer_index,
            epoch: peer.epoch,
            peers,
            receiver,
            control_receiver,
        })
    }

    pub(crate) fn leave(&self, channel_id: &str, peer_id: Uuid) -> Result<(), String> {
        let mut rooms = self
            .rooms
            .lock()
            .map_err(|error| format!("lock local Huddle hub: {error}"))?;
        let Some(room) = rooms.get_mut(channel_id) else {
            return Ok(());
        };
        if let Some(peer) = room.peers.remove(&peer_id) {
            let _ = room.control.send(ControlFrame::Left(peer.peer_index));
            let _ = room.control.send(ControlFrame::Roster(sorted_peers(room)));
        }
        if room.peers.is_empty() {
            rooms.remove(channel_id);
        }
        Ok(())
    }

    pub(crate) fn roster(&self, channel_id: &str) -> Result<Vec<HuddlePeer>, String> {
        let rooms = self
            .rooms
            .lock()
            .map_err(|error| format!("lock local Huddle hub: {error}"))?;
        Ok(rooms.get(channel_id).map_or_else(Vec::new, sorted_peers))
    }

    pub(crate) fn broadcast_audio(
        &self,
        channel_id: &str,
        peer_id: Uuid,
        frame: &[u8],
    ) -> Result<(), String> {
        if frame.is_empty() || frame.len() > MAX_AUDIO_FRAME_BYTES {
            return Err("invalid Huddle audio frame size".to_string());
        }
        let rooms = self
            .rooms
            .lock()
            .map_err(|error| format!("lock local Huddle hub: {error}"))?;
        let room = rooms
            .get(channel_id)
            .ok_or_else(|| "Huddle room is not active".to_string())?;
        let peer = room
            .peers
            .get(&peer_id)
            .ok_or_else(|| "Huddle peer is not registered".to_string())?;
        let mut payload = Vec::with_capacity(frame.len() + 1);
        payload.push(peer.peer_index);
        payload.extend_from_slice(frame);
        let _ = room.audio.send(ForwardedAudio {
            sender_peer_id: peer_id,
            payload,
        });
        Ok(())
    }
}

fn sorted_peers(room: &HuddleRoom) -> Vec<HuddlePeer> {
    let mut peers = room.peers.values().cloned().collect::<Vec<_>>();
    peers.sort_by_key(|peer| peer.peer_index);
    peers
}

pub(crate) async fn audio_socket(
    Extension(authority): Extension<std::sync::Arc<LocalAuthority>>,
    Path(channel_id): Path<String>,
    websocket: WebSocketUpgrade,
) -> Response {
    websocket.on_upgrade(move |socket| session(socket, authority, channel_id))
}

async fn session(
    mut socket: axum::extract::ws::WebSocket,
    authority: std::sync::Arc<LocalAuthority>,
    channel_id: String,
) {
    if Uuid::parse_str(&channel_id).is_err() {
        let _ = socket.close().await;
        return;
    }
    let challenge = format!("punks-huddle-{}", Uuid::new_v4());
    if socket
        .send(Message::Text(
            json!({"type": "challenge", "challenge": challenge})
                .to_string()
                .into(),
        ))
        .await
        .is_err()
    {
        return;
    }
    let Some(Ok(Message::Text(raw_auth))) = socket.next().await else {
        return;
    };
    let Ok(auth): Result<Value, _> = serde_json::from_str(&raw_auth) else {
        return;
    };
    let Some(raw_event) = auth.get("event") else {
        return;
    };
    let Ok(event) = Event::from_json(raw_event.to_string()) else {
        return;
    };
    let valid = auth.get("type").and_then(Value::as_str) == Some("auth")
        && auth.get("protocol_version").and_then(Value::as_u64) == Some(2)
        && event.kind.as_u16() as u32 == 22_242
        && event.verify_id()
        && event.verify_signature()
        && tag_value(&event, "challenge").as_deref() == Some(challenge.as_str())
        && authority
            .assert_member_can_publish(&event.pubkey.to_hex())
            .is_ok()
        && authority.channel_members(&channel_id).is_ok_and(|members| {
            members
                .iter()
                .any(|(pubkey, _)| pubkey == &event.pubkey.to_hex())
        });
    if !valid {
        let _ = socket
            .send(Message::Text(
                json!({"type": "error", "message": "Huddle authentication rejected"})
                    .to_string()
                    .into(),
            ))
            .await;
        return;
    }
    let Ok(mut joined) = authority.huddles.join(&channel_id, event.pubkey.to_hex()) else {
        return;
    };
    let joined_roster = authority
        .huddles
        .roster(&channel_id)
        .unwrap_or_else(|_| joined.peers.clone());
    if socket
        .send(Message::Text(
            joined_message(&joined, &joined_roster).to_string().into(),
        ))
        .await
        .is_err()
    {
        let _ = authority.huddles.leave(&channel_id, joined.peer_id);
        return;
    }
    let (mut sender, mut receiver) = socket.split();
    loop {
        tokio::select! {
            incoming = receiver.next() => match incoming {
                Some(Ok(Message::Binary(frame))) => match authority
                    .huddles
                    .broadcast_audio(&channel_id, joined.peer_id, &frame)
                {
                    Ok(()) => {}
                    Err(_) => break,
                },
                Some(Ok(Message::Ping(data))) => match sender.send(Message::Pong(data)).await {
                    Ok(()) => {}
                    Err(_) => break,
                },
                Some(Ok(Message::Text(text))) if is_leave_message(&text) => break,
                Some(Ok(Message::Text(_))) => {}
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                _ => {}
            },
            frame = joined.receiver.recv() => {
                let Ok(frame) = frame else { continue };
                if frame.sender_peer_id != joined.peer_id
                    && sender.send(Message::Binary(frame.payload.into())).await.is_err() { break; }
            },
            control = joined.control_receiver.recv() => {
                let Ok(control) = control else { continue };
                let message = match control {
                    ControlFrame::Roster(peers) => json!({"type": "roster", "peers": peer_json(&peers)}),
                    ControlFrame::Left(peer_index) => json!({"type": "left", "peer_index": peer_index}),
                };
                if sender.send(Message::Text(message.to_string().into())).await.is_err() { break; }
            }
        }
    }
    let _ = authority.huddles.leave(&channel_id, joined.peer_id);
}

fn joined_message(joined: &HuddleJoin, peers: &[HuddlePeer]) -> Value {
    json!({
        "type": "joined",
        "peer_index": joined.peer_index,
        "epoch": joined.epoch,
        "peers": peer_json(peers)
    })
}

fn peer_json(peers: &[HuddlePeer]) -> Vec<Value> {
    peers
        .iter()
        .map(|peer| {
            json!({
                "peer_index": peer.peer_index,
                "pubkey": peer.pubkey,
                "epoch": peer.epoch
            })
        })
        .collect()
}

fn is_leave_message(text: &str) -> bool {
    serde_json::from_str::<Value>(text)
        .ok()
        .and_then(|value| {
            value
                .get("type")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .as_deref()
        == Some("leave")
}

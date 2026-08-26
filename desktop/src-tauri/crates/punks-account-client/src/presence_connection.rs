use std::{sync::Arc, time::Duration};

use futures_util::{SinkExt, StreamExt};
use reqwest::{
    cookie::CookieStore,
    header::{HeaderValue, COOKIE, ORIGIN, SEC_WEBSOCKET_PROTOCOL},
};
use serde_json::json;
use tokio::{
    net::TcpStream,
    sync::{mpsc, oneshot, Mutex},
    time::{self, Instant},
};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
    MaybeTlsStream, WebSocketStream,
};
use tokio_util::sync::CancellationToken;
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

use crate::{
    promotion_audit::record_network_request, reduce_presence_frame, validate_uuid, ClientFailure,
    FailureKind, PresenceDelivery, PresenceEffect, PresenceServerFrame, PresenceState, Transport,
    WorkspaceSession,
};

const PRESENCE_PROTOCOL: &str = "punks.presence.v1";
const MAX_FRAME_BYTES: usize = 4_194_304;

enum PresenceCommand {
    SetStatus(Option<String>),
    SignalTyping {
        conversation_id: String,
        active: bool,
    },
    Close(oneshot::Sender<()>),
}

/// Cloneable cancellation handle owned by the mounted Workspace generation.
#[derive(Clone)]
pub struct PresenceCancellation(CancellationToken);

impl PresenceCancellation {
    pub fn cancel(&self) {
        self.0.cancel();
    }
}

/// Native-only Presence channel; token and device identity never cross IPC.
pub struct PresenceConnection {
    session: WorkspaceSession,
    commands: mpsc::Sender<PresenceCommand>,
    deliveries: Arc<Mutex<mpsc::Receiver<Result<PresenceDelivery, ClientFailure>>>>,
    cancellation: PresenceCancellation,
}

impl WorkspaceSession {
    /// Opens the one ephemeral Presence channel for this Workspace generation.
    pub async fn hold_presence(&self) -> Result<PresenceConnection, ClientFailure> {
        self.require_capability("presence").await?;
        let _operation = self.operations.read().await;
        self.assert_current().await?;
        #[cfg(not(test))]
        let Transport::Http(transport) = &self.inner.transport;
        #[cfg(test)]
        let transport = match &self.inner.transport {
            Transport::Http(transport) => transport,
            Transport::Test(_) => {
                return Err(ClientFailure::new(
                    FailureKind::ContractViolation,
                    "Test transport does not implement Presence",
                ))
            }
        };
        let mut websocket_url = transport.origin.clone();
        websocket_url
            .set_scheme(if transport.origin.scheme() == "https" {
                "wss"
            } else {
                "ws"
            })
            .map_err(|_| ClientFailure::contract("presence.hold@1 origin"))?;
        websocket_url.set_path(&format!(
            "/api/v1/workspaces/{}/presence/hold",
            self.lease.workspace_id
        ));
        let client_generation = self.lease.generation.to_string();
        let hold_id = Uuid::new_v4().to_string();
        websocket_url
            .query_pairs_mut()
            .append_pair("deviceId", &self.device_id)
            .append_pair("clientGeneration", &client_generation)
            .append_pair("holdId", &hold_id);
        let mut request = websocket_url.as_str().into_client_request().map_err(|_| {
            ClientFailure::new(
                FailureKind::ContractViolation,
                "Punks Presence request is invalid",
            )
        })?;
        request.headers_mut().insert(
            ORIGIN,
            HeaderValue::from_str(&self.lease.origin)
                .map_err(|_| ClientFailure::contract("presence.hold@1 origin"))?,
        );
        request.headers_mut().insert(
            SEC_WEBSOCKET_PROTOCOL,
            HeaderValue::from_static(PRESENCE_PROTOCOL),
        );
        if let Some(cookie) = transport.jar.cookies(&transport.origin) {
            request.headers_mut().insert(COOKIE, cookie);
        }

        let workspace_cancellation = self.cancellation.clone();
        let (mut socket, response) = tokio::select! {
            biased;
            _ = workspace_cancellation.cancelled() => {
                return Err(ClientFailure::new(
                    FailureKind::Cancelled,
                    "Punks Presence connection was cancelled",
                ));
            }
            result = connect_async(request) => result.map_err(|_| {
                ClientFailure::new(
                    FailureKind::Transport,
                    "Punks Presence connection could not be opened",
                )
            })?,
        };
        record_network_request("PRESENCE", &websocket_url, response.status().as_u16());
        if response
            .headers()
            .get(SEC_WEBSOCKET_PROTOCOL)
            .and_then(|value| value.to_str().ok())
            != Some(PRESENCE_PROTOCOL)
        {
            return Err(ClientFailure::contract(
                "Punks Presence selected an unexpected subprotocol",
            ));
        }

        let initial = tokio::select! {
            biased;
            _ = workspace_cancellation.cancelled() => {
                return Err(ClientFailure::new(
                    FailureKind::Cancelled,
                    "Punks Presence acceptance was cancelled",
                ));
            }
            frame = next_text_frame(&mut socket) => frame?,
        };
        let initial_frame = serde_json::from_str::<PresenceServerFrame>(&initial)
            .map_err(|_| ClientFailure::contract("presence.hold-server-frame@1"))?;
        let reduction = reduce_presence_frame(
            &PresenceState::new(&self.lease.workspace_id, self.lease.generation),
            initial_frame,
        )?;
        let initial_delivery = match reduction.effect {
            PresenceEffect::Delivery(delivery @ PresenceDelivery::Accepted { .. }) => delivery,
            _ => return Err(ClientFailure::contract("presence.hold-server-frame@1")),
        };
        let heartbeat_interval_ms = reduction
            .state
            .heartbeat_interval_ms()
            .ok_or_else(|| ClientFailure::contract("presence.hold-server-frame@1"))?;
        let token = reduction
            .state
            .lease_token()
            .ok_or_else(|| ClientFailure::contract("presence.hold-server-frame@1"))?
            .to_owned();
        self.assert_current().await?;

        let (command_sender, command_receiver) = mpsc::channel(32);
        let (delivery_sender, delivery_receiver) = mpsc::channel(128);
        delivery_sender
            .try_send(Ok(initial_delivery))
            .map_err(|_| ClientFailure::contract("Presence delivery channel"))?;
        let cancellation = PresenceCancellation(CancellationToken::new());
        tokio::spawn(run_presence(
            self.clone(),
            socket,
            reduction.state,
            token,
            heartbeat_interval_ms,
            command_receiver,
            delivery_sender,
            cancellation.0.clone(),
        ));
        Ok(PresenceConnection {
            session: self.clone(),
            commands: command_sender,
            deliveries: Arc::new(Mutex::new(delivery_receiver)),
            cancellation,
        })
    }
}

impl PresenceConnection {
    pub fn cancellation(&self) -> PresenceCancellation {
        self.cancellation.clone()
    }

    pub async fn next_delivery(&self) -> Result<PresenceDelivery, ClientFailure> {
        self.session.assert_current().await?;
        let delivery = self.deliveries.lock().await.recv().await.ok_or_else(|| {
            ClientFailure::new(FailureKind::Transport, "Punks Presence connection ended")
        })??;
        self.session.assert_current().await?;
        Ok(delivery)
    }

    pub async fn set_status(&self, status: Option<&str>) -> Result<(), ClientFailure> {
        self.session.assert_current().await?;
        let status = canonical_status(status)?;
        self.commands
            .send(PresenceCommand::SetStatus(status))
            .await
            .map_err(|_| {
                ClientFailure::new(FailureKind::Transport, "Punks Presence is unavailable")
            })?;
        self.session.assert_current().await
    }

    pub async fn signal_typing(
        &self,
        conversation_id: &str,
        active: bool,
    ) -> Result<(), ClientFailure> {
        validate_uuid(conversation_id, "conversationId")?;
        self.session.assert_current().await?;
        self.commands
            .send(PresenceCommand::SignalTyping {
                conversation_id: conversation_id.to_owned(),
                active,
            })
            .await
            .map_err(|_| {
                ClientFailure::new(FailureKind::Transport, "Punks Presence is unavailable")
            })?;
        self.session.assert_current().await
    }

    pub async fn close(&self) -> Result<(), ClientFailure> {
        self.cancellation.cancel();
        let (sender, receiver) = oneshot::channel();
        if self
            .commands
            .send(PresenceCommand::Close(sender))
            .await
            .is_ok()
        {
            let _ = receiver.await;
        }
        Ok(())
    }
}

impl Drop for PresenceConnection {
    fn drop(&mut self) {
        self.cancellation.cancel();
    }
}

fn canonical_status(status: Option<&str>) -> Result<Option<String>, ClientFailure> {
    let Some(status) = status else {
        return Ok(None);
    };
    let canonical = status.nfc().collect::<String>();
    if canonical != status
        || canonical != canonical.trim()
        || !(1..=80).contains(&canonical.chars().count())
        || canonical
            .chars()
            .any(|character| matches!(character, '\r' | '\n' | '\u{2028}' | '\u{2029}'))
    {
        return Err(ClientFailure::contract("presence.status.set@1"));
    }
    Ok(Some(canonical))
}

async fn next_text_frame(
    socket: &mut WebSocketStream<MaybeTlsStream<TcpStream>>,
) -> Result<String, ClientFailure> {
    loop {
        let message = socket.next().await.ok_or_else(|| {
            ClientFailure::new(FailureKind::Transport, "Punks Presence connection ended")
        })?;
        match message
            .map_err(|_| ClientFailure::new(FailureKind::Transport, "Punks Presence read failed"))?
        {
            Message::Text(text) if text.len() <= MAX_FRAME_BYTES => return Ok(text.to_string()),
            Message::Ping(payload) => socket.send(Message::Pong(payload)).await.map_err(|_| {
                ClientFailure::new(FailureKind::Transport, "Punks Presence heartbeat failed")
            })?,
            Message::Close(_) => {
                return Err(ClientFailure::new(
                    FailureKind::Transport,
                    "Punks Presence connection ended",
                ))
            }
            _ => return Err(ClientFailure::contract("presence.hold-server-frame@1")),
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_presence(
    session: WorkspaceSession,
    mut socket: WebSocketStream<MaybeTlsStream<TcpStream>>,
    mut state: PresenceState,
    lease_token: String,
    heartbeat_interval_ms: u64,
    mut commands: mpsc::Receiver<PresenceCommand>,
    deliveries: mpsc::Sender<Result<PresenceDelivery, ClientFailure>>,
    cancellation: CancellationToken,
) {
    let mut sequence = 0_u64;
    let interval = Duration::from_millis(heartbeat_interval_ms);
    let mut heartbeat = time::interval_at(Instant::now() + interval, interval);
    loop {
        let workspace_cancellation = session.cancellation.clone();
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => break,
            _ = workspace_cancellation.cancelled() => break,
            command = commands.recv() => {
                match command {
                    Some(PresenceCommand::SetStatus(status)) => {
                        sequence = sequence.saturating_add(1);
                        if send_json(&mut socket, json!({
                            "contract": "presence.status.set@1",
                            "leaseToken": lease_token,
                            "sequence": sequence,
                            "status": status,
                        })).await.is_err() { break; }
                    }
                    Some(PresenceCommand::SignalTyping { conversation_id, active }) => {
                        sequence = sequence.saturating_add(1);
                        if send_json(&mut socket, json!({
                            "contract": "presence.typing.signal@1",
                            "leaseToken": lease_token,
                            "sequence": sequence,
                            "workspaceId": session.lease.workspace_id,
                            "conversationId": conversation_id,
                            "active": active,
                        })).await.is_err() { break; }
                    }
                    Some(PresenceCommand::Close(done)) => {
                        let _ = socket.close(None).await;
                        let _ = done.send(());
                        break;
                    }
                    None => break,
                }
            }
            _ = heartbeat.tick() => {
                sequence = sequence.saturating_add(1);
                if send_json(&mut socket, json!({
                    "contract": "presence.hold@1",
                    "type": "heartbeat",
                    "leaseToken": lease_token,
                    "sequence": sequence,
                })).await.is_err() { break; }
            }
            incoming = socket.next() => {
                let result = match incoming {
                    Some(Ok(Message::Text(text))) if text.len() <= MAX_FRAME_BYTES => {
                        serde_json::from_str::<PresenceServerFrame>(&text)
                            .map_err(|_| ClientFailure::contract("presence.hold-server-frame@1"))
                            .and_then(|frame| reduce_presence_frame(&state, frame))
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        if socket.send(Message::Pong(payload)).await.is_err() { break; }
                        continue;
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        Err(ClientFailure::new(FailureKind::Transport, "Punks Presence connection ended"))
                    }
                    Some(Ok(_)) => Err(ClientFailure::contract("presence.hold-server-frame@1")),
                    Some(Err(_)) => Err(ClientFailure::new(FailureKind::Transport, "Punks Presence read failed")),
                };
                match result {
                    Ok(reduction) => {
                        state = reduction.state;
                        if let PresenceEffect::Delivery(delivery) = reduction.effect {
                            if deliveries.send(Ok(delivery)).await.is_err() { break; }
                        }
                    }
                    Err(error) => {
                        let _ = deliveries.send(Err(error)).await;
                        break;
                    }
                }
            }
        }
    }
}

async fn send_json(
    socket: &mut WebSocketStream<MaybeTlsStream<TcpStream>>,
    value: serde_json::Value,
) -> Result<(), ClientFailure> {
    let encoded = serde_json::to_string(&value)
        .map_err(|_| ClientFailure::contract("Punks Presence frame encoding"))?;
    socket
        .send(Message::Text(encoded.into()))
        .await
        .map_err(|_| {
            ClientFailure::new(FailureKind::Transport, "Punks Presence signal was omitted")
        })
}

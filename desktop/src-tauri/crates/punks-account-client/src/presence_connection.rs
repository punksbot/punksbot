use std::{sync::Arc, time::Duration};

use futures_util::{SinkExt, StreamExt};
use reqwest::{
    cookie::CookieStore,
    header::{HeaderValue, COOKIE, ORIGIN, SEC_WEBSOCKET_PROTOCOL},
};
use serde_json::json;
use tokio::{
    net::TcpStream,
    sync::{mpsc, watch, Mutex},
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
const INITIAL_RECONNECT_DELAY: Duration = Duration::from_millis(500);
const MAXIMUM_RECONNECT_DELAY: Duration = Duration::from_secs(10);

enum PresenceCommand {
    SetStatus(Option<String>),
    SignalTyping {
        conversation_id: String,
        active: bool,
    },
}

/// Cloneable cancellation handle owned by the mounted Workspace generation.
#[derive(Clone)]
pub struct PresenceCancellation(CancellationToken);

impl PresenceCancellation {
    /// Cancels the native Presence channel owned by this mounted generation.
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
    reconnect_generation: watch::Sender<u64>,
}

impl WorkspaceSession {
    /// Opens the one ephemeral Presence channel for this Workspace generation.
    pub async fn hold_presence(&self) -> Result<PresenceConnection, ClientFailure> {
        self.require_capability("presence").await?;
        self.assert_current().await?;
        let (command_sender, command_receiver) = mpsc::channel(32);
        let (delivery_sender, delivery_receiver) = mpsc::channel(128);
        let cancellation = PresenceCancellation(CancellationToken::new());
        let (reconnect_generation, reconnect_receiver) = watch::channel(0_u64);
        tokio::spawn(run_presence_supervisor(
            self.clone(),
            command_receiver,
            delivery_sender,
            cancellation.0.clone(),
            reconnect_receiver,
        ));
        Ok(PresenceConnection {
            session: self.clone(),
            commands: command_sender,
            deliveries: Arc::new(Mutex::new(delivery_receiver)),
            cancellation,
            reconnect_generation,
        })
    }
}

impl PresenceConnection {
    /// Returns a cloneable handle that cancels this native Presence channel.
    pub fn cancellation(&self) -> PresenceCancellation {
        self.cancellation.clone()
    }

    /// Waits for the next validated renderer-safe Presence delivery.
    pub async fn next_delivery(&self) -> Result<PresenceDelivery, ClientFailure> {
        self.session.assert_current().await?;
        let delivery = self.deliveries.lock().await.recv().await.ok_or_else(|| {
            ClientFailure::new(FailureKind::Transport, "Punks Presence connection ended")
        })??;
        self.session.assert_current().await?;
        Ok(delivery)
    }

    /// Replaces or clears the bounded status carried by the active Presence lease.
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

    /// Emits a lossy typing signal for one authorized Conversation.
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

    /// Interrupts only a pending native backoff, for example when the app
    /// returns to the foreground. The renderer never opens another socket.
    pub fn reconnect_now(&self) {
        self.reconnect_generation
            .send_modify(|generation| *generation = generation.saturating_add(1));
    }

    /// Cancels the native supervisor; dropping its socket closes the Bail.
    pub async fn close(&self) -> Result<(), ClientFailure> {
        self.cancellation.cancel();
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

type PresenceSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;

struct OpenPresence {
    socket: PresenceSocket,
    state: PresenceState,
    lease_token: String,
    heartbeat_interval_ms: u64,
    initial_delivery: PresenceDelivery,
}

async fn open_presence(
    session: &WorkspaceSession,
    hold_id: &str,
    operation_cancellation: &CancellationToken,
) -> Result<OpenPresence, ClientFailure> {
    let _operation = session.operations.read().await;
    session.assert_current().await?;
    #[cfg(not(test))]
    let Transport::Http(transport) = &session.inner.transport;
    #[cfg(test)]
    let transport = match &session.inner.transport {
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
        session.lease.workspace_id
    ));
    websocket_url
        .query_pairs_mut()
        .append_pair("deviceId", &session.device_id)
        .append_pair("clientGeneration", &session.lease.generation.to_string())
        .append_pair("holdId", hold_id);
    let mut request = websocket_url.as_str().into_client_request().map_err(|_| {
        ClientFailure::new(
            FailureKind::ContractViolation,
            "Punks Presence request is invalid",
        )
    })?;
    request.headers_mut().insert(
        ORIGIN,
        HeaderValue::from_str(&session.lease.origin)
            .map_err(|_| ClientFailure::contract("presence.hold@1 origin"))?,
    );
    request.headers_mut().insert(
        SEC_WEBSOCKET_PROTOCOL,
        HeaderValue::from_static(PRESENCE_PROTOCOL),
    );
    if let Some(cookie) = transport.jar.cookies(&transport.origin) {
        request.headers_mut().insert(COOKIE, cookie);
    }

    let workspace_cancellation = session.cancellation.clone();
    let (mut socket, response) = tokio::select! {
        biased;
        _ = operation_cancellation.cancelled() => {
            return Err(ClientFailure::new(
                FailureKind::Cancelled,
                "Punks Presence connection was cancelled",
            ));
        }
        _ = workspace_cancellation.cancelled() => {
            return Err(ClientFailure::new(
                FailureKind::StaleWorkspace,
                "Punks Presence Workspace generation was cancelled",
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
        _ = operation_cancellation.cancelled() => {
            return Err(ClientFailure::new(
                FailureKind::Cancelled,
                "Punks Presence acceptance was cancelled",
            ));
        }
        _ = workspace_cancellation.cancelled() => {
            return Err(ClientFailure::new(
                FailureKind::StaleWorkspace,
                "Punks Presence Workspace generation was cancelled",
            ));
        }
        frame = next_text_frame(&mut socket) => frame?,
    };
    let initial_frame = serde_json::from_str::<PresenceServerFrame>(&initial)
        .map_err(|_| ClientFailure::contract("presence.hold-server-frame@1"))?;
    let reduction = reduce_presence_frame(
        &PresenceState::new(&session.lease.workspace_id, session.lease.generation),
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
    let lease_token = reduction
        .state
        .lease_token()
        .ok_or_else(|| ClientFailure::contract("presence.hold-server-frame@1"))?
        .to_owned();
    session.assert_current().await?;
    Ok(OpenPresence {
        socket,
        state: reduction.state,
        lease_token,
        heartbeat_interval_ms,
        initial_delivery,
    })
}

async fn next_text_frame(socket: &mut PresenceSocket) -> Result<String, ClientFailure> {
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

enum PhysicalConnectionExit {
    Reconnect { degraded_delivered: bool },
    Stop,
    Terminal(ClientFailure),
}

async fn run_presence_supervisor(
    session: WorkspaceSession,
    mut commands: mpsc::Receiver<PresenceCommand>,
    deliveries: mpsc::Sender<Result<PresenceDelivery, ClientFailure>>,
    cancellation: CancellationToken,
    mut reconnect_generation: watch::Receiver<u64>,
) {
    let mut reconnect_delay = INITIAL_RECONNECT_DELAY;
    let mut degraded_delivered = false;
    let mut hold_id = Uuid::new_v4().to_string();
    loop {
        let opened = open_presence(&session, &hold_id, &cancellation).await;
        let connection_exit = match opened {
            Ok(opened) => {
                if deliveries
                    .send(Ok(opened.initial_delivery.clone()))
                    .await
                    .is_err()
                {
                    break;
                }
                degraded_delivered = false;
                reconnect_delay = INITIAL_RECONNECT_DELAY;
                let exit = run_physical_presence(
                    &session,
                    opened,
                    &mut commands,
                    &deliveries,
                    &cancellation,
                )
                .await;
                // A connection that reached `accepted` owns one intention.
                // Every later physical reconnect starts a fresh Bail.
                hold_id = Uuid::new_v4().to_string();
                exit
            }
            Err(error)
                if matches!(
                    error.kind,
                    FailureKind::Cancelled | FailureKind::StaleWorkspace
                ) =>
            {
                PhysicalConnectionExit::Stop
            }
            Err(error) if matches!(error.kind, FailureKind::Transport) => {
                PhysicalConnectionExit::Reconnect {
                    degraded_delivered: false,
                }
            }
            Err(error) => PhysicalConnectionExit::Terminal(error),
        };
        match connection_exit {
            PhysicalConnectionExit::Stop => break,
            PhysicalConnectionExit::Terminal(error) => {
                let _ = deliveries.send(Err(error)).await;
                break;
            }
            PhysicalConnectionExit::Reconnect {
                degraded_delivered: physical_degraded,
            } => {
                degraded_delivered |= physical_degraded;
            }
        }
        if !degraded_delivered {
            if deliveries
                .send(Ok(PresenceDelivery::RealtimeDegraded {
                    reason: crate::PresenceDegradedReason::CapacityUnavailable,
                }))
                .await
                .is_err()
            {
                break;
            }
            degraded_delivered = true;
        }
        if !wait_for_reconnect(
            reconnect_delay,
            &session,
            &cancellation,
            &mut commands,
            &mut reconnect_generation,
        )
        .await
        {
            break;
        }
        reconnect_delay = reconnect_delay
            .saturating_mul(2)
            .min(MAXIMUM_RECONNECT_DELAY);
    }
}

async fn wait_for_reconnect(
    delay: Duration,
    session: &WorkspaceSession,
    cancellation: &CancellationToken,
    commands: &mut mpsc::Receiver<PresenceCommand>,
    reconnect_generation: &mut watch::Receiver<u64>,
) -> bool {
    // Ignore foreground signals observed while the physical socket was live.
    {
        let _observed_generation = *reconnect_generation.borrow_and_update();
    }
    let delay = time::sleep(delay);
    tokio::pin!(delay);
    loop {
        let workspace_cancellation = session.cancellation.clone();
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => return false,
            _ = workspace_cancellation.cancelled() => return false,
            changed = reconnect_generation.changed() => return changed.is_ok(),
            _ = &mut delay => return true,
            command = commands.recv() => {
                // Presence mutations are explicitly lossy and are never
                // replayed onto a later Bail.
                if command.is_none() {
                    return false;
                }
            }
        }
    }
}

async fn run_physical_presence(
    session: &WorkspaceSession,
    opened: OpenPresence,
    commands: &mut mpsc::Receiver<PresenceCommand>,
    deliveries: &mpsc::Sender<Result<PresenceDelivery, ClientFailure>>,
    cancellation: &CancellationToken,
) -> PhysicalConnectionExit {
    let OpenPresence {
        mut socket,
        mut state,
        lease_token,
        heartbeat_interval_ms,
        initial_delivery: _,
    } = opened;
    let mut sequence = 0_u64;
    let interval = Duration::from_millis(heartbeat_interval_ms);
    let mut heartbeat = time::interval_at(Instant::now() + interval, interval);
    let mut degraded_delivered = false;
    loop {
        let workspace_cancellation = session.cancellation.clone();
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => return PhysicalConnectionExit::Stop,
            _ = workspace_cancellation.cancelled() => return PhysicalConnectionExit::Stop,
            command = commands.recv() => {
                match command {
                    Some(PresenceCommand::SetStatus(status)) => {
                        sequence = sequence.saturating_add(1);
                        if send_json(&mut socket, json!({
                            "contract": "presence.status.set@1",
                            "leaseToken": lease_token,
                            "sequence": sequence,
                            "status": status,
                        })).await.is_err() {
                            return PhysicalConnectionExit::Reconnect { degraded_delivered };
                        }
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
                        })).await.is_err() {
                            return PhysicalConnectionExit::Reconnect { degraded_delivered };
                        }
                    }
                    None => return PhysicalConnectionExit::Stop,
                }
            }
            _ = heartbeat.tick() => {
                sequence = sequence.saturating_add(1);
                if send_json(&mut socket, json!({
                    "contract": "presence.hold@1",
                    "type": "heartbeat",
                    "leaseToken": lease_token,
                    "sequence": sequence,
                })).await.is_err() {
                    return PhysicalConnectionExit::Reconnect { degraded_delivered };
                }
            }
            incoming = socket.next() => {
                let result = match incoming {
                    Some(Ok(Message::Text(text))) if text.len() <= MAX_FRAME_BYTES => {
                        serde_json::from_str::<PresenceServerFrame>(&text)
                            .map_err(|_| ClientFailure::contract("presence.hold-server-frame@1"))
                            .and_then(|frame| reduce_presence_frame(&state, frame))
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        if socket.send(Message::Pong(payload)).await.is_err() {
                            return PhysicalConnectionExit::Reconnect { degraded_delivered };
                        }
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
                            degraded_delivered |= matches!(
                                &delivery,
                                PresenceDelivery::RealtimeDegraded { .. }
                            );
                            if deliveries.send(Ok(delivery)).await.is_err() {
                                return PhysicalConnectionExit::Stop;
                            }
                        }
                    }
                    Err(error) => {
                        return if matches!(error.kind, FailureKind::Transport) {
                            PhysicalConnectionExit::Reconnect { degraded_delivered }
                        } else if matches!(
                            error.kind,
                            FailureKind::Cancelled | FailureKind::StaleWorkspace
                        ) {
                            PhysicalConnectionExit::Stop
                        } else {
                            PhysicalConnectionExit::Terminal(error)
                        };
                    }
                }
            }
        }
    }
}

async fn send_json(
    socket: &mut PresenceSocket,
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

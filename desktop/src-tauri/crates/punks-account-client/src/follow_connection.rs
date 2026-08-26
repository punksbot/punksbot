use futures_util::{SinkExt, StreamExt};
use reqwest::{
    cookie::CookieStore,
    header::{HeaderValue, COOKIE, ORIGIN, SEC_WEBSOCKET_PROTOCOL},
};
use serde::Serialize;
use tokio::net::TcpStream;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
    MaybeTlsStream, WebSocketStream,
};
use tokio_util::sync::CancellationToken;

use crate::follow::validate_follow_frame;
use crate::{
    promotion_audit::record_network_request, reduce_follow_frame, validate_uuid, ClientFailure,
    ClientResyncReason, ConversationUnavailableReason, FailureKind, FollowEffect,
    FollowServerFrame, FollowState, PresenceTypingPatch, Transport, WorkspaceSession,
};

const FOLLOW_PROTOCOL: &str = "punks.follow.v1";
const MAX_FRAME_BYTES: usize = 262_144;

pub(crate) fn classify_follow_close(code: u16, reason: &str) -> FailureKind {
    match (code, reason) {
        (1008, "authorization revoked" | "conversation unavailable") => FailureKind::Problem,
        (1008, _) => FailureKind::ContractViolation,
        _ => FailureKind::Transport,
    }
}

/// Renderer delivery emitted by one native FOLLOW connection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum FollowDelivery {
    ApplyBatch {
        frame: FollowServerFrame,
    },
    Typing {
        patch: PresenceTypingPatch,
    },
    BecameLive,
    Resync {
        reason: ClientResyncReason,
        after_cursor: u64,
        high_water_cursor: u64,
    },
    Terminal {
        reason: ConversationUnavailableReason,
        cursor: u64,
    },
}

/// Native WebSocket owned by exactly one generation-bound WorkspaceSession.
pub struct FollowConnection {
    session: WorkspaceSession,
    conversation_id: String,
    socket: WebSocketStream<MaybeTlsStream<TcpStream>>,
    state: FollowState,
    cancellation: FollowCancellation,
}

/// Cloneable cancellation handle retained by the owning Tauri generation.
#[derive(Clone)]
pub struct FollowCancellation(CancellationToken);

impl FollowCancellation {
    pub fn cancel(&self) {
        self.0.cancel();
    }
}

impl WorkspaceSession {
    /// Opens `punks.follow.v1` with the private HTTP cookie jar.
    pub async fn follow_conversation(
        &self,
        conversation_id: &str,
        after_cursor: u64,
    ) -> Result<FollowConnection, ClientFailure> {
        validate_uuid(conversation_id, "conversationId")?;
        crate::promotion_audit::begin_live_follow_capture(after_cursor);
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
                    "Test transport does not implement FOLLOW",
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
            .map_err(|_| {
                ClientFailure::new(
                    FailureKind::ContractViolation,
                    "Punks FOLLOW origin is invalid",
                )
            })?;
        websocket_url.set_path(&format!(
            "/api/v1/workspaces/{}/conversations/{conversation_id}/follow",
            self.lease.workspace_id
        ));
        websocket_url
            .query_pairs_mut()
            .append_pair("afterCursor", &after_cursor.to_string());
        let mut request = websocket_url.as_str().into_client_request().map_err(|_| {
            ClientFailure::new(
                FailureKind::ContractViolation,
                "Punks FOLLOW request is invalid",
            )
        })?;
        request.headers_mut().insert(
            ORIGIN,
            HeaderValue::from_str(&self.lease.origin).map_err(|_| {
                ClientFailure::new(
                    FailureKind::ContractViolation,
                    "Punks FOLLOW origin header is invalid",
                )
            })?,
        );
        request.headers_mut().insert(
            SEC_WEBSOCKET_PROTOCOL,
            HeaderValue::from_static(FOLLOW_PROTOCOL),
        );
        if let Some(cookie) = transport.jar.cookies(&transport.origin) {
            request.headers_mut().insert(COOKIE, cookie);
        }
        let cancellation = self.cancellation.clone();
        let (socket, response) = tokio::select! {
            biased;
            _ = cancellation.cancelled() => {
                return Err(ClientFailure::new(
                    FailureKind::Cancelled,
                    "Punks FOLLOW connection was cancelled",
                ));
            }
            result = connect_async(request) => result.map_err(|_| {
                ClientFailure::new(
                    FailureKind::Transport,
                    "Punks FOLLOW connection could not be opened",
                )
            })?,
        };
        record_network_request("FOLLOW", &websocket_url, response.status().as_u16());
        if response
            .headers()
            .get(SEC_WEBSOCKET_PROTOCOL)
            .and_then(|value| value.to_str().ok())
            != Some(FOLLOW_PROTOCOL)
        {
            return Err(ClientFailure::new(
                FailureKind::ContractViolation,
                "Punks FOLLOW selected an unexpected subprotocol",
            ));
        }
        self.assert_current().await?;
        Ok(FollowConnection {
            session: self.clone(),
            conversation_id: conversation_id.to_owned(),
            socket,
            state: FollowState::new(after_cursor),
            cancellation: FollowCancellation(CancellationToken::new()),
        })
    }
}

impl FollowConnection {
    pub fn cancellation(&self) -> FollowCancellation {
        self.cancellation.clone()
    }

    /// Waits for the next indivisible renderer delivery.
    pub async fn next_delivery(&mut self) -> Result<FollowDelivery, ClientFailure> {
        loop {
            self.session.assert_current().await?;
            let cancellation = self.cancellation.0.clone();
            let workspace_cancellation = self.session.cancellation.clone();
            let next = tokio::select! {
                _ = cancellation.cancelled() => {
                    return Err(ClientFailure::new(
                        FailureKind::Cancelled,
                        "Punks FOLLOW was cancelled",
                    ));
                }
                _ = workspace_cancellation.cancelled() => {
                    return Err(ClientFailure::new(
                        FailureKind::Cancelled,
                        "Punks Workspace FOLLOW was cancelled",
                    ));
                }
                next = self.socket.next() => next,
            };
            let message = next.ok_or_else(|| {
                ClientFailure::new(FailureKind::Transport, "Punks FOLLOW connection ended")
            })?;
            let message = message.map_err(|_| {
                ClientFailure::new(FailureKind::Transport, "Punks FOLLOW read failed")
            })?;
            let text = match message {
                Message::Text(text) if text.len() <= MAX_FRAME_BYTES => text,
                Message::Ping(payload) => {
                    self.socket
                        .send(Message::Pong(payload))
                        .await
                        .map_err(|_| {
                            ClientFailure::new(
                                FailureKind::Transport,
                                "Punks FOLLOW heartbeat failed",
                            )
                        })?;
                    continue;
                }
                Message::Close(frame) => {
                    let kind = frame.as_ref().map_or(FailureKind::Transport, |frame| {
                        classify_follow_close(frame.code.into(), frame.reason.as_ref())
                    });
                    let message = match kind {
                        FailureKind::Problem => "Punks FOLLOW authorization is no longer available",
                        FailureKind::ContractViolation => {
                            "Punks FOLLOW closed after a protocol violation"
                        }
                        _ => "Punks FOLLOW connection ended",
                    };
                    return Err(ClientFailure::new(kind, message));
                }
                _ => {
                    return Err(ClientFailure::new(
                        FailureKind::ContractViolation,
                        "Punks FOLLOW frame is invalid",
                    ))
                }
            };
            let frame = serde_json::from_str::<FollowServerFrame>(&text).map_err(|_| {
                ClientFailure::new(
                    FailureKind::ContractViolation,
                    "Punks FOLLOW frame violated its contract",
                )
            })?;
            validate_follow_frame(
                &frame,
                &self.session.lease().workspace_id,
                &self.conversation_id,
            )?;
            crate::promotion_audit::record_live_follow_frame(&frame);
            let reduction = reduce_follow_frame(&self.state, frame);
            self.state = reduction.state;
            self.session.assert_current().await?;
            match reduction.effect {
                FollowEffect::None => continue,
                FollowEffect::ApplyBatch(frame) => return Ok(FollowDelivery::ApplyBatch { frame }),
                FollowEffect::Typing(patch) => return Ok(FollowDelivery::Typing { patch }),
                FollowEffect::BecameLive => return Ok(FollowDelivery::BecameLive),
                FollowEffect::Resync {
                    reason,
                    after_cursor,
                    high_water_cursor,
                } => {
                    return Ok(FollowDelivery::Resync {
                        reason,
                        after_cursor,
                        high_water_cursor,
                    })
                }
                FollowEffect::Terminal { reason, cursor } => {
                    return Ok(FollowDelivery::Terminal { reason, cursor })
                }
            }
        }
    }

    /// Sends ACK only after the renderer confirms the exact delivered cursor.
    pub async fn confirm_batch(&mut self, through_cursor: u64) -> Result<(), ClientFailure> {
        self.session.assert_current().await?;
        let confirmation = crate::confirm_follow_batch(&self.state, through_cursor);
        let ack = confirmation.ack.ok_or_else(|| {
            ClientFailure::new(
                FailureKind::ContractViolation,
                "Punks FOLLOW confirmation does not match the pending batch",
            )
        })?;
        let text = serde_json::to_string(&ack).map_err(|_| {
            ClientFailure::new(
                FailureKind::ContractViolation,
                "Punks FOLLOW ACK could not be encoded",
            )
        })?;
        let cancellation = self.cancellation.0.clone();
        let workspace_cancellation = self.session.cancellation.clone();
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => {
                return Err(ClientFailure::new(
                    FailureKind::Cancelled,
                    "Punks FOLLOW was cancelled",
                ));
            }
            _ = workspace_cancellation.cancelled() => {
                return Err(ClientFailure::new(
                    FailureKind::Cancelled,
                    "Punks Workspace FOLLOW was cancelled",
                ));
            }
            result = self.socket.send(Message::Text(text.into())) => {
                result.map_err(|_| {
                    ClientFailure::new(FailureKind::Transport, "Punks FOLLOW ACK failed")
                })?;
            }
        }
        self.session.assert_current().await?;
        self.state = confirmation.state;
        crate::promotion_audit::record_live_follow_confirmation(through_cursor);
        Ok(())
    }

    /// Closes the native socket for this Workspace generation.
    pub async fn close(&mut self) -> Result<(), ClientFailure> {
        self.cancellation.cancel();
        self.socket
            .close(None)
            .await
            .map_err(|_| ClientFailure::new(FailureKind::Transport, "Punks FOLLOW close failed"))
    }
}

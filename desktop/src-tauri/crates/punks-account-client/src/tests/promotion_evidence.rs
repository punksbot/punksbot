use super::*;
use crate::PromotionFaultObservationInput;

#[tokio::test]
async fn installed_fault_observer_uses_the_native_session_and_closed_identity() {
    let execution_id = "abababababab.efefefefefef:linux-x64:coupure:api-conversation";
    let client = client_with(move |_method, path, body, _idempotency_key| {
        let execution_id = execution_id.to_string();
        Box::pin(async move {
            Ok(match path.as_str() {
                "/api/v1/desktop/compatibility" => compatibility(),
                "/api/auth/v1/session" => session(),
                "/api/v1/promotion/faults/observe" => {
                    assert_eq!(
                        body,
                        Some(json!({
                            "contract": "promotion.fault-observe@1",
                            "executionId": execution_id,
                            "candidateSha": "ab".repeat(20),
                            "stagingDeploymentId": format!("sha256:{}", "cd".repeat(32)),
                            "type": "coupure",
                            "authority": "api-conversation",
                            "target": {
                                "kind": "aggregate",
                                "id": "11111111-1111-4111-8111-111111111111",
                            },
                        }))
                    );
                    json!({
                        "contract": "promotion.fault-observe@1",
                        "executionId": execution_id,
                        "authority": "api-conversation",
                        "status": "recovered",
                    })
                }
                _ => return Err(ClientFailure::new(FailureKind::Problem, "unexpected")),
            })
        })
    });
    client.check_compatibility().await.unwrap();
    client.get_session().await.unwrap();

    let result = client
        .observe_promotion_fault(PromotionFaultObservationInput {
            execution_id: execution_id.to_string(),
            candidate_sha: "ab".repeat(20),
            staging_deployment_id: format!("sha256:{}", "cd".repeat(32)),
            fault_type: "coupure".to_string(),
            authority: "api-conversation".to_string(),
            target: crate::PromotionFaultTarget {
                kind: "aggregate".to_string(),
                id: "11111111-1111-4111-8111-111111111111".to_string(),
            },
        })
        .await
        .unwrap();
    assert_eq!(result.status, "recovered");
    assert_eq!(result.execution_id, execution_id);
}

#[test]
fn installed_promotion_conformance_closes_every_required_follow_scenario() {
    let scenarios = crate::promotion_follow_conformance()
        .expect("the embedded FOLLOW corpus must stay executable");
    let outcomes = scenarios
        .iter()
        .map(|(name, result)| (name.as_str(), result.outcome.as_str()))
        .collect::<std::collections::BTreeMap<_, _>>();
    assert_eq!(
        outcomes,
        std::collections::BTreeMap::from([
            ("changements-avant-ready", "vert"),
            ("crash-apres-ack", "ne-rejoue-pas"),
            ("crash-avant-ack", "rejoue"),
            ("divergence", "resync"),
            ("doublon-exact", "ignore"),
            ("pagination-concurrente", "vert"),
            ("resync", "vert"),
            ("snapshot", "vert"),
            ("terminal", "vert"),
            ("trou", "resync"),
        ]),
    );
    assert!(scenarios
        .values()
        .all(|result| !result.observations.is_empty()));
}

#[test]
fn installed_promotion_conformance_closes_every_authentication_scenario() {
    let scenarios = crate::promotion_auth_conformance()
        .expect("the compiled authentication ceremony must stay executable");
    let outcomes = scenarios
        .iter()
        .map(|(name, result)| (name.as_str(), result.outcome.as_str()))
        .collect::<std::collections::BTreeMap<_, _>>();
    assert_eq!(
        outcomes,
        std::collections::BTreeMap::from([
            ("crash-livraison-avant-confirmation", "reprenable"),
            ("deeplink-rejoue", "refuse"),
            ("deconnexion-hors-ligne", "mise-en-file"),
            ("expiration", "expire"),
            ("github-annulation", "vert"),
            ("github-succes", "vert"),
            ("google-annulation", "vert"),
            ("google-succes", "vert"),
            ("mauvaise-origine", "refuse"),
            ("passkey-annulation", "vert"),
            ("passkey-succes", "vert"),
            ("renouvellement", "borne"),
        ]),
    );
    assert!(scenarios
        .values()
        .all(|result| !result.observations.is_empty()));
}

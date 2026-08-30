use std::{io::Read, net::ToSocketAddrs, time::Duration};

use nostr::Event;
use serde_json::{json, Value};

use super::render_template;

const MAX_WEBHOOK_RESPONSE_BYTES: u64 = 1024 * 1024;

pub(super) fn call_webhook(step: &Value, trigger_event: &Event) -> Result<Value, String> {
    let raw_url = step
        .get("url")
        .and_then(Value::as_str)
        .ok_or_else(|| "call_webhook URL is missing".to_string())?;
    let url = render_template(raw_url, trigger_event);
    let parsed = reqwest::Url::parse(&url)
        .map_err(|error| format!("call_webhook URL is invalid: {error}"))?;
    if parsed.scheme() != "https" {
        return Err("call_webhook requires a public HTTPS URL".to_string());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "call_webhook URL has no host".to_string())?;
    let port = parsed.port_or_known_default().unwrap_or(443);
    let addresses = (host, port)
        .to_socket_addrs()
        .map_err(|error| format!("resolve call_webhook host: {error}"))?
        .collect::<Vec<_>>();
    if addresses.is_empty() || addresses.iter().any(|address| !is_public_ip(address.ip())) {
        return Err("call_webhook requires a public HTTPS destination".to_string());
    }
    let pinned = *addresses
        .first()
        .ok_or_else(|| "call_webhook host has no address".to_string())?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .connect_timeout(Duration::from_secs(5))
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .resolve(host, pinned)
        .build()
        .map_err(|error| format!("build call_webhook client: {error}"))?;
    let method = step.get("method").and_then(Value::as_str).unwrap_or("POST");
    let method = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|error| format!("call_webhook method is invalid: {error}"))?;
    if matches!(method, reqwest::Method::CONNECT | reqwest::Method::TRACE) {
        return Err("call_webhook method is not allowed".to_string());
    }
    let mut request = client.request(method, parsed);
    if let Some(headers) = step.get("headers").and_then(Value::as_object) {
        for (name, value) in headers {
            let lower = name.to_ascii_lowercase();
            if matches!(
                lower.as_str(),
                "authorization" | "proxy-authorization" | "cookie" | "x-api-key"
            ) {
                return Err(
                    "call_webhook credentials must use a configured provider, not workflow YAML"
                        .to_string(),
                );
            }
            let value = value
                .as_str()
                .ok_or_else(|| "call_webhook header values must be strings".to_string())?;
            request = request.header(name, render_template(value, trigger_event));
        }
    }
    if let Some(body) = step.get("body").and_then(Value::as_str) {
        request = request.body(render_template(body, trigger_event));
    }
    let mut response = request
        .send()
        .map_err(|error| format!("call_webhook transport failed: {error}"))?;
    let status = response.status();
    let mut bytes = Vec::new();
    response
        .by_ref()
        .take(MAX_WEBHOOK_RESPONSE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("read call_webhook response: {error}"))?;
    if bytes.len() as u64 > MAX_WEBHOOK_RESPONSE_BYTES {
        return Err("call_webhook response exceeds 1 MiB".to_string());
    }
    let text = String::from_utf8_lossy(&bytes).into_owned();
    if !status.is_success() {
        return Err(format!(
            "call_webhook returned HTTP {}: {}",
            status.as_u16(),
            text.chars().take(512).collect::<String>()
        ));
    }
    let body = serde_json::from_slice::<Value>(&bytes).unwrap_or_else(|_| json!(text));
    Ok(json!({
        "status": status.as_u16(),
        "body": body
    }))
}

fn is_public_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(ip) => {
            !(ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_multicast()
                || ip.is_broadcast()
                || ip.is_documentation()
                || ip.is_unspecified())
        }
        std::net::IpAddr::V6(ip) => {
            !(ip.is_loopback()
                || ip.is_multicast()
                || ip.is_unspecified()
                || ip.is_unique_local()
                || ip.is_unicast_link_local())
        }
    }
}

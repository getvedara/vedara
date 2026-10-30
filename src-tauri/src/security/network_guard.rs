use std::net::IpAddr;
use std::str::FromStr;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct NetworkTargetStatus {
    pub allowed: bool,
    pub host: String,
    pub port: Option<u16>,
    pub scheme: String,
    pub reason: String,
    pub is_loopback: bool,
}

/// Helper to determine if a hostname or IP string represents a local loopback target.
pub fn is_loopback_host(host: &str) -> bool {
    let clean_host = host.trim().trim_matches('[').trim_matches(']');
    
    if clean_host.eq_ignore_ascii_case("localhost") {
        return true;
    }

    if let Ok(ip) = IpAddr::from_str(clean_host) {
        match ip {
            IpAddr::V4(v4) => v4.is_loopback(),
            IpAddr::V6(v6) => {
                if v6.is_loopback() {
                    return true;
                }
                // Handle IPv4-mapped IPv6 loopback (::ffff:127.0.0.1)
                if let Some(v4_mapped) = v6.to_ipv4_mapped() {
                    return v4_mapped.is_loopback();
                }
                false
            }
        }
    } else {
        false
    }
}

/// Validates whether a target network string (URL or host:port) is 100% air-gap compliant.
/// Only loopback addresses (127.0.0.0/8, ::1, localhost) over permitted local schemes
/// (http, ws, and optional https/wss on loopback) are allowed.
pub fn validate_network_target(target: &str) -> Result<NetworkTargetStatus, String> {
    let trimmed = target.trim();
    if trimmed.is_empty() {
        return Err("Network target cannot be empty".to_string());
    }

    // Parse scheme and remainder
    let (scheme, host_port_part) = if let Some(idx) = trimmed.find("://") {
        let s = &trimmed[..idx];
        let remainder = &trimmed[idx + 3..];
        (s.to_lowercase(), remainder)
    } else {
        ("http".to_string(), trimmed)
    };

    // Verify scheme is an approved local transport
    let allowed_schemes = ["http", "https", "ws", "wss"];
    if !allowed_schemes.contains(&scheme.as_str()) {
        return Ok(NetworkTargetStatus {
            allowed: false,
            host: String::new(),
            port: None,
            scheme: scheme.clone(),
            reason: format!("Forbidden transport scheme '{}'. Only local HTTP and WebSocket protocols are permitted.", scheme),
            is_loopback: false,
        });
    }

    // Extract host and port from host_port_part (stripping paths, queries, credentials)
    let host_and_port = host_port_part
        .split('/')
        .next()
        .unwrap_or("")
        .split('?')
        .next()
        .unwrap_or("");

    // Strip optional userinfo (e.g. user:pass@host)
    let authority = if let Some(at_idx) = host_and_port.rfind('@') {
        &host_and_port[at_idx + 1..]
    } else {
        host_and_port
    };

    // Parse IPv6 with brackets or IPv4 / hostname
    let (host, port) = if authority.starts_with('[') {
        if let Some(bracket_end) = authority.find(']') {
            let host_part = &authority[1..bracket_end];
            let rest = &authority[bracket_end + 1..];
            let port_opt = if let Some(colon_idx) = rest.find(':') {
                rest[colon_idx + 1..].parse::<u16>().ok()
            } else {
                None
            };
            (host_part.to_string(), port_opt)
        } else {
            return Err("Mismatched IPv6 bracket formatting".to_string());
        }
    } else if let Some(colon_idx) = authority.rfind(':') {
        let h = &authority[..colon_idx];
        let p_str = &authority[colon_idx + 1..];
        if let Ok(p) = p_str.parse::<u16>() {
            (h.to_string(), Some(p))
        } else {
            // Not a valid port number, treat whole authority as host
            (authority.to_string(), None)
        }
    } else {
        (authority.to_string(), None)
    };

    let loopback = is_loopback_host(&host);

    if !loopback {
        return Ok(NetworkTargetStatus {
            allowed: false,
            host: host.clone(),
            port,
            scheme,
            reason: format!(
                "Host '{}' violates Vedara zero-telemetry air-gap policy: external network hosts are strictly forbidden.",
                host
            ),
            is_loopback: false,
        });
    }

    Ok(NetworkTargetStatus {
        allowed: true,
        host,
        port,
        scheme,
        reason: "Air-gap compliant loopback endpoint".to_string(),
        is_loopback: true,
    })
}

#[tauri::command]
pub fn validate_network_target_cmd(target: String) -> Result<NetworkTargetStatus, String> {
    validate_network_target(&target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_loopback_host() {
        assert!(is_loopback_host("localhost"));
        assert!(is_loopback_host("LOCALHOST"));
        assert!(is_loopback_host("127.0.0.1"));
        assert!(is_loopback_host("127.0.0.50"));
        assert!(is_loopback_host("127.255.255.254"));
        assert!(is_loopback_host("::1"));
        assert!(is_loopback_host("[::1]"));

        assert!(!is_loopback_host("example.com"));
        assert!(!is_loopback_host("api.openai.com"));
        assert!(!is_loopback_host("8.8.8.8"));
        assert!(!is_loopback_host("192.168.1.1"));
        assert!(!is_loopback_host("10.0.0.1"));
    }

    #[test]
    fn test_validate_local_ollama_url() {
        let res = validate_network_target("http://127.0.0.1:11434/api/generate").unwrap();
        assert!(res.allowed);
        assert_eq!(res.host, "127.0.0.1");
        assert_eq!(res.port, Some(11434));
        assert_eq!(res.scheme, "http");
        assert!(res.is_loopback);
    }

    #[test]
    fn test_validate_localhost_ws() {
        let res = validate_network_target("ws://localhost:8080/events").unwrap();
        assert!(res.allowed);
        assert_eq!(res.host, "localhost");
        assert_eq!(res.port, Some(8080));
        assert_eq!(res.scheme, "ws");
        assert!(res.is_loopback);
    }

    #[test]
    fn test_validate_ipv6_loopback() {
        let res = validate_network_target("http://[::1]:11434/api/tags").unwrap();
        assert!(res.allowed);
        assert_eq!(res.host, "::1");
        assert_eq!(res.port, Some(11434));
        assert!(res.is_loopback);
    }

    #[test]
    fn test_reject_external_cloud_hosts() {
        let res = validate_network_target("https://api.openai.com/v1/chat").unwrap();
        assert!(!res.allowed);
        assert!(!res.is_loopback);
        assert!(res.reason.contains("violates Vedara zero-telemetry air-gap policy"));

        let res2 = validate_network_target("http://8.8.8.8:80/telemetry").unwrap();
        assert!(!res2.allowed);
        assert!(!res2.is_loopback);
    }

    #[test]
    fn test_reject_forbidden_schemes() {
        let res = validate_network_target("ftp://127.0.0.1:21/files").unwrap();
        assert!(!res.allowed);
        assert!(res.reason.contains("Forbidden transport scheme"));
    }
}

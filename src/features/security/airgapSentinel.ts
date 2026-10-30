/**
 * Vedara Air-Gap Security Sentinel
 *
 * Enforces zero-telemetry and strict local network isolation.
 * Prevents unauthorized outbound HTTP/WebSocket requests to external endpoints,
 * CDNs, or cloud tracking beacons.
 */

export class AirgapSecurityError extends Error {
  public readonly target: string;
  public readonly violationType: 'non_loopback' | 'forbidden_scheme' | 'telemetry_sink' | 'cdn_leak';

  constructor(
    message: string,
    target: string,
    violationType: 'non_loopback' | 'forbidden_scheme' | 'telemetry_sink' | 'cdn_leak' = 'non_loopback'
  ) {
    super(message);
    this.name = 'AirgapSecurityError';
    this.target = target;
    this.violationType = violationType;
  }
}

export interface AirgapValidationResult {
  allowed: boolean;
  host: string;
  port?: number;
  scheme: string;
  reason: string;
  isLoopback: boolean;
}

const ALLOWED_NAMESPACES = new Set([
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/1999/xhtml',
]);

const FORBIDDEN_TELEMETRY_PATTERNS = [
  'google-analytics.com',
  'googletagmanager.com',
  'mixpanel.com',
  'segment.io',
  'sentry.io',
  'amplitude.com',
  'datadoghq.com',
  'posthog.com',
  'bugsnag.com',
  'telemetry.openstudio',
  'analytics.openstudio',
  'telemetry.vedara',
  'analytics.vedara',
];

const FORBIDDEN_CDN_PATTERNS = [
  'cdnjs.cloudflare.com',
  'unpkg.com',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'raw.githubusercontent.com',
];

/**
 * Checks if a given host string is a local loopback interface.
 */
export function isLoopbackHost(rawHost: string): boolean {
  if (!rawHost) return false;
  const host = rawHost.trim().toLowerCase().replace(/^\[|\]$/g, '');

  if (host === 'localhost' || host === '::1' || host === '0.0.0.0') {
    return true;
  }

  // IPv4 loopback check (127.0.0.0/8)
  const ipv4Match = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4Match) {
    const [, b, c, d] = ipv4Match.map(Number);
    return b >= 0 && b <= 255 && c >= 0 && c <= 255 && d >= 0 && d <= 255;
  }

  // IPv4-mapped IPv6 loopback (::ffff:127.0.0.1)
  if (host.startsWith('::ffff:127.')) {
    return true;
  }

  return false;
}

/**
 * Validates a target URL against Vedara's zero-telemetry air-gap policy.
 */
export function validateAirgapUrl(inputUrl: string): AirgapValidationResult {
  const trimmed = (inputUrl || '').trim();
  if (!trimmed) {
    return {
      allowed: false,
      host: '',
      scheme: '',
      reason: 'Network target URL cannot be empty.',
      isLoopback: false,
    };
  }

  // Exempt standard XML / SVG schemas
  if (ALLOWED_NAMESPACES.has(trimmed)) {
    return {
      allowed: true,
      host: 'w3.org',
      scheme: 'http',
      reason: 'Standard static schema namespace allowed.',
      isLoopback: false,
    };
  }

  if (trimmed.startsWith('http://json-schema.org') || trimmed.startsWith('https://json-schema.org') || trimmed.startsWith('https://schema.tauri.app')) {
    return {
      allowed: true,
      host: 'json-schema.org',
      scheme: 'http',
      reason: 'Standard meta-schema identifier allowed.',
      isLoopback: false,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`);
  } catch {
    return {
      allowed: false,
      host: '',
      scheme: '',
      reason: `Malformed URL: unable to parse target '${trimmed}'.`,
      isLoopback: false,
    };
  }

  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
  const allowedSchemes = ['http', 'https', 'ws', 'wss'];
  if (!allowedSchemes.includes(scheme)) {
    return {
      allowed: false,
      host: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port, 10) : undefined,
      scheme,
      reason: `Forbidden scheme '${scheme}'. Only local HTTP and WebSocket protocols are permitted.`,
      isLoopback: false,
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Check telemetry sinks
  if (FORBIDDEN_TELEMETRY_PATTERNS.some((pattern) => hostname.includes(pattern))) {
    return {
      allowed: false,
      host: hostname,
      port: parsed.port ? parseInt(parsed.port, 10) : undefined,
      scheme,
      reason: `Blocked connection to known telemetry/tracking destination: '${hostname}'.`,
      isLoopback: false,
    };
  }

  // Check CDN sinks
  if (FORBIDDEN_CDN_PATTERNS.some((pattern) => hostname.includes(pattern))) {
    return {
      allowed: false,
      host: hostname,
      port: parsed.port ? parseInt(parsed.port, 10) : undefined,
      scheme,
      reason: `Blocked connection to external CDN: '${hostname}'. Vedara must run 100% offline.`,
      isLoopback: false,
    };
  }

  const loopback = isLoopbackHost(hostname);
  if (!loopback) {
    return {
      allowed: false,
      host: hostname,
      port: parsed.port ? parseInt(parsed.port, 10) : undefined,
      scheme,
      reason: `Host '${hostname}' violates Vedara air-gap policy: non-loopback endpoints are strictly forbidden.`,
      isLoopback: false,
    };
  }

  return {
    allowed: true,
    host: hostname,
    port: parsed.port ? parseInt(parsed.port, 10) : undefined,
    scheme,
    reason: 'Air-gap compliant loopback target.',
    isLoopback: true,
  };
}

/**
 * Asserts that a target URL is air-gap compliant, throwing AirgapSecurityError if not.
 */
export function assertAirgapUrl(inputUrl: string): void {
  const result = validateAirgapUrl(inputUrl);
  if (!result.allowed) {
    let violationType: 'non_loopback' | 'forbidden_scheme' | 'telemetry_sink' | 'cdn_leak' = 'non_loopback';
    if (result.reason.includes('telemetry')) {
      violationType = 'telemetry_sink';
    } else if (result.reason.includes('CDN')) {
      violationType = 'cdn_leak';
    } else if (result.reason.includes('scheme')) {
      violationType = 'forbidden_scheme';
    }
    throw new AirgapSecurityError(result.reason, inputUrl, violationType);
  }
}

/**
 * Validates a network target via native Tauri backend if available, falling back to TS validation.
 */
export async function checkNetworkTargetWithBackend(target: string): Promise<AirgapValidationResult> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke<{
      allowed: boolean;
      host: string;
      port?: number;
      scheme: string;
      reason: string;
      is_loopback: boolean;
    }>('validate_network_target_cmd', { target });

    return {
      allowed: result.allowed,
      host: result.host,
      port: result.port,
      scheme: result.scheme,
      reason: result.reason,
      isLoopback: result.is_loopback,
    };
  } catch {
    // Fallback to in-process TypeScript validation
    return validateAirgapUrl(target);
  }
}

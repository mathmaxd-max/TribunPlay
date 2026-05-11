import { performHealthCheck, type HealthCheckResult } from './utils/healthCheck';

const isBrowserLocalHost = (): boolean => {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
};

const forceRemoteApiInDev = import.meta.env.VITE_ALLOW_REMOTE_API_IN_DEV === 'true';

// Default to production API, but detect development environment
// In development, use relative paths (Vite proxy) or localhost
// In production, use the production API URL
// Can be overridden via VITE_API_BASE environment variable
const API_BASE =
  import.meta.env.DEV && isBrowserLocalHost() && !forceRemoteApiInDev
    ? ""
    : (import.meta.env.VITE_API_BASE ?? (() => {
        // Check if we're in development (Vite dev mode or localhost)
        if (import.meta.env.DEV || isBrowserLocalHost()) {
          // Use relative paths in dev - Vite proxy will route to localhost:8787
          return "";
        }
        // Production: use production API
        return "https://api.tribun-ppc.com";
      })());

// WebSocket base URL - defaults to production, but detects development
// Can be overridden via VITE_WS_BASE environment variable
const WS_BASE =
  import.meta.env.DEV && isBrowserLocalHost() && !forceRemoteApiInDev
    ? "ws://localhost:8787"
    : (import.meta.env.VITE_WS_BASE ?? (() => {
        // Check if we're in development
        if (import.meta.env.DEV || isBrowserLocalHost()) {
          // Development: connect directly to local backend
          return "ws://localhost:8787";
        }
        // Production: use production WebSocket endpoint
        return "wss://api.tribun-ppc.com";
      })());

/**
 * Detect the best available endpoint by checking both production and development
 * @param timeout - Timeout in milliseconds for each health check (default: 3000)
 * @returns Promise resolving to detected API_BASE and WS_BASE, or null if detection failed
 */
async function detectBestEndpoint(
  timeout: number = 3000
): Promise<{ apiBase: string; wsBase: string } | null> {
  const candidates = [
    // Production endpoints
    {
      apiBase: 'https://api.tribun-ppc.com',
      wsBase: 'wss://api.tribun-ppc.com',
    },
    // Development endpoints
    {
      apiBase: '',
      wsBase: 'ws://localhost:8787',
    },
  ];

  // Check all candidates in parallel
  const checks = await Promise.all(
    candidates.map((candidate) =>
      performHealthCheck(candidate.apiBase, candidate.wsBase, timeout)
    )
  );

  // Find the first candidate where both API and WebSocket are reachable
  for (let i = 0; i < checks.length; i++) {
    const check = checks[i];
    if (check.api.reachable && check.websocket.reachable) {
      return candidates[i];
    }
  }

  // If no perfect match, prefer the one with API reachable (more critical)
  for (let i = 0; i < checks.length; i++) {
    if (checks[i].api.reachable) {
      return candidates[i];
    }
  }

  // Fallback to production (default behavior)
  return null;
}

export { API_BASE, WS_BASE, detectBestEndpoint, performHealthCheck, type HealthCheckResult };

/**
 * Cloudflare Turnstile site key (public).
 * When unset, the CAPTCHA widget is not shown and no token is sent.
 */
const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
const configuredTurnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() ?? null;

// Local dev must use the test key because real keys are domain-gated.
const TURNSTILE_SITE_KEY: string | null = import.meta.env.DEV ? TURNSTILE_TEST_SITE_KEY : configuredTurnstileSiteKey;

export { TURNSTILE_SITE_KEY };

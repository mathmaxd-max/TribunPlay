import { performHealthCheck, type HealthCheckResult } from './utils/healthCheck';

// Default to production API, but detect development environment
// In development, use relative paths (Vite proxy) or localhost
// In production, use the production API URL
// Can be overridden via VITE_API_BASE environment variable
const API_BASE = import.meta.env.VITE_API_BASE ?? (() => {
  // Check if we're in development (Vite dev mode or localhost)
  if (import.meta.env.DEV || (typeof window !== 'undefined' && window.location.hostname === 'localhost')) {
    // Use relative paths in dev - Vite proxy will route to localhost:8787
    return "";
  }
  // Production: use production API
  return "https://api.tribun-ppc.com";
})();

// WebSocket base URL - defaults to production, but detects development
// Can be overridden via VITE_WS_BASE environment variable
const WS_BASE = import.meta.env.VITE_WS_BASE ?? (() => {
  // Check if we're in development
  if (import.meta.env.DEV || (typeof window !== 'undefined' && window.location.hostname === 'localhost')) {
    // Development: connect directly to local backend
    return "ws://localhost:8787";
  }
  // Production: use production WebSocket endpoint
  return "wss://api.tribun-ppc.com";
})();

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

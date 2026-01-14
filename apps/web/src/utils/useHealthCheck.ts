import { useState, useEffect, useCallback } from 'react';
import { performHealthCheck, type HealthCheckResult } from './healthCheck';
import { API_BASE, WS_BASE, detectBestEndpoint } from '../config';

export interface UseHealthCheckOptions {
  /**
   * Whether to automatically check health on mount
   * @default true
   */
  autoCheck?: boolean;
  
  /**
   * Timeout in milliseconds for each health check
   * @default 5000
   */
  timeout?: number;
  
  /**
   * Interval in milliseconds to re-check health (0 to disable)
   * @default 0 (disabled)
   */
  interval?: number;
}

export interface UseHealthCheckReturn {
  /**
   * Current health check result
   */
  result: HealthCheckResult | null;
  
  /**
   * Whether a health check is currently in progress
   */
  checking: boolean;
  
  /**
   * Error message if health check failed
   */
  error: string | null;
  
  /**
   * Manually trigger a health check
   */
  checkHealth: () => Promise<void>;
  
  /**
   * Detect the best available endpoint
   */
  detectEndpoint: () => Promise<{ apiBase: string; wsBase: string } | null>;
}

/**
 * React hook for checking API and WebSocket health
 * @param options - Configuration options
 * @returns Health check state and functions
 */
export function useHealthCheck(
  options: UseHealthCheckOptions = {}
): UseHealthCheckReturn {
  const {
    autoCheck = true,
    timeout = 5000,
    interval = 0,
  } = options;

  const [result, setResult] = useState<HealthCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkHealth = useCallback(async () => {
    setChecking(true);
    setError(null);
    
    try {
      const healthResult = await performHealthCheck(API_BASE, WS_BASE, timeout);
      setResult(healthResult);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Health check failed';
      setError(errorMessage);
      setResult(null);
    } finally {
      setChecking(false);
    }
  }, [timeout]);

  const detectEndpoint = useCallback(async (): Promise<{ apiBase: string; wsBase: string } | null> => {
    setChecking(true);
    setError(null);
    
    try {
      const detected = await detectBestEndpoint(timeout);
      return detected;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Endpoint detection failed';
      setError(errorMessage);
      return null;
    } finally {
      setChecking(false);
    }
  }, [timeout]);

  useEffect(() => {
    if (autoCheck) {
      checkHealth();
    }
  }, [autoCheck, checkHealth]);

  useEffect(() => {
    if (interval > 0 && autoCheck) {
      const intervalId = setInterval(() => {
        checkHealth();
      }, interval);

      return () => clearInterval(intervalId);
    }
  }, [interval, autoCheck, checkHealth]);

  return {
    result,
    checking,
    error,
    checkHealth,
    detectEndpoint,
  };
}

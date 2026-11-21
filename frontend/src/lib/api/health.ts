/**
 * Typed API client for health / readiness probes.
 *
 * Mirrors `backend/app/api/v1/health.py`. These endpoints are public (no
 * auth required) and are fetched directly rather than through the typed
 * client because /ready can return 503 with a JSON body that the typed
 * client would discard, and because health checks must not trigger token
 * refresh or session-expiry handling.
 */

export interface HealthCheck {
  [name: string]: string;
}

export interface HealthPayload {
  status?: string;
  checks?: HealthCheck;
}

export type HealthState = "checking" | "ready" | "degraded" | "offline";

export const healthApi = {
  checkReadiness: async (): Promise<HealthPayload> => {
    const res = await fetch("/api/v1/health/ready", {
      credentials: "include",
      cache: "no-store",
    });
    return (await res.json().catch(() => ({}))) as HealthPayload;
  },
};

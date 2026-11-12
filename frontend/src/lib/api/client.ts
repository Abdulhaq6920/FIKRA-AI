/**
 * Typed API client for the FIKRA AI backend.
 *
 * All API calls go through this module.
 * - Credentials are always sent (cookies) — no tokens in localStorage.
 * - Errors are parsed into ApiError objects.
 * - A 401 response triggers a token refresh; if that fails, the user is
 *   redirected to /login.
 */

import type { ApiError } from "@/types";

const BASE_URL = "/api/v1";

// ---------------------------------------------------------------------------
// Core fetch wrapper
// ---------------------------------------------------------------------------

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId: string
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
  retried = false
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    credentials: "include", // Always send HttpOnly cookies
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Handle 401 — try token refresh once (except on the auth endpoints
  // themselves, which would ping-pong forever while logged out).
  if (
    res.status === 401 &&
    !retried &&
    path !== "/auth/refresh" &&
    path !== "/auth/login"
  ) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      // Retry original request once; `retried` stops a second 401 from
      // starting another refresh cycle.
      return request<T>(method, path, body, headers, true);
    }
    // Refresh failed — redirect to login, unless we are already on a public
    // auth page (the mount-time /auth/me probe 401s for logged-out visitors
    // on every public page and must not hijack those routes, e.g. it would
    // clobber the /register → /login?mode=signup hand-off).
    const PUBLIC_AUTH_PATHS = ["/login", "/register", "/forgot-password", "/reset-password"];
    if (
      typeof window !== "undefined" &&
      !PUBLIC_AUTH_PATHS.some((p) => window.location.pathname.startsWith(p))
    ) {
      window.location.href = "/login?session_expired=1";
    }
    throw new ApiRequestError(401, "SESSION_EXPIRED", "Session expired", "");
  }

  if (!res.ok) {
    let errorData: ApiError | null = null;
    try {
      errorData = await res.json();
    } catch {
      // Response is not JSON
    }
    throw new ApiRequestError(
      res.status,
      errorData?.error?.code ?? "UNKNOWN_ERROR",
      errorData?.error?.message ?? "An unexpected error occurred.",
      errorData?.error?.request_id ?? ""
    );
  }

  // 204 No Content
  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

/**
 * Shared in-flight refresh. Refresh tokens rotate, so two concurrent refreshes
 * invalidate each other and can trip the auth rate limiter — which ends in a
 * spurious "session expired" logout. Parallel 401s therefore await one call.
 */
let refreshInFlight: Promise<boolean> | null = null;

function tryRefreshToken(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${BASE_URL}/auth/refresh`, {
          method: "POST",
          credentials: "include",
        });
        // Only treat an HTTP 2xx as refresh success; a 401/false previously
        // let callers loop me→refresh→me forever while logged out.
        return res.ok;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

// ---------------------------------------------------------------------------
// Typed API methods
// ---------------------------------------------------------------------------

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),

  // Multipart form upload (not JSON)
  upload: async <T>(path: string, formData: FormData): Promise<T> => {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      credentials: "include",
      body: formData,
      // Do NOT set Content-Type — browser sets it with boundary for multipart
    });
    if (!res.ok) {
      let errorData: ApiError | null = null;
      try {
        errorData = await res.json();
      } catch {}
      throw new ApiRequestError(
        res.status,
        errorData?.error?.code ?? "UPLOAD_ERROR",
        errorData?.error?.message ?? "Upload failed.",
        ""
      );
    }
    return res.json() as Promise<T>;
  },

  // Streaming fetch — returns a ReadableStream
  stream: async (path: string, body: unknown, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> => {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok || !res.body) {
      throw new ApiRequestError(res.status, "STREAM_ERROR", "Stream failed.", "");
    }
    return res.body;
  },
};

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
  headers?: Record<string, string>
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

  // Handle 401 — try token refresh once
  if (res.status === 401 && path !== "/auth/refresh" && path !== "/auth/login") {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      // Retry original request
      return request<T>(method, path, body, headers);
    }
    // Refresh failed — redirect to login
    if (typeof window !== "undefined") {
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

async function tryRefreshToken(): Promise<boolean> {
  try {
    await fetch(`${BASE_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    return true;
  } catch {
    return false;
  }
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

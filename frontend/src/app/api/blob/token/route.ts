/**
 * Issue a short-lived, single-file Vercel Blob upload URL.
 *
 * The browser uploads document bytes directly to Blob so large files never
 * hit Vercel's 4.5 MB Function body limit. Authentication is delegated to the
 * FastAPI service through a private service binding; no token is minted for an
 * unauthenticated caller.
 */

import { issueSignedToken, presignUrl } from "@vercel/blob";
import { NextResponse } from "next/server";

import {
  ALLOWED_MIME_TYPES,
  EXTENSION_MIME,
  MAX_UPLOAD_BYTES,
  fileExtension,
} from "@/lib/uploads/config";

export const runtime = "nodejs";
export const maxDuration = 30;

interface TokenRequest {
  filename?: unknown;
  size?: unknown;
}

function isTokenRequest(value: unknown): value is TokenRequest {
  return typeof value === "object" && value !== null;
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!isTokenRequest(body)) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const filename = typeof body.filename === "string" ? body.filename : "";
  const size = typeof body.size === "number" ? body.size : Number.NaN;
  const ext = fileExtension(filename);

  if (!ext || !Number.isInteger(size) || size < 1 || size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Unsupported file or file too large." }, { status: 400 });
  }

  const mimeType = EXTENSION_MIME[ext];
  if (!mimeType || !ALLOWED_MIME_TYPES.includes(mimeType)) {
    return NextResponse.json({ error: "Unsupported file type." }, { status: 400 });
  }

  // Verify the session with the backend. The binding bypasses the public
  // request pipeline but does not bypass application authentication.
  const backendUrl = (
    process.env.BACKEND_INTERNAL_URL ||
    process.env.BACKEND_URL ||
    "http://localhost:8000"
  ).replace(/\/$/, "");

  let authenticated = false;
  try {
    const authResponse = await fetch(`${backendUrl}/api/v1/auth/me`, {
      headers: {
        cookie: request.headers.get("cookie") ?? "",
        authorization: request.headers.get("authorization") ?? "",
      },
      cache: "no-store",
    });
    authenticated = authResponse.ok;
    await authResponse.body?.cancel();
  } catch {
    authenticated = false;
  }

  if (!authenticated) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  try {
    const pathname = `uploads/${crypto.randomUUID()}/${crypto.randomUUID()}.${ext}`;
    const access = process.env.BLOB_ACCESS === "public" ? "public" : "private";
    const validUntil = Date.now() + 15 * 60 * 1000;

    const token = await issueSignedToken({
      pathname,
      operations: ["put"],
      allowedContentTypes: [mimeType],
      maximumSizeInBytes: MAX_UPLOAD_BYTES,
      validUntil,
    });

    const { presignedUrl } = await presignUrl(token, {
      operation: "put",
      pathname,
      access,
      allowedContentTypes: [mimeType],
      maximumSizeInBytes: MAX_UPLOAD_BYTES,
      addRandomSuffix: false,
      allowOverwrite: false,
      validUntil,
    });

    return NextResponse.json({ presignedUrl, pathname, contentType: mimeType });
  } catch (error) {
    console.error("blob_token_issue_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Could not prepare the upload." }, { status: 500 });
  }
}

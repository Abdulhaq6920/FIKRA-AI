/**
 * Client-direct Vercel Blob upload flow.
 *
 * 1. Ask the Next.js token route for a presigned PUT URL (authenticated).
 * 2. PUT the file straight to Blob — no Function request body is involved.
 * 3. Tell FastAPI where the blob lives so it can create the document row and
 *    queue ingestion.
 */

import { api } from "@/lib/api/client";
import type { Document } from "@/types";

interface BlobTokenResponse {
  presignedUrl: string;
  pathname: string;
  contentType: string;
}

async function requestToken(file: File): Promise<BlobTokenResponse> {
  const payload = JSON.stringify({ filename: file.name, size: file.size });

  const fetchToken = () =>
    fetch("/api/blob/token", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });

  let response = await fetchToken();

  // The access-token cookie is sent to /api/blob/*, but the refresh cookie is
  // scoped to /api/v1/auth. Refresh through the backend, then retry once.
  if (response.status === 401) {
    await api.post("/auth/refresh");
    response = await fetchToken();
  }

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? "Could not prepare the upload.");
  }

  return (await response.json()) as BlobTokenResponse;
}

export async function uploadViaVercelBlob(file: File): Promise<Document> {
  const token = await requestToken(file);

  // Do not set Content-Type: Vercel Blob derives it from the pathname
  // extension, which the token route already validated.
  const put = await fetch(token.presignedUrl, {
    method: "PUT",
    body: file,
  });
  if (!put.ok) {
    throw new Error("The file could not be uploaded to storage. Please retry.");
  }

  return api.post<Document>("/documents/blob/finalize", {
    pathname: token.pathname,
    original_filename: file.name,
    size_bytes: file.size,
  });
}

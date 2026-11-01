/**
 * Shared TypeScript types for the FIKRA AI frontend.
 * These mirror the backend Pydantic schemas and are kept in sync manually.
 * In a CI pipeline, these would be generated from the OpenAPI spec.
 */

// ─── Auth ─────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  full_name: string;
  status: "active" | "inactive" | "pending" | "disabled";
  is_platform_admin: boolean;
  organization_role: "member" | "org_admin" | "platform_admin" | null;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface LoginRequest {
  email: string;
  password: string;
  organization_id: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  full_name: string;
  organization_id: string;
}

// ─── Conversations ────────────────────────────────────────────────────────

export interface Conversation {
  id: string;
  title: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface Citation {
  source_number: number;
  document_id: string;
  document_title: string;
  page_number: number | null;
  section_heading: string | null;
  excerpt: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations: Citation[] | null;
  model_used: string | null;
  created_at: string;
}

export interface ChatResponse {
  answer: string;
  citations: Citation[];
  conversation_id: string;
  message_id: string | null;
  model_used: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
}

// ─── Documents ────────────────────────────────────────────────────────────

export type DocumentStatus =
  | "pending"
  | "queued"
  | "processing"
  | "ready"
  | "failed"
  | "reindexing";

export interface Document {
  id: string;
  title: string;
  original_filename: string;
  mime_type: string;
  file_size_bytes: number;
  status: DocumentStatus;
  access_level: "organization" | "restricted";
  page_count: number | null;
  chunk_count: number;
  created_at: string;
  updated_at: string;
}

export interface DocumentListResponse {
  items: Document[];
  total: number;
  page: number;
  page_size: number;
}

export interface ProcessingJob {
  id: string;
  document_id: string;
  status: string;
  attempt_number: number;
  error_type: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

// ─── API Error ────────────────────────────────────────────────────────────

export interface ApiError {
  error: {
    code: string;
    message: string;
    request_id: string;
  };
}

// ─── UI State ─────────────────────────────────────────────────────────────

export type LoadingState = "idle" | "loading" | "success" | "error";

export interface PaginationParams {
  page: number;
  page_size: number;
}

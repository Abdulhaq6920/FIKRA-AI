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

/** An organization that accepts public self-registration. */
export interface PublicOrganization {
  id: string;
  name: string;
}

export interface SignupOptions {
  organizations: PublicOrganization[];
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

export interface ConversationListResponse {
  items: Conversation[];
  total: number;
  page: number;
  page_size: number;
}

export interface MessageListResponse {
  items: Message[];
  total: number;
  page: number;
  page_size: number;
}

/** A saved question owned by the signed-in user inside their organization. */
export interface FavoriteQuestion {
  id: string;
  question: string;
  created_at: string;
}

export interface FavoriteQuestionListResponse {
  items: FavoriteQuestion[];
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

// ─── Analytics ────────────────────────────────────────────────────────────

export interface AnalyticsSummary {
  total_questions: number;
  total_conversations: number;
  total_tokens: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  avg_latency_ms: number | null;
  total_users: number | null;
  active_users: number | null;
  total_documents: number | null;
  total_feedback: number | null;
  positive_feedback: number | null;
  negative_feedback: number | null;
}

export interface DailyPoint {
  date: string;
  questions: number;
  tokens: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface SourceStat {
  document_id: string | null;
  document_title: string;
  citations: number;
}

export interface QuestionFeedback {
  id: string;
  feedback_type: string;
  comment: string | null;
  review_status: string;
  created_at: string;
}

export interface CitationSource {
  source_number: number;
  document_id: string | null;
  document_title: string;
  page_number: number | null;
  section_heading: string | null;
  excerpt: string;
  chunk_id: string | null;
  retrieval_method: string | null;
  similarity: number | null;
  document_original_filename: string | null;
  document_mime_type: string | null;
  document_status: string | null;
  chunk_content: string | null;
  chunk_token_count: number | null;
}

export interface RecentQuestion {
  id: string;
  conversation_id: string;
  conversation_title: string;
  question: string;
  answer: string | null;
  asked_at: string;
  answered_at: string | null;
  model_used: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  latency_ms: number | null;
  sources: CitationSource[];
  feedback: QuestionFeedback[];
}

export interface FlowStep {
  stage: string;
  label: string;
  status: string;
  timestamp: string | null;
  detail: string | null;
}

export interface QuestionDetail {
  id: string;
  question: string;
  asked_at: string;
  user_id: string;
  user_name: string;
  user_email: string;
  conversation_id: string;
  conversation_title: string;
  answer_id: string | null;
  answer: string | null;
  answered_at: string | null;
  model_used: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  latency_ms: number | null;
  retrieval_latency_ms: number | null;
  sources: CitationSource[];
  feedback: QuestionFeedback[];
  flow: FlowStep[];
}

export interface PersonalAnalytics {
  summary: AnalyticsSummary;
  daily: DailyPoint[];
  top_sources: SourceStat[];
  recent_questions: RecentQuestion[];
}

export interface UserAnalyticsRow {
  user_id: string;
  full_name: string;
  email: string;
  role: "admin" | "member" | string;
  is_active: boolean;
  is_platform_admin: boolean;
  questions: number;
  conversations: number;
  tokens: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  avg_latency_ms: number | null;
  feedback_count: number;
  last_active_at: string | null;
}

export interface UserAnalyticsList {
  items: UserAnalyticsRow[];
  total: number;
  page: number;
  page_size: number;
}

export interface OrgAnalytics {
  summary: AnalyticsSummary;
  daily: DailyPoint[];
  top_sources: SourceStat[];
  users: UserAnalyticsList;
}

export interface UserAnalyticsDetail {
  user: UserAnalyticsRow;
  summary: AnalyticsSummary;
  daily: DailyPoint[];
  top_sources: SourceStat[];
  recent_questions: RecentQuestion[];
}

export interface QuestionListItem {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  conversation_id: string;
  conversation_title: string;
  question: string;
  answer_excerpt: string | null;
  asked_at: string;
  answered_at: string | null;
  model_used: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  latency_ms: number | null;
  citation_count: number;
  feedback_count: number;
}

export interface QuestionList {
  items: QuestionListItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface AdminDocumentRow {
  id: string;
  title: string;
  original_filename: string;
  mime_type: string;
  file_extension: string;
  file_size_bytes: number;
  status: string;
  page_count: number | null;
  chunk_count: number;
  word_count: number | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  uploaded_by_email: string | null;
  citation_count: number;
  created_at: string;
  updated_at: string;
}

export interface AdminDocumentList {
  items: AdminDocumentRow[];
  total: number;
  page: number;
  page_size: number;
}

export interface DocumentJob {
  id: string;
  status: string;
  attempt_number: number;
  error_type: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface DocumentChunkPreview {
  id: string;
  chunk_index: number;
  page_number: number | null;
  section_heading: string | null;
  token_count: number;
  excerpt: string;
}

export interface AdminDocumentDetail extends AdminDocumentRow {
  language: string | null;
  embedding_model: string | null;
  checksum_sha256: string;
  jobs: DocumentJob[];
  chunks: DocumentChunkPreview[];
}

// ─── Admin ────────────────────────────────────────────────────────────────

export type AdminUserRole = "admin" | "member";

export interface AdminMember {
  id: string;
  full_name: string;
  email: string;
  role: "admin" | "member";
  status: string;
  joined_at: string;
}

export interface AdminUser {
  id: string;
  email: string;
  full_name: string;
  role: AdminUserRole;
  is_active: boolean;
  account_status: string;
  is_platform_admin: boolean;
  joined_at: string;
  is_self: boolean;
}

export interface AdminUserCreate {
  email: string;
  full_name: string;
  password: string;
  role: AdminUserRole;
}

export interface AdminUserUpdate {
  full_name?: string;
  role?: AdminUserRole;
  is_active?: boolean;
}

export interface FeedbackItem {
  id: string;
  feedback_type: "thumbs_up" | "thumbs_down" | string;
  comment: string | null;
  review_status: "open" | "in_review" | "solved" | string;
  admin_note: string | null;
  user_name: string;
  user_email: string;
  message_excerpt: string;
  created_at: string;
}

export interface AccessRequest {
  id: string;
  user_name: string;
  user_email: string;
  reason: string | null;
  status: "pending" | "approved" | "rejected" | string;
  created_at: string;
}

export interface PagedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface ListUsersParams {
  page?: number;
  page_size?: number;
  search?: string;
  role?: AdminUserRole;
  is_active?: boolean;
}

/**
 * Typed API client for personal analytics and admin insights.
 *
 * Mirrors `backend/app/schemas/analytics.py`. Personal endpoints are scoped
 * server-side to the signed-in user; admin endpoints require an org admin.
 */

import { api } from "./client";

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

function withParams(path: string, params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export const analyticsApi = {
  /** Analytics for the signed-in user only. */
  personal: (days = 14) =>
    api.get<PersonalAnalytics>(withParams("/analytics/me", { days })),
};

export interface AdminAnalyticsParams {
  days?: number;
  search?: string;
  page?: number;
  page_size?: number;
}

export interface QuestionListParams {
  search?: string;
  user_id?: string;
  page?: number;
  page_size?: number;
}

export interface AdminDocumentParams {
  search?: string;
  status?: string;
  page?: number;
  page_size?: number;
}

export const adminAnalyticsApi = {
  orgAnalytics: ({ days = 14, search, page = 1, page_size = 20 }: AdminAnalyticsParams = {}) =>
    api.get<OrgAnalytics>(
      withParams("/admin/analytics", { days, search, page, page_size })
    ),

  userAnalytics: (userId: string, days = 14) =>
    api.get<UserAnalyticsDetail>(
      withParams(`/admin/analytics/users/${userId}`, { days })
    ),

  questions: ({ search, user_id, page = 1, page_size = 20 }: QuestionListParams = {}) =>
    api.get<QuestionList>(
      withParams("/admin/questions", { search, user_id, page, page_size })
    ),

  question: (messageId: string) =>
    api.get<QuestionDetail>(`/admin/questions/${messageId}`),

  documents: ({ search, status, page = 1, page_size = 20 }: AdminDocumentParams = {}) =>
    api.get<AdminDocumentList>(
      withParams("/admin/documents", { search, status, page, page_size })
    ),

  document: (documentId: string) =>
    api.get<AdminDocumentDetail>(`/admin/documents/${documentId}`),
};

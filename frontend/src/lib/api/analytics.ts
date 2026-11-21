/**
 * Typed API client for personal analytics and admin insights.
 *
 * Mirrors `backend/app/schemas/analytics.py`. Personal endpoints are scoped
 * server-side to the signed-in user; admin endpoints require an org admin.
 */

import { api } from "./client";
import type {
  AdminDocumentDetail,
  AdminDocumentList,
  CitationSource,
  DailyPoint,
  DocumentChunkPreview,
  DocumentJob,
  FlowStep,
  OrgAnalytics,
  PersonalAnalytics,
  QuestionDetail,
  QuestionFeedback,
  QuestionList,
  QuestionListItem,
  RecentQuestion,
  SourceStat,
  UserAnalyticsDetail,
  UserAnalyticsList,
  UserAnalyticsRow,
} from "@/types";

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

// Re-export types for backward compatibility (consumers import from this module)
export type {
  AdminDocumentDetail,
  AdminDocumentList,
  CitationSource,
  DailyPoint,
  DocumentChunkPreview,
  DocumentJob,
  FlowStep,
  OrgAnalytics,
  PersonalAnalytics,
  QuestionDetail,
  QuestionFeedback,
  QuestionList,
  QuestionListItem,
  RecentQuestion,
  SourceStat,
  UserAnalyticsDetail,
  UserAnalyticsList,
  UserAnalyticsRow,
} from "@/types";

import { api } from "./client";

export interface AdminMember {
  id: string;
  full_name: string;
  email: string;
  role: "admin" | "member";
  status: string;
  joined_at: string;
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

export const adminApi = {
  getMembers: (page = 1, page_size = 20, search?: string) => {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(page_size),
    });
    if (search) params.set("search", search);
    return api.get<PagedResponse<AdminMember>>(`/admin/members?${params}`);
  },

  getFeedback: (page = 1, page_size = 20, status?: string) => {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(page_size),
    });
    if (status) params.set("status", status);
    return api.get<PagedResponse<FeedbackItem>>(`/admin/feedback?${params}`);
  },

  updateFeedback: (id: string, status: "in_review" | "solved", note?: string) =>
    api.patch<{ status: string }>(`/admin/feedback/${id}`, { status, note }),

  getAccessRequests: (page = 1, page_size = 20, status?: string) => {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(page_size),
    });
    if (status) params.set("status", status);
    return api.get<PagedResponse<AccessRequest>>(`/admin/access-requests?${params}`);
  },

  decideAccessRequest: (id: string, status: "approved" | "rejected", note?: string) =>
    api.patch<{ status: string }>(`/admin/access-requests/${id}`, { status, note }),
};

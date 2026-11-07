import { api } from "./client";

export interface AdminMember {
  id: string;
  full_name: string;
  email: string;
  role: "admin" | "member";
  status: string;
  joined_at: string;
}

export type AdminUserRole = "admin" | "member";

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

export const adminApi = {
  getMembers: (page = 1, page_size = 20, search?: string) => {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(page_size),
    });
    if (search) params.set("search", search);
    return api.get<PagedResponse<AdminMember>>(`/admin/members?${params}`);
  },

  // ─── User management ──────────────────────────────────────────────────
  listUsers: ({
    page = 1,
    page_size = 20,
    search,
    role,
    is_active,
  }: ListUsersParams = {}) => {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(page_size),
    });
    if (search?.trim()) params.set("search", search.trim());
    if (role) params.set("role", role);
    if (is_active !== undefined) params.set("is_active", String(is_active));
    return api.get<PagedResponse<AdminUser>>(`/admin/users?${params}`);
  },

  createUser: (body: AdminUserCreate) =>
    api.post<AdminUser>("/admin/users", body),

  updateUser: (id: string, body: AdminUserUpdate) =>
    api.patch<AdminUser>(`/admin/users/${id}`, body),

  resetUserPassword: (id: string, newPassword: string) =>
    api.post<void>(`/admin/users/${id}/reset-password`, {
      new_password: newPassword,
    }),

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

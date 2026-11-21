import { api } from "./client";
import type {
  AccessRequest,
  AdminMember,
  AdminUser,
  AdminUserCreate,
  AdminUserUpdate,
  FeedbackItem,
  ListUsersParams,
  PagedResponse,
} from "@/types";

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

// Re-export types for backward compatibility (consumers import from this module)
export type {
  AccessRequest,
  AdminMember,
  AdminUser,
  AdminUserCreate,
  AdminUserRole,
  AdminUserUpdate,
  FeedbackItem,
  ListUsersParams,
  PagedResponse,
} from "@/types";

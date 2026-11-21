/**
 * Typed API client for in-app notifications.
 *
 * Mirrors `backend/app/api/v1/notifications.py`. All endpoints are
 * tenant-scoped to the signed-in user's organization via the JWT.
 */

import { api } from "./client";

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

export interface NotificationListResponse {
  items: NotificationItem[];
  total: number;
  page: number;
  page_size: number;
  unread: number;
}

export const notificationsApi = {
  list: (page = 1, page_size = 20) => {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(page_size),
    });
    return api.get<NotificationListResponse>(
      `/notifications?${params}`
    );
  },

  markRead: (notificationId: string) =>
    api.patch<void>(`/notifications/${notificationId}/read`),
};

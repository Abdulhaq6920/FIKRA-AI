import { api } from "./client";
import type { Document, DocumentListResponse, ProcessingJob } from "@/types";

export const documentsApi = {
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.upload<Document>("/documents/upload", form);
  },

  list: (page = 1, page_size = 20, status?: string) => {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(page_size),
      ...(status ? { status } : {}),
    });
    return api.get<DocumentListResponse>(`/documents/?${params}`);
  },

  get: (id: string) => api.get<Document>(`/documents/${id}`),

  delete: (id: string) => api.delete<void>(`/documents/${id}`),

  reindex: (id: string) =>
    api.post<{ task_id: string; status: string }>(`/documents/${id}/reindex`),

  getStatus: (id: string) => api.get<ProcessingJob>(`/documents/${id}/status`),

  downloadUrl: (id: string) => `/api/v1/documents/${id}/download`,
};

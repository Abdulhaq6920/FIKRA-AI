import { api } from "./client";
import type {
  ChatResponse,
  Conversation,
  Message,
} from "@/types";

export const chatApi = {
  createConversation: (title?: string) =>
    api.post<Conversation>("/chat/conversations", { title: title ?? "New Conversation" }),

  listConversations: () =>
    api.get<Conversation[]>("/chat/conversations"),

  renameConversation: (id: string, title: string) =>
    api.patch<Conversation>(`/chat/conversations/${id}`, { title }),

  deleteConversation: (id: string) =>
    api.delete<void>(`/chat/conversations/${id}`),

  getMessages: (conversationId: string) =>
    api.get<Message[]>(`/chat/conversations/${conversationId}/messages`),

  ask: (question: string, conversation_id: string) =>
    api.post<ChatResponse>("/chat/ask", { question, conversation_id }),

  askStream: (question: string, conversation_id: string, signal?: AbortSignal) =>
    api.stream("/chat/ask/stream", { question, conversation_id }, signal),

  cancelStream: (question: string, conversation_id: string) =>
    api.post<void>("/chat/ask/stream/cancel", { question, conversation_id }),

  submitFeedback: (
    message_id: string,
    feedback_type: string,
    comment?: string
  ) =>
    api.post("/chat/messages/" + message_id + "/feedback", {
      message_id,
      feedback_type,
      comment,
    }),
};

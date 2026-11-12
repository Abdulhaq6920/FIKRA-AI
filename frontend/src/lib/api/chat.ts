import { api } from "./client";
import type {
  ChatResponse,
  Conversation,
  ConversationListResponse,
  FavoriteQuestion,
  FavoriteQuestionListResponse,
  Message,
  MessageListResponse,
} from "@/types";

export const chatApi = {
  createConversation: (title?: string) =>
    api.post<Conversation>("/chat/conversations", { title: title ?? "New Conversation" }),

  listConversations: (page = 1, page_size = 15) =>
    api.get<ConversationListResponse>(
      `/chat/conversations?page=${page}&page_size=${page_size}`
    ),

  renameConversation: (id: string, title: string) =>
    api.patch<Conversation>(`/chat/conversations/${id}`, { title }),

  deleteConversation: (id: string) =>
    api.delete<void>(`/chat/conversations/${id}`),

  /** Page 1 is the most recent window of `page_size` messages, oldest first. */
  getMessages: (conversationId: string, page = 1, page_size = 30) =>
    api.get<MessageListResponse>(
      `/chat/conversations/${conversationId}/messages?page=${page}&page_size=${page_size}`
    ),

  ask: (question: string, conversation_id: string) =>
    api.post<ChatResponse>("/chat/ask", { question, conversation_id }),

  askStream: (question: string, conversation_id: string, signal?: AbortSignal) =>
    api.stream("/chat/ask/stream", { question, conversation_id }, signal),

  cancelStream: (question: string, conversation_id: string) =>
    api.post<void>("/chat/ask/stream/cancel", { question, conversation_id }),

  listFavoriteQuestions: () =>
    api.get<FavoriteQuestionListResponse>("/chat/favorites"),

  saveFavoriteQuestion: (question: string) =>
    api.post<FavoriteQuestion>("/chat/favorites", { question }),

  deleteFavoriteQuestion: (id: string) =>
    api.delete<void>(`/chat/favorites/${id}`),

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

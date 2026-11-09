import { api } from "./client";
import type { LoginRequest, RegisterRequest, SignupOptions, TokenResponse, User } from "@/types";

export const authApi = {
  login: (data: LoginRequest) =>
    api.post<TokenResponse>("/auth/login", data),

  register: (data: RegisterRequest) =>
    api.post<User>("/auth/register", data),

  /** Organizations accepting public sign-up (fixes hard-coded org UUIDs). */
  signupOptions: () => api.get<SignupOptions>("/auth/signup-options"),

  logout: () => api.post<void>("/auth/logout"),

  me: () => api.get<User>("/auth/me"),

  initiatePasswordReset: (email: string, organization_id: string) =>
    api.post<void>("/auth/password-reset/initiate", { email, organization_id }),

  completePasswordReset: (token: string, new_password: string) =>
    api.post<void>("/auth/password-reset/complete", { token, new_password }),
};

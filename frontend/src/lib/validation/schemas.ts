import { z } from "zod";

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128)
  .refine((v) => /[0-9]/.test(v), "Password must contain at least one number")
  .refine((v) => /[A-Z]/.test(v), "Password must contain at least one uppercase letter");

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
  organization_id: z.string().uuid("Invalid organization ID"),
});

export const registerSchema = z
  .object({
    email: z.string().email("Enter a valid email address"),
    full_name: z.string().min(1, "Full name is required").max(255),
    password: passwordSchema,
    confirm_password: z.string(),
    organization_id: z.string().uuid("Invalid organization ID"),
  })
  .refine((data) => data.password === data.confirm_password, {
    message: "Passwords do not match",
    path: ["confirm_password"],
  });

export const forgotPasswordSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  organization_id: z.string().uuid("Invalid organization ID"),
});

export const resetPasswordSchema = z
  .object({
    new_password: passwordSchema,
    confirm_password: z.string(),
  })
  .refine((data) => data.new_password === data.confirm_password, {
    message: "Passwords do not match",
    path: ["confirm_password"],
  });

export const chatSchema = z.object({
  question: z.string().min(1).max(4000),
});

export type LoginFormData = z.infer<typeof loginSchema>;
export type RegisterFormData = z.infer<typeof registerSchema>;
export type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordFormData = z.infer<typeof resetPasswordSchema>;
export type ChatFormData = z.infer<typeof chatSchema>;

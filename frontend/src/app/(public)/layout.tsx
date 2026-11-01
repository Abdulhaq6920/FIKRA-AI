/**
 * Public layout — unauthenticated pages (login, register, password reset).
 * No auth check needed here; the AuthProvider handles redirect after login.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

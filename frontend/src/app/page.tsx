import { redirect } from "next/navigation";

/**
 * Root page — redirect to login.
 * The actual auth check happens in the protected layout.
 */
export default function RootPage() {
  redirect("/login");
}

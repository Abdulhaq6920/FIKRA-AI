"use client";

/**
 * Document library page — read-only view of the organization's documents.
 *
 * The table itself lives in `features/documents/DocumentTable` and is shared
 * with the Admin area; this page only supplies the page chrome and the
 * "management moved to Admin" pointer for admins.
 */

import Link from "next/link";
import { Shield } from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import { DocumentTable } from "@/features/documents/DocumentTable";

export default function DocumentsPage() {
  const { user } = useAuth();
  const canManage = Boolean(
    user?.is_platform_admin || user?.organization_role === "org_admin"
  );

  return (
    <div className="h-full overflow-y-auto bg-surface-950 p-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-surface-100">Documents</h1>
          <p className="mt-0.5 text-sm text-surface-400">
            The knowledge base shared with your organization.
          </p>
        </div>

        {canManage && (
          <Link
            href="/admin?tab=Documents"
            className="mb-6 flex items-center gap-2 rounded-lg border border-brand-500/25 bg-brand-600/10 p-3 text-sm text-brand-300 transition-colors hover:bg-brand-600/20 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <Shield className="h-4 w-4 flex-shrink-0" />
            <span>
              Document uploads and management moved to{" "}
              <span className="font-medium underline underline-offset-2">
                Admin → Documents
              </span>
              .
            </span>
          </Link>
        )}

        <DocumentTable variant="library" canManage={canManage} />
      </div>
    </div>
  );
}

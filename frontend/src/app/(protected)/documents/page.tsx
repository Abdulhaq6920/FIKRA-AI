"use client";

/**
 * Document library page — read-only view of the organization's documents.
 * Admins have a Documents entry point inside the Admin area; this page
 * intentionally shows no management controls (upload/delete/reindex).
 */

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import {
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Download,
  Shield,
} from "lucide-react";
import { documentsApi } from "@/lib/api/documents";
import { useAuth } from "@/features/auth/AuthContext";
import { cn } from "@/lib/utils/cn";
import { formatBytes, relativeTime } from "@/lib/utils/format";
import type { Document, DocumentStatus } from "@/types";

const STATUS_CONFIG: Record<DocumentStatus, { label: string; color: string; icon: React.ReactNode }> = {
  pending:    { label: "Pending",    color: "text-surface-400", icon: <Clock className="w-3.5 h-3.5" /> },
  queued:     { label: "Queued",     color: "text-yellow-400",  icon: <Clock className="w-3.5 h-3.5" /> },
  processing: { label: "Processing", color: "text-blue-400",    icon: <Loader2 className="w-3.5 h-3.5 animate-spin" /> },
  ready:      { label: "Ready",      color: "text-green-400",   icon: <CheckCircle className="w-3.5 h-3.5" /> },
  failed:     { label: "Failed",     color: "text-red-400",     icon: <XCircle className="w-3.5 h-3.5" /> },
  reindexing: { label: "Reindexing", color: "text-purple-400",  icon: <Loader2 className="w-3.5 h-3.5 animate-spin" /> },
};

export default function DocumentsPage() {
  const { user } = useAuth();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);

  const isAdmin = user?.is_platform_admin || user?.organization_role === "org_admin";

  const loadDocuments = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const res = await documentsApi.list();
      setDocuments(res.items);
    } catch {
      // non-fatal
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => { loadDocuments(); }, [loadDocuments]);

  // This library is shared across the organization. Refresh in the
  // background so a member sees an admin upload without manually reloading.
  useEffect(() => {
    const refresh = () => { loadDocuments(false); };
    const interval = window.setInterval(refresh, 5_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [loadDocuments]);

  // Keep processing states current without forcing the user to refresh.
  useEffect(() => {
    const hasActiveIngestion = documents.some((doc) =>
      doc.status === "pending" || doc.status === "queued" ||
      doc.status === "processing" || doc.status === "reindexing"
    );
    if (!hasActiveIngestion) return;

    const interval = window.setInterval(() => { loadDocuments(false); }, 1500);
    return () => window.clearInterval(interval);
  }, [documents, loadDocuments]);

  return (
    <div className="h-full overflow-y-auto bg-surface-950 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-surface-100">Documents</h1>
          <p className="text-sm text-surface-400 mt-0.5">
            {documents.length} document{documents.length !== 1 ? "s" : ""} in your organization
          </p>
        </div>

        {/* Admins manage documents in the Admin area */}
        {isAdmin && (
          <Link
            href="/admin?tab=Documents"
            className="mb-6 flex items-center gap-2 p-3 rounded-lg bg-brand-600/10 border border-brand-500/25 text-sm text-brand-300 hover:bg-brand-600/20 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <Shield className="w-4 h-4 flex-shrink-0" />
            <span>
              Document uploads and management moved to{" "}
              <span className="font-medium underline underline-offset-2">Admin → Documents</span>.
            </span>
          </Link>
        )}

        {/* Document list */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded-xl bg-surface-800 animate-pulse" />
            ))}
          </div>
        ) : documents.length === 0 ? (
          <div className="text-center py-16">
            <FileText className="w-10 h-10 text-surface-600 mx-auto mb-3" />
            <p className="text-surface-400 text-sm">No documents available yet.</p>
            {isAdmin ? (
              <p className="text-surface-600 text-xs mt-1">
                Upload your first document from Admin → Documents.
              </p>
            ) : (
              <p className="text-surface-600 text-xs mt-1">
                An administrator can upload documents for the organization.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <AnimatePresence>
              {documents.map((doc) => (
                <DocumentRow key={doc.id} doc={doc} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}

function DocumentRow({ doc }: { doc: Document }) {
  const status = STATUS_CONFIG[doc.status] ?? STATUS_CONFIG.pending;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -8 }}
      className="flex items-center gap-4 p-4 rounded-xl bg-surface-900/60 border border-surface-800 hover:border-surface-700 transition-colors"
    >
      <FileText className="w-8 h-8 text-brand-400 flex-shrink-0" />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-surface-100 truncate">{doc.title}</p>
        <p className="text-xs text-surface-500 mt-0.5">
          {formatBytes(doc.file_size_bytes)}
          {doc.page_count != null && ` · ${doc.page_count} pages`}
          {doc.chunk_count > 0 && ` · ${doc.chunk_count} chunks`}
          {" · "}
          {relativeTime(doc.created_at)}
        </p>
      </div>

      <div className={cn("flex items-center gap-1.5 text-xs font-medium", status.color)}>
        {status.icon}
        {status.label}
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        <a
          href={documentsApi.downloadUrl(doc.id)}
          className="p-1.5 rounded-lg text-surface-400 hover:text-surface-200 hover:bg-surface-800 focus:outline-none"
          aria-label="Download"
          download
        >
          <Download className="w-3.5 h-3.5" />
        </a>
      </div>
    </motion.div>
  );
}

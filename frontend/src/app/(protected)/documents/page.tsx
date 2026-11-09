"use client";

/**
 * Document library page — read-only view of the organization's documents.
 * Admins have a Documents entry point inside the Admin area; this page
 * intentionally shows no management controls (upload/delete/reindex).
 *
 * Every row ends with a kebab menu (view details, download, copy title) so the
 * row stays uncluttered while every action is one deliberate click away.
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
  Copy,
  Shield,
  X,
} from "lucide-react";
import { documentsApi } from "@/lib/api/documents";
import { ActionMenu } from "@/components/ui/ActionMenu";
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
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [detail, setDetail] = useState<Document | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const DOC_PAGE_SIZE = 20;
  const totalPages = Math.max(1, Math.ceil(total / DOC_PAGE_SIZE));

  const isAdmin = user?.is_platform_admin || user?.organization_role === "org_admin";

  const loadDocuments = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const res = await documentsApi.list(page, DOC_PAGE_SIZE);
      setDocuments(res.items);
      setTotal(res.total);
    } catch {
      // non-fatal
    } finally {
      if (showLoading) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Changing pages always shows the loading skeleton again.
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

  // Auto-dismiss the clipboard toast.
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 2200);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const copyTitle = useCallback(async (title: string) => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(title);
      setFlash("Document title copied");
    } catch {
      setFlash("Could not copy the title");
    }
  }, []);

  return (
    <div className="h-full overflow-y-auto bg-surface-950 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-surface-100">Documents</h1>
          <p className="text-sm text-surface-400 mt-0.5">
            {total} document{total !== 1 ? "s" : ""} in your organization
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
                <DocumentRow
                  key={doc.id}
                  doc={doc}
                  onOpen={() => setDetail(doc)}
                  onCopy={() => void copyTitle(doc.title)}
                />
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* Pagination */}
        {!loading && total > DOC_PAGE_SIZE && (
          <div className="mt-6 flex items-center justify-between border-t border-surface-800 pt-4 text-xs text-surface-500">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded px-2 py-1.5 transition-colors hover:text-surface-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-surface-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              ← Previous
            </button>
            <span>
              Page {page} of {totalPages} · {total} documents
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded px-2 py-1.5 transition-colors hover:text-surface-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-surface-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Row details — a quiet overlay with no navigation or destructive action. */}
      <AnimatePresence>
        {detail && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            onClick={() => setDetail(null)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="document-detail-title"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              onClick={(event) => event.stopPropagation()}
              className="w-full max-w-lg overflow-hidden rounded-2xl border border-surface-700 bg-surface-900 shadow-2xl"
            >
              <div className="flex items-start gap-3 border-b border-surface-800 px-5 py-4">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-300">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2
                    id="document-detail-title"
                    className="truncate text-base font-semibold text-surface-100"
                  >
                    {detail.title}
                  </h2>
                  <p className="mt-0.5 truncate text-xs text-surface-500">
                    {detail.original_filename}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDetail(null)}
                  aria-label="Close document details"
                  className="rounded-lg p-1.5 text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 px-5 py-4 text-sm sm:grid-cols-2">
                <DetailItem
                  label="Status"
                  value={
                    <span className={cn("font-medium", STATUS_CONFIG[detail.status]?.color)}>
                      {STATUS_CONFIG[detail.status]?.label ?? detail.status}
                    </span>
                  }
                />
                <DetailItem label="File type" value={detail.mime_type} />
                <DetailItem label="Size" value={formatBytes(detail.file_size_bytes)} />
                <DetailItem label="Pages" value={detail.page_count ?? "—"} />
                <DetailItem label="Chunks" value={detail.chunk_count} />
                <DetailItem
                  label="Access"
                  value={detail.access_level === "restricted" ? "Restricted" : "Organization"}
                />
                <DetailItem label="Added" value={relativeTime(detail.created_at)} />
                <DetailItem label="Updated" value={relativeTime(detail.updated_at)} />
              </dl>

              <div className="flex items-center justify-end gap-2 border-t border-surface-800 px-5 py-3">
                <button
                  type="button"
                  onClick={() => setDetail(null)}
                  className="rounded-lg border border-surface-700 px-3 py-1.5 text-xs font-medium text-surface-300 transition-colors hover:bg-surface-800 hover:text-surface-100"
                >
                  Close
                </button>
                <a
                  href={documentsApi.downloadUrl(detail.id)}
                  download
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-500"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </a>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Clipboard confirmation — fade only. */}
      <AnimatePresence>
        {flash && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, x: "-50%" }}
            animate={{ opacity: 1, scale: 1, x: "-50%" }}
            exit={{ opacity: 0, scale: 0.97, x: "-50%" }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            role="status"
            className="fixed bottom-6 left-1/2 z-[75] rounded-full border border-surface-700 bg-surface-900 px-4 py-2 text-xs font-medium text-surface-200 shadow-xl"
          >
            {flash}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DocumentRow({
  doc,
  onOpen,
  onCopy,
}: {
  doc: Document;
  onOpen: () => void;
  onCopy: () => void;
}) {
  const status = STATUS_CONFIG[doc.status] ?? STATUS_CONFIG.pending;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.99 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.99 }}
      className="depth-hover flex items-center gap-4 p-4 rounded-xl bg-surface-900/60 border border-surface-800 hover:border-surface-700"
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
        <ActionMenu
          label={`Actions for ${doc.title}`}
          triggerClassName="rounded-lg p-1.5"
          items={[
            {
              key: "details",
              label: "View details",
              icon: <FileText className="h-3.5 w-3.5" />,
              onSelect: onOpen,
              reaction: "read",
            },
            {
              key: "download",
              label: "Download",
              icon: <Download className="h-3.5 w-3.5" />,
              href: documentsApi.downloadUrl(doc.id),
              download: true,
            },
            {
              key: "copy",
              label: "Copy title",
              icon: <Copy className="h-3.5 w-3.5" />,
              onSelect: onCopy,
            },
          ]}
        />
      </div>
    </motion.div>
  );
}

function DetailItem({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-surface-500">{label}</dt>
      <dd className="mt-0.5 truncate text-xs text-surface-200">{value}</dd>
    </div>
  );
}

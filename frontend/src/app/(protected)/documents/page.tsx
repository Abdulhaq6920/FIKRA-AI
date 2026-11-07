"use client";

/**
 * Document management page.
 * Available to all authenticated users; upload/delete restricted to org admins.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload,
  FileText,
  Trash2,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  AlertTriangle,
  Download,
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
  reindexing: { label: "Reindexing", color: "text-purple-400",  icon: <RefreshCw className="w-3.5 h-3.5 animate-spin" /> },
};

export default function DocumentsPage() {
  const { user } = useAuth();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadError(null);

    for (const file of Array.from(files)) {
      setUploading(true);
      try {
        const doc = await documentsApi.upload(file);
        setDocuments((prev) => [doc, ...prev]);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Upload failed.";
        setUploadError(msg);
      } finally {
        setUploading(false);
      }
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this document? This cannot be undone.")) return;
    await documentsApi.delete(id).catch(() => {});
    setDocuments((prev) => prev.filter((d) => d.id !== id));
  };

  const handleReindex = async (id: string) => {
    await documentsApi.reindex(id).catch(() => {});
    // Optimistically show reindexing status
    setDocuments((prev) => prev.map((d) => d.id === id ? { ...d, status: "reindexing" } : d));
  };

  return (
    <div className="h-full overflow-y-auto bg-surface-950 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-surface-100">Documents</h1>
            <p className="text-sm text-surface-400 mt-0.5">
              {documents.length} document{documents.length !== 1 ? "s" : ""} in your organization
            </p>
          </div>
          {isAdmin && (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-brand-400"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Upload document
            </button>
          )}
        </div>

        {/* Upload zone */}
        {isAdmin && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.odt,.pptx,.odp,.xlsx,.xls,.ods,.csv,.tsv,.md,.markdown,.html,.htm,.txt,.rtf,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff"
              className="hidden"
              aria-label="Upload files"
              onChange={(e) => handleUpload(e.target.files)}
            />
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); handleUpload(e.dataTransfer.files); }}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "border-2 border-dashed rounded-xl p-8 mb-6 text-center cursor-pointer transition-colors",
                dragOver
                  ? "border-brand-500 bg-brand-600/10"
                  : "border-surface-700 hover:border-surface-600 bg-surface-900/40"
              )}
              role="button"
              aria-label="Drop files here or click to upload"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
            >
              <Upload className="w-8 h-8 text-surface-500 mx-auto mb-2" />
              <p className="text-sm text-surface-400">
                Drop files here or <span className="text-brand-400">browse</span>
              </p>
              <p className="text-xs text-surface-600 mt-1">PDF, Office files, spreadsheets, HTML, text, and images with OCR · Max 50MB</p>
            </div>

            {uploadError && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center gap-2 text-sm text-red-400">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                {uploadError}
              </div>
            )}
          </>
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
            <p className="text-surface-400 text-sm">No documents uploaded yet.</p>
            {isAdmin && (
              <p className="text-surface-600 text-xs mt-1">
                Upload your first document to get started.
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
                  isAdmin={!!isAdmin}
                  onDelete={() => handleDelete(doc.id)}
                  onReindex={() => handleReindex(doc.id)}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}

function DocumentRow({
  doc,
  isAdmin,
  onDelete,
  onReindex,
}: {
  doc: Document;
  isAdmin: boolean;
  onDelete: () => void;
  onReindex: () => void;
}) {
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
        {isAdmin && (
          <>
            {(doc.status === "failed" || doc.status === "ready") && (
              <button
                onClick={onReindex}
                className="p-1.5 rounded-lg text-surface-400 hover:text-blue-400 hover:bg-surface-800 focus:outline-none"
                aria-label="Reindex"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={onDelete}
              className="p-1.5 rounded-lg text-surface-400 hover:text-red-400 hover:bg-surface-800 focus:outline-none"
              aria-label="Delete"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    </motion.div>
  );
}

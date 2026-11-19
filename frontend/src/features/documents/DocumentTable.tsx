"use client";

/**
 * The one document table.
 *
 * Two surfaces render the same tenant documents and used to have two separate
 * implementations with different fields, status colour maps, polling and date
 * formatting:
 *
 *   variant="library"  read-only browse for every member   GET /documents
 *   variant="admin"    upload / search / filter / delete    GET /admin/documents
 *
 * Both variants share the row renderer, the status vocabulary, the detail
 * modal and the pagination control, so a field added to one surface cannot
 * silently drift from the other.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Copy,
  Download,
  Eye,
  FileText,
  HardDrive,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import {
  adminAnalyticsApi,
  type AdminDocumentDetail,
  type DocumentChunkPreview,
  type DocumentJob,
} from "@/lib/api/analytics";
import { documentsApi } from "@/lib/api/documents";
import { ActionMenu, type ActionMenuItem } from "@/components/ui/ActionMenu";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils/cn";
import { formatBytes, relativeTime } from "@/lib/utils/format";
import { errorText } from "@/lib/utils/errors";
import {
  EmptyRow,
  formatDateTime,
  formatNumber,
  KeyValueGrid,
  Modal,
  Pagination,
  prettyStatus,
  Section,
  Skeleton,
} from "@/features/admin/InsightUi";

const PAGE_SIZE = 20;

const UPLOAD_ACCEPT =
  ".pdf,.docx,.odt,.pptx,.odp,.xlsx,.xls,.ods,.csv,.tsv,.md,.markdown,.html,.htm,.txt,.rtf,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff";

const STATUSES = [
  { value: "", label: "All" },
  { value: "ready", label: "Ready" },
  { value: "processing", label: "Processing" },
  { value: "queued", label: "Queued" },
  { value: "pending", label: "Pending" },
  { value: "failed", label: "Failed" },
  { value: "reindexing", label: "Reindexing" },
] as const;

const STATUS_STYLES: Record<string, string> = {
  ready: "bg-emerald-500/10 text-emerald-300",
  processing: "bg-blue-500/10 text-blue-300",
  queued: "bg-yellow-500/10 text-yellow-300",
  pending: "bg-surface-700 text-surface-300",
  failed: "bg-red-500/10 text-red-300",
  reindexing: "bg-purple-500/10 text-purple-300",
};

/** Statuses that mean the pipeline is still working on the document. */
const ACTIVE_STATUSES = new Set(["pending", "queued", "processing", "reindexing"]);

/** Fields both endpoints return, plus the admin-only extras when present. */
interface DocumentRow {
  id: string;
  title: string;
  original_filename: string;
  mime_type: string;
  status: string;
  file_size_bytes: number;
  page_count: number | null;
  chunk_count: number;
  created_at: string;
  updated_at: string;
  access_level?: "organization" | "restricted";
  uploaded_by_name?: string | null;
  uploaded_by_email?: string | null;
  citation_count?: number;
}

interface DocumentDetail extends DocumentRow {
  file_extension?: string;
  word_count?: number | null;
  language?: string | null;
  embedding_model?: string | null;
  checksum_sha256?: string;
  jobs?: DocumentJob[];
  chunks?: DocumentChunkPreview[];
}

export function DocumentTable({
  variant,
  canManage = false,
}: {
  variant: "library" | "admin";
  /** Library only: whether the viewer may upload (tailors the empty state). */
  canManage?: boolean;
}) {
  const isAdmin = variant === "admin";
  const toast = useToast();

  const [rows, setRows] = useState<DocumentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [status, setStatus] = useState("");

  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const detailRequest = useRef(0);
  // Every list response carries the id of the request that produced it. A slow
  // response from a previous page can therefore never overwrite a newer one.
  const listRequest = useRef(0);

  const load = useCallback(
    async ({ quiet = false }: { quiet?: boolean } = {}) => {
      const request = (listRequest.current += 1);
      if (!quiet) {
        setLoading(true);
        setError(null);
      }
      try {
        if (isAdmin) {
          const result = await adminAnalyticsApi.documents({
            page,
            page_size: PAGE_SIZE,
            search: search || undefined,
            status: status || undefined,
          });
          if (request !== listRequest.current) return;
          setRows(result.items);
          setTotal(result.total);
        } else {
          const result = await documentsApi.list(page, PAGE_SIZE);
          if (request !== listRequest.current) return;
          setRows(result.items);
          setTotal(result.total);
        }
        setError(null);
      } catch (cause) {
        if (request !== listRequest.current) return;
        // A background poll must not replace a good list with an error panel;
        // the next tick (or the user's Retry) will pick the list back up.
        if (!quiet) {
          setRows([]);
          setTotal(0);
          setError(errorText(cause, "Could not load documents."));
        }
      } finally {
        if (request === listRequest.current) setLoading(false);
      }
    },
    [isAdmin, page, search, status]
  );

  useEffect(() => {
    void load();
  }, [load]);

  // One poller, not two. Active ingestion polls quickly; an idle library is
  // refreshed slowly. Both share `load`, whose request id drops stale answers.
  const hasActiveIngestion = rows.some((row) => ACTIVE_STATUSES.has(row.status));

  useEffect(() => {
    if (isAdmin) return;
    const interval = window.setInterval(
      () => void load({ quiet: true }),
      hasActiveIngestion ? 1_500 : 5_000
    );
    return () => window.clearInterval(interval);
  }, [isAdmin, hasActiveIngestion, load]);

  // Returning to the tab shows an admin's new upload without a manual reload.
  useEffect(() => {
    if (isAdmin) return;
    const refresh = () => void load({ quiet: true });
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [isAdmin, load]);

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        await documentsApi.upload(file);
      }
      toast.show(
        files.length === 1 ? "Document uploaded." : `${files.length} documents uploaded.`,
        "success"
      );
      if (page === 1) await load();
      else setPage(1);
    } catch (cause) {
      const message = errorText(cause, "Upload failed.");
      setUploadError(message);
      toast.show(message, "error");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (row: DocumentRow) => {
    if (!window.confirm(`Delete “${row.title}”? This cannot be undone.`)) return;
    setBusyId(row.id);
    try {
      await documentsApi.delete(row.id);
      toast.show("Document deleted.", "success");
      // If the last row on a page was removed, step back to a valid page.
      if (rows.length === 1 && page > 1) setPage(page - 1);
      else await load();
    } catch (cause) {
      // Nothing was removed locally, so the list still tells the truth.
      toast.show(errorText(cause, "Delete failed."), "error");
    } finally {
      setBusyId(null);
    }
  };

  const handleReindex = async (row: DocumentRow) => {
    setBusyId(row.id);
    try {
      await documentsApi.reindex(row.id);
      toast.show("Reindex queued.", "success");
      await load();
    } catch (cause) {
      toast.show(errorText(cause, "Reindex failed."), "error");
    } finally {
      setBusyId(null);
    }
  };

  const copyTitle = async (title: string) => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(title);
      toast.show("Document title copied.", "success");
    } catch {
      toast.show("Could not copy the title.", "error");
    }
  };

  const openDetail = async (row: DocumentRow) => {
    // The library list already carries every field its modal shows.
    if (!isAdmin) {
      setDetailError(null);
      setDetail(row);
      return;
    }
    const request = (detailRequest.current += 1);
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    try {
      const result: AdminDocumentDetail = await adminAnalyticsApi.document(row.id);
      if (request === detailRequest.current) setDetail(result);
    } catch (cause) {
      if (request === detailRequest.current) {
        setDetailError(errorText(cause, "Could not load document."));
      }
    } finally {
      if (request === detailRequest.current) setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    detailRequest.current += 1;
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
  };

  const detailIndex = detail ? rows.findIndex((row) => row.id === detail.id) : -1;
  const stepDetail = (delta: number) => {
    const target = rows[detailIndex + delta];
    if (target) void openDetail(target);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const list = loading ? (
    <Skeleton rows={isAdmin ? 5 : 3} />
  ) : error ? (
    // A failed request is not an empty tenant: say what broke and offer Retry.
    <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      <AlertTriangle className="h-8 w-8 text-red-400" />
      <div>
        <p className="text-sm font-medium text-surface-200">Documents could not be loaded</p>
        <p className="mt-1 max-w-md text-xs text-surface-400">{error}</p>
      </div>
      <button
        type="button"
        onClick={() => void load()}
        className="rounded-lg border border-surface-700 px-3 py-1.5 text-xs font-medium text-surface-200 transition-colors hover:bg-surface-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
      >
        Try again
      </button>
    </div>
  ) : rows.length === 0 ? (
    <EmptyRow
      text={
        isAdmin
          ? search || status
            ? "No documents match these filters."
            : "No documents yet. Use “Upload document” to add the first one."
          : canManage
            ? "No documents yet. Upload your first document from Admin → Documents."
            : "No documents yet. An administrator can upload documents for the organization."
      }
    />
  ) : (
    <>
      <div className="divide-y divide-surface-800/80">
        {rows.map((row) => (
          <DocumentRowItem
            key={row.id}
            row={row}
            variant={variant}
            busy={busyId === row.id}
            onOpen={() => void openDetail(row)}
            onCopy={() => void copyTitle(row.title)}
            onReindex={() => void handleReindex(row)}
            onDelete={() => void handleDelete(row)}
          />
        ))}
      </div>
      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        onPrev={() => setPage((value) => Math.max(1, value - 1))}
        onNext={() => setPage((value) => Math.min(totalPages, value + 1))}
      />
    </>
  );

  const detailOverlay = (detailLoading || detail || detailError) && (
    <Modal
      title={detail?.title ?? "Loading document…"}
      subtitle={detail?.original_filename}
      onClose={closeDetail}
      onPrev={() => stepDetail(-1)}
      onNext={() => stepDetail(1)}
      prevDisabled={detailIndex <= 0}
      nextDisabled={detailIndex < 0 || detailIndex >= rows.length - 1}
      position={detailIndex >= 0 ? `${detailIndex + 1} of ${rows.length}` : undefined}
    >
      {detailLoading && <Skeleton rows={5} />}
      {detailError && <EmptyRow text={detailError} />}
      {detail && <DocumentDetailBody detail={detail} isAdmin={isAdmin} />}
    </Modal>
  );

  if (!isAdmin) {
    return (
      <>
        {list}
        {detailOverlay}
      </>
    );
  }

  return (
    <>
      <Section
        title="Documents"
        icon={<FileText className="w-4 h-4" />}
        action={
          <span className="text-xs text-surface-500">
            {total ? `${formatNumber(total)} total` : ""}
          </span>
        }
      >
        <div className="space-y-3 border-b border-surface-800 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={UPLOAD_ACCEPT}
              className="hidden"
              aria-label="Upload files"
              onChange={(event) => void handleUpload(event.target.files)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-brand-400"
            >
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              Upload document
            </button>
            <span className="text-[10px] text-surface-500">
              PDF, Office files, spreadsheets, HTML, text, images · Max 50MB each
            </span>
            {uploadError && (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/25 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-200">
                <AlertTriangle className="h-3 w-3 shrink-0" /> {uploadError}
              </span>
            )}
          </div>

          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-surface-500" />
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search documents by title or filename…"
                aria-label="Search documents"
                className="w-full rounded-lg border border-surface-700 bg-surface-800 py-1.5 pl-8 pr-3 text-xs text-surface-100 outline-none placeholder:text-surface-500 focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <button
              type="submit"
              className="rounded-lg border border-brand-500/30 bg-brand-600/20 px-3 py-1.5 text-xs text-brand-300 hover:bg-brand-600/30"
            >
              Search
            </button>
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearchInput("");
                  setSearch("");
                  setPage(1);
                }}
                className="rounded-lg border border-surface-700 px-3 py-1.5 text-xs text-surface-400 hover:text-surface-200"
              >
                Clear
              </button>
            )}
          </form>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-surface-500">Status</span>
            {STATUSES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setPage(1);
                  setStatus(option.value);
                }}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] transition-colors",
                  status === option.value
                    ? "border border-brand-500/30 bg-brand-600/30 text-brand-300"
                    : "bg-surface-800 text-surface-400 hover:text-surface-200"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {list}
      </Section>
      {detailOverlay}
    </>
  );
}

function DocumentRowItem({
  row,
  variant,
  busy,
  onOpen,
  onCopy,
  onReindex,
  onDelete,
}: {
  row: DocumentRow;
  variant: "library" | "admin";
  busy: boolean;
  onOpen: () => void;
  onCopy: () => void;
  onReindex: () => void;
  onDelete: () => void;
}) {
  const isAdmin = variant === "admin";
  const meta = [
    formatBytes(row.file_size_bytes),
    row.page_count != null ? `${formatNumber(row.page_count)} pages` : null,
    row.chunk_count > 0 ? `${formatNumber(row.chunk_count)} chunks` : null,
    isAdmin && row.citation_count ? `${formatNumber(row.citation_count)} citations` : null,
    isAdmin ? formatDateTime(row.created_at) : relativeTime(row.created_at),
  ].filter((item): item is string => Boolean(item));

  const actions: ActionMenuItem[] = [
    {
      key: "details",
      label: "View details",
      icon: <Eye className="h-3.5 w-3.5" />,
      onSelect: onOpen,
    },
    {
      key: "download",
      label: "Download",
      icon: <Download className="h-3.5 w-3.5" />,
      href: documentsApi.downloadUrl(row.id),
      download: true,
    },
    {
      key: "copy",
      label: "Copy title",
      icon: <Copy className="h-3.5 w-3.5" />,
      onSelect: onCopy,
    },
  ];

  if (isAdmin) {
    actions.push(
      {
        key: "reindex",
        label: busy ? "Reindexing…" : "Reindex",
        icon: busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        ),
        onSelect: onReindex,
        disabled: busy || (row.status !== "failed" && row.status !== "ready"),
      },
      {
        key: "delete",
        label: "Delete",
        icon: <Trash2 className="h-3.5 w-3.5" />,
        onSelect: onDelete,
        tone: "danger",
        separator: true,
        disabled: busy,
      }
    );
  }


  return (
    <div className="depth-hover flex items-start gap-2 px-4 py-3 hover:bg-surface-800/40">
      <button
        type="button"
        onClick={onOpen}
        title="Open document details"
        className="min-w-0 flex-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 shrink-0 text-brand-400" />
              <p className="truncate text-sm font-medium text-surface-200">{row.title}</p>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  STATUS_STYLES[row.status] ?? "bg-surface-700 text-surface-300"
                )}
              >
                {prettyStatus(row.status)}
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-surface-500">{row.original_filename}</p>
            {isAdmin && (
              <p className="mt-1 truncate text-xs text-surface-400">
                {row.uploaded_by_name ?? "Unknown uploader"}
                {row.uploaded_by_email ? ` · ${row.uploaded_by_email}` : ""}
              </p>
            )}
          </div>
          <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-surface-600" />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-surface-500">
          <span className="inline-flex items-center gap-1">
            <HardDrive className="h-3 w-3" /> {meta[0]}
          </span>
          {meta.slice(1).map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-0.5">
        <ActionMenu
          label={`Actions for ${row.title}`}
          triggerClassName="rounded p-1.5"
          items={actions}
        />
      </div>
    </div>
  );
}

function DocumentDetailBody({
  detail,
  isAdmin,
}: {
  detail: DocumentDetail;
  isAdmin: boolean;
}) {
  const items: Array<{ label: string; value: React.ReactNode }> = [
    { label: "Status", value: prettyStatus(detail.status) },
    { label: "File type", value: detail.mime_type },
    { label: "Size", value: formatBytes(detail.file_size_bytes) },
    { label: "Pages", value: formatNumber(detail.page_count) },
    { label: "Chunks", value: formatNumber(detail.chunk_count) },
    {
      label: "Access",
      value: detail.access_level === "restricted" ? "Restricted" : "Organization",
    },
    { label: "Added", value: formatDateTime(detail.created_at) },
    { label: "Updated", value: formatDateTime(detail.updated_at) },
  ];

  if (isAdmin) {
    items.splice(
      2,
      0,
      { label: "Uploader", value: detail.uploaded_by_name ?? "—" },
      { label: "Uploader email", value: detail.uploaded_by_email ?? "—" }
    );
    items.push(
      { label: "Words", value: formatNumber(detail.word_count) },
      { label: "Citations", value: formatNumber(detail.citation_count) },
      { label: "Language", value: detail.language ?? "—" },
      { label: "Embedding model", value: detail.embedding_model ?? "—" },
      { label: "Extension", value: detail.file_extension ?? "—" },
      {
        label: "Checksum",
        value: (
          <span className="break-all text-xs">{detail.checksum_sha256 ?? "—"}</span>
        ),
      }
    );
  }

  return (
    <div className="divide-y divide-surface-800">
      <KeyValueGrid items={items} />

      {isAdmin && (
        <>
          <div className="p-4">
            <p className="mb-2 text-[10px] uppercase tracking-wide text-surface-500">
              Processing jobs ({detail.jobs?.length ?? 0})
            </p>
            {detail.jobs?.length ? (
              <div className="space-y-2">
                {detail.jobs.map((job) => (
                  <div
                    key={job.id}
                    className="rounded-lg border border-surface-800 bg-surface-950/50 p-2.5"
                  >
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-surface-300">
                      <span className="font-medium">{prettyStatus(job.status)}</span>
                      <span>Attempt {job.attempt_number}</span>
                      <span>Started {formatDateTime(job.started_at)}</span>
                      <span>Completed {formatDateTime(job.completed_at)}</span>
                    </div>
                    {job.error_message && (
                      <p className="mt-1 text-xs text-red-300">
                        {job.error_type ? `${job.error_type}: ` : ""}
                        {job.error_message}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-surface-500">No processing jobs recorded.</p>
            )}
          </div>

          <div className="p-4">
            <p className="mb-2 text-[10px] uppercase tracking-wide text-surface-500">
              Chunk previews ({detail.chunks?.length ?? 0})
            </p>
            {detail.chunks?.length ? (
              <div className="space-y-2">
                {detail.chunks.map((chunk) => (
                  <div
                    key={chunk.id}
                    className="rounded-lg border border-surface-800 bg-surface-950/50 p-2.5"
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-surface-500">
                      <span>#{chunk.chunk_index}</span>
                      {chunk.page_number !== null && <span>Page {chunk.page_number}</span>}
                      {chunk.section_heading && <span>{chunk.section_heading}</span>}
                      <span>{formatNumber(chunk.token_count)} tokens</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-surface-300">
                      {chunk.excerpt}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-surface-500">No chunks stored for this document.</p>
            )}
          </div>
        </>
      )}

      <div className="flex items-center justify-end gap-2 px-4 py-3">
        <a
          href={documentsApi.downloadUrl(detail.id)}
          download
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-500"
        >
          <Download className="h-3.5 w-3.5" />
          Download
        </a>
      </div>
    </div>
  );
}

"use client";

/**
 * Admin document manager.
 * Lists tenant documents with uploader/citation metrics and opens metadata,
 * processing jobs, and chunk previews for a single document. Upload, delete,
 * and reindex actions were moved here from the read-only document library.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Download,
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
  type AdminDocumentList,
} from "@/lib/api/analytics";
import { documentsApi } from "@/lib/api/documents";
import { cn } from "@/lib/utils/cn";
import { formatBytes } from "@/lib/utils/format";
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
} from "./InsightUi";

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

export function DocumentsTab() {
  const [data, setData] = useState<AdminDocumentList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [status, setStatus] = useState("");

  const [detail, setDetail] = useState<AdminDocumentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const detailRequest = useRef(0);

  // Management actions (uploads, deletes, reindex) live here since the
  // library page is now read-only.
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(
        await adminAnalyticsApi.documents({
          page,
          page_size: 20,
          search: search || undefined,
          status: status || undefined,
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load documents.");
    } finally {
      setLoading(false);
    }
  }, [page, search, status]);

  useEffect(() => {
    load();
  }, [load]);

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
      setPage(1);
      await load();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this document? This cannot be undone.")) return;
    setActionError(null);
    setBusyId(id);
    try {
      await documentsApi.delete(id);
      // If the last row on a page was removed, step back to a valid page.
      if (data && data.items.length === 1 && page > 1) setPage(page - 1);
      else await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusyId(null);
    }
  };

  const handleReindex = async (id: string) => {
    setActionError(null);
    setBusyId(id);
    try {
      await documentsApi.reindex(id);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Reindex failed.");
    } finally {
      setBusyId(null);
    }
  };

  const openDetail = async (id: string) => {
    const request = ++detailRequest.current;
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    try {
      const result = await adminAnalyticsApi.document(id);
      if (request === detailRequest.current) setDetail(result);
    } catch (err) {
      if (request === detailRequest.current) {
        setDetailError(err instanceof Error ? err.message : "Could not load document.");
      }
    } finally {
      if (request === detailRequest.current) setDetailLoading(false);
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / 20)) : 1;

  // Detail overlays page through the rows already loaded in this list.
  const detailItems = data?.items ?? [];
  const detailIndex = detail
    ? detailItems.findIndex((document) => document.id === detail.id)
    : -1;
  const stepDetail = (delta: number) => {
    const target = detailItems[detailIndex + delta];
    if (target) void openDetail(target.id);
  };

  return (
    <>
      <Section
        title="Documents"
        icon={<FileText className="w-4 h-4" />}
        action={<span className="text-xs text-surface-500">{data ? `${formatNumber(data.total)} total` : ""}</span>}
      >
        <div className="space-y-3 px-4 py-3 border-b border-surface-800">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={UPLOAD_ACCEPT}
              className="hidden"
              aria-label="Upload files"
              onChange={(event) => handleUpload(event.target.files)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-brand-400"
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
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
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-surface-500" />
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search documents by title or filename…"
                className="w-full rounded-lg bg-surface-800 border border-surface-700 pl-8 pr-3 py-1.5 text-xs text-surface-100 placeholder:text-surface-500 outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <button
              type="submit"
              className="rounded-lg bg-brand-600/20 border border-brand-500/30 px-3 py-1.5 text-xs text-brand-300 hover:bg-brand-600/30"
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
                    ? "bg-brand-600/30 text-brand-300 border border-brand-500/30"
                    : "bg-surface-800 text-surface-400 hover:text-surface-200"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          {actionError && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              <AlertTriangle className="h-3.5 w-3.5" /> {actionError}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              <AlertTriangle className="h-3.5 w-3.5" /> {error}
            </div>
          )}
        </div>

        {loading ? (
          <Skeleton rows={5} />
        ) : data?.items.length ? (
          <>
            <div className="divide-y divide-surface-800/80">
              {data.items.map((document) => (
                <div
                  key={document.id}
                  className="flex items-start gap-2 px-4 py-3 transition-colors hover:bg-surface-800/40"
                >
                  <button
                    type="button"
                    onClick={() => openDetail(document.id)}
                    className="min-w-0 flex-1 text-left"
                    title="Open document details"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium text-surface-200">{document.title}</p>
                          <span
                            className={cn(
                              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                              STATUS_STYLES[document.status] ?? "bg-surface-700 text-surface-300"
                            )}
                          >
                            {prettyStatus(document.status)}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-xs text-surface-500">{document.original_filename}</p>
                        <p className="mt-1 text-xs text-surface-400">
                          {document.uploaded_by_name ?? "Unknown uploader"}
                          {document.uploaded_by_email ? ` · ${document.uploaded_by_email}` : ""}
                        </p>
                      </div>
                      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-surface-600" />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-surface-500">
                      <span className="inline-flex items-center gap-1">
                        <HardDrive className="h-3 w-3" /> {formatBytes(document.file_size_bytes)}
                      </span>
                      <span>{formatNumber(document.chunk_count)} chunks</span>
                      <span>{formatNumber(document.page_count)} pages</span>
                      <span>{formatNumber(document.citation_count)} citations</span>
                      <span>{formatDateTime(document.created_at)}</span>
                    </div>
                  </button>
                  <div className="flex flex-shrink-0 items-center gap-0.5">
                    <a
                      href={documentsApi.downloadUrl(document.id)}
                      download
                      className="rounded p-1.5 text-surface-400 hover:bg-surface-800 hover:text-surface-200 focus:outline-none"
                      aria-label={`Download ${document.title}`}
                      title="Download"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </a>
                    {(document.status === "failed" || document.status === "ready") && (
                      <button
                        type="button"
                        onClick={() => handleReindex(document.id)}
                        disabled={busyId === document.id}
                        className="rounded p-1.5 text-surface-400 hover:bg-surface-800 hover:text-blue-300 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={`Reindex ${document.title}`}
                        title="Reindex"
                      >
                        {busyId === document.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDelete(document.id)}
                      disabled={busyId === document.id}
                      className="rounded p-1.5 text-surface-400 hover:bg-surface-800 hover:text-red-300 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={`Delete ${document.title}`}
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <Pagination
              page={page}
              totalPages={totalPages}
              total={data.total}
              onPrev={() => setPage((value) => Math.max(1, value - 1))}
              onNext={() => setPage((value) => value + 1)}
            />
          </>
        ) : (
          <EmptyRow
            text={
              search || status
                ? "No documents match these filters."
                : "No documents yet. Use “Upload document” to add the first one."
            }
          />
        )}
      </Section>

      {(detailLoading || detail || detailError) && (
        <Modal
          title={detail?.title ?? "Loading document…"}
          subtitle={detail?.original_filename}
          onClose={() => {
            setDetail(null);
            setDetailError(null);
          }}
          onPrev={() => stepDetail(-1)}
          onNext={() => stepDetail(1)}
          prevDisabled={detailIndex <= 0}
          nextDisabled={detailIndex < 0 || detailIndex >= detailItems.length - 1}
          position={detailIndex >= 0 ? `${detailIndex + 1} of ${detailItems.length}` : undefined}
        >
          {detailLoading && <Skeleton rows={5} />}
          {detailError && <EmptyRow text={detailError} />}
          {detail && (
            <div className="divide-y divide-surface-800">
              <KeyValueGrid
                items={[
                  { label: "Status", value: prettyStatus(detail.status) },
                  { label: "Uploader", value: detail.uploaded_by_name ?? "—" },
                  { label: "Uploader email", value: detail.uploaded_by_email ?? "—" },
                  { label: "MIME type", value: detail.mime_type },
                  { label: "Extension", value: detail.file_extension },
                  { label: "Size", value: formatBytes(detail.file_size_bytes) },
                  { label: "Pages", value: formatNumber(detail.page_count) },
                  { label: "Words", value: formatNumber(detail.word_count) },
                  { label: "Chunks", value: formatNumber(detail.chunk_count) },
                  { label: "Citations", value: formatNumber(detail.citation_count) },
                  { label: "Language", value: detail.language ?? "—" },
                  { label: "Embedding model", value: detail.embedding_model ?? "—" },
                  { label: "Created", value: formatDateTime(detail.created_at) },
                  { label: "Updated", value: formatDateTime(detail.updated_at) },
                  { label: "Checksum", value: <span className="break-all text-xs">{detail.checksum_sha256}</span> },
                ]}
              />

              <div className="p-4">
                <p className="mb-2 text-[10px] uppercase tracking-wide text-surface-500">
                  Processing jobs ({detail.jobs.length})
                </p>
                {detail.jobs.length ? (
                  <div className="space-y-2">
                    {detail.jobs.map((job) => (
                      <div key={job.id} className="rounded-lg border border-surface-800 bg-surface-950/50 p-2.5">
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
                  Chunk previews ({detail.chunks.length})
                </p>
                {detail.chunks.length ? (
                  <div className="space-y-2">
                    {detail.chunks.map((chunk) => (
                      <div key={chunk.id} className="rounded-lg border border-surface-800 bg-surface-950/50 p-2.5">
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
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

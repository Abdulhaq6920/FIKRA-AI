/**
 * Shared client-side upload constraints.
 *
 * These mirror backend/app/core/config.py (MAX_UPLOAD_SIZE_MB and
 * ALLOWED_EXTENSIONS). The backend performs the authoritative validation in
 * `/api/v1/documents/blob/finalize`; this module only stops obviously invalid
 * requests before a Blob token is issued.
 */

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Extension → MIME type used when deriving a Blob upload token's scope. */
export const EXTENSION_MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odt: "application/vnd.oasis.opendocument.text",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odp: "application/vnd.oasis.opendocument.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  md: "text/markdown",
  markdown: "text/markdown",
  html: "text/html",
  htm: "text/html",
  txt: "text/plain",
  rtf: "application/rtf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
};

export const ALLOWED_EXTENSIONS = Object.keys(EXTENSION_MIME);
export const ALLOWED_MIME_TYPES = Object.values(EXTENSION_MIME);

export function fileExtension(filename: string): string | null {
  if (!filename || filename.includes("/") || filename.includes("\\")) return null;
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return null;
  const ext = filename.slice(dot + 1).toLowerCase();
  return ALLOWED_EXTENSIONS.includes(ext) ? ext : null;
}

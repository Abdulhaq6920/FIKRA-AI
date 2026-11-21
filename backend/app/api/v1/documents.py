"""
Document management API endpoints.

POST   /api/v1/documents/upload
GET    /api/v1/documents/
GET    /api/v1/documents/{doc_id}
DELETE /api/v1/documents/{doc_id}
POST   /api/v1/documents/{doc_id}/reindex
GET    /api/v1/documents/{doc_id}/status
GET    /api/v1/documents/{doc_id}/download
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import mimetypes
import re
import uuid
from datetime import UTC
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import CurrentUser, OrgAdminUser
from app.core.config import settings
from app.core.exceptions import (
    ConflictError,
    DocumentNotFoundError,
    FileTooLargeError,
    InvalidFileTypeError,
    PermissionDeniedError,
)
from app.core.logging import get_logger
from app.db.models.conversation import Message
from app.db.models.document import (
    Document,
    DocumentAccessLevel,
    DocumentProcessingJob,
    DocumentStatus,
    JobStatus,
)
from app.db.models.user import OrgRole
from app.db.session import get_db
from app.schemas.document import (
    BlobUploadFinalize,
    DocumentListResponse,
    DocumentOut,
    ProcessingJobOut,
    ReindexResponse,
)
from app.storage.local_storage import get_storage

# Optional native dependency: python-magic needs the libmagic system library
# (installed in the Docker image). Import once at module level; when it is
# unavailable the upload endpoint falls back to a static extension→MIME map
# instead of trusting the client-supplied Content-Type.
try:
    import magic as _magic
except ImportError:  # pragma: no cover - libmagic missing locally
    _magic = None  # type: ignore[assignment]  # optional native dependency

logger = get_logger(__name__)

# References to inline-ingestion background tasks. asyncio only keeps weak
# references to tasks, so the set below prevents them from being garbage
# collected mid-run; completed tasks are discarded automatically.
_inline_tasks: set[asyncio.Task[None]] = set()


def _dispatch_inline_task(coro: Any) -> None:
    """Start a fire-and-forget ingestion task that cannot be GC'd mid-run."""
    task = asyncio.create_task(coro)
    _inline_tasks.add(task)
    task.add_done_callback(_inline_tasks.discard)


router = APIRouter(prefix="/documents", tags=["documents"])

# Blob pathnames are minted by the Next.js token route. Enforcing the exact
# shape prevents a client from pointing a document row at another tenant's blob.
_BLOB_PATH_RE = re.compile(r"^uploads/[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-z0-9]{1,10}$")


# Static extension → MIME fallback for environments where python-magic
# cannot import (missing libmagic). Uses mimetypes' registry first so the
# mapping never diverges from a working `file` classification.
def _extension_mime(ext: str) -> str:
    """Return a safe MIME type for *ext*, defaulting to octet-stream."""
    guessed, _ = mimetypes.guess_type(f"f.{ext}", strict=True)
    if guessed:
        return guessed
    return {
        "md": "text/markdown",
        "markdown": "text/markdown",
        "tsv": "text/tab-separated-values",
        "odt": "application/vnd.oasis.opendocument.text",
        "odp": "application/vnd.oasis.opendocument.presentation",
        "ods": "application/vnd.oasis.opendocument.spreadsheet",
        "tif": "image/tiff",
        "tiff": "image/tiff",
        "bmp": "image/bmp",
        "html": "text/html",
        "htm": "text/html",
    }.get(ext, "application/octet-stream")


def _sha256_hex(data: bytes) -> str:
    """Return the hex SHA-256 of *data* (run in a worker thread by callers)."""
    return hashlib.sha256(data).hexdigest()


def _safe_download_filename(name: str) -> str:
    """
    Scrub an uploaded filename for use in the Content-Disposition header.

    Quotes/backslashes/CRLF are escaped rather than trusted — an unfiltered
    filename can break the header or smuggle extra header fields.
    """
    cleaned = (
        "".join(" " if c in ("\r", "\n") else c for c in name).replace("\\", "_").replace('"', "_")
    )
    cleaned = "".join(c if c.isprintable() else "_" for c in cleaned).strip()
    if not cleaned or cleaned.startswith("."):
        cleaned = f"download{Path(name).suffix[:24]}" if "." in name else "download"
    return cleaned[:512]


async def _register_and_dispatch_document(
    *,
    user: Any,
    org_id: Any,
    original_name: str,
    ext: str,
    file_bytes: bytes,
    db: AsyncSession,
    storage_path: str | None = None,
    already_stored: bool = False,
) -> DocumentOut:
    """Persist a validated upload, enqueue ingestion and return its DTO."""
    # Detect actual MIME type (not trusting the client's Content-Type).
    if _magic is not None:
        detected_mime = _magic.from_buffer(file_bytes[:4096], mime=True)
    else:
        detected_mime = _extension_mime(ext)

    # Hash off the event loop: SHA-256 over a 50 MB upload is pure CPU and would
    # otherwise stall /health/live, login and chat for every other request.
    checksum = await asyncio.to_thread(_sha256_hex, file_bytes)

    doc_uuid = uuid.uuid4()
    if storage_path is None:
        # Generate a safe storage path — never use the user-supplied filename.
        storage_path = f"{org_id}/{doc_uuid}/{doc_uuid}.{ext}"

    storage = get_storage()
    if not already_stored:
        await storage.save(file_bytes, storage_path)

    document = Document(
        id=doc_uuid,
        organization_id=org_id,
        uploaded_by=user.id,
        title=Path(original_name).stem,
        original_filename=original_name,
        storage_path=storage_path,
        mime_type=detected_mime,
        file_extension=ext,
        file_size_bytes=len(file_bytes),
        checksum_sha256=checksum,
        status=DocumentStatus.QUEUED,
    )
    job = DocumentProcessingJob(
        document_id=doc_uuid,
        organization_id=org_id,
        status=JobStatus.PENDING,
    )
    try:
        db.add(document)
        await db.flush()
        db.add(job)
        await db.commit()
    except Exception:
        # A failed insert must not leave an orphan behind in either backend.
        await db.rollback()
        with contextlib.suppress(Exception):
            await storage.delete(storage_path)
        raise

    # Dispatch background ingestion task. Kept function-local on purpose:
    # the workers module pulls in the Celery app and the ingestion pipeline
    # (sentence-transformers), which must not load at API import time.
    from app.workers.document_tasks import ingest_document

    # The try covers the *publish* only. Anything after a successful publish
    # (persisting the task id) must never start a second pipeline: the queued
    # task and the inline fallback would both DELETE+INSERT this document's
    # chunks and duplicate every row.
    try:
        task = ingest_document.apply_async(
            args=[str(doc_uuid), str(org_id)],
            queue="ingestion",
        )
    except Exception as exc:
        logger.warning(
            "celery_unavailable_processing_inline",
            document_id=str(doc_uuid),
            error=str(exc)[:200],
        )
        _dispatch_inline_task(
            _process_document_inline(doc_uuid, org_id, str(doc_uuid), storage_path, ext)
        )
    else:
        logger.info(
            "document_upload_queued",
            document_id=str(doc_uuid),
            org_id=str(org_id),
            file=original_name,
            size=len(file_bytes),
            celery_task=task.id,
        )
        try:
            job.celery_task_id = task.id
            await db.commit()
        except Exception as exc:
            await db.rollback()
            logger.warning(
                "document_job_task_id_not_persisted",
                document_id=str(doc_uuid),
                error=str(exc)[:200],
            )

    return DocumentOut.model_validate(document)


@router.post("/upload", response_model=DocumentOut, status_code=201)
async def upload_document(
    ctx: OrgAdminUser,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
) -> DocumentOut:
    """
    Upload a document for ingestion.

    Only organization admins can upload documents.
    Files are validated by size, extension, and MIME type before storage.
    """
    user, org_id, role = ctx

    # Validate file size by streaming — never buffer an unbounded upload
    # in memory before checking its size (resource-exhaustion vector).
    max_bytes = settings.max_upload_size_bytes
    chunks: list[bytes] = []
    total_size = 0
    while True:
        chunk = await file.read(1024 * 1024)  # 1 MB
        if not chunk:
            break
        total_size += len(chunk)
        if total_size > max_bytes:
            raise FileTooLargeError(f"File exceeds {settings.max_upload_size_mb}MB limit.")
        chunks.append(chunk)
    file_bytes = b"".join(chunks)
    del chunks

    original_name = file.filename or "unknown"
    ext = Path(original_name).suffix.lstrip(".").lower()
    if ext not in settings.allowed_extensions:
        raise InvalidFileTypeError(
            f"File type '.{ext}' is not supported. "
            f"Allowed: {', '.join(settings.allowed_extensions)}"
        )

    return await _register_and_dispatch_document(
        user=user,
        org_id=org_id,
        original_name=original_name,
        ext=ext,
        file_bytes=file_bytes,
        db=db,
    )


@router.post("/blob/finalize", response_model=DocumentOut, status_code=201)
async def finalize_blob_upload(
    payload: BlobUploadFinalize,
    ctx: OrgAdminUser,
    db: AsyncSession = Depends(get_db),
) -> DocumentOut:
    """
    Register a file that the browser uploaded directly to Vercel Blob.

    The browser never sends file bytes to Vercel Functions (4.5 MB body cap).
    It receives a short-lived presigned PUT URL from the Next.js token route,
    uploads to Blob, then calls this endpoint to create the document row and
    start ingestion. Bytes are read back here only for hashing and validation.
    """
    user, org_id, role = ctx

    if settings.storage_backend != "vercel_blob":
        raise InvalidFileTypeError("Direct Blob uploads are not enabled for this deployment.")

    pathname = payload.pathname
    if not _BLOB_PATH_RE.fullmatch(pathname):
        raise InvalidFileTypeError("Invalid upload path returned by the storage provider.")
    ext = pathname.rsplit(".", 1)[1].lower()
    if ext not in settings.allowed_extensions:
        raise InvalidFileTypeError(
            f"File type '.{ext}' is not supported. "
            f"Allowed: {', '.join(settings.allowed_extensions)}"
        )

    original_ext = Path(payload.original_filename).suffix.lstrip(".").lower()
    if original_ext != ext:
        raise InvalidFileTypeError("Filename extension does not match the uploaded file.")

    max_bytes = settings.max_upload_size_bytes
    if payload.size_bytes > max_bytes:
        raise FileTooLargeError(f"File exceeds {settings.max_upload_size_mb}MB limit.")

    # A pathname must never be reused across tenants or documents.
    claimed = await db.scalar(select(Document.id).where(Document.storage_path == pathname))
    if claimed is not None:
        raise ConflictError("This upload has already been registered.")

    storage = get_storage()
    if not await storage.exists(pathname):
        raise InvalidFileTypeError("The uploaded file could not be found. Retry the upload.")

    file_bytes = await storage.read(pathname)
    if not file_bytes:
        raise InvalidFileTypeError("The uploaded file is empty.")
    if len(file_bytes) > max_bytes:
        raise FileTooLargeError(f"File exceeds {settings.max_upload_size_mb}MB limit.")
    if len(file_bytes) != payload.size_bytes:
        raise InvalidFileTypeError("The uploaded file size does not match its metadata.")

    return await _register_and_dispatch_document(
        user=user,
        org_id=org_id,
        original_name=payload.original_filename,
        ext=ext,
        file_bytes=file_bytes,
        db=db,
        storage_path=pathname,
        already_stored=True,
    )


@router.get("", response_model=DocumentListResponse)
# Alias so a trailing-slash request (common from external clients) is answered
# directly instead of a 307 whose absolute Location escapes a reverse proxy.
@router.get("/", response_model=DocumentListResponse, include_in_schema=False)
async def list_documents(
    ctx: CurrentUser,
    db: AsyncSession = Depends(get_db),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    status: str | None = Query(default=None),
) -> DocumentListResponse:
    """List documents for the authenticated user's organization."""
    user, org_id, role = ctx

    conditions: list[Any] = [
        Document.organization_id == org_id,
        Document.is_active == True,  # noqa: E712
    ]
    # Restricted documents are admin-only in every consumer; members must
    # not even be able to list their metadata.
    if role != OrgRole.ORG_ADMIN:
        conditions.append(Document.access_level == DocumentAccessLevel.ORGANIZATION)
    if status:
        conditions.append(Document.status == status)

    total = await db.scalar(select(func.count()).select_from(Document).where(*conditions))

    query = (
        select(Document)
        .where(*conditions)
        .offset((page - 1) * page_size)
        .limit(page_size)
        .order_by(Document.created_at.desc())
    )
    result = await db.execute(query)
    docs = result.scalars().all()

    return DocumentListResponse(
        items=[DocumentOut.model_validate(d) for d in docs],
        total=total or 0,
        page=page,
        page_size=page_size,
    )


@router.get("/{doc_id}", response_model=DocumentOut)
async def get_document(
    doc_id: uuid.UUID,
    ctx: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> DocumentOut:
    """Get a specific document (must belong to the user's organization)."""
    user, org_id, role = ctx
    doc = await _get_doc_or_404(doc_id, org_id, db)
    if doc.access_level == DocumentAccessLevel.RESTRICTED and role != OrgRole.ORG_ADMIN:
        # Match the not-found contract so we don't confirm existence.
        raise DocumentNotFoundError()
    return DocumentOut.model_validate(doc)


@router.delete("/{doc_id}", status_code=204, response_model=None)
async def delete_document(
    doc_id: uuid.UUID,
    ctx: OrgAdminUser,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Permanently delete a document, its source file, vectors, and jobs."""
    user, org_id, role = ctx
    doc = await _get_doc_or_404(doc_id, org_id, db)

    # Stop a queued ingestion job before its database rows are removed. A task
    # that has already started also checks document existence before writing.
    jobs = (
        (
            await db.execute(
                select(DocumentProcessingJob.celery_task_id).where(
                    DocumentProcessingJob.document_id == doc_id,
                    DocumentProcessingJob.organization_id == org_id,
                )
            )
        )
        .scalars()
        .all()
    )
    for task_id in jobs:
        if task_id:
            from app.workers.celery_app import celery_app

            celery_app.control.revoke(task_id, terminate=False)

    # Preserve conversations, but remove only metadata and excerpts that point
    # to this document. Other citations in the same assistant response remain.
    messages_with_citations = (
        (
            await db.execute(
                select(Message).where(
                    Message.organization_id == org_id,
                    Message.citations.is_not(None),
                )
            )
        )
        .scalars()
        .all()
    )
    for message in messages_with_citations:
        citations = message.citations or []
        retained = [
            citation for citation in citations if citation.get("document_id") != str(doc_id)
        ]
        if len(retained) != len(citations):
            message.citations = retained or None

    storage = get_storage()
    await storage.delete(doc.storage_path)

    # Qdrant has no FK cascade: delete the document's vectors explicitly, using
    # the tenant-scoped filter, before the relational rows are removed.
    from app.providers.vector_store import delete_document_points

    await delete_document_points(doc_id, org_id)

    # PostgreSQL ON DELETE CASCADE removes document_chunks and processing jobs.
    # Deleting the document also means its title and original filename cannot
    # appear in later list requests.
    await db.delete(doc)
    await db.commit()
    logger.info("document_permanently_deleted", document_id=str(doc_id), actor=str(user.id))


@router.post("/{doc_id}/reindex", status_code=202, response_model=ReindexResponse)
async def reindex_document(
    doc_id: uuid.UUID,
    ctx: OrgAdminUser,
    db: AsyncSession = Depends(get_db),
) -> ReindexResponse:
    """
    Re-queue a document for ingestion (admin only).

    The document is marked REINDEXING rather than QUEUED so the existing chunks
    stay in place — and stay retrievable — until the new ones are written. A
    second request while a run is in flight is rejected with 409 instead of
    starting a competing pipeline that would DELETE+INSERT the same rows.
    """
    user, org_id, role = ctx
    doc = await _get_doc_or_404(doc_id, org_id, db)

    in_flight = {
        DocumentStatus.QUEUED,
        DocumentStatus.PROCESSING,
        DocumentStatus.REINDEXING,
    }
    if doc.status in in_flight:
        raise ConflictError(f"Document is already being processed (status: {doc.status.value}).")

    doc.status = DocumentStatus.REINDEXING
    # One job row per run: the worker reads the newest job, so a fresh row is
    # required for attempt/status bookkeeping to belong to this run.
    job = DocumentProcessingJob(
        document_id=doc_id,
        organization_id=org_id,
        status=JobStatus.PENDING,
    )
    db.add(job)
    # Commit *before* dispatch: the worker must find a visible row, and a
    # publish failure must not leave a half-written transaction behind.
    await db.commit()

    from app.workers.document_tasks import ingest_document

    task_id = None
    try:
        task = ingest_document.apply_async(
            args=[str(doc_id), str(org_id)],
            queue="ingestion",
        )
        task_id = task.id
    except Exception as exc:
        logger.warning(
            "celery_unavailable_reindexing_inline", document_id=str(doc_id), error=str(exc)[:200]
        )
        _dispatch_inline_task(
            _process_document_inline(
                doc_id, org_id, str(doc_id), doc.storage_path, doc.file_extension
            )
        )
    else:
        try:
            job.celery_task_id = task_id
            await db.commit()
        except Exception as exc:
            await db.rollback()
            logger.warning(
                "reindex_job_task_id_not_persisted",
                document_id=str(doc_id),
                error=str(exc)[:200],
            )

    return ReindexResponse(task_id=task_id or "inline", status=DocumentStatus.REINDEXING.value)


@router.get("/{doc_id}/status", response_model=ProcessingJobOut)
async def get_processing_status(
    doc_id: uuid.UUID,
    ctx: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> ProcessingJobOut:
    """Get the latest processing job status for a document."""
    user, org_id, role = ctx
    await _get_doc_or_404(doc_id, org_id, db)  # tenant check

    job = await db.scalar(
        select(DocumentProcessingJob)
        .where(
            DocumentProcessingJob.document_id == doc_id,
            DocumentProcessingJob.organization_id == org_id,
        )
        .order_by(DocumentProcessingJob.created_at.desc())
    )
    if job is None:
        raise DocumentNotFoundError("Processing job not found.")

    return ProcessingJobOut.model_validate(job)


@router.get("/{doc_id}/download", response_model=None)
async def download_document(
    doc_id: uuid.UUID,
    ctx: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """Download the original uploaded file (authenticated, tenant-scoped)."""
    user, org_id, role = ctx
    doc = await _get_doc_or_404(doc_id, org_id, db)

    # Restricted documents are organization-admin only — the flag means
    # what it says, for every consumer (download, chat, retrieval).
    if doc.access_level == DocumentAccessLevel.RESTRICTED and role != OrgRole.ORG_ADMIN:
        raise PermissionDeniedError("This document is restricted to admins.")

    storage = get_storage()
    file_bytes = await storage.read(doc.storage_path)

    return StreamingResponse(
        iter([file_bytes]),
        media_type=doc.mime_type,
        headers={
            "Content-Disposition": (
                f'attachment; filename="{_safe_download_filename(doc.original_filename)}"'
            )
        },
    )


async def _get_doc_or_404(
    doc_id: uuid.UUID,
    org_id: uuid.UUID,
    db: AsyncSession,
) -> Document:
    """Load a document, enforcing tenant ownership."""
    doc = await db.scalar(
        select(Document).where(
            Document.id == doc_id,
            Document.organization_id == org_id,  # TENANT ISOLATION
        )
    )
    if doc is None:
        raise DocumentNotFoundError()
    return doc


# ---------------------------------------------------------------------------
# Inline document processing (fallback when Celery/Redis is unavailable)
# ---------------------------------------------------------------------------
# This runs the full ingestion pipeline (extract → chunk → embed → index)
# as an async background task within the FastAPI process itself.
# In production with a Celery worker running, this fallback is never used.


async def _process_document_inline(
    doc_id: uuid.UUID,
    org_id: uuid.UUID,
    doc_id_str: str,
    storage_path: str,
    ext: str,
) -> None:
    """Run the full ingestion pipeline inline without Celery."""
    from datetime import datetime

    from sqlalchemy import delete
    from sqlalchemy import select as _select

    from app.core.config import settings
    from app.core.logging import get_logger
    from app.db.models.document import (
        Document,
        DocumentChunk,
        DocumentProcessingJob,
        DocumentStatus,
        JobStatus,
    )
    from app.db.session import AsyncSessionLocal
    from app.providers.embeddings import get_model_version
    from app.services.ingestion_service import chunk_text, embed_chunks, extract_text
    from app.storage.local_storage import get_storage

    _log = get_logger(__name__)
    _log.info("inline_ingestion_started", document_id=doc_id_str)

    try:
        async with AsyncSessionLocal() as db:
            # Verify document exists and belongs to this org
            doc = await db.scalar(
                _select(Document).where(
                    Document.id == doc_id,
                    Document.organization_id == org_id,
                )
            )
            if doc is None:
                _log.error("inline_ingestion_doc_not_found", document_id=doc_id_str)
                return

            # Mark as processing. A re-index keeps REINDEXING so the document
            # (and its current chunks) stays visible to retrieval while the new
            # version is built.
            doc.status = (
                DocumentStatus.REINDEXING
                if doc.status == DocumentStatus.REINDEXING
                else DocumentStatus.PROCESSING
            )
            job = await db.scalar(
                _select(DocumentProcessingJob)
                .where(
                    DocumentProcessingJob.document_id == doc_id,
                    DocumentProcessingJob.organization_id == org_id,
                )
                .order_by(DocumentProcessingJob.created_at.desc())
                .limit(1)
            )
            if job:
                job.status = JobStatus.RUNNING
                job.started_at = datetime.now(UTC)
            await db.commit()

            # Read file from storage
            storage = get_storage()
            file_bytes = await storage.read(doc.storage_path)

            # Extraction (PyMuPDF + OCR), chunking (tiktoken) and embedding
            # (torch) are blocking CPU work. Run them in a worker thread so the
            # event loop keeps serving /health/live, login and chat.
            extraction = await asyncio.to_thread(extract_text, file_bytes, doc.file_extension)

            # Chunk
            chunks_data = await asyncio.to_thread(chunk_text, extraction)
            if not chunks_data:
                raise ValueError("Extraction produced no text chunks")

            # Embed
            chunks_data = await asyncio.to_thread(embed_chunks, chunks_data)

            # Do not recreate chunks for a document deleted while embedding.
            doc = await db.scalar(
                _select(Document).where(
                    Document.id == doc_id,
                    Document.organization_id == org_id,
                    Document.is_active == True,  # noqa: E712
                )
            )
            if doc is None:
                _log.info("inline_ingestion_aborted_deleted_document", document_id=doc_id_str)
                return

            # Replace both stores together: stale Qdrant points would point at
            # chunk IDs that no longer exist after a reindex.
            from app.providers.vector_store import (
                VectorPoint,
                delete_document_points,
                upsert_points,
            )

            await delete_document_points(doc_id, org_id)
            await db.execute(delete(DocumentChunk).where(DocumentChunk.document_id == doc_id))

            # Insert new chunks, flushing first so Qdrant can use their UUIDs.
            new_chunks: list[DocumentChunk] = []
            for cd in chunks_data:
                chunk = DocumentChunk(
                    document_id=doc_id,
                    organization_id=org_id,
                    content=cd.content,
                    content_hash=cd.content_hash,
                    chunk_index=cd.chunk_index,
                    page_number=cd.page_number,
                    section_heading=cd.section_heading,
                    start_char=cd.start_char,
                    end_char=cd.end_char,
                    token_count=cd.token_count,
                )
                db.add(chunk)
                new_chunks.append(chunk)
            await db.flush()

            await upsert_points(
                [
                    VectorPoint(
                        chunk_id=chunk.id,
                        document_id=doc_id,
                        organization_id=org_id,
                        embedding=cd.embedding,
                    )
                    for chunk, cd in zip(new_chunks, chunks_data, strict=True)
                ]
            )

            # Update document
            doc.status = DocumentStatus.READY
            doc.page_count = extraction.page_count
            doc.word_count = extraction.word_count
            doc.extraction_warnings = extraction.warnings or None
            doc.chunk_count = len(chunks_data)
            doc.embedding_model = settings.embedding_model
            doc.embedding_model_version = get_model_version()

            if job:
                job.status = JobStatus.SUCCESS
                job.completed_at = datetime.now(UTC)

            await db.commit()

            _log.info(
                "inline_ingestion_complete",
                document_id=doc_id_str,
                chunks=len(chunks_data),
            )

    except Exception as exc:
        _log.error(
            "inline_ingestion_failed",
            document_id=doc_id_str,
            error=str(exc)[:300],
        )
        # Mark as failed
        try:
            async with AsyncSessionLocal() as db:
                doc = await db.scalar(
                    _select(Document).where(
                        Document.id == doc_id,
                        Document.organization_id == org_id,
                    )
                )
                if doc:
                    doc.status = DocumentStatus.FAILED
                job = await db.scalar(
                    _select(DocumentProcessingJob)
                    .where(
                        DocumentProcessingJob.document_id == doc_id,
                        DocumentProcessingJob.organization_id == org_id,
                    )
                    .order_by(DocumentProcessingJob.created_at.desc())
                    .limit(1)
                )
                if job:
                    job.status = JobStatus.DEAD
                    job.error_type = type(exc).__name__
                    job.error_message = str(exc)[:256]
                    job.completed_at = datetime.now(UTC)
                await db.commit()
        except Exception:
            # The document is already logged as failed above; if even the
            # failure bookkeeping cannot be written, say so instead of hiding it.
            _log.exception(
                "inline_ingestion_failure_record_failed",
                document_id=doc_id_str,
            )

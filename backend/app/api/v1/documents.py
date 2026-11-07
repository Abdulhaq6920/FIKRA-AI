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

import hashlib
import mimetypes
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import CurrentUser, OrgAdminUser
from app.core.config import settings
from app.core.exceptions import (
    DocumentNotFoundError,
    FileTooLarge,
    InvalidFileType,
    PermissionDeniedError,
)
from app.core.logging import get_logger
from app.db.models.document import Document, DocumentProcessingJob, DocumentStatus, JobStatus
from app.db.models.conversation import Message
from app.db.session import get_db
from app.schemas.document import DocumentListResponse, DocumentOut, ProcessingJobOut
from app.storage.local_storage import get_storage

logger = get_logger(__name__)
router = APIRouter(prefix="/documents", tags=["documents"])


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

    # Validate file size
    file_bytes = await file.read()
    if len(file_bytes) > settings.max_upload_size_bytes:
        raise FileTooLarge(
            f"File exceeds {settings.max_upload_size_mb}MB limit."
        )

    # Validate extension
    original_name = file.filename or "unknown"
    ext = Path(original_name).suffix.lstrip(".").lower()
    if ext not in settings.allowed_extensions:
        raise InvalidFileType(
            f"File type '.{ext}' is not supported. "
            f"Allowed: {', '.join(settings.allowed_extensions)}"
        )

    # Detect actual MIME type (not trusting the client's Content-Type)
    try:
        import magic
        detected_mime = magic.from_buffer(file_bytes[:4096], mime=True)
    except Exception:
        detected_mime = file.content_type or "application/octet-stream"

    # Compute checksum for deduplication
    checksum = hashlib.sha256(file_bytes).hexdigest()

    # Generate a safe storage path — never use the user-supplied filename in the path
    doc_uuid = uuid.uuid4()
    storage_path = f"{org_id}/{doc_uuid}/{doc_uuid}.{ext}"

    # Save to storage
    storage = get_storage()
    await storage.save(file_bytes, storage_path)

    # Create document record
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
    db.add(document)
    await db.flush()

    # Create processing job record
    job = DocumentProcessingJob(
        document_id=doc_uuid,
        organization_id=org_id,
        status=JobStatus.PENDING,
    )
    db.add(job)
    await db.commit()

    # Dispatch background ingestion task
    from app.workers.document_tasks import ingest_document
    from app.core.logging import get_logger as _gl
    _log = _gl(__name__)
    try:
        task = ingest_document.apply_async(
            args=[str(doc_uuid), str(org_id)],
            queue="ingestion",
        )
        async with db.begin_nested():
            job.celery_task_id = task.id
            await db.flush()
        _log.info(
            "document_upload_queued",
            document_id=str(doc_uuid),
            org_id=str(org_id),
            file=original_name,
            size=len(file_bytes),
            celery_task=task.id,
        )
    except Exception as exc:
        # Celery/Redis unavailable — process document inline as background task
        _log.warning(
            "celery_unavailable_processing_inline",
            document_id=str(doc_uuid),
            error=str(exc)[:200],
        )
        import asyncio as _aio
        _aio.create_task(_process_document_inline(doc_uuid, org_id, str(doc_uuid), storage_path, ext))

    return DocumentOut.model_validate(document)


@router.get("/", response_model=DocumentListResponse)
async def list_documents(
    ctx: CurrentUser,
    db: AsyncSession = Depends(get_db),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    status: str | None = Query(default=None),
) -> DocumentListResponse:
    """List documents for the authenticated user's organization."""
    user, org_id, role = ctx

    query = select(Document).where(
        Document.organization_id == org_id,
        Document.is_active == True,  # noqa: E712
    )
    if status:
        query = query.where(Document.status == status)

    count_result = await db.execute(
        select(Document.id).where(
            Document.organization_id == org_id,
            Document.is_active == True,  # noqa: E712
        )
    )
    total = len(count_result.all())

    query = query.offset((page - 1) * page_size).limit(page_size).order_by(Document.created_at.desc())
    result = await db.execute(query)
    docs = result.scalars().all()

    return DocumentListResponse(
        items=[DocumentOut.model_validate(d) for d in docs],
        total=total,
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
        await db.execute(
            select(DocumentProcessingJob.celery_task_id).where(
                DocumentProcessingJob.document_id == doc_id,
                DocumentProcessingJob.organization_id == org_id,
            )
        )
    ).scalars().all()
    for task_id in jobs:
        if task_id:
            from app.workers.celery_app import celery_app
            celery_app.control.revoke(task_id, terminate=False)

    # Preserve conversations, but remove only metadata and excerpts that point
    # to this document. Other citations in the same assistant response remain.
    messages_with_citations = (
        await db.execute(
            select(Message).where(
                Message.organization_id == org_id,
                Message.citations.is_not(None),
            )
        )
    ).scalars().all()
    for message in messages_with_citations:
        citations = message.citations or []
        retained = [citation for citation in citations if citation.get("document_id") != str(doc_id)]
        if len(retained) != len(citations):
            message.citations = retained or None

    storage = get_storage()
    await storage.delete(doc.storage_path)

    # PostgreSQL ON DELETE CASCADE removes document_chunks (including pgvector
    # embeddings) and processing jobs. Deleting the document itself also means
    # its title and original filename cannot appear in later list requests.
    await db.delete(doc)
    await db.commit()
    logger.info("document_permanently_deleted", document_id=str(doc_id), actor=str(user.id))


@router.post("/{doc_id}/reindex", status_code=202)
async def reindex_document(
    doc_id: uuid.UUID,
    ctx: OrgAdminUser,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Re-queue a document for ingestion (admin only)."""
    user, org_id, role = ctx
    doc = await _get_doc_or_404(doc_id, org_id, db)

    doc.status = DocumentStatus.QUEUED
    await db.flush()

    from app.workers.document_tasks import ingest_document
    from app.core.logging import get_logger as _gl
    _log = _gl(__name__)
    task_id = None
    try:
        task = ingest_document.apply_async(
            args=[str(doc_id), str(org_id)],
            queue="ingestion",
        )
        task_id = task.id
    except Exception as exc:
        _log.warning("celery_unavailable_reindexing_inline", document_id=str(doc_id), error=str(exc)[:200])
        import asyncio as _aio
        _aio.create_task(_process_document_inline(doc_id, org_id, str(doc_id), doc.storage_path, doc.file_extension))

    await db.commit()
    return {"task_id": task_id or "inline", "status": "queued"}


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


@router.get("/{doc_id}/download")
async def download_document(
    doc_id: uuid.UUID,
    ctx: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """Download the original uploaded file (authenticated, tenant-scoped)."""
    user, org_id, role = ctx
    doc = await _get_doc_or_404(doc_id, org_id, db)

    storage = get_storage()
    file_bytes = await storage.read(doc.storage_path)

    return StreamingResponse(
        iter([file_bytes]),
        media_type=doc.mime_type,
        headers={
            "Content-Disposition": f'attachment; filename="{doc.original_filename}"'
        },
    )


async def _get_doc_or_404(
    doc_id: uuid.UUID,
    org_id: uuid.UUID,
    db,
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
    from datetime import datetime, timezone
    from sqlalchemy import delete, select as _select

    from app.db.models.document import Document, DocumentChunk, DocumentProcessingJob, DocumentStatus, JobStatus
    from app.db.session import AsyncSessionLocal
    from app.providers.embeddings import embed_documents, get_model_version
    from app.services.ingestion_service import chunk_text, embed_chunks, extract_text
    from app.storage.local_storage import get_storage
    from app.core.config import settings
    from app.core.logging import get_logger

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

            # Mark as processing
            doc.status = DocumentStatus.PROCESSING
            job = await db.scalar(
                _select(DocumentProcessingJob).where(
                    DocumentProcessingJob.document_id == doc_id,
                    DocumentProcessingJob.organization_id == org_id,
                ).order_by(DocumentProcessingJob.created_at.desc())
            )
            if job:
                job.status = JobStatus.RUNNING
                job.started_at = datetime.now(timezone.utc)
            await db.commit()

            # Read file from storage
            storage = get_storage()
            file_bytes = await storage.read(doc.storage_path)

            # Extract text
            extraction = extract_text(file_bytes, doc.file_extension)

            # Chunk
            chunks_data = chunk_text(extraction)
            if not chunks_data:
                raise ValueError("Extraction produced no text chunks")

            # Embed
            chunks_data = embed_chunks(chunks_data)

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

            # Delete existing chunks (safe reindex)
            await db.execute(
                delete(DocumentChunk).where(DocumentChunk.document_id == doc_id)
            )

            # Insert new chunks
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
                    embedding=cd.embedding,
                )
                db.add(chunk)

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
                job.completed_at = datetime.now(timezone.utc)

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
                    _select(DocumentProcessingJob).where(
                        DocumentProcessingJob.document_id == doc_id,
                        DocumentProcessingJob.organization_id == org_id,
                    ).order_by(DocumentProcessingJob.created_at.desc())
                )
                if job:
                    job.status = JobStatus.DEAD
                    job.error_type = type(exc).__name__
                    job.error_message = str(exc)[:256]
                    job.completed_at = datetime.now(timezone.utc)
                await db.commit()
        except Exception:
            pass

"""
Celery application configuration.

Workers run as a separate process using the same application codebase.
The broker and result backend are Redis.

To start: celery -A app.workers.celery_app worker --loglevel=info
"""

from __future__ import annotations

import ssl
from datetime import timedelta

from celery import Celery

from app.core.config import settings
from app.core.logging import configure_logging

# Install the same stdout + process-safe app.logs sink before Celery boots.
# With worker_hijack_root_logger=False below, Celery will not replace them.
configure_logging()

celery_app = Celery(
    "fikra",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=["app.workers.document_tasks", "app.workers.maintenance_tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,  # Ack after task completes (safer)
    worker_prefetch_multiplier=1,  # One task at a time per worker
    task_reject_on_worker_lost=True,  # Re-queue if worker dies mid-task
    worker_concurrency=settings.worker_concurrency,
    # Keep our structlog RotatingFileHandler on the root logger; Celery's
    # default hijack would discard it and send task logs only to the console.
    worker_hijack_root_logger=False,
    # Timeouts
    task_soft_time_limit=300,  # 5 min soft limit → SoftTimeLimitExceeded
    task_time_limit=360,  # 6 min hard limit → worker killed
    # Retry policy
    task_max_retries=3,
    task_default_retry_delay=60,  # 1 minute between retries
    # Result expiry
    result_expires=86400,  # 1 day
    # Force RESP2 protocol — older Redis (< 6.0) doesn't support HELLO command
    broker_transport_options={"protocol": 2},
    result_backend_transport_options={"protocol": 2},
    # Redis Cloud's free tier only exposes DB 0 and requires TLS (rediss://).
    # kombu refuses a rediss:// broker without ssl_cert_reqs, so supply it
    # explicitly rather than defaulting to insecure behaviour.
    broker_use_ssl=(
        {"ssl_cert_reqs": ssl.CERT_NONE}
        if settings.celery_broker_url.startswith("rediss://")
        else None
    ),
    # Dead-letter: tasks that exhaust retries are moved to a DL queue
    task_queues={
        "default": {"exchange": "default", "routing_key": "default"},
        "ingestion": {"exchange": "ingestion", "routing_key": "ingestion"},
    },
    task_default_queue="default",
    task_routes={
        "app.workers.document_tasks.*": {"queue": "ingestion"},
        "app.workers.maintenance_tasks.*": {"queue": "default"},
    },
    # Beat: run the ingestion reconciler every 5 minutes so documents stuck in
    # PROCESSING after a worker crash are self-healed to FAILED instead of being
    # lost forever.
    beat_schedule={
        "reconcile-stuck-documents": {
            "task": "app.workers.maintenance_tasks.reconcile_stuck_documents",
            "schedule": timedelta(minutes=5),
        },
    },
)

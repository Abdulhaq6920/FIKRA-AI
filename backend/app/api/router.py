"""
Central API router — registers all versioned route modules.
"""

from fastapi import APIRouter

from app.api.v1 import (
    access_requests,
    admin,
    admin_insights,
    admin_users,
    analytics,
    auth,
    chat,
    documents,
    health,
    notifications,
)

api_router = APIRouter(prefix="/api/v1")

api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(chat.router)
api_router.include_router(documents.router)
api_router.include_router(admin.router)
api_router.include_router(admin_users.router)
api_router.include_router(admin_insights.router)
api_router.include_router(analytics.router)
api_router.include_router(notifications.router)
api_router.include_router(access_requests.router)

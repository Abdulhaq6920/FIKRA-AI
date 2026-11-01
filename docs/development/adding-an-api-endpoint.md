# Adding an API Endpoint

This guide walks through adding a new endpoint to the backend, step by step.

## Example: Add `GET /api/v1/users/me/stats` (user usage stats)

### Step 1: Define the response schema

Create or edit a file in `app/schemas/`:

```python
# app/schemas/user.py
from pydantic import BaseModel

class UserStatsOut(BaseModel):
    total_conversations: int
    total_messages: int
    total_tokens_used: int
```

### Step 2: Add the API route

Create or edit a router file in `app/api/v1/`:

```python
# app/api/v1/users.py
from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import CurrentUser
from app.db.session import get_db
from app.db.models.conversation import Conversation, Message
from app.db.models.audit import UsageRecord
from app.schemas.user import UserStatsOut

router = APIRouter(prefix="/users", tags=["users"])

@router.get("/me/stats", response_model=UserStatsOut)
async def get_my_stats(
    ctx: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> UserStatsOut:
    user, org_id, role = ctx  # unpack auth context

    # All queries are tenant-scoped via org_id
    conv_count = await db.scalar(
        select(func.count(Conversation.id)).where(
            Conversation.user_id == user.id,
            Conversation.organization_id == org_id,  # tenant filter
        )
    )
    msg_count = await db.scalar(
        select(func.count(Message.id)).where(
            Message.user_id == user.id,
            Message.organization_id == org_id,
        )
    )
    tokens = await db.scalar(
        select(func.coalesce(func.sum(UsageRecord.total_tokens), 0)).where(
            UsageRecord.user_id == user.id,
            UsageRecord.organization_id == org_id,
        )
    )

    return UserStatsOut(
        total_conversations=conv_count or 0,
        total_messages=msg_count or 0,
        total_tokens_used=tokens or 0,
    )
```

### Step 3: Register the router

Edit `app/api/router.py`:

```python
from app.api.v1 import auth, chat, documents, health, users  # add users

api_router.include_router(users.router)
```

### Step 4: Add the frontend type

Edit `frontend/src/types/index.ts`:

```typescript
export interface UserStats {
  total_conversations: number;
  total_messages: number;
  total_tokens_used: number;
}
```

### Step 5: Add the frontend API call

Edit `frontend/src/lib/api/` or create a new file:

```typescript
// frontend/src/lib/api/users.ts
import { api } from "./client";
import type { UserStats } from "@/types";

export const usersApi = {
  getMyStats: () => api.get<UserStats>("/users/me/stats"),
};
```

### Step 6: Write tests

```python
# tests/integration/test_user_stats.py
class TestUserStats:
    async def test_returns_own_stats(self, client, test_user):
        # login, create conversation, then call endpoint
        ...
```

### Checklist

- [ ] Schema defined in `app/schemas/`
- [ ] Route added in `app/api/v1/`
- [ ] Router registered in `app/api/router.py`
- [ ] Uses `CurrentUser` or `OrgAdminUser` dependency for auth
- [ ] All DB queries filter by `organization_id`
- [ ] Frontend type added
- [ ] Frontend API method added
- [ ] Test written

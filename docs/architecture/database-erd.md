# Database Entity-Relationship Diagram

## Entity overview

```mermaid
erDiagram
    organizations {
        uuid id PK
        string name
        string slug UK
        enum status
        bool allow_registration
        int max_users
        int max_documents
        int max_storage_mb
        timestamptz created_at
        timestamptz updated_at
    }

    users {
        uuid id PK
        string email UK
        string email_normalized UK
        string hashed_password
        string full_name
        enum status
        bool is_platform_admin
        string password_reset_token
        timestamptz created_at
        timestamptz updated_at
    }

    organization_memberships {
        uuid id PK
        uuid user_id FK
        uuid organization_id FK
        enum role
        bool is_active
        timestamptz created_at
        timestamptz updated_at
    }

    refresh_sessions {
        uuid id PK
        uuid user_id FK
        string token_hash UK
        bool is_revoked
        timestamptz expires_at
        string user_agent
        string ip_address
    }

    documents {
        uuid id PK
        uuid organization_id FK
        uuid uploaded_by FK
        string title
        string original_filename
        string storage_path UK
        string mime_type
        string file_extension
        bigint file_size_bytes
        string checksum_sha256
        enum status
        enum access_level
        bool is_active
        int page_count
        int chunk_count
        string embedding_model
        string embedding_model_version
    }

    document_chunks {
        uuid id PK
        uuid document_id FK
        uuid organization_id FK
        text content
        string content_hash
        int chunk_index
        int page_number
        string section_heading
        int token_count
        vector_384 embedding
        tsvector content_tsv
    }

    document_processing_jobs {
        uuid id PK
        uuid document_id FK
        uuid organization_id FK
        string celery_task_id
        enum status
        int attempt_number
        string error_type
        text error_message
        timestamptz started_at
        timestamptz completed_at
    }

    conversations {
        uuid id PK
        uuid organization_id FK
        uuid user_id FK
        string title
        bool is_active
        int message_count
        timestamptz created_at
        timestamptz updated_at
    }

    messages {
        uuid id PK
        uuid conversation_id FK
        uuid organization_id FK
        uuid user_id FK
        enum role
        text content
        jsonb citations
        string model_used
        int input_tokens
        int output_tokens
        int latency_ms
        timestamptz created_at
    }

    conversation_summaries {
        uuid id PK
        uuid conversation_id FK
        uuid organization_id FK
        text summary_text
        uuid covers_up_to_message_id
        int message_count_covered
    }

    feedback {
        uuid id PK
        uuid message_id FK
        uuid user_id FK
        uuid organization_id FK
        enum feedback_type
        text comment
    }

    audit_logs {
        uuid id PK
        uuid organization_id FK
        uuid actor_user_id FK
        string action
        string resource_type
        string resource_id
        jsonb details
        string ip_address
        string request_id
        timestamptz created_at
    }

    usage_records {
        uuid id PK
        uuid organization_id FK
        uuid user_id FK
        uuid conversation_id
        string model
        int input_tokens
        int output_tokens
        int total_tokens
        int request_latency_ms
        int retrieval_latency_ms
    }

    organizations ||--o{ organization_memberships : "has"
    users ||--o{ organization_memberships : "belongs to"
    users ||--o{ refresh_sessions : "has"
    organizations ||--o{ documents : "owns"
    users ||--o{ documents : "uploads"
    documents ||--o{ document_chunks : "split into"
    documents ||--o{ document_processing_jobs : "tracked by"
    organizations ||--o{ conversations : "scopes"
    users ||--o{ conversations : "owns"
    conversations ||--o{ messages : "contains"
    conversations ||--o{ conversation_summaries : "summarized by"
    messages ||--o{ feedback : "receives"
    organizations ||--o{ audit_logs : "audited by"
    organizations ||--o{ usage_records : "billed for"
```

---

## Key design notes

### Tenant ownership
Every table except `users` and `refresh_sessions` has `organization_id`.
`document_chunks` has a denormalized `organization_id` to avoid a JOIN during vector search.

### Embedding column
`document_chunks.embedding` is a `vector(384)` column (pgvector).
The dimension **must match** `EMBEDDING_DIMENSIONS` in config.
Changing the embedding model requires updating this column definition and reindexing.

An IVFFlat index with `lists=100` is created at migration time:
```sql
CREATE INDEX ix_chunks_embedding_ivfflat
ON document_chunks USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
```

### Full-text search
`document_chunks.content_tsv` is a `tsvector GENERATED ALWAYS AS STORED` column.
It is automatically updated when `content` changes.
A GIN index enables fast FTS queries.

### Citations storage
`messages.citations` is JSONB — a list of citation objects. Each object contains:
`source_number`, `document_id`, `document_title`, `page_number`, `section_heading`, `excerpt`.

Citations are written by the server after validating them against the source map.
The model cannot inject unauthorized document references.

### Deletion behaviour
| Parent deleted | Child behaviour |
|---------------|----------------|
| Organization | CASCADE → all owned resources |
| User | CASCADE → memberships, conversations, messages, feedback; SET NULL → documents.uploaded_by |
| Document | CASCADE → chunks, processing jobs |
| Conversation | CASCADE → messages, summaries |
| Message | CASCADE → feedback |

### Indexes
All `organization_id`, `user_id`, and `status` columns are indexed.
`document_chunks.content_tsv` has a GIN index.
`document_chunks.embedding` has an IVFFlat index.
`users.email_normalized` has a unique index for fast login lookups.

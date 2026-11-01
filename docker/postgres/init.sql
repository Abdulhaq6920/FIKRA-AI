-- PostgreSQL initialization script
-- Runs once when the container is first created.
-- Extensions are also created in the Alembic migration,
-- but adding them here ensures they're available before migration runs.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

# FIKRA AI — Documentation Index

Welcome. This documentation explains every part of the system for developers at any level.

## Start here

1. [System Overview](architecture/system-overview.md) — what the system is and how it fits together
2. [Setup Guide](development/setup-guide.md) — get it running locally in 10 minutes
3. [Project Structure](development/project-structure.md) — where everything lives

## Architecture

- [System Overview](architecture/system-overview.md)
- [Database ERD](architecture/database-erd.md)
- [RAG Pipeline](architecture/rag-pipeline.md)
- [Document Ingestion](architecture/document-ingestion.md)
- [Authentication Flow](architecture/authentication-flow.md)
- [Tenant Isolation](architecture/tenant-isolation.md)
- [Conversation Memory](architecture/conversation-memory.md)

## Architecture Decision Records

- [ADR-001: Technology Stack](decisions/ADR-001-technology-stack.md)
- [ADR-002: Multi-Tenancy](decisions/ADR-002-multi-tenancy.md)
- [ADR-003: RAG Retrieval](decisions/ADR-003-rag-retrieval.md)
- [ADR-004: Authentication](decisions/ADR-004-authentication.md)
- [ADR-005: Model Provider](decisions/ADR-005-model-provider.md)

## Development

- [Setup Guide](development/setup-guide.md)
- [Project Structure](development/project-structure.md)
- [Testing Guide](development/testing-guide.md)
- [Debugging Guide](development/debugging-guide.md)
- [Adding an API Endpoint](development/adding-an-api-endpoint.md)
- [Adding a Document Parser](development/adding-a-document-parser.md)
- [Changing an Embedding Model](development/changing-an-embedding-model.md)

## Operations

> Historical audit/phase-gate documents below describe the retired pgvector
> backend. Current vector search runs in Qdrant (see `architecture/rag-pipeline.md`).

- [Production Readiness Plan](operations/production-readiness-plan.md) — phased path to GA
- [Release Checklist](operations/release-checklist.md) — the gates this release was verified against, with evidence and open items
- [Productionization Checklist](operations/productionization-checklist.md) — working backlog with status for every hardening item
- [CD Pipeline](operations/cd-pipeline.md) — build, push, deploy and rollback on main
- [Vercel Deployment](operations/vercel-deployment.md) — full-stack Services, Daemon and Blob setup on the Hobby plan
- [SLOs, Alerts and Runbook](operations/slo-and-alerts.md) — targets, alert inventory and first response
- [Backup and Restore](operations/backup-and-restore.md) — nightly dumps, offsite copy and restore drill
- [Audit Findings Register](operations/audit-findings.md) — every defect found, with severity and file:line
- [Configuration Reference](operations/configuration-reference.md)
- [Security Checklist](operations/security-checklist.md)
- [Troubleshooting](operations/troubleshooting.md)

## Reference

- [Glossary](glossary.md)

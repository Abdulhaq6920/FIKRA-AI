"""
Full end-to-end test: login -> upload doc -> process -> ask question -> verify answer.
This script lives OUTSIDE the backend dir so it doesn't trigger uvicorn reloads.
"""

import asyncio
import httpx
import io
import json
import time

BACKEND = "http://localhost:8000"
ORG_ID = "00000000-0000-0000-0000-000000000001"
EMAIL = "admin@fikra.ai"
PASSWORD = "Admin1234!"

# Test document content — should be findable when asking about it
DOC_CONTENT = """
FIKRA AI Technical Documentation

Overview
FIKRA AI is a multi-tenant Retrieval-Augmented Generation chatbot.
It uses PostgreSQL with pgvector for vector similarity search.
The system supports PDF, DOCX, Markdown, HTML, and TXT document formats.

Architecture
The backend is built with FastAPI and Python.
The frontend uses Next.js 14 with TypeScript and Tailwind CSS.
Background processing is handled by Celery workers with Redis as the broker.
Embeddings are generated locally using the BAAI/bge-small-en-v1.5 model.
The primary LLM is served by Groq using the openai/gpt-oss-20b model.

Security
Passwords are hashed with Argon2id.
JWT tokens are stored in HttpOnly cookies.
Every database query is filtered by organization_id for tenant isolation.
File uploads are validated by size, extension, and MIME type.

Retrieval Pipeline
The RAG pipeline uses hybrid retrieval combining vector search and full-text search.
Results are fused using Reciprocal Rank Fusion (RRF).
An optional cross-encoder reranker improves accuracy on the top candidates.
Citations are constructed from server-side metadata, not from LLM output.
"""


async def main():
    async with httpx.AsyncClient() as c:
        print("=" * 60)
        print("STEP 1: Login")
        print("=" * 60)
        r = await c.post(
            f"{BACKEND}/api/v1/auth/login",
            json={"email": EMAIL, "password": PASSWORD, "organization_id": ORG_ID},
        )
        assert r.status_code == 200, f"Login failed: {r.status_code} {r.text[:200]}"
        cookies = r.cookies
        print(f"  ✓ Login OK (status {r.status_code})")

        print()
        print("=" * 60)
        print("STEP 2: Upload document")
        print("=" * 60)
        files = {
            "file": ("tech_docs.txt", io.BytesIO(DOC_CONTENT.encode()), "text/plain")
        }
        r = await c.post(
            f"{BACKEND}/api/v1/documents/upload",
            files=files,
            cookies=cookies,
            timeout=30,
        )
        assert r.status_code == 201, f"Upload failed: {r.status_code} {r.text[:200]}"
        doc = r.json()
        doc_id = doc["id"]
        print(f"  ✓ Uploaded: {doc['title']} (id={doc_id})")
        print(f"  Status: {doc['status']}")

        print()
        print("=" * 60)
        print("STEP 3: Wait for document processing")
        print("=" * 60)
        # Poll document status until ready or failed
        for i in range(30):
            await asyncio.sleep(2)
            r = await c.get(f"{BACKEND}/api/v1/documents/{doc_id}", cookies=cookies)
            if r.status_code == 200:
                status = r.json()["status"]
                chunks = r.json().get("chunk_count", 0)
                print(f"  [{i*2}s] Status: {status}, chunks: {chunks}")
                if status == "ready":
                    print(f"  ✓ Document processed! ({chunks} chunks)")
                    break
                elif status == "failed":
                    print(f"  ✗ Document processing failed!")
                    # Check job status for error
                    r2 = await c.get(
                        f"{BACKEND}/api/v1/documents/{doc_id}/status", cookies=cookies
                    )
                    if r2.status_code == 200:
                        job = r2.json()
                        print(
                            f"    Error: {job.get('error_type')}: {job.get('error_message', '')[:200]}"
                        )
                    return
        else:
            print("  ✗ Timeout waiting for processing")
            return

        print()
        print("=" * 60)
        print("STEP 4: Create conversation and ask a question")
        print("=" * 60)
        r = await c.post(
            f"{BACKEND}/api/v1/chat/conversations",
            json={"title": "Tech Q&A"},
            cookies=cookies,
        )
        assert r.status_code == 201, f"Create conv failed: {r.status_code}"
        conv_id = r.json()["id"]
        print(f"  ✓ Conversation created: {conv_id}")

        # Ask a question about the document content
        question = "What model is used for embeddings in FIKRA AI?"
        print(f"  Question: {question}")

        r = await c.post(
            f"{BACKEND}/api/v1/chat/ask",
            json={"question": question, "conversation_id": conv_id},
            cookies=cookies,
            timeout=60,
        )

        print(f"  Response status: {r.status_code}")
        if r.status_code == 200:
            data = r.json()
            print(f"  ✓ Answer received!")
            print(f"  Model: {data['model_used']}")
            print(f"  Tokens: in={data['input_tokens']}, out={data['output_tokens']}")
            print(f"  Latency: {data['latency_ms']}ms")
            print(f"  Citations: {len(data['citations'])}")
            print()
            print("  ANSWER:")
            print("  " + "=" * 56)
            for line in data["answer"].split("\n"):
                print(f"  {line}")
            print("  " + "=" * 56)
            print()

            if data["citations"]:
                print("  CITATIONS:")
                for cit in data["citations"]:
                    print(f"  [Source {cit['source_number']}] {cit['document_title']}")
                    if cit["page_number"]:
                        print(f"    Page: {cit['page_number']}")
                    if cit["section_heading"]:
                        print(f"    Section: {cit['section_heading']}")
                    print(f"    Excerpt: {cit['excerpt'][:150]}...")
                    print()

            # Verify answer quality
            answer_lower = data["answer"].lower()
            has_bge = "bge" in answer_lower or "bge-small" in answer_lower
            has_baai = "baai" in answer_lower
            print(f"  Quality check:")
            print(f"    Contains 'bge': {has_bge}")
            print(f"    Contains 'baai': {has_baai}")
            print(f"    Has citations: {len(data['citations']) > 0}")
            if has_bge or has_baai:
                print(f"  ✓ Answer correctly references the embedding model!")
            else:
                print(f"  ⚠ Answer may not fully reference the expected model name")
        else:
            print(f"  ✗ Error: {r.text[:500]}")
            return

        print()
        print("=" * 60)
        print("STEP 5: Test streaming endpoint")
        print("=" * 60)
        question2 = "What database does FIKRA AI use?"
        print(f"  Question: {question2}")

        r = await c.post(
            f"{BACKEND}/api/v1/chat/ask/stream",
            json={"question": question2, "conversation_id": conv_id},
            cookies=cookies,
            timeout=60,
        )

        print(f"  Stream status: {r.status_code}")
        if r.status_code == 200:
            # Read streaming body
            text = r.text
            print(f"  Stream body length: {len(text)}")
            # Parse SSE data lines
            chunks = []
            for line in text.split("\n"):
                if line.startswith("data: "):
                    chunk = line[6:]
                    if chunk == "[DONE]":
                        break
                    if chunk.startswith("[ERROR]"):
                        print(f"  ✗ Stream error: {chunk}")
                        break
                    chunks.append(chunk)
            full_answer = "".join(chunks)
            print(f"  ✓ Streamed answer ({len(chunks)} chunks):")
            print(f"  {full_answer[:500]}")
        else:
            print(f"  ✗ Stream error: {r.text[:300]}")

        print()
        print("=" * 60)
        print("ALL TESTS COMPLETE")
        print("=" * 60)


asyncio.run(main())

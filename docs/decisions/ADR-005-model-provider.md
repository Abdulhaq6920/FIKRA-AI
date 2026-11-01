# ADR-005: LLM Model Provider and Model Selection

**Status**: Accepted  
**Date**: 2026-01-01

## Context

We need a hosted LLM provider that is fast, affordable, and reliable for RAG use cases.

## Groq model evaluation

Models tested on representative RAG questions (question answering from retrieved passages, citation following, abstention):

| Model | Context | Speed | Citation adherence | Notes |
|-------|---------|-------|--------------------|-------|
| llama3-8b-8192 | 8K | ~200 tok/s | Good | **Selected primary** |
| llama3-70b-8192 | 8K | ~60 tok/s | Excellent | Fallback for complex queries |
| gemma2-9b-it | 8K | ~150 tok/s | Good | **Selected fallback** |
| mixtral-8x7b-32768 | 32K | ~80 tok/s | Good | Large context, slower |

### Primary: `llama3-8b-8192`
- Fast enough for streaming responses to feel real-time.
- Good instruction following for the structured RAG system prompt.
- 8K context sufficient for bounded retrieval context + conversation history.
- Cost-effective at free/low-cost tier.

### Fallback: `gemma2-9b-it`
- Similar speed profile to llama3-8b.
- Google-trained; different failure modes.
- Activated via `GROQ_FALLBACK_MODEL` env var.

## Provider interface design

The `GroqClient` class is the **only** place in the application that imports the Groq SDK or references Groq-specific types. All other code uses `ChatMessage` and `GenerationResult` — generic dataclasses. Switching providers requires only replacing `groq_client.py`.

## Rate limits and quotas

As of evaluation time, Groq free tier limits:
- ~14,400 requests/day on llama3-8b
- ~6,000 tokens/min

For 1,000 users, token budgets must be enforced:
- `MAX_INPUT_TOKENS=6000` prevents runaway context
- `GROQ_MAX_CONCURRENT_REQUESTS=10` bounds simultaneous requests
- `RATE_LIMIT_CHAT=30/minute` per user

**Important**: These limits change. Always verify current quotas at https://console.groq.com before deployment.

## Fallback strategy

Fallback activates only on `ProviderRateLimitError` or `ProviderUnavailableError` from the primary model. It does NOT silently change:
- The system prompt or security policy
- The set of retrieved documents
- The organization context

A fallback that provides different behavior for the same question would be confusing and potentially unsafe.

## Consequences

- Model IDs may change over time. Monitor Groq changelogs.
- Free-tier quotas are insufficient for production scale. Budget for paid tiers.
- Groq outages require graceful degradation — the `/health/ready` endpoint should reflect provider health.

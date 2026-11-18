"""Measure /chat/ask latency distribution and per-stage cost.

Run from ``backend/`` (the API must be running)::

    ..\\.venv\\Scripts\\python.exe scripts\\bench_chat.py <label> [n]

Logs in, then issues *n* asks (each in a fresh conversation so conversation
history does not grow and skew the numbers), records the server-reported
latency_ms plus wall time, and prints p50/p95. Also reads /metrics before and
after to report the per-stage histogram sum/count deltas, which is where the
time actually goes.
"""

from __future__ import annotations

import json
import statistics
import sys
import time

import httpx

BASE = "http://127.0.0.1:8000"
CREDS = {
    "email": "admin@fikra.ai",
    "password": "Admin1234!",
    "organization_id": "00000000-0000-0000-0000-000000000001",
}
QUESTION = "When does benefits enrolment close?"


def stage_snapshot(client: httpx.Client) -> dict[str, tuple[float, float]]:
    text = client.get(f"{BASE}/metrics").text
    sums: dict[str, float] = {}
    counts: dict[str, float] = {}
    for line in text.splitlines():
        if line.startswith("rag_stage_duration_seconds_sum{"):
            stage = line.split('stage="', 1)[1].split('"', 1)[0]
            sums[stage] = float(line.rsplit(" ", 1)[1])
        elif line.startswith("rag_stage_duration_seconds_count{"):
            stage = line.split('stage="', 1)[1].split('"', 1)[0]
            counts[stage] = float(line.rsplit(" ", 1)[1])
    return {stage: (sums.get(stage, 0.0), counts.get(stage, 0.0)) for stage in counts}


def pct(values: list[float], q: float) -> float:
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(q * (len(ordered) - 1))))
    return ordered[index]


def main() -> None:
    label = sys.argv[1] if len(sys.argv) > 1 else "run"
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 20

    with httpx.Client(timeout=120.0) as client:
        login = client.post(f"{BASE}/api/v1/auth/login", json=CREDS)
        login.raise_for_status()
        token = login.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        before = stage_snapshot(client)
        server_ms: list[float] = []
        wall_ms: list[float] = []
        failures = 0

        for i in range(n):
            conv = client.post(
                f"{BASE}/api/v1/chat/conversations",
                headers=headers,
                json={"title": f"bench-{label}-{i}"},
            )
            conv.raise_for_status()
            conv_id = conv.json()["id"]

            started = time.perf_counter()
            response = client.post(
                f"{BASE}/api/v1/chat/ask",
                headers=headers,
                json={"question": QUESTION, "conversation_id": conv_id},
            )
            wall_ms.append((time.perf_counter() - started) * 1000)
            if response.status_code != 200:
                failures += 1
                print(f"  request {i}: HTTP {response.status_code} {response.text[:200]}")
                continue
            payload = response.json()
            server_ms.append(float(payload["latency_ms"]))
            print(
                f"  {i + 1:02d}/{n}  server={payload['latency_ms']:7.0f} ms  "
                f"wall={wall_ms[-1]:7.0f} ms  citations={len(payload['citations'])}"
            )

        after = stage_snapshot(client)

    print(f"\n=== {label} ===")
    print(f"requests: {len(server_ms)} ok / {failures} failed")
    print(
        f"server ms  p50={pct(server_ms, 0.50):.0f}  p95={pct(server_ms, 0.95):.0f}  "
        f"min={min(server_ms):.0f}  max={max(server_ms):.0f}  mean={statistics.fmean(server_ms):.0f}"
    )
    print(
        f"wall   ms  p50={pct(wall_ms, 0.50):.0f}  p95={pct(wall_ms, 0.95):.0f}  "
        f"mean={statistics.fmean(wall_ms):.0f}"
    )
    print("\nper-stage mean ms (delta over this run):")
    rows = []
    for stage, (total, count) in sorted(after.items()):
        prev_total, prev_count = before.get(stage, (0.0, 0.0))
        d_count = count - prev_count
        d_total = total - prev_total
        if d_count > 0:
            rows.append((stage, d_total / d_count * 1000, int(d_count)))
    for stage, mean_ms, count in rows:
        print(f"  {stage:<14} {mean_ms:8.1f} ms  (n={count})")

    with open(f"bench-{label}.json", "w", encoding="utf-8") as fh:
        json.dump(
            {
                "label": label,
                "server_ms": server_ms,
                "wall_ms": wall_ms,
                "stages": {s: [m, c] for s, m, c in rows},
            },
            fh,
            indent=2,
        )


if __name__ == "__main__":
    main()

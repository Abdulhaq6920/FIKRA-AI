---
test: ../admin_overview_test.md
status: failed
started: 2026-11-08T08:06:08.424Z
duration_s: 45
session_id: 5a041eb0-a010-4381-8b9b-d41abb8222f4
---

# Admin Overview is operational: quick links and failed jobs — Result

## Step 1 ✓ passed (36.3s)
md5: de08e6b6e9b2caab862d07c613669330
Log in on http://localhost:3000/login as `orgadmin@fikra.ai` with password
`FikraAdmin#2026` and wait for the Admin Dashboard.

## Step 2 ✗ failed (3.1s)
md5: 90853294490b672405acde97109ae093
Reason: Credits exhausted: {"error":"insufficient credits"}
Verify no organization analytics card (no "Organization analytics" title and
no "Open Analytics" link) appears on the Overview tab; organization analytics
live on the separate Analytics page.

## Step 3 ✓ passed (—)
md5: c2931a22aa09992e6f81e60c3ce2585b
Verify a "Management" section exists with these quick links: "Manage users",
"Review questions", "Knowledge base", "Feedback review", "Admin requests".

## Step 4 ✓ passed (—)
md5: 24f314d3c68e143d3a4aa3c5048c6d29
Verify a "Failed Ingestion Jobs" section exists and either lists failed jobs
with a red FAILED badge or shows the empty-state text "No failed ingestion
jobs.".

## Step 5 ✗ failed (—)
md5: ba3ce335a4016e9da076d38c561cc631
Click the "Manage users" quick link and verify the Users tab opens with the
Organization Users list. Do not interact with any user row.

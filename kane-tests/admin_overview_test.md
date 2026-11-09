---
mode: testing
target: chrome
max_steps: 40
url: http://localhost:3000/login
tags: smoke, admin
---

# Admin Overview is operational: quick links and failed jobs

## Step 1
Log in on http://localhost:3000/login as `orgadmin@fikra.ai` with password
`FikraAdmin#2026` and wait for the Admin Dashboard.

## Step 2
Verify no organization analytics card (no "Organization analytics" title and
no "Open Analytics" link) appears on the Overview tab; organization analytics
live on the separate Analytics page.

## Step 3
Verify a "Management" section exists with these quick links: "Manage users",
"Review questions", "Knowledge base", "Feedback review", "Admin requests".

## Step 4
Verify a "Failed Ingestion Jobs" section exists and either lists failed jobs
with a red FAILED badge or shows the empty-state text "No failed ingestion
jobs.".

## Step 5
Click the "Manage users" quick link and verify the Users tab opens with the
Organization Users list. Do not interact with any user row.

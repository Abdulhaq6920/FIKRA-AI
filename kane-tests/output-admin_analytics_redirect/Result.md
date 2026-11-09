---
test: ../admin_analytics_redirect_test.md
status: failed
started: 2026-11-08T08:04:26.060Z
duration_s: 95
session_id: 2eaf3d5b-eb53-463b-b776-68b58f9b8d3d
---

# Legacy /admin?tab=Analytics deep link redirects to the Analytics page — Result

## Step 1 ✓ passed (37.39s)
md5: de08e6b6e9b2caab862d07c613669330
Log in on http://localhost:3000/login as `orgadmin@fikra.ai` with password
`FikraAdmin#2026` and wait for the Admin Dashboard.

## Step 2 ✗ failed (5.4s)
md5: e0e15cd7ca8023bc72f210f605affbd7
Reason: Credits exhausted: {"error":"insufficient credits"}
Navigate directly to the URL http://localhost:3000/admin?tab=Analytics in the
address bar. Verify the browser URL becomes /analytics?view=organization and
the "Analytics" page heading with the text "Organization snapshot" is visible
instead of the Admin Dashboard.

## Step 3 ✓ passed (—)
md5: 421877bab3d2475f32e3460a49215506
Click the browser back button, then on the Admin Dashboard verify once more
that no tab button named "Analytics" exists in the tab strip.

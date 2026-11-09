---
mode: testing
target: chrome
max_steps: 40
url: http://localhost:3000/login
tags: admin, analytics
---

# Legacy /admin?tab=Analytics deep link redirects to the Analytics page

## Step 1
Log in on http://localhost:3000/login as `orgadmin@fikra.ai` with password
`FikraAdmin#2026` and wait for the Admin Dashboard.

## Step 2
Navigate directly to the URL http://localhost:3000/admin?tab=Analytics in the
address bar. Verify the browser URL becomes /analytics?view=organization and
the "Analytics" page heading with the text "Organization snapshot" is visible
instead of the Admin Dashboard.

## Step 3
Click the browser back button, then on the Admin Dashboard verify once more
that no tab button named "Analytics" exists in the tab strip.

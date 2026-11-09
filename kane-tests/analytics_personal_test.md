---
mode: testing
target: chrome
max_steps: 40
url: http://localhost:3000/login
tags: analytics, personal
---

# Admin can switch to My activity and sees only personal analytics

## Step 1
Log in on http://localhost:3000/login as `orgadmin@fikra.ai` with password
`FikraAdmin#2026`, wait for the Admin Dashboard, then open the "Analytics"
item in the left sidebar.

## Step 2
Click the "My activity" button in the view switcher. Verify the URL becomes
/analytics?view=personal and the page shows "My questions per day",
"My tokens per day", "My cost per day", "Sources I reference most",
"Feedback summary" and "My recent questions".

## Step 3
Verify NO "Organization snapshot" block and no "Member leaderboard" section
are visible on this view — only the caller's own data.

## Step 4
Verify the range selector shows "7 days", "14 days", "30 days", "90 days"
pills and that clicking "7 days" keeps the personal view rendering.

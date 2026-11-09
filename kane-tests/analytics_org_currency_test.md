---
mode: testing
target: chrome
max_steps: 50
url: http://localhost:3000/login
tags: analytics, currency
---

# Analytics organization view with USD/INR currency switch

## Step 1
Log in on http://localhost:3000/login as `orgadmin@fikra.ai` with password
`FikraAdmin#2026`, wait for the Admin Dashboard, then open the "Analytics"
item in the left sidebar. Verify the "Organization snapshot" block with tiles
"Active members", "Documents", "Conversations" and "Feedback" is visible.

## Step 2
Verify the header shows two currency buttons, `USD $` and `INR ₹`. Verify a
tile named "Cost in range" displays an amount formatted with a `$` dollar
sign, and a chart section named "Cost per day" exists showing a total value
also formatted with `$`.

## Step 3
Click the `INR ₹` button in the top bar. Verify the "Cost in range" tile now
shows the SAME amount converted and formatted with a `₹` rupee symbol (a much
larger number than the USD value), and the "Cost per day" chart caption now
reads "Cost · INR" with its totals in `₹`.

## Step 4
Reload the page with the browser refresh button and wait for the Analytics
page. Verify the cost tile still displays `₹` — the INR choice was persisted.

## Step 5
Click the `USD $` button and verify the cost tile switches back to `$`.

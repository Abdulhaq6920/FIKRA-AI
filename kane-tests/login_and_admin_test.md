---
mode: testing
target: chrome
max_steps: 40
url: http://localhost:3000/login
tags: smoke, auth
---

# Login as organization admin and land on the Admin dashboard

## Step 1
On the FIKRA AI login page, type `orgadmin@fikra.ai` into the email field,
`FikraAdmin#2026` into the password field, and click the submit button. Wait
for navigation and verify the "Admin Dashboard" heading is visible.

## Step 2
Verify the Admin Dashboard tab strip contains exactly these tab buttons:
Overview, Users, Questions, Documents, Feedback, Access Requests. Verify there
is NO tab button named "Analytics".

## Step 3
Click the "Users" tab and verify the "Organization Users" section with a
"Search by name or email…" input appears. Then click the "Overview" tab and
verify you are back on the Admin Dashboard with the "Open Analytics" link.

## Step 4
Click "Sign out" in the left sidebar and verify the app returns to the login
page.

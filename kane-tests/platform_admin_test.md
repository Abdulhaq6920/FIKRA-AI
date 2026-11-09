---
mode: testing
target: chrome
max_steps: 40
url: http://localhost:3000/login
tags: auth, platform-admin
---

# Platform admin can log in and sees the organization analytics view

## Step 1
On http://localhost:3000/login log in as `admin@fikra.ai` with password
`Admin1234!` and wait for the dashboard/chat area to load after sign-in.

## Step 2
Open "Admin" in the left sidebar and verify the Admin Dashboard renders with
its tabs. Do not modify any user.

## Step 3
Open "Analytics" in the left sidebar and verify the "Organization snapshot"
block is visible and the "My activity" switch is also available to this
admin.

## Step 4
Sign out via the sidebar and verify the login page returns.

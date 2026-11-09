---
mode: testing
target: chrome
max_steps: 50
url: http://localhost:3000/login
tags: documents, settings
---

# Documents page and Settings behaviour

## Step 1
Log in on http://localhost:3000/login as `orgadmin@fikra.ai` with password
`FikraAdmin#2026` and wait for the Admin Dashboard. Admins have no "Documents"
entry in the left sidebar.

## Step 2
Navigate directly to http://localhost:3000/documents. Verify the Documents
library loads and lists at least one existing document. It is read-only:
there is no upload control, no delete or reindex buttons, and a notice points
to "Admin → Documents". Do NOT upload or delete anything.

## Step 3
Open http://localhost:3000/admin and click the "Documents" tab. Verify an
"Upload document" button exists along with Download / Reindex / Delete
controls on rows. Do NOT click any of them.

## Step 4
Open "Settings" in the left sidebar. Verify the "Account" card appears ABOVE
the "Appearance" card on the page.

## Step 5
Click the "Change theme" button and verify a set of theme cards appears
(buttons whose label starts with "Use " and ends with " theme") — there must
be exactly 22 of them, including a "Fantasy" group of ten themes.

## Step 6
Click "Use Ember Abyss theme" and verify the applied theme (page attribute
data-theme) becomes "ember-abyss". Then click the collapse button
("Hide themes") and verify the theme cards disappear.

## Step 7
Open "Analytics" in the left sidebar and verify the Analytics page still
renders normally with the selected theme applied (no broken layout).

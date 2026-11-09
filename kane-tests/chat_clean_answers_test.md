---
mode: testing
target: chrome
max_steps: 40
url: http://localhost:3000/login
tags: chat, formatting
---

# Chat answers are well formatted and show no sources panel

## Step 1
Log in on http://localhost:3000/login as `orgadmin@fikra.ai` with password
`FikraAdmin#2026`, then open "Chat" in the left sidebar and wait for the
composer labelled "Chat input".

## Step 2
In the sidebar conversation list click the conversation titled
"What documents are available in the knowledge base?" and wait until the
messages load.

## Step 3
Verify the assistant answers are rendered as structured Markdown inside the
chat — at least one bulleted list or bold heading is visible in the open
answer text.

## Step 4
Verify NONE of the assistant answers display source markers: the text
"[Source" must not appear anywhere in the messages area, and no button or
counter like "N sources" appears under the answers. Verify each assistant
answer has only Copy, thumbs up, and thumbs down controls below it.

## Step 5
Do not send any new message. This conversation must remain unchanged.

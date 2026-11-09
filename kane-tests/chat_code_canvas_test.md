---
mode: testing
target: chrome
max_steps: 50
url: http://localhost:3000/login
tags: chat, code-canvas
---

# Coding answers render in a dedicated code canvas

## Step 1
Log in on http://localhost:3000/login as `orgadmin@fikra.ai` with password
`FikraAdmin#2026`, open "Chat" in the left sidebar, and wait for the composer.

## Step 2
In the composer type exactly:
Respond with exactly one fenced python code block and nothing else: a function reverse_string(s) that reverses a string.
then press Enter to send it. Wait until the "Stop response" button disappears,
then wait up to 30 more seconds for the assistant's full answer.

## Step 3
Verify the assistant reply contains a dark code block for Python with the
text `def reverse_string` inside it, and an expand button with accessible
name "Open code canvas". Do not proceed until it is visible.

## Step 4
Click "Open code canvas". Verify a full-screen dialog named "Code canvas"
opens, covering the whole browser window, with the code visible inside, plus
"Copy", "Download" and a close button.

## Step 5
Press the Escape key and verify the code canvas closes and the chat is visible
again.

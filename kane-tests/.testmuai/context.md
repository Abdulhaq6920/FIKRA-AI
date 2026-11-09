# FIKRA AI — application context for the test agent

FIKRA AI is a multi-tenant RAG chatbot web app running locally at
http://localhost:3000 (frontend) with a FastAPI backend at http://127.0.0.1:8000
(the browser only talks to the frontend, which proxies `/api/*`).

## Accounts
- Organization admin: email `orgadmin@fikra.ai`, password `FikraAdmin#2026`
- Platform admin (also org admin): email `admin@fikra.ai`, password `Admin1234!`

The login page has fields with ids `#email` and `#password` and a submit
button (`button[type="submit"]`). A successful login redirects to either
`/admin` (admins) or `/chat` (members).

## Layout
- Left sidebar: FIKRA AI logo, nav links Chat, Documents, Analytics, Settings,
  Admin (admins only), New conversation + conversation list on Chat, Sign out,
  Collapse.
- Top bar: back/forward buttons, a currency switch (`USD $` and `INR ₹`
  buttons), and a notification bell.
- Admin `/admin` tabs: Overview · Users · Questions · Documents · Feedback ·
  Access Requests. There is deliberately NO "Analytics" tab anymore.
- Analytics `/analytics`: admins get a view switcher with "Organization" and
  "My activity" buttons; members always see only "My activity". The
  organization view shows an "Organization snapshot" block, range tiles
  (including "Cost in range"), charts titled "Questions per day", "Tokens per
  day", "Cost per day", "Top cited sources" and a "Member leaderboard". The
  personal view shows tiles, "My questions per day", "My tokens per day", "My
  cost per day", "Sources I reference most", "Feedback summary" and "My recent
  questions".
- Chat `/chat`: conversation list in the sidebar, composer labelled
  "Chat input", assistant answers rendered as Markdown inside bubbles with
  `.chat-markdown` elements. Answers must NOT show a sources/references panel
  and must NOT display `[Source N]` markers. Fenced code renders in a dark code
  block with a header (language label, copy icon, expand icon
  `aria-label="Open code canvas"`); the expand button opens a full-screen
  "Code canvas" dialog with Copy/Download/Close, closed by Escape.
- Documents `/documents` and Settings `/settings`: Settings shows an "Account"
  card ABOVE an "Appearance" card; a "Change theme" button reveals 12 theme
  cards ("Use <name> theme" buttons) and can collapse them again.

## Rules for the agent
- Never delete, rename, deactivate, or change the role of any user,
  document, conversation, or feedback item. This is a live database.
- Never submit destructive forms. Creating nothing is fine.
- Do not log out mid-test unless a step asks for it, and never change the
  password or profile of any account.
- If a rate-limit banner like "handling a lot of requests right now" appears
  after sending a chat message, wait 10 seconds and continue waiting for the
  answer rather than failing immediately.
- Costs are displayed in USD by default ($...) and can be switched to INR
  (₹...) using the header currency switch.
- Everything on localhost is fast; wait generously (2–5 s) after clicks before
  asserting.

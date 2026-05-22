# How to write public docs

This is the house style for **public** documentation — the customer-facing
knowledgebase articles about migrating email with the Noxity tool. Use it for
every KB article.

## Who reads public docs

A customer moving their own mailbox. Assume **no** technical background. They
don't know what IMAP is, they've never heard of an "app password," and they're
mildly worried about losing their email. Your job is to get them through it
calmly, on one page.

## Principles

- **Plain and warm.** Write like a helpful support agent talking to one person,
  not a manual. Short sentences. Second person ("you").
- **Accurate to the actual screen.** Every step must match what the customer
  really sees. Use the real button and label text, in **bold**. Don't describe
  screens that don't exist. When in doubt, open the wizard and check.
- **Self-contained.** A customer should finish their migration from this one
  page without hunting around.
- **Explain jargon once.** First time you say IMAP or app password, give a
  one-line plain definition.

## Structure — copy this template

```markdown
# <Title: the task, in the customer's words>

<1–2 sentence intro: what they'll achieve and roughly how long it takes.>

## Before you start
What they need: both email addresses, both passwords, and — if their provider
requires it — an **app password** (say which providers do).

## Step by step
Walk the actual wizard, in order, using bold button/label text:
current e-mail → server (we auto-fill it; tell them to double-check) →
same/different address → same/different password → passwords (mention the eye
icon to check what they typed) → confirm → progress → done.

## While it runs
Reassure them: progress shows **% done**, time left, and "N of M e-mails." They
can leave it running. Mention **Sync artifact messages** (a second pass for mail
that arrived during the migration).

## If something goes wrong
The real messages they might see, each with the fix:
- "app password required" → how to get one for their provider.
- "we can't migrate to that destination" → use the right server hostname.
- "use a hostname, not an IP" → why, and what to enter instead.

## Need a hand?
Point to the support contact.
```

## Tone & style — and what to avoid

Write like a person. **Do not** use the tells of AI/marketing copy:

- No filler adjectives: *seamless, effortless, robust, powerful, cutting-edge.*
- No "In today's fast-paced world…" openers. Start with the task.
- No rule-of-three padding ("fast, easy, and reliable").
- Don't pile up em dashes. One idea per sentence.
- Don't over-reassure or gush. State facts; trust the reader.

Prefer: "You'll need an app password for Gmail. Here's how to make one." over
"Gmail offers a seamless, secure way to generate app-specific credentials."

## Accuracy: ground it in the real tool

Before publishing, check the source so steps and provider instructions are right:

- The wizard steps, labels, and button text live in `imapsync_form_extra.html`.
- The exact per-provider app-password steps and guide links live in
  `PROVIDER_INFO` in `imapsync_form.js` — copy those, don't guess.
- Which providers are auto-detected: `CONSUMER_DOMAINS` / `MX_PROVIDERS` in the
  same file.
- The support contact is `NOXITY_SUPPORT` in `noxity-ips.js`.

## Where they live & naming

Save articles under `docs/kb/` with a kebab-case slug that matches the customer's
search: `docs/kb/migrating-from-gmail.md`, `docs/kb/what-is-an-app-password.md`.

## Good public-doc topics

What is an app password (per provider) · migrating from Gmail / Google Workspace
/ Microsoft 365 / Outlook.com / Yahoo / iCloud · "how long will it take" ·
"is my old email deleted?" (no) · what to do if a migration stops or errors ·
running it again to catch new mail.

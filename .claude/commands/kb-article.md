---
description: Write a public knowledgebase article about migrating email with the Noxity tool
argument-hint: <topic, e.g. "migrating from Gmail" or "what is an app password">
allowed-tools: Read, Grep, Glob, Write
---

You are writing a **public, customer-facing knowledgebase article** for Noxity's
mailbox migration tool (the wizard in this repo). The reader is a non-technical
customer migrating their own email. Topic: **$ARGUMENTS** (if empty, ask what
article to write, then proceed).

## Ground the article in how the tool actually works

Before writing, read the source so every step matches the real UI — do not invent
screens, buttons, or behaviour:

- `imapsync_form_extra.html` — the actual wizard steps, labels, and button text.
- `imapsync_form.js` — `CONSUMER_DOMAINS` / `MX_PROVIDERS` (which providers are
  auto-detected) and `PROVIDER_INFO` (the **exact** app-password instructions and
  guide links per provider). Quote these accurately; don't paraphrase the steps
  wrong.
- `noxity-ips.js` — the support contact (`NOXITY_SUPPORT`) to point readers to.

If the topic is provider-specific (Gmail, Workspace, Microsoft 365, Outlook,
Yahoo, iCloud), pull the steps straight from that provider's entry in
`PROVIDER_INFO`.

## What every article should cover (adapt to the topic)

1. **One-line summary** of what the reader will achieve.
2. **Before you start** — what they need (both addresses, both passwords, and an
   *app password* if their provider needs one). Be explicit about which providers
   require one.
3. **Step-by-step** through the actual wizard: current e-mail → server (auto-filled,
   ask them to double-check) → same/different address → same/different password →
   passwords (mention the eye icon to verify) → confirm → progress → done.
4. **Watching progress** — % done, time remaining, "N of M e-mails", and that they
   can leave it running. Mention "Sync artifact messages" (a second pass that
   catches mail that arrived during the migration).
5. **Troubleshooting** — the real messages a customer can hit: "app password
   required", "we can't migrate to that destination", "use a hostname, not an IP".
   Give the fix for each.
6. **Where to get help** — the support contact from `noxity-ips.js`.

## Tone & style (important)

- Plain, warm, direct. Short sentences. Second person ("you").
- **No AI tells**: avoid "seamless", "robust", "effortless", "in today's world",
  rule-of-three padding, and em-dash pile-ups. Write like a helpful human support
  agent. (Apply the same standards as the `humanizer` skill.)
- Explain jargon the first time (IMAP, app password). Don't assume technical
  knowledge.
- Use real button/label text in **bold** so it matches what they see on screen.

## Output

- Save to `docs/kb/<kebab-case-slug>.md` (create the folder if needed).
- Start with an H1 title and a 1–2 sentence intro, then the sections above.
- Keep it self-contained — a customer should be able to finish a migration from
  this one page.
- End by printing the saved path and a 2-line summary of what you wrote.

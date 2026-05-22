# How to write internal docs

This is the house style for **internal** documentation of the migration tool —
the stuff engineers and support read, not customers. Use it whenever you add or
update a runbook, an architecture note, a config reference, or an incident write-up.

## Who reads internal docs

A teammate who is competent but doesn't have the context in their head right now:
a new engineer, or whoever is on call at 2am. Assume technical literacy, assume
**no** memory of why a thing was built the way it was. Your job is to remove the
need to ask someone.

## Principles

- **Accurate over tidy.** A doc that's correct and ugly beats a polished one
  that's subtly wrong. If you're unsure, say so.
- **Be blunt about caveats and limits.** Write down the sharp edges, the things
  that look done but aren't, the security holes you're aware of. The allowlist
  being client-side only is exactly the kind of thing that belongs in writing.
- **Reproducible.** Real commands, real paths, real file names — copy-pasteable.
  Mark anything the reader must substitute (`<domain>`, `/path/to/...`).
- **Current or dated.** Put the last-updated date on procedures. A stale runbook
  is worse than none. Delete what's no longer true.

## What belongs in internal docs

- Architecture and request flow (how the pieces talk).
- Deploy and operations runbooks (step-by-step, with verification).
- Configuration reference (every knob, what it does, safe values).
- Security notes and known limitations.
- Troubleshooting tables (symptom → check → fix).
- Incident notes / postmortems (what broke, why, what changed).

## Structure — copy this template

```markdown
# <Title: what this doc is>

**Owner:** <name/team>  ·  **Last updated:** <YYYY-MM-DD>

## Summary
One or two sentences: what this covers and when you'd reach for it.

## Audience & prerequisites
Who this is for and what they need first (access, tools, a test mailbox).

## Steps / Procedure
Numbered, imperative steps. One action per step. Real commands in code blocks.
Note anything destructive *before* the step, not after.

## Verification
How to confirm it worked (the exact command/output to expect).

## Rollback / recovery
How to undo it, or what to do if it half-finished.

## Caveats & limitations
The sharp edges. What this does NOT cover or protect against.

## Related
Links to code, other docs, tickets.
```

Short notes don't need every heading — but **Summary**, **Steps**, and
**Verification** are the minimum for anything procedural.

## Tone & formatting

- Imperative and direct: "Restart Apache," not "You might want to restart Apache."
- Exact paths, users, and ports. `www-data`, `/usr/lib/cgi-bin/imapsync`, `:443`.
- Call out danger inline with a marker (⚠️) before the risky step.
- Use a symptom→check→fix **table** for troubleshooting; it's faster to scan.
- State assumptions explicitly ("assumes Debian 13 + Apache from the README").

## Maintenance

- Update the doc in the **same change** that changes the behaviour.
- Re-date procedures when you touch them.
- If you find a doc is wrong, fix it or mark it `OUTDATED:` at the top — don't
  leave a confident-but-wrong doc standing.

## Good internal-doc topics for this tool

Architecture & request flow · deploy-from-scratch runbook · the `/bypass/` +
basic-auth setup · the destination-allowlist limitation and any server-side
enforcement · "migration OOM-killed" runbook (swap) · upgrading imapsync · the
front-end CSS/JS gotchas (specificity, the flash fix, centering).

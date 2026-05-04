/* =============================================================
   Noxity destination allowlist
   -------------------------------------------------------------
   The destination IMAP host the user enters in the wizard is
   resolved via DNS-over-HTTPS at submit time, and at least one
   of its A records must match an entry in the list below for
   the migration to proceed.

   Examples that should pass:
     mail.customerdomain.com   →  resolves to a Noxity IP listed below
     delta.web.example.net     →  resolves to a Noxity IP listed below
     203.0.113.10              →  IP entered directly, matches the list

   To add a new mail server, drop its public IPv4 address into
   the array. Whitespace and comments are ignored.

   Leaving the array empty disables the check (useful for local
   testing). Production should always have at least one entry.
   ============================================================= */

window.NOXITY_DEST_IPS = [
    // "203.0.113.10",
    // "203.0.113.11",
];

/* Optional: support contact shown on every provider/error modal.
   Change the address (or replace with a URL like "https://noxity.io/support")
   to redirect the user wherever you want. */
window.NOXITY_SUPPORT = "mailto:support@noxity.io";

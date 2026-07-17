# Noxity Mailbox Migration UI

A guided, single-screen web UI for [imapsync](https://imapsync.lamiral.info/),
the open-source IMAP copy engine by Gilles Lamiral. Customers walk through a
short wizard (source → destination → confirm), watch live progress, and the
backend is plain imapsync running as a CGI.

This repo is the front end plus one optional server-side script
(`server/imapsync-guard`). imapsync itself (the Perl program / CGI) is installed
separately on the server — see [Deploy from scratch](#deploy-from-scratch-debian-13).

---

## What's in here

| File | Purpose |
|------|---------|
| `imapsync_form_extra.html` | The custom wizard UI (entry point customers load). |
| `imapsync_form.css` | All styling (the "Noxity Design System" — ink-on-paper, dark mode). |
| `imapsync_form.js` | All behaviour: wizard steps, provider detection, validation, live progress. |
| `noxity-ips.js` | **Config** — destination allowlist + support contact. Edit this per environment. |
| `server/imapsync-guard` | **Server-side** CGI wrapper that enforces the allowlist and starts runs detached (optional — see [Locking the backend](#locking-the-backend-server-side-enforcement)). |
| `server/imapsync-log` | Companion CGI the browser tails a running migration through (see [Long migrations](#long-migrations-status-polling)). |
| `credits.html` | License/attribution page for imapsync (linked from the footer). |
| `favicon.ico`, `logo_imapsync_Xn.png` | Assets. |

No build step, no framework. It loads Tailwind, jQuery, and Font Awesome from
CDNs and is served as static files.

---

## How it works

```
Browser ──────────────► imapsync_form_extra.html (+ css/js)        static files
   │  fills the wizard
   │  POST /cgi-bin/imapsync  (user1, password1, host1, user2, …)
   ▼
Apache ──► /usr/lib/cgi-bin/imapsync
   │  Base install: the imapsync Perl script in CGI mode, streaming the run log
   │  back over this same response.
   │  With the guard installed: starts imapsync detached and answers at once
   │  with a job id, because a sync outlives what a proxy will hold open —
   │  see Long migrations (status polling).
   ▼
Browser tails the log (GET /cgi-bin/imapsync-log?job=…&from=…, every 6s) and
parses the `ETA:` line → % done, time left, N of M.
```

- **Provider detection** (Gmail / Google Workspace / Microsoft 365 / Outlook /
  Yahoo / iCloud): the source domain is checked against a table, and for custom
  domains an MX lookup is done via DNS-over-HTTPS (Cloudflare). The source host
  is auto-filled and an "app password" modal is shown where relevant.
- **Destination allowlist**: at submit time the destination hostname is resolved
  (DoH) and must match an IP in `noxity-ips.js`, otherwise the migration is
  refused. ⚠️ This check is **client-side only** — see [Security](#security-notes).
- **Hostnames only**: the host fields reject raw IP addresses, because an IP
  connection can't be TLS-verified.

---

## Configuration (`noxity-ips.js`)

```js
window.NOXITY_DEST_IPS = [
    "2.58.59.26",          // public IPv4 of each Noxity mail server
];
window.NOXITY_SUPPORT = "mailto:support@noxity.io";   // shown on every modal
```

- Add one line per destination mail-server IP. Customers enter a **hostname**
  that resolves to one of these.
- An **empty array disables the check** — handy for local testing, never in prod.

---

## Local preview

### Whole thing, migration included

```bash
python3 server/dev-server.py
# open http://127.0.0.1:8799/imapsync_form_extra.html
```

Serves the UI and runs the **real** `imapsync-guard` and `imapsync-log`, so the
allowlist check, the detached job start and the log tailing are all exercised.
Only imapsync itself is faked — it replays a realistic log, so there's no IMAP
server, no credentials, and nothing to clean up. A full run takes ~35s and walks
the whole status sequence:

```
Connecting…  ->  Counting messages in your current mailbox (12 folders)…
->  Reading INBOX.Sent (4,567 messages)…  ->  Copying INBOX.Sent — 4,180 of 4,567
->  Migration complete
```

In the wizard use **`one.one.one.one`** as the destination host. Browser and
guard both check the destination and both read the dev allowlist the script
serves, and that's the hostname they accept. Source host and passwords can be
anything; nothing connects anywhere.

Runs on **8799**, not the static preview's 8765, and stamps a token onto the
asset URLs. Both are cache defences: a page cached from an `http.server` on 8765
would otherwise shadow this one and silently serve the real allowlist, and the
wizard would refuse every destination for reasons nothing on screen explains.

The scripts have production paths baked in (`/usr/lib/cgi-bin`, `/var/www/html`,
`/var/tmp`), so they're copied to a temp dir with those three rewritten and
nothing else — what runs is otherwise byte-for-byte what deploys. The sandbox is
printed at startup and removed on ctrl-c.

### Static only

```bash
python3 -m http.server 8765
# open http://localhost:8765/imapsync_form_extra.html
```

The wizard renders and you can click through it, but "Begin migration" fails the
POST — there's no CGI. To get that far without the allowlist blocking you, set
`NOXITY_DEST_IPS = []` temporarily.

---

## Deploy from scratch (Debian 13)

Target: a clean Debian 13 (trixie) box that will serve
`https://migrate.noxity.io` with Apache + the imapsync CGI.

> Adjust these to your box; they're referenced throughout:
>
> | Var | Value used here |
> |-----|-----------------|
> | Domain | `migrate.noxity.io` |
> | Web root | `/var/www/html` |
> | imapsync source | `/opt/imapsync` |
> | Custom UI checkout | `/opt/imapsync-ui` (this repo) |
> | CGI | `/usr/lib/cgi-bin/imapsync` |
> | Web user | `www-data` |

### 1. Base system + swap

imapsync holds whole messages in memory while it works; on big mailboxes it can
spike well past a small VPS's RAM. **These boxes ship with little or no swap, so
add at least 4 GB** or large migrations get OOM-killed mid-run.

```bash
apt update && apt -y full-upgrade
apt install -y apache2 apache2-utils git curl ca-certificates

# --- 4 GB swap (skip the fallocate line and use dd if your FS dislikes it) ---
fallocate -l 4G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab          # persist across reboots

# Prefer RAM, fall back to swap only under pressure
echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
sysctl --system

free -h          # verify: Swap should show 4.0Gi
```

### 2. Install imapsync

The simplest route is the Perl dependencies via apt, then the imapsync script
itself from the official repo (the in-distro package lags behind).

```bash
# Perl dependencies (this is imapsync's documented Debian set; if a migration
# errors about a missing module, install the matching lib*-perl package and
# re-check with `imapsync --testslive`).
apt install -y \
  libauthen-ntlm-perl libcgi-pm-perl libcrypt-openssl-rsa-perl libdata-uniqid-perl \
  libdigest-hmac-perl libdist-checkconflicts-perl libencode-imaputf7-perl \
  libfile-copy-recursive-perl libfile-tail-perl libio-compress-perl \
  libio-socket-inet6-perl libio-socket-ssl-perl libio-tee-perl libhtml-parser-perl \
  libjson-webtoken-perl libmail-imapclient-perl libmodule-scandeps-perl \
  libnet-ssleay-perl libpar-packer-perl libparse-recdescent-perl libproc-processtable-perl \
  libreadonly-perl libregexp-common-perl libsys-meminfo-perl libterm-readkey-perl \
  libtest-fatal-perl libtest-mock-guard-perl libtest-mockobject-perl libtest-pod-perl \
  libtest-requires-perl libtest-simple-perl libunicode-string-perl liburi-perl \
  libwww-perl libxml-libxml-perl make cpanminus

# Get imapsync
git clone https://github.com/imapsync/imapsync.git /opt/imapsync
cd /opt/imapsync
./imapsync --version          # confirms Perl + modules are OK
make install                  # installs the binary to /usr/bin/imapsync
```

### 3. Wire imapsync up as a CGI

```bash
cp /opt/imapsync/imapsync /usr/lib/cgi-bin/imapsync
chmod 755 /usr/lib/cgi-bin/imapsync

a2enmod cgi headers ssl rewrite
systemctl restart apache2

# Sanity check (returns imapsync's CGI banner):
curl -s -X POST http://localhost/cgi-bin/imapsync | head
```

Debian's Apache already maps `/cgi-bin/` → `/usr/lib/cgi-bin/`
(`/etc/apache2/conf-enabled/serve-cgi-bin.conf`), so the form's
`action="/cgi-bin/imapsync"` works out of the box.

### 4. Deploy the custom UI (public)

```bash
git clone https://github.com/noxitylabs/imapsync.git /opt/imapsync-ui

# Serve it at the web root. The browser opens imapsync_form_extra.html.
install -d /var/www/html
cp /opt/imapsync-ui/{imapsync_form_extra.html,imapsync_form.css,imapsync_form.js,\
noxity-ips.js,credits.html,favicon.ico,logo_imapsync_Xn.png} /var/www/html/
chown -R www-data:www-data /var/www/html
```

Optionally make `imapsync_form_extra.html` the directory index so the clean URL
`https://migrate.noxity.io/` opens it — add to the vhost below.

### 5. HTTPS via a Cloudflare Origin certificate

This site sits behind Cloudflare, so the origin serves a **Cloudflare Origin
certificate** (a long-lived cert Cloudflare trusts) — there's no certbot /
Let's Encrypt.

**a. Create the Origin cert** in the Cloudflare dashboard → **SSL/TLS → Origin
Server → Create Certificate**. Pick RSA or ECDSA, hostnames `migrate.noxity.io`
(or `*.noxity.io`), 15-year validity. Save the two blocks on the server:

```bash
mkdir -p /etc/ssl/cloudflare
# Paste the CERTIFICATE block into this file:
nano /etc/ssl/cloudflare/migrate.noxity.io.pem
# Paste the PRIVATE KEY block into this file:
nano /etc/ssl/cloudflare/migrate.noxity.io.key
chmod 600 /etc/ssl/cloudflare/migrate.noxity.io.key
```

**b. Write the vhost** at `/etc/apache2/sites-available/migrate.noxity.io.conf`:

```apache
<VirtualHost *:443>
    ServerName migrate.noxity.io
    DocumentRoot /var/www/html
    DirectoryIndex imapsync_form_extra.html index.html

    <Directory /var/www/html>
        Require all granted
    </Directory>

    SSLEngine on
    SSLCertificateFile    /etc/ssl/cloudflare/migrate.noxity.io.pem
    SSLCertificateKeyFile /etc/ssl/cloudflare/migrate.noxity.io.key
</VirtualHost>
```

```bash
a2enmod ssl
a2ensite migrate.noxity.io
apachectl configtest && systemctl reload apache2
```

**c. Cloudflare side:**

- DNS: the `migrate` record → **proxied** (orange cloud).
- **SSL/TLS → Overview → encryption mode → Full (strict).** The Origin cert
  validates fine under strict.

No `*:80` vhost is needed — Cloudflare reaches the origin over HTTPS (443).
Turn on **Always Use HTTPS** in Cloudflare so visitors are upgraded too.

You now have the custom UI live at `https://migrate.noxity.io/`.

---

## The stock imapsync UI at `/bypass/` (support only)

Support sometimes needs the **full, unrestricted** imapsync form (every option,
no allowlist). We serve the *original* imapsync UI at `/bypass/`, behind HTTP
basic auth, while customers only ever see the custom UI.

> Why a separate directory: the custom UI reuses the stock filenames
> (`imapsync_form.css` / `.js`), so the two sets can't share a folder — keep the
> stock UI isolated under `bypass/`.

### 1. Put the stock UI under `bypass/`

```bash
install -d /var/www/html/bypass
# The stock web form ships with imapsync:
cp /opt/imapsync/imapsync_form.html      /var/www/html/bypass/index.html
cp /opt/imapsync/imapsync_form.css       /var/www/html/bypass/
cp /opt/imapsync/imapsync_form.js        /var/www/html/bypass/
# (also copy imapsync_form_extra.html from /opt/imapsync if support wants the
#  extended stock form too)
chown -R www-data:www-data /var/www/html/bypass
```

Both UIs POST to imapsync's CGI, so the stock form works unchanged — until you
enable [server-side enforcement](#locking-the-backend-server-side-enforcement),
which repoints the bypass copy at `/cgi-bin/imapsync-staff` (one `action` change,
covered there).

### 2. Password-protect it

```bash
# Create the support login (re-run without -c to add more users):
htpasswd -c /etc/apache2/.htpasswd-bypass support
```

Add to the `*:443` vhost (inside `<VirtualHost>`):

```apache
<Directory /var/www/html/bypass>
    AuthType Basic
    AuthName "Noxity support — imapsync (staff only)"
    AuthUserFile /etc/apache2/.htpasswd-bypass
    Require valid-user
    DirectoryIndex index.html
</Directory>
```

```bash
apachectl configtest && systemctl reload apache2
```

Result:

| URL | Who | Auth |
|-----|-----|------|
| `https://migrate.noxity.io/` | Customers | none (public) |
| `https://migrate.noxity.io/bypass/` | Support | HTTP basic auth |
| `https://migrate.noxity.io/cgi-bin/imapsync` | Public UI | none — shared backend until you add the [wrapper](#locking-the-backend-server-side-enforcement) |
| `https://migrate.noxity.io/cgi-bin/imapsync-staff` | Bypass UI | HTTP basic auth — exists once enforcement is enabled |

---

## Locking the backend (server-side enforcement)

By default `/cgi-bin/imapsync` is an **open backend**: `noxity-ips.js` only runs in
the browser, so anyone can `curl` straight to the CGI with any `host1` / `host2` /
credentials and have the box open IMAP sessions to arbitrary servers. To make the
allowlist a real control, split the single CGI in two:

| Endpoint | Used by | Auth | Destinations |
|----------|---------|------|--------------|
| `/cgi-bin/imapsync` | Public UI | none | **allow-listed only** (checked by the wrapper) |
| `/cgi-bin/imapsync-staff` | `/bypass/` (support) | HTTP basic auth | any (unrestricted) |

`server/imapsync-guard` becomes the public CGI. It re-runs the destination check
server-side — pulls `host2` from the POST, resolves it (or takes a literal IP),
and only runs the real imapsync if it matches an IP in `noxity-ips.js`; otherwise
it returns `403`. The real imapsync moves to `imapsync-staff`, now behind the same
basic auth as `/bypass/`, so the unrestricted path is **staff-only instead of open
to the world**.

The guard does not stream the migration back on that request — see
[Long migrations](#long-migrations-status-polling) for why, and for the second
CGI (`imapsync-log`) it needs.

> **Fail-closed:** unlike the browser (empty list = check disabled, for local
> testing), the wrapper **denies everything** if `noxity-ips.js` is missing or has
> no IPs. A security control should fail safe.

### Steps

Assumes the base install is done (imapsync at `/usr/lib/cgi-bin/imapsync`, UI
checkout at `/opt/imapsync-ui`, `/bypass/` set up with `.htpasswd-bypass`).

```bash
# 1. Move the real imapsync to the staff endpoint.
cp /opt/imapsync/imapsync /usr/lib/cgi-bin/imapsync-staff
chmod 755 /usr/lib/cgi-bin/imapsync-staff

# 2. Install the wrapper as the public CGI (it takes over /cgi-bin/imapsync),
#    plus the log tail it hands the browser off to.
cp /opt/imapsync-ui/server/imapsync-guard /usr/lib/cgi-bin/imapsync
cp /opt/imapsync-ui/server/imapsync-log   /usr/lib/cgi-bin/imapsync-log
chmod 755 /usr/lib/cgi-bin/imapsync /usr/lib/cgi-bin/imapsync-log
perl -c /usr/lib/cgi-bin/imapsync          # syntax sanity check
perl -c /usr/lib/cgi-bin/imapsync-log

# 3. Repoint the bypass form at the unrestricted endpoint (idempotent).
perl -pi -e 's{/cgi-bin/imapsync(?!-staff)}{/cgi-bin/imapsync-staff}g' \
  /var/www/html/bypass/index.html \
  /var/www/html/bypass/imapsync_form.js
# (also .../bypass/imapsync_form_extra.html if you deployed it)
```

Put basic auth on the staff endpoint **server-wide** (a `<Location>` inside one
vhost wouldn't cover a stray `:80`), then reload:

```bash
cat > /etc/apache2/conf-available/imapsync-staff.conf <<'EOF'
# Staff-only unrestricted imapsync backend (used by /bypass/)
<Location /cgi-bin/imapsync-staff>
    AuthType Basic
    AuthName "Noxity support — imapsync (staff only)"
    AuthUserFile /etc/apache2/.htpasswd-bypass
    Require valid-user
</Location>
EOF
a2enconf imapsync-staff
apachectl configtest && systemctl reload apache2
```

The wrapper reads the allowlist from `/var/www/html/noxity-ips.js` (one source of
truth with the browser). Edit `$ALLOWLIST` / `$IMAPSYNC_REAL` at the top of the
script if your paths differ.

### Verify

```bash
# Public CGI refuses a non-Noxity destination, even via raw curl:
curl -s -X POST -d 'host2=example.com' http://localhost/cgi-bin/imapsync
#  -> Refused: "example.com" is not a Noxity destination.

# Public CGI lets an allow-listed destination through — it starts the job and
# answers at once with an id (it does NOT return the log; see Long migrations):
curl -s -D- -o /dev/null -X POST -d 'host2=<an-allow-listed-ip>' http://localhost/cgi-bin/imapsync
#  -> 202 Accepted + X-Imapsync-Job: <32 hex>

# Tail that job's log (the browser does this every 6s):
curl -s -D- "http://localhost/cgi-bin/imapsync-log?job=<the-id>&from=0"
#  -> 200 + X-Imapsync-Offset / X-Imapsync-Done, body = the log so far

# Staff endpoint now requires auth:
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost/cgi-bin/imapsync-staff   # -> 401
curl -s -u support:PASS  -X POST http://localhost/cgi-bin/imapsync-staff | head            # -> imapsync banner
```

The `/bypass/` form keeps working because it now POSTs to `imapsync-staff`; staff
authenticate once for the form and the CGI shares the same login. That endpoint is
still the plain imapsync, so it streams the log on one request the old way — fine
for support, who can watch it and are not behind the 100s cap on a long sync.

---

## Long migrations (status polling)

Cloudflare gives up on any request that hasn't finished within **100 seconds** and
returns [error 524](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/).
That timeout is fixed below the Enterprise plan. A mailbox sync takes minutes to
hours, so the obvious design — one POST that streams imapsync's log until it's
done — cannot work here: every real migration blows through the cap, the browser
gets Cloudflare's error page instead of a log, and the sync it was watching is
still running on the origin, invisible.

So a run is **started, not streamed**:

```
POST /cgi-bin/imapsync              -> 202 + X-Imapsync-Job: <32 hex>   (instant)
  guard checks host2, forks, setsid, exec imapsync with output -> job log file,
  and answers immediately. The sync outlives the request, the CGI, and the tab.

GET /cgi-bin/imapsync-log?job=<id>&from=<offset>                        (every 6s)
  -> 200, body = log bytes from <offset>
     X-Imapsync-Offset: where to resume next poll
     X-Imapsync-Done:   1 once imapsync exited     X-Imapsync-Exit: its code
```

Every request is short, so the 100s cap is never in play — no 524, at any sync
length. Because the browser is reading a file rather than holding a socket, it
also survives a sleeping laptop, a dropped wifi connection, and a closed tab.

Notes worth knowing:

- **Jobs live in `/var/tmp/imapsync-jobs/<job id>/`** (`log` + `exit`), created
  `0700` as `www-data`. The guard sweeps entries older than 2 days on each new
  run — `$JOB_TTL_DAYS` in the script.
- **The job id is the only thing authorising a read** of that log, so it's 16
  bytes from `/dev/urandom`, and `imapsync-log` accepts nothing but 32 hex
  characters before touching the filesystem.
- **The POST body never hits disk** — it holds both passwords, so the guard pipes
  it to imapsync's stdin instead. Only imapsync's own output is written, and it
  masks passwords itself (`--password1 MASKED`).
- **Abort still runs inline.** It only signals a PID and exits, so it's back in
  milliseconds and needs no job.
- **imapsync's own tmpdir is unaffected.** It keeps writing its own copy under
  `/var/tmp/imapsync_cgi/<hash>/`; the job log is just its stdout.

---

## Updating the custom UI

The deploy is a git pull + copy (nothing is built):

```bash
cd /opt/imapsync-ui
git pull origin master
cp imapsync_form_extra.html imapsync_form.css imapsync_form.js credits.html \
   /var/www/html/
# Note: noxity-ips.js is intentionally NOT overwritten so per-server allowlists
# survive. Copy it too only when the allowlist itself changed.
```

Then hard-refresh (Cmd/Ctrl-Shift-R) — filenames are unversioned, so browsers
cache them.

---

## Security notes

- **The destination allowlist is client-side by default.** `noxity-ips.js` runs in
  the browser; without the wrapper a determined user can POST straight to
  `/cgi-bin/imapsync` with any destination. For real enforcement, enable the
  server-side wrapper — see [Locking the backend](#locking-the-backend-server-side-enforcement).
- **Keep imapsync updated** (`cd /opt/imapsync && git pull && make install`, then
  copy the binary into place). The CGI runs migrations with user-supplied
  credentials; past versions had shell-injection issues that are fixed upstream.
  ⚠️ With the wrapper enabled the real program is `imapsync-staff`, so copy to
  `/usr/lib/cgi-bin/imapsync-staff` — never over `/usr/lib/cgi-bin/imapsync`, which
  is the wrapper.
- **Always serve over HTTPS** — the Cloudflare Origin cert above with encryption
  mode **Full (strict)**; credentials are POSTed in the clear otherwise.
- **`/bypass/` must stay behind auth.** It's the unrestricted form.
- Credentials the customer types are cached in the browser's `localStorage`
  (inherited imapsync behaviour) and cleared by "Start over".

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| "Begin migration" does nothing / 500 | `curl -X POST http://localhost/cgi-bin/imapsync`; `tail -f /var/log/apache2/error.log`; is `mod_cgi` enabled? |
| Migration OOM-killed on big mailboxes | `free -h` — is the 4 GB swap on? `dmesg | grep -i oom`. |
| "We can't migrate to that destination" | The destination hostname doesn't resolve to an IP in `noxity-ips.js`. |
| Provider modal/auto-fill never appears | DNS-over-HTTPS to `cloudflare-dns.com` blocked by the network? |
| UI looks unstyled briefly on reload | Expected only if the Tailwind CDN is slow; the local CSS hides the flash. |
| Changes not showing after deploy | Hard-refresh; confirm you copied to the served directory, not just `/opt/imapsync-ui`. |

---

Built on imapsync by Gilles Lamiral. See `credits.html` and
<https://imapsync.lamiral.info/>.

# Noxity Mailbox Migration UI

A guided, single-screen web UI for [imapsync](https://imapsync.lamiral.info/),
the open-source IMAP copy engine by Gilles Lamiral. Customers walk through a
short wizard (source → destination → confirm), watch live progress, and the
backend is plain imapsync running as a CGI.

This repo contains **only the front end**. imapsync itself (the Perl program /
CGI) is installed separately on the server — see [Deploy from scratch](#deploy-from-scratch-debian-13).

---

## What's in here

| File | Purpose |
|------|---------|
| `imapsync_form_extra.html` | The custom wizard UI (entry point customers load). |
| `imapsync_form.css` | All styling (the "Noxity Design System" — ink-on-paper, dark mode). |
| `imapsync_form.js` | All behaviour: wizard steps, provider detection, validation, live progress. |
| `noxity-ips.js` | **Config** — destination allowlist + support contact. Edit this per environment. |
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
Apache ──► /usr/lib/cgi-bin/imapsync  (the imapsync Perl script in CGI mode)
   │  streams the run log back over the same HTTP response
   ▼
Browser polls the response, parses the `ETA:` line → % done, time left, N of M.
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

```bash
python3 -m http.server 8765
# open http://localhost:8765/imapsync_form_extra.html
```

The wizard renders and you can click through it. The actual migration won't run
(there's no CGI locally) — "Begin migration" will just fail the POST. To preview
without the allowlist blocking you, set `NOXITY_DEST_IPS = []` temporarily.

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

### 5. HTTPS + vhost

```bash
apt install -y certbot python3-certbot-apache
certbot --apache -d migrate.noxity.io     # issues the cert and writes the vhost
```

Then edit `/etc/apache2/sites-enabled/migrate.noxity.io-le-ssl.conf` so it
contains (key bits):

```apache
<VirtualHost *:443>
    ServerName migrate.noxity.io
    DocumentRoot /var/www/html
    DirectoryIndex imapsync_form_extra.html index.html

    # Custom UI is public
    <Directory /var/www/html>
        Require all granted
    </Directory>

    # ... certbot's SSLCertificate* lines ...
</VirtualHost>
```

```bash
apachectl configtest && systemctl reload apache2
```

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

Both UIs POST to the same `/cgi-bin/imapsync`, so the stock form works unchanged.

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
| `https://migrate.noxity.io/cgi-bin/imapsync` | both UIs | shared backend |

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

- **The destination allowlist is client-side only.** `noxity-ips.js` runs in the
  browser; a determined user can POST straight to `/cgi-bin/imapsync` with any
  destination. Treat it as a guardrail, not a control. If you need real
  enforcement, validate the destination server-side (a wrapper around the CGI, or
  a patch to imapsync) — see `CLAUDE.md`.
- **Keep imapsync updated** (`cd /opt/imapsync && git pull && make install && cp
  imapsync /usr/lib/cgi-bin/`). The CGI runs migrations with user-supplied
  credentials; past versions had shell-injection issues that are fixed upstream.
- **Always serve over HTTPS** — credentials are POSTed in the clear otherwise.
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

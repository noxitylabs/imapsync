#!/usr/bin/env python3
"""Run the whole thing locally: real UI, real CGIs, fake imapsync.

    python3 server/dev-server.py      # then open http://127.0.0.1:8765/

Serves the static UI and runs the *actual* imapsync-guard and imapsync-log
scripts, so the guard's allowlist check, detached job start, and log tailing
are all exercised for real. Only imapsync itself is faked — it replays a
realistic log instead of touching any mailbox, so no IMAP server, no
credentials, and nothing to clean up.

The scripts have production paths baked in (/usr/lib/cgi-bin, /var/www/html,
/var/tmp), so they're copied to a temp dir with those rewritten. The originals
are never modified — what you test is byte-for-byte the deployed logic apart
from those three paths.
"""
import http.server, os, pathlib, re, shutil, subprocess, sys, tempfile, urllib.parse

REPO = pathlib.Path(__file__).resolve().parent.parent
# Deliberately not 8765: that's the static-preview port, and a page cached from
# an http.server there would shadow this one's (same scheme+host+port = same
# cache). Its stale HTML would then pull in the stale allowlist and the wizard
# would refuse every destination, for reasons nothing on screen explains.
PORT = 8799
TMP = pathlib.Path(tempfile.mkdtemp(prefix="imapsync-dev-"))
# Stamped into asset URLs on every start. Without it a stale noxity-ips.js or
# imapsync_form.js cached from an earlier server on this port silently wins,
# and you debug the wrong file — which is exactly what a browser cache did to
# this project in production.
TOKEN = TMP.name.rsplit("-", 1)[-1]

# A stand-in imapsync: replays real log lines (formats taken from imapsync's
# source) over ~20s so the status line and ETA parsing have something to chew.
FAKE_IMAPSYNC = r'''#!/usr/bin/perl
use strict; use warnings;
$| = 1;
my $body = do { local $/; <STDIN> };
my %p = map { my ($k,$v) = split /=/, $_, 2; ($k => (defined $v ? $v : '')) } split /&/, ($body // '');
my $masked = join ' ', map { "--$_ " . ($_ =~ /^password/ ? 'MASKED' : ($p{$_} // '')) } sort keys %p;
print "Content-Type: text/plain\r\n\r\n";
print "Transfer started at Friday 17 July 2026\n";
print "Command line used:\n $masked\n";
my @script = (
  [ 0, "Host1: probing ssl on port 993\n" ],
  [ 1, "Host1: success login on [$p{host1}] with user [$p{user1}] auth [LOGIN]\n" ],
  [ 1, "Host2: success login on [$p{host2}] with user [$p{user2}] auth [LOGIN]\n" ],
  [ 1, "Host1: folders list (first the raw imap format then the [X] = [Y]):\n" ],
  [ 1, ($p{automap} ? "Folders mapping from --automap feature (use --f1f2 to override any mapping):\nINBOX.Sent -> INBOX.Sent Messages\nINBOX.Drafts -> Drafts\n" : "") ],
  [ 1, "++++ Calculating sizes of 12 folders on Host1\n" ],
  [ 2, "Host1 Nb messages:                68179 messages\n" ],
  [ 1, "++++ Calculating sizes of 12 folders on Host2\n" ],
  [ 1, "Host2 Nb messages:                    0 messages\n" ],
  [ 1, "++++ Looping on each one of 12 folders to sync\n" ],
  [ 1, "Host1: folder [INBOX.Sent] selected 4567 messages, duplicates 0\n" ],
  [ 2, "Host2: folder [INBOX.Sent Messages] selected 0 messages, duplicates 0\n" ],
);
for my $s ( @script ) { sleep $s->[0]; print $s->[1] if length $s->[1]; }
for my $i ( 1 .. 6 ) {
  sleep 2;
  my $done = 4000 + $i * 90;
  my $left = 4567 - $done;
  printf "msg INBOX.Sent/%d {7451}          copied to INBOX.Sent Messages/%d        1.73 msgs/s  26.953 KiB/s 2.095 MiB copied ETA: Wed Jul  3 14:55:27 2019  %d s  %d/4567 msgs left\n",
    $i, $i, $left * 2, $left;
}
print "++++ End looping on each folder\n++++ Statistics\n";
print "The sync looks good, all 4567 identified messages in host1 are on host2.\n";
print "Exiting with return value 0 (EX_OK: successful termination)\n";
exit 0;
'''


def build():
    """Copy the real CGIs with production paths rewritten to temp ones."""
    (TMP / "jobs").mkdir()
    fake = TMP / "imapsync-staff"
    fake.write_text(FAKE_IMAPSYNC)
    fake.chmod(0o755)
    # Both sides check the destination and they must agree, so both read this
    # one file (it is served to the browser too, shadowing the repo's).
    #
    # It can't just be empty: an empty list disables the browser's check but
    # makes the guard deny everything (it fails closed, by design). And it
    # can't be 127.0.0.1: the browser resolves host2 over DNS-over-HTTPS,
    # which won't resolve 'localhost'. So use a hostname that really does
    # resolve, publicly and stably. Nothing connects to it — imapsync is fake.
    (TMP / "noxity-ips.js").write_text(
        '/* dev only — see server/dev-server.py */\n'
        'window.NOXITY_DEST_IPS = ["1.1.1.1"];\n'
        'window.NOXITY_SUPPORT = "mailto:support@noxity.io";\n'
    )

    subs = {
        "/usr/lib/cgi-bin/imapsync-staff": str(fake),
        "/var/www/html/noxity-ips.js": str(TMP / "noxity-ips.js"),
        "/var/tmp/imapsync-jobs": str(TMP / "jobs"),
    }
    for name in ("imapsync-guard", "imapsync-log"):
        src = (REPO / "server" / name).read_text()
        for old, new in subs.items():
            src = src.replace(old, new)
        dst = TMP / name
        dst.write_text(src)
        dst.chmod(0o755)
        r = subprocess.run(["perl", "-c", str(dst)], capture_output=True, text=True)
        if r.returncode:
            sys.exit(f"{name} does not compile:\n{r.stderr}")
        print(f"  {name}: syntax OK")


def run_cgi(script, env_extra, stdin=b""):
    env = dict(os.environ)
    env["REQUEST_METHOD"] = env_extra.get("REQUEST_METHOD", "GET")
    env.update(env_extra)
    p = subprocess.run(["perl", str(TMP / script)], input=stdin,
                       capture_output=True, env=env)
    return p.stdout


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(REPO), **k)

    def log_message(self, fmt, *a):
        pass

    def reply_cgi(self, raw):
        head, _, body = raw.partition(b"\r\n\r\n")
        status, headers = 200, []
        for line in head.decode("utf-8", "replace").split("\r\n"):
            if not line.strip():
                continue
            k, _, v = line.partition(":")
            if k.strip().lower() == "status":
                status = int(v.strip().split()[0])
            else:
                headers.append((k.strip(), v.strip()))
        self.send_response(status)
        for k, v in headers:
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path.rstrip("/") != "/cgi-bin/imapsync":
            return self.send_error(404)
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        self.reply_cgi(run_cgi("imapsync-guard", {
            "REQUEST_METHOD": "POST",
            "CONTENT_LENGTH": str(len(body)),
            "CONTENT_TYPE": "application/x-www-form-urlencoded",
        }, body))

    def send_bytes(self, body, ctype):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parts = urllib.parse.urlparse(self.path)

        # Shadow the repo's allowlist so browser and guard read the same list.
        if parts.path == "/noxity-ips.js":
            return self.send_bytes((TMP / "noxity-ips.js").read_bytes(),
                                   "application/javascript")

        # Stamp the assets so a cached copy can never shadow the working tree.
        if parts.path in ("/", "/imapsync_form_extra.html"):
            html = (REPO / "imapsync_form_extra.html").read_text()
            html = re.sub(r'(src|href)="(noxity-ips\.js|imapsync_form\.js|imapsync_form\.css)"',
                          rf'\1="\2?dev={TOKEN}"', html)
            return self.send_bytes(html.encode(), "text/html; charset=utf-8")

        if parts.path.rstrip("/") != "/cgi-bin/imapsync-log":
            return super().do_GET()
        self.reply_cgi(run_cgi("imapsync-log", {
            "REQUEST_METHOD": "GET",
            "QUERY_STRING": parts.query,
        }))


if __name__ == "__main__":
    print(f"sandbox: {TMP}")
    build()
    print(f"\n  open  http://127.0.0.1:{PORT}/imapsync_form_extra.html")
    print("\n  Use these in the wizard — both the browser and the guard check")
    print("  the destination, and this is the pair they both accept:")
    print("      destination host : one.one.one.one   (resolves to 1.1.1.1)")
    print("      source host      : anything, e.g. mail.example.com")
    print("      passwords        : anything — imapsync is faked, nothing connects")
    print("\n  (ctrl-c to stop; the sandbox dir is removed on exit)\n")
    try:
        http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
    except KeyboardInterrupt:
        shutil.rmtree(TMP, ignore_errors=True)
        print("\ncleaned up")

const express = require("express");
const cors = require("cors");
const dns = require("node:dns").promises;

const app = express();
const port = 8080;

const DOMAIN_RE = /^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(?:\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))+$/;
const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

const PROVIDERS = [
    { suffixes: ["google.com"], host: "imap.gmail.com" },
    { suffixes: ["outlook.com", "office365.com", "hotmail.com", "live.com", "me.com"], host: "outlook.office365.com" },
    { suffixes: ["yahoo.com"], host: "imap.mail.yahoo.com" },
    { suffixes: ["icloud.com", "apple.com"], host: "imap.mail.me.com" },
];

const stripDot = (s) => s.replace(/\.$/, "");

async function resolveMxHost(domain) {
    try {
        const records = await dns.resolveMx(domain);
        if (records.length === 0) return "";
        records.sort((a, b) => a.priority - b.priority);
        return stripDot(records[0].exchange).toLowerCase();
    } catch {
        return "";
    }
}

function matchKnownProvider(mxHostLower) {
    for (const p of PROVIDERS) {
        if (p.suffixes.some((s) => mxHostLower.endsWith(s))) return p.host;
    }
    return "";
}

async function probeCustomImap(domain) {
    const candidates = new Set();
    const subs = ["imap", "mail", "autoconfig", "autodiscover"];

    await Promise.all(subs.map(async (sub) => {
        const fqdn = `${sub}.${domain}`;
        try {
            const cnames = await dns.resolveCname(fqdn);
            cnames.forEach((c) => candidates.add(stripDot(c)));
        } catch { /* no record */ }
        try {
            const ips = await dns.resolve4(fqdn);
            ips.forEach((ip) => candidates.add(ip));
        } catch { /* no record */ }
    }));

    const srvs = [`_imap._tcp.${domain}`, `_imaps._tcp.${domain}`, `_autodiscover._tcp.${domain}`];
    await Promise.all(srvs.map(async (name) => {
        try {
            const records = await dns.resolveSrv(name);
            records.forEach((r) => candidates.add(stripDot(r.name)));
        } catch { /* no record */ }
    }));

    for (const host of candidates) {
        let ip = host;
        if (!IPV4_RE.test(host)) {
            try {
                const ips = await dns.resolve4(host);
                if (ips.length === 0) continue;
                ip = ips[0];
            } catch {
                continue;
            }
        }
        try {
            const ptrs = await dns.reverse(ip);
            if (ptrs.length > 0) return stripDot(ptrs[0]);
        } catch { /* no PTR */ }
    }
    return "";
}

async function lookupImapHost(domain) {
    const mxHost = await resolveMxHost(domain);
    if (mxHost) {
        const known = matchKnownProvider(mxHost);
        if (known) return known;
    }
    return probeCustomImap(domain);
}

app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.disable("x-powered-by");

app.get("/run-script", async (req, res) => {
    const userInput = req.query.user_input;

    if (!userInput) {
        return res.status(400).send("No user_input parameter provided.");
    }

    if (typeof userInput !== "string" || !DOMAIN_RE.test(userInput)) {
        return res.status(400).send("Invalid domain.");
    }

    try {
        const host = await lookupImapHost(userInput.toLowerCase());
        return res.send(host ? `${host}\n` : "");
    } catch (err) {
        console.error("Lookup failed:", err);
        return res.status(500).send("Lookup failed.");
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});

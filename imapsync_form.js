// $Id: imapsync_form.js,v 1.34 2024/08/05 23:26:21 gilles Exp gilles $

/*jslint browser: true*/ /*global  $, Storage, XMLHttpRequest, document, localStorage, JSON, setInterval, clearInterval */

function last_x_lines(string, num) {
    if (undefined === string || 0 === num) {
        return "";
    }
    return string.split(/\r?\n/).slice(num).join("\n");
}

// Public UI only: strip infrastructure details (server IP, hostname,
// RAM/load) from the imapsync log before showing it to the customer.
// The staff /bypass/ UI uses the stock JS and is not affected.
// Note: this filters the *displayed* console; the raw XHR response is
// still visible in browser devtools. True suppression would require
// patching imapsync's shared CGI, which would also affect /bypass/.
function sanitizeLog(text) {
    if (undefined === text || null === text) {
        return "";
    }
    // Whole lines that are pure infrastructure detail — drop them entirely.
    const dropEnv = /^(REMOTE_ADDR|REMOTE_HOST|HTTP_REFERER|HTTP_USER_AGENT|SERVER_SOFTWARE|SERVER_NAME|SERVER_ADDR|SERVER_PORT|SERVER_ADMIN|HTTP_COOKIE) is /;
    const dropLoad = /^Load (is|on) /;
    const dropRam = /free GiB of RAM/;          // "with A/B free GiB of RAM, C% used …"
    return text
        .split(/\r?\n/)
        .filter(function (line) {
            return !dropEnv.test(line) && !dropLoad.test(line) && !dropRam.test(line);
        })
        .map(function (line) {
            // Trim the CGI path + host off the imapsync banner, keep the version:
            // "Here is imapsync 2.314 /path on host mail.example, a linux system"
            // becomes "Here is imapsync 2.314."
            return line.replace(/^(Here is imapsync \S+).*$/, "$1.");
        })
        .join("\n");
}

function last_eta(string) {
    if (undefined === string) {
        return "";
    }

    const eta_re = /ETA:[^\n]*\n/g;
    const eta = string.match(eta_re);
    if (eta) {
        return eta[eta.length - 1];
    }
    return "ETA: unknown";
}

function decompose_eta_line(eta_str) {
    const regex_eta =
        /^ETA:\s+([^\n]+?)\s+(\d+)\s+s\s+(\d+)\/(\d+)\s+msgs\s+left\n?$/;
    const eta_array = regex_eta.exec(eta_str);

    if (eta_array === null) {
        return {
            str: "",
            date: "?",
            seconds_left: "?",
            msgs_left: "?",
            msgs_total: "?",
            msgs_done: "?",
            percent_done: function () { return ""; },
            percent_left: function () { return ""; },
        };
    }

    const eta_obj = {
        str: eta_str,
        date: eta_array[1],
        seconds_left: eta_array[2],
        msgs_left: eta_array[3],
        msgs_total: eta_array[4],
        msgs_done: function () {
            const diff = eta_obj.msgs_total - eta_obj.msgs_left;
            return diff.toString();
        },
        percent_done: function () {
            if (Number(eta_obj.msgs_total) === 0) {
                return "0";
            }
            const percent =
                ((eta_obj.msgs_total - eta_obj.msgs_left) /
                    eta_obj.msgs_total) *
                100;
            return percent.toFixed(2);
        },
        percent_left: function () {
            if (Number(eta_obj.msgs_total) === 0) {
                return "0";
            }
            const percent =
                (eta_obj.msgs_left / eta_obj.msgs_total) * 100;
            return percent.toFixed(2);
        },
    };
    return eta_obj;
}

function showpassword(id, button) {
    const x = document.getElementById(id);
    if (button.checked) {
        x.type = "text";
    } else {
        x.type = "password";
    }
}

function extract_eta(xhr) {
    const slice_length = xhr.readyState === 4 ? -24000 : -2400;
    const slice_log = xhr.responseText.slice(slice_length);
    const eta_str = last_eta(slice_log);
    return decompose_eta_line(eta_str);
}

$(document).ready(function () {
    "use strict";

    const readyStateStr = {
        0: "Request not initialized",
        1: "Server connection established",
        2: "Response headers received",
        3: "Processing request",
        4: "Finished and response is ready",
    };

    /* ===== DNS-over-HTTPS provider detection ============================ */

    const DOH_URL = "https://cloudflare-dns.com/dns-query";
    const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

    async function doh(name, type) {
        try {
            const res = await fetch(
                DOH_URL + "?name=" + encodeURIComponent(name) + "&type=" + type,
                { headers: { Accept: "application/dns-json" } }
            );
            if (!res.ok) return [];
            const json = await res.json();
            return Array.isArray(json.Answer) ? json.Answer : [];
        } catch (e) {
            return [];
        }
    }

    const stripDot = function (s) { return s.replace(/\.$/, ""); };

    const MX_PROVIDERS = [
        { suffix: "google.com",             host: "imap.gmail.com",        kind: "google" },
        { suffix: "googlemail.com",         host: "imap.gmail.com",        kind: "google" },
        { suffix: "outlook.com",            host: "outlook.office365.com", kind: "microsoft" },
        { suffix: "office365.com",          host: "outlook.office365.com", kind: "microsoft" },
        { suffix: "protection.outlook.com", host: "outlook.office365.com", kind: "microsoft" },
        { suffix: "hotmail.com",            host: "outlook.office365.com", kind: "microsoft" },
        { suffix: "live.com",               host: "outlook.office365.com", kind: "microsoft" },
        { suffix: "yahoodns.net",           host: "imap.mail.yahoo.com",   kind: "yahoo" },
        { suffix: "yahoo.com",              host: "imap.mail.yahoo.com",   kind: "yahoo" },
        { suffix: "icloud.com",             host: "imap.mail.me.com",      kind: "icloud" },
        { suffix: "mail.me.com",            host: "imap.mail.me.com",      kind: "icloud" },
        { suffix: "apple.com",              host: "imap.mail.me.com",      kind: "icloud" },
    ];

    const CONSUMER_DOMAINS = {
        "gmail.com":       { host: "imap.gmail.com",        kind: "gmail" },
        "googlemail.com":  { host: "imap.gmail.com",        kind: "gmail" },
        "outlook.com":     { host: "outlook.office365.com", kind: "outlook_consumer" },
        "hotmail.com":     { host: "outlook.office365.com", kind: "outlook_consumer" },
        "live.com":        { host: "outlook.office365.com", kind: "outlook_consumer" },
        "msn.com":         { host: "outlook.office365.com", kind: "outlook_consumer" },
        "yahoo.com":       { host: "imap.mail.yahoo.com",   kind: "yahoo" },
        "yahoo.co.uk":     { host: "imap.mail.yahoo.com",   kind: "yahoo" },
        "ymail.com":       { host: "imap.mail.yahoo.com",   kind: "yahoo" },
        "icloud.com":      { host: "imap.mail.me.com",      kind: "icloud" },
        "me.com":          { host: "imap.mail.me.com",      kind: "icloud" },
        "mac.com":         { host: "imap.mail.me.com",      kind: "icloud" },
    };

    async function detectProvider(domain) {
        domain = (domain || "").toLowerCase();
        if (!domain) return { host: "", kind: "custom" };

        if (CONSUMER_DOMAINS[domain]) {
            return CONSUMER_DOMAINS[domain];
        }

        const mxRecords = await doh(domain, "MX");
        if (mxRecords.length) {
            mxRecords.sort(function (a, b) {
                return parseInt(a.data, 10) - parseInt(b.data, 10);
            });
            const parts = mxRecords[0].data.split(/\s+/);
            const mxHost = stripDot(parts[parts.length - 1] || "").toLowerCase();
            for (const p of MX_PROVIDERS) {
                if (mxHost.endsWith(p.suffix)) {
                    let kind = p.kind;
                    if (kind === "google")    kind = "google_workspace";
                    if (kind === "microsoft") kind = "microsoft365";
                    return { host: p.host, kind: kind };
                }
            }
        }

        const subs = ["imap", "mail"];
        for (const sub of subs) {
            const fqdn = sub + "." + domain;
            const a = await doh(fqdn, "A");
            if (a.some(function (r) { return r.type === 1; })) {
                return { host: fqdn, kind: "custom" };
            }
        }

        return { host: "", kind: "custom" };
    }

    async function resolveAllIPs(host) {
        host = (host || "").trim();
        if (!host) return [];
        if (IPV4_RE.test(host)) return [host];
        const answers = await doh(host, "A");
        return answers
            .filter(function (r) { return r.type === 1; })
            .map(function (r) { return r.data; });
    }

    async function isAllowedDestination(host) {
        const allow = (window.NOXITY_DEST_IPS || []).filter(Boolean);
        if (allow.length === 0) return true;
        const ips = await resolveAllIPs(host);
        return ips.some(function (ip) { return allow.indexOf(ip) !== -1; });
    }

    /* ===== Provider modal copy ========================================== */

    const PROVIDER_INFO = {
        gmail: {
            title: "Gmail requires an app password",
            body: "Google no longer accepts your normal Gmail password for IMAP. To migrate you'll need to:",
            steps: [
                "Turn on 2-Step Verification on your Google account.",
                "Generate a 16-character App Password.",
                "Use that App Password (not your real password) in the next step.",
            ],
            guideLabel: "Google's App Password guide",
            guideHref: "https://support.google.com/accounts/answer/185833",
            primary: "I have my app password",
        },
        google_workspace: {
            title: "Google Workspace setup needed",
            body: "Your Workspace admin must enable IMAP, and you'll need an app password.",
            steps: [
                "Admin: enable IMAP at admin.google.com → Apps → Google Workspace → Gmail → End user access.",
                "User: turn on 2-Step Verification, then create an App Password at myaccount.google.com/apppasswords.",
                "If your org enforces SSO without app passwords, IMAP won't work — reach out to us for help.",
            ],
            guideLabel: "Workspace IMAP guide",
            guideHref: "https://support.google.com/a/answer/105694",
            primary: "Continue",
        },
        microsoft365: {
            title: "Microsoft 365 setup needed",
            body: "Microsoft 365 disables IMAP basic-auth by default. You'll need admin help and likely an app password.",
            steps: [
                "Admin: enable IMAP per mailbox — Set-CASMailbox -Identity you@example.com -ImapEnabled $true.",
                "Admin: opt-in to Authenticated SMTP / IMAP at the tenant level if it's blocked.",
                "User: with MFA on, create an App Password at account.microsoft.com → Security → Advanced.",
            ],
            guideLabel: "Microsoft IMAP guide",
            guideHref: "https://learn.microsoft.com/exchange/clients-and-mobile-in-exchange-online/pop3-and-imap4/enable-or-disable-pop3-or-imap4-access",
            primary: "Continue",
        },
        outlook_consumer: {
            title: "Outlook requires an app password",
            body: "Microsoft no longer accepts your normal password for outlook.com / hotmail.com / live.com IMAP.",
            steps: [
                "Turn on 2-Step Verification at account.microsoft.com → Security.",
                "Open Advanced security options → App passwords and create one.",
                "Use the App Password (not your real password) in the next step.",
            ],
            guideLabel: "Microsoft App Password guide",
            guideHref: "https://support.microsoft.com/account-billing/manage-app-passwords-for-two-step-verification-d6dc8c6d-4bf7-4851-ad95-6d07799387e9",
            primary: "I have my app password",
        },
        yahoo: {
            title: "Yahoo requires an app password",
            body: "Yahoo no longer accepts your normal password for IMAP.",
            steps: [
                "Sign in at login.yahoo.com → Account security.",
                "Click Generate app password and create one.",
                "Use that App Password (not your real password) in the next step.",
            ],
            guideLabel: "Yahoo App Password guide",
            guideHref: "https://help.yahoo.com/kb/SLN15241.html",
            primary: "I have my app password",
        },
        icloud: {
            title: "iCloud requires an app-specific password",
            body: "Apple requires an app-specific password for any third-party tool accessing your mailbox.",
            steps: [
                "Make sure 2FA is enabled on your Apple ID.",
                "Sign in at appleid.apple.com → Sign-In and Security → App-Specific Passwords.",
                "Generate a password and use it instead of your iCloud password.",
            ],
            guideLabel: "Apple App-Specific Password guide",
            guideHref: "https://support.apple.com/HT204397",
            primary: "I have my app password",
        },
        custom: null,
    };

    const REJECT_INFO = {
        title: "We can't migrate to that destination",
        body: "The destination server you entered doesn't resolve to a Noxity mail server. We only accept migrations into Noxity-hosted mailboxes.",
        steps: [
            "Double-check the destination hostname or IP.",
            "If you're a Noxity customer, your DNS should point to one of our mail server IPs.",
            "If you're stuck, contact our support team — we'll guide you through it.",
        ],
        guideLabel: null,
        guideHref: null,
        primary: "Got it",
    };

    // Action the modal's primary button runs once, if the modal carries one.
    let modalPrimary = null;

    function fillModal(info) {
        const support = window.NOXITY_SUPPORT || "mailto:support@noxity.io";
        modalPrimary = info.onPrimary || null;
        $("#modal-title").text(info.title);
        $("#modal-body").text(info.body);
        const $list = $("#modal-steps").empty();
        for (const step of info.steps) {
            $list.append($("<li>").text(step));
        }
        if (info.guideHref) {
            $("#modal-guide")
                .attr("href", info.guideHref)
                .text(info.guideLabel || "Open guide")
                .css({ display: "" });
        } else {
            $("#modal-guide").css({ display: "none" });
        }
        $("#modal-support").attr("href", support);
        $("#modal-btn-ok").text(info.primary || "OK");
    }

    function showProviderModal(kind) {
        const info = PROVIDER_INFO[kind];
        if (!info) return false;
        fillModal(info);
        $("#tos-modal").css({ display: "flex" });
        return true;
    }

    function showRejectModal() {
        fillModal(REJECT_INFO);
        $("#tos-modal").css({ display: "flex" });
    }

    /* ===== Source/destination the wrong way round ====================== */

    // The wizard's whole premise is "current mailbox on the left, new one on
    // the right", and people do fill it in backwards. This is the undo.
    const swapFields = function swapFields(pairs) {
        pairs.forEach(function (pair) {
            const $a = $("#" + pair[0]);
            const $b = $("#" + pair[1]);
            const tmp = $a.val();
            $a.val($b.val());
            $b.val(tmp);
        });
    };

    const SWAP_INFO = {
        title: "Your two servers look the wrong way round",
        body: "The server you entered as the destination isn't one of ours — but the one you entered as the source is. That normally means the two sides of the form were filled in the other way round.",
        steps: [
            "Source is the mailbox you're moving away from.",
            "Destination is your new Noxity mailbox.",
            "We can swap the two sides over — check the details before you start.",
        ],
        guideLabel: null,
        guideHref: null,
        primary: "Swap them over",
        onPrimary: function () {
            swapFields([
                ["host1", "host2"],
                ["user1", "user2"],
                ["password1", "password2"],
            ]);
            $("#oldM").text($("#user1").val());
            $("#newM").text($("#user2").val());
        },
    };

    function showSwapModal() {
        fillModal(SWAP_INFO);
        $("#tos-modal").css({ display: "flex" });
    }

    /* ===== Wizard navigation + Back buttons (Task 3) =================== */

    /* Self-managed step stack rather than the HTML5 History API: this is an
       in-form, show/hide wizard, so a stack moves between steps without a
       refresh and without hijacking the browser's global back button. Each step
       carries its own Back control (.btn-back) next to its primary action; the
       first step has none, so there's never a back-off-the-form. */
    const navStack = [];

    const navTo = function navTo(toId) {
        const fromId = $("#form > .box:visible").attr("id");
        if (fromId) {
            navStack.push(fromId);
            $("#" + fromId).css({ display: "none" });
        }
        $("#" + toId).css({ display: "flex" });
    };

    $(".btn-back").click(function () {
        if (navStack.length === 0) {
            return;
        }
        const toId = navStack.pop();
        $("#form > .box:visible").css({ display: "none" });
        $("#" + toId).css({ display: "flex" });
        clearAllFieldErrors();
    });

    /* ===== Theme switcher (Task 3) ===================================== */

    /* One toggle that persists the choice in localStorage so it survives
       reloads (the head script applies it before first paint to avoid a flash);
       this combines the "toggle button" and "local storage" options. */
    const THEME_KEY = "nox-theme";

    const applyTheme = function applyTheme(theme) {
        document.documentElement.setAttribute("data-theme", theme);
        const dark = theme === "dark";
        $("#bt-theme")
            .attr("aria-pressed", dark ? "true" : "false")
            .attr("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
        $("#bt-theme i").attr(
            "class",
            dark ? "ph-bold ph-sun" : "ph-bold ph-moon"
        );
    };

    // Sync the button with whatever the head script already set on <html>.
    applyTheme(
        document.documentElement.getAttribute("data-theme") === "dark"
            ? "dark"
            : "light"
    );

    $("#bt-theme").click(function () {
        const next =
            document.documentElement.getAttribute("data-theme") === "dark"
                ? "light"
                : "dark";
        try {
            localStorage.setItem(THEME_KEY, next);
        } catch (e) {
            /* localStorage blocked — theme still applies for this session */
        }
        applyTheme(next);
    });

    /* ===== Form validation (Task 4) ==================================== */

    /* Custom JS validation: the wizard advances with type="button" controls and
       the form's submit is prevented, so native HTML5 required/email validation
       never fires. We validate per step and show inline, role="alert" feedback. */
    const isEmail = function isEmail(v) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
    };

    // IP addresses force an unencrypted connection, so we require hostnames.
    const isIpAddress = function isIpAddress(v) {
        return IPV4_RE.test(v) || v.indexOf(":") !== -1; // IPv4 or IPv6
    };
    const isHostname = function isHostname(v) {
        return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v);
    };

    const setFieldValidity = function setFieldValidity(sel, valid, message) {
        const $f = $(sel);
        const $err = $("#" + $f.attr("id") + "-error");
        if (valid) {
            $f.removeClass("invalid").attr("aria-invalid", "false");
            $err.addClass("hidden");
        } else {
            $f.addClass("invalid").attr("aria-invalid", "true");
            $err.text(message).removeClass("hidden");
        }
        return valid;
    };

    // specs: [{ sel, message, test? }]. Returns true when every field passes.
    const requireFields = function requireFields(specs) {
        let firstBad = null;
        specs.forEach(function (s) {
            const val = ($(s.sel).val() || "").trim();
            const valid = s.test ? s.test(val) : val.length > 0;
            setFieldValidity(s.sel, valid, s.message);
            if (!valid && !firstBad) {
                firstBad = s.sel;
            }
        });
        if (firstBad) {
            $(firstBad).trigger("focus");
        }
        return firstBad === null;
    };

    // Wipe any visible field errors (used when navigating between steps so a
    // stale red message never carries over to a step you've returned to).
    const clearAllFieldErrors = function clearAllFieldErrors() {
        ["#user1", "#user2", "#host1", "#host2", "#password1", "#password2"].forEach(
            function (sel) {
                setFieldValidity(sel, true);
            }
        );
        $("#confirm-error").addClass("hidden");
    };

    // Clear a field's error as soon as the user types something into it.
    ["#user1", "#user2", "#host1", "#host2", "#password1", "#password2"].forEach(
        function (sel) {
            $(sel).on("input", function () {
                if (($(this).val() || "").trim()) {
                    setFieldValidity(sel, true);
                }
            });
        }
    );

    // Editing the auto-filled host clears its green "we filled this in" cue.
    $("#host1").on("input", function () {
        $(this).removeClass("prefilled");
        $("#host1-hint").addClass("hidden");
    });

    // Show/hide password (eye icon) — flips the targeted field's type.
    $(".pw-toggle").click(function () {
        const $btn = $(this);
        const input = document.getElementById($btn.attr("data-target"));
        if (!input) return;
        const reveal = input.type === "password";
        input.type = reveal ? "text" : "password";
        $btn.attr("aria-pressed", reveal ? "true" : "false")
            .attr("aria-label", reveal ? "Hide password" : "Show password")
            .find("i")
            .attr("class", reveal ? "ph-bold ph-eye-slash" : "ph-bold ph-eye");
    });

    const resetPwToggle = function resetPwToggle(id) {
        const input = document.getElementById(id);
        if (input) input.type = "password";
        $(".pw-toggle[data-target='" + id + "']")
            .attr("aria-pressed", "false")
            .attr("aria-label", "Show password")
            .find("i")
            .attr("class", "ph-bold ph-eye");
    };

    const refresh_interval_ms = 6000;
    const refresh_interval_s = refresh_interval_ms / 1000;
    const test = {
        counter_all: 0,
        counter_ok: 0,
        counter_nok: 0,
        failed_tests: "",
    };

    const is = function is(expected, given, comment) {
        test.counter_all += 1;
        let message =
            test.counter_all +
            " - [" +
            expected +
            "] === [" +
            given +
            "] " +
            comment +
            "\n";
        if (expected === given) {
            test.counter_ok += 1;
            message = "ok " + message;
        } else {
            test.counter_nok += 1;
            test.failed_tests += "nb " + message + "\n";
            message = "not ok " + message;
        }
        $("#tests").append(message);
    };

    const tests_last_x_lines = function tests_last_x_lines() {
        is("", last_x_lines(), "last_x_lines: no args => empty string");
        is("", last_x_lines(""), "last_x_lines: empty string => empty string");
        is("abc", last_x_lines("abc"), "last_x_lines: abc => abc");
        is(
            "abc\ndef",
            last_x_lines("abc\ndef"),
            "last_x_lines: abc\ndef => abc\ndef"
        );
        is(
            "def",
            last_x_lines("abc\ndef", -1),
            "last_x_lines: abc\ndef -1 => def\n"
        );
        is(
            "",
            last_x_lines("abc\ndef", 0),
            "last_x_lines: abc\ndef 0 => empty string"
        );
        is(
            "abc\ndef",
            last_x_lines("abc\ndef", -10),
            "last_x_lines: last 10 of 2 lines => 2 lines"
        );
        is(
            "4\n5\n",
            last_x_lines("1\n2\n3\n4\n5\n", -3),
            "last_x_lines: last 3 lines of 5 lines"
        );
        is(
            "3\n4\n5",
            last_x_lines("1\n2\n3\n4\n5", -3),
            "last_x_lines: last 3 lines of 5 lines"
        );
    };

    const advanceVisibleStep = function advanceVisibleStep() {
        if ($("#tos-modal").is(":visible")) {
            $("#modal-btn-ok").click();
            return;
        }
        $("#form > .box:visible").find("button[id^='next'], #bt-sync").first().click();
    };

    $("#form").on("submit", function (e) {
        e.preventDefault();
        advanceVisibleStep();
    });

    // The form has no submit button, so Enter never fires a native submit.
    // Wire it explicitly so Enter advances the step through our own validation.
    $("#form").on("keydown", "input", function (e) {
        if (e.key === "Enter") {
            e.preventDefault();
            advanceVisibleStep();
        }
    });

    $("#next1").click(async function () {
        if (!requireFields([{
            sel: "#user1",
            message: "Please enter your current e-mail address.",
            test: isEmail,
        }])) {
            return;
        }

        const userInput = ($("#user1").val() || "").trim();
        const at = userInput.lastIndexOf("@");
        const domain = at >= 0 ? userInput.slice(at + 1).toLowerCase() : "";

        navTo("imapserver");

        if (!domain) return;
        try {
            const result = await detectProvider(domain);
            if (result.host) {
                // Mark the auto-filled host green and tell the user to check it.
                $("#host1").val(result.host).addClass("prefilled");
                $("#host1-hint-text").text(
                    "We filled this in from your e-mail provider — please double-check it's correct."
                );
                $("#host1-hint").removeClass("hidden");
            }
            showProviderModal(result.kind);
        } catch (e) {
            /* leave host blank, continue without modal */
        }
    });

    const checkHost = function checkHost(sel, role) {
        const v = ($(sel).val() || "").trim();
        if (!v) {
            return setFieldValidity(sel, false, "Enter the " + role + " server hostname.");
        }
        if (isIpAddress(v)) {
            return setFieldValidity(
                sel,
                false,
                "Use a hostname like mail.yourdomain.com, not an IP address — IP connections aren't encrypted."
            );
        }
        if (!isHostname(v)) {
            return setFieldValidity(
                sel,
                false,
                "That doesn't look like a server hostname (e.g. mail.yourdomain.com)."
            );
        }
        return setFieldValidity(sel, true);
    };

    $("#next2").click(function () {
        const okSrc = checkHost("#host1", "source");
        const okDest = checkHost("#host2", "destination");
        if (!okSrc || !okDest) {
            $(okSrc ? "#host2" : "#host1").trigger("focus");
            return;
        }
        navTo("isSameMail");
        const src = $("#host1").val();
        const dest = $("#host2").val();
        $("#migrationText").text("Migrating from " + src + " to " + dest);
    });

    $("#yesMail").click(function () {
        navTo("isSamePass");
        $("#user2").val($("#user1").val());
    });

    let flag_isMailSame = true;
    let flag_isPassSame = true;

    $("#noMail").click(function () {
        navTo("notSameMail");
        flag_isMailSame = false;
    });

    $("#next3").click(function () {
        if (!requireFields([{
            sel: "#user2",
            message: "Please enter your new e-mail address.",
            test: isEmail,
        }])) {
            return;
        }
        // This step only shows when the user chose "Different e-mails", so the
        // destination must not equal the source — a common slip is re-typing the
        // source address here. Catch it and point them back if they meant "same".
        const src = ($("#user1").val() || "").trim().toLowerCase();
        const dest = ($("#user2").val() || "").trim().toLowerCase();
        if (src && dest === src) {
            setFieldValidity(
                "#user2",
                false,
                "That's the same as your source e-mail. Enter your new (destination) address, or go Back and choose “Same e-mails”."
            );
            $("#user2").trigger("focus");
            return;
        }
        navTo("isSamePass");
    });

    $("#yesPass").click(function () {
        flag_isPassSame = true;
        navTo("enterPass");
        $("#password2").closest(".pw-wrap").css({
            display: "none"
        });
        $("#destLabel").css({
            display: "none"
        });
        // readonly, not disabled: disabled controls are not "successful" and so
        // are dropped by $("#form").serialize(), which would send host2 no
        // password at all. readonly still serializes.
        $("#password2").prop("readonly", true);
        $("#password2").val($("#password1").val());
        $("#password1").off("input").on("input", function () {
            $("#password2").val($(this).val());
        });
        const sourceInput = $("#user1").val();
        $("#srcLabel").text("This is for source mail: " + sourceInput);
        if (flag_isPassSame && !flag_isMailSame) {
            $("#srcLabel").text("This is for both mails.");
        }
    });

    $("#noPass").click(function () {
        flag_isPassSame = false;
        navTo("enterPass");
        $("#password2").closest(".pw-wrap").css({
            display: "block"
        });
        $("#password2").prop("readonly", false);
        $("#password2").val("");
        resetPwToggle("password2");
        $("#password1").off("input");
        const sourceInput = $("#user1").val();
        $("#srcLabel").text("This is for source mail: " + sourceInput);
        const destInput = $("#user2").val();
        $("#destLabel").text("This is for destination mail: " + destInput);
    });

    $("#next4").click(function () {
        const specs = [{
            sel: "#password1",
            message: "Enter the source mailbox password.",
        }];
        // password2 is readonly (mirrored from password1) when the user chose
        // "same password", so only require it when the mailboxes differ.
        if (!$("#password2").prop("readonly")) {
            specs.push({
                sel: "#password2",
                message: "Enter the destination mailbox password.",
            });
        }
        if (!requireFields(specs)) {
            return;
        }
        navTo("confirmPage");
        $("#oldM").text($("#user1").val());
        $("#newM").text($("#user2").val());
    });

    $("#modal-btn-ok").click(function () {
        $("#tos-modal").css({
            display: "none"
        });
        if (modalPrimary) {
            const run = modalPrimary;
            modalPrimary = null;   // clear first: the action must not re-fire
            run();
        }
    });

    const tests_last_eta = function tests_last_eta() {
        is("", last_eta(), "last_eta: no args => empty string");

        is("ETA: unknown", last_eta(""), "last_eta: empty => empty string");

        is("ETA: unknown", last_eta("ETA"), "last_eta: ETA => empty string");

        is(
            "ETA: unknown",
            last_eta("ETA: but no CR"),
            "last_eta: ETA: but no CR => empty string"
        );

        is(
            "ETA: with CR\n",
            last_eta("Blabla ETA: with CR\n"),
            "last_eta: ETA: with CR => ETA: with CR"
        );

        is(
            "ETA: 2 with CR\n",
            last_eta("Blabla ETA: 1 with CR\nBlabla ETA: 2 with CR\n"),
            "last_eta: several ETA: with CR => ETA: 2 with CR"
        );
    };

    const tests_decompose_eta_line = function tests_decompose_eta_line() {
        const eta_str =
            "ETA: Wed Jul  3 14:55:27 2019  1234 s  123/4567 msgs left\n";

        let eta_obj = decompose_eta_line("");
        is("", eta_obj.str, "decompose_eta_line: no match => undefined");

        eta_obj = decompose_eta_line(eta_str);
        is(eta_str, eta_str, "decompose_eta_line: str is str");

        is(eta_str, eta_obj.str, "decompose_eta_line: str back");

        is(
            "Wed Jul  3 14:55:27 2019",
            eta_obj.date,
            "decompose_eta_line: date"
        );

        is("1234", eta_obj.seconds_left, "decompose_eta_line: seconds_left");

        is("123", eta_obj.msgs_left, "decompose_eta_line: msgs_left");

        is("4567", eta_obj.msgs_total, "decompose_eta_line: msgs_total");

        is("4444", eta_obj.msgs_done(), "decompose_eta_line: msgs_done");

        is("97.31", eta_obj.percent_done(), "decompose_eta_line: percent_done");

        is("2.69", eta_obj.percent_left(), "decompose_eta_line: percent_left");
    };

    let migrationAborted = false;
    let lastEta = null;
    let syncError = null;   // {title, sub, action, fix, partial} once a run fails
    let lastPhase = null;   // newest status parsed out of the log
    let lastAlert = null;   // newest live warning parsed out of the log
    let pendingFix = null;  // what the completion panel's button repairs first
    let jobId = null;       // id the guard minted for the running migration
    let jobLog = "";        // log accumulated across polls
    let jobOffset = 0;      // byte offset to resume the tail from
    let pollTimer = null;

    // The run POST only carries an imapsync log when it returns 200. Every
    // other status is someone else answering: the guard refusing the
    // destination (403) or erroring (500), Cloudflare giving up at its 100s
    // proxy cap (524), or the connection dropping (0). Their bodies are not
    // logs and must not be rendered as one.
    const transportFailure = function transportFailure(status) {
        if (403 === status) {
            return {
                title: "Migration refused",
                sub: "That destination isn't a Noxity mail server, so the migration was refused. Check the destination host and try again."
            };
        }
        if (524 === status) {
            return {
                title: "Lost contact with the server",
                sub: "The connection to the server timed out, but your migration was not stopped — it is still running. Contact support for the final log."
            };
        }
        if (0 === status) {
            return {
                title: "Connection dropped",
                sub: "The connection to the server dropped. Your migration may still be running — contact support before starting over."
            };
        }
        return {
            title: "Migration failed to start",
            sub: "The server returned an unexpected error (HTTP " + status + "). Your migration may not have started."
        };
    };

    const fmtInt = function fmtInt(n) {
        const v = Number(n);
        return isFinite(v) ? v.toLocaleString() : String(n);
    };

    // Human-readable time from imapsync's "ETA seconds" value.
    const format_eta = function format_eta(seconds) {
        const s = parseInt(seconds, 10);
        if (!isFinite(s) || s < 0) {
            return "";
        }
        if (s < 60) {
            return "~" + s + " sec left";
        }
        const m = Math.round(s / 60);
        if (m < 60) {
            return "~" + m + " min left";
        }
        const h = Math.floor(s / 3600);
        const mm = Math.round((s % 3600) / 60);
        return "~" + h + " h " + mm + " min left";
    };

    const progress_bar_update = function progress_bar_update(eta_obj) {
        if (eta_obj.str.length) {
            $("#progress-bar-done")
                .removeClass("indeterminate")
                .css("width", eta_obj.percent_done() + "%")
                .attr("aria-valuenow", Math.round(Number(eta_obj.percent_done())));
        }
    };

    // imapsync narrates its run in detail, and most of it happens before the
    // first ETA line — on a big mailbox that's minutes of apparent silence.
    // These are the lines worth turning into a status, in the order a run
    // emits them. Only lines imapsync prints unconditionally are listed:
    // anything behind --debug (e.g. "++++ Verifying [x] -> [y]") never arrives.
    const LOG_PHASES = [
        [/^Host1: probing ssl/, function () {
            return "Checking your current mail server…";
        }],
        [/^Host1: success login/, function () {
            return "Signed in to your current mailbox…";
        }],
        [/^Host2: success login/, function () {
            return "Signed in to your new mailbox…";
        }],
        [/^Host1: folders list/, function () {
            return "Reading your folder list…";
        }],
        [/^Host2: folders list/, function () {
            return "Reading your new mailbox's folders…";
        }],
        [/^Folders mapping from --automap/, function () {
            return "Matching up folder names…";
        }],
        [/^\+\+\+\+ Calculating sizes of (\d+) folders on Host1/, function (m) {
            return "Counting messages in your current mailbox (" +
                fmtInt(m[1]) + " folders)…";
        }],
        [/^Host1 Nb messages:\s+(\d+) messages/, function (m) {
            return "Found " + fmtInt(m[1]) + " messages to migrate…";
        }],
        [/^\+\+\+\+ Calculating sizes of (\d+) folders on Host2/, function () {
            return "Checking what's already in your new mailbox…";
        }],
        [/^Host2 Nb messages:\s+(\d+) messages/, function (m) {
            return fmtInt(m[1]) + " already in your new mailbox…";
        }],
        [/^\+\+\+\+ Looping on each one of (\d+) folders to sync/, function (m) {
            return "Starting on " + fmtInt(m[1]) + " folders…";
        }],
        [/^Host1: folder \[([^\]]+)\] selected (\d+) messages/, function (m) {
            return "Reading " + m[1] + " (" + fmtInt(m[2]) + " messages)…";
        }],
        [/^Host2: folder \[([^\]]+)\] selected (\d+) messages/, function (m) {
            return "Checking " + m[1] + " for messages already copied…";
        }],
        [/^msg (\S+)\/\S+ .*copied to /, function (m) {
            return "Copying " + m[1];
        }],
        [/^\+\+\+\+ End looping on each folder/, function () {
            return "Finishing up…";
        }],
        [/^\+\+\+\+ Statistics/, function () {
            return "Wrapping up…";
        }]
    ];

    // Problems worth interrupting the customer about *while the run is still
    // going*, because they are the ones they can still fix from the other
    // side: the destination's storage limit. imapsync checks the quota right
    // after login, predicts the overflow once it has counted host1, and
    // reports [OVERQUOTA] per message once the server starts refusing them.
    // Listed weakest first — later markers arrive later and take over.
    const LOG_ALERTS = [
        [/^Host2: ([\d.]+) % full: it is time to find a bigger place/, function (m) {
            return "Your new mailbox is " + Math.round(Number(m[1])) +
                "% full. Raise its storage limit before the migration runs out of room.";
        }],
        [/^Host2: Quota limit will be exceeded! Over (\d+) %/, function (m) {
            return "Your new mailbox is too small for this migration — your e-mail needs about " +
                m[1] + "% of the space it has. Raise its storage limit now and the copy keeps going.";
        }],
        [/OVERQUOTA/, function () {
            return "Your new mailbox is out of space, so the server is refusing messages. Raise its storage limit — nothing already copied is lost, and a second run picks up the rest.";
        }]
    ];

    // Reads only the newly-arrived bytes, so this stays cheap however long the
    // log grows, and the phase sticks between markers instead of flickering
    // back to nothing during a long stretch of "msg ... copied" lines.
    function detect(markers, chunk) {
        let found = null;
        chunk.split("\n").forEach(function (line) {
            markers.some(function (marker) {
                const m = line.match(marker[0]);
                if (m) {
                    found = marker[1](m);
                    return true;
                }
                return false;
            });
        });
        return found; // the last marker in this chunk
    }

    // imapsync classifies its own failures: it exits with a code per error
    // type (its %EXIT_TXT table), the guard writes that code down beside the
    // log, and imapsync-log hands it back as X-Imapsync-Exit. Without this the
    // completion panel congratulates the customer on a migration that failed.
    //
    // "partial" marks the ones where the copy did run and most of it landed —
    // they get a warning, not a red cross, and re-running finishes the job
    // (imapsync only copies what is missing).
    const SYNC_FAILURES = {
        6: {   // EXIT_BY_SIGNAL
            title: "Migration was interrupted",
            sub: "Something stopped the migration before it finished. Nothing was deleted on either side — run it again and it picks up where it left off.",
            partial: true
        },
        10: {  // EXIT_CONNECTION_FAILURE
            title: "Couldn't reach a mail server",
            sub: "One of the two servers didn't answer. Check both server addresses — they usually look like mail.yourdomain.com."
        },
        101: { // EXIT_CONNECTION_FAILURE_HOST1
            title: "Couldn't reach your current mail server",
            sub: "The server you're moving away from didn't answer. Check its address — your old provider's help pages list the right IMAP server."
        },
        102: { // EXIT_CONNECTION_FAILURE_HOST2
            title: "Couldn't reach your new mail server",
            sub: "The destination server didn't answer. Check the address, or contact support and we'll confirm the right one."
        },
        12: {  // EXIT_TLS_FAILURE
            title: "Couldn't set up a secure connection",
            sub: "The server refused an encrypted connection. That's usually the wrong server address or port — check both and try again."
        },
        16: {  // EXIT_AUTHENTICATION_FAILURE
            title: "Sign-in was rejected",
            sub: "A mailbox turned down the password it was given. Check both passwords and try again."
        },
        161: { // EXIT_AUTHENTICATION_FAILURE_USER1
            title: "Your current mailbox rejected the sign-in",
            sub: "The address and password for the mailbox you're moving away from weren't accepted. If that provider uses two-factor authentication, you need an app password rather than your normal one."
        },
        162: { // EXIT_AUTHENTICATION_FAILURE_USER2
            title: "Your new mailbox rejected the sign-in",
            sub: "The address and password for the new mailbox weren't accepted. Check them, or contact support to have the password reset."
        },
        111: { // EXIT_WITH_ERRORS
            title: "Migration finished, but not everything copied",
            sub: "Most of your e-mail is across; some messages were refused along the way. Run it again — only what's missing gets copied.",
            partial: true
        },
        112: { // EXIT_WITH_ERRORS_MAX
            title: "Migration stopped after too many errors",
            sub: "The new server kept refusing messages, so the copy gave up early. The log has the reason — send it to support and we'll sort it out.",
            partial: true
        },
        113: { // EXIT_OVERQUOTA
            title: "Your new mailbox is out of space",
            sub: "The migration filled the new mailbox's storage limit, so the rest couldn't be copied. Raise the limit, then run it again — it carries on from where it stopped.",
            partial: true
        },
        114: { // EXIT_ERR_APPEND
            title: "The new server refused some messages",
            sub: "Everything else copied across. Run it again to retry them — if they're refused a second time, send us the log.",
            partial: true
        },
        115: { // EXIT_ERR_FETCH
            title: "Couldn't read some messages from your current mailbox",
            sub: "Your old server failed to hand over some e-mails. Run it again — it only retries what's missing.",
            partial: true
        },
        116: { // EXIT_ERR_CREATE
            title: "Couldn't create some folders in the new mailbox",
            sub: "The new server rejected some folder names, or ran out of room for them. Check the mailbox's storage limit and try again.",
            partial: true
        },
        117: { // EXIT_ERR_SELECT
            title: "Couldn't open some folders in the new mailbox",
            sub: "The new server refused access to folders the migration needed. Run it again, or contact support with the log.",
            partial: true
        },
        118: { // EXIT_TRANSFER_EXCEEDED
            title: "This run hit its transfer limit",
            sub: "There's a cap on how much one run may move. Nothing is lost — run it again to continue from where it stopped.",
            partial: true
        },
        119: { // EXIT_ERR_APPEND_VIRUS
            title: "The new server's virus scanner refused some messages",
            sub: "Everything else copied across. Those messages have to be moved by hand — contact support if you need them.",
            partial: true
        },
        120: { // EXIT_ERR_FLAGS
            title: "Your e-mail copied, but read/unread marks didn't",
            sub: "Nothing is missing — the new server just refused some of the read, unread and starred marks. Run it again if you want them retried.",
            partial: true
        },
        64: {  // EX_USAGE
            title: "Migration couldn't start",
            sub: "The server refused the request before it began. Contact support — this one is ours to fix."
        },
        69: {  // EX_UNAVAILABLE
            title: "The migration server is busy",
            sub: "It turned this run away rather than start it. Wait a few minutes and try again, or contact support."
        }
    };

    const CATCH_ALL_FAILURE = {
        title: "Migration failed",
        sub: "The copy stopped before it finished. Open Show logs for the details — send them to support and we'll take a look."
    };

    // A side only truly failed to sign in if it never reported a success:
    // imapsync logs a failure and then retries with plain LOGIN, so the
    // failure line alone doesn't mean the mailbox was locked out.
    const loginFailed = function loginFailed(log, side) {
        return log.indexOf(side + " failure: Error login on") !== -1 &&
            log.indexOf(side + ": success login on") === -1;
    };

    const diagnoseFailure = function diagnoseFailure(exit, log) {
        // Both mailboxes turning down their password isn't two bad passwords,
        // it's one form filled in backwards. imapsync attempts both logins
        // before it gives up, so a single run shows both failures — and since
        // the destination already passed the Noxity check, it's the accounts
        // that are swapped, not the servers.
        if (loginFailed(log, "Host1") && loginFailed(log, "Host2")) {
            const u1 = ($("#user1").val() || "your first address").trim();
            const u2 = ($("#user2").val() || "your second address").trim();
            return {
                title: "Are your two mailboxes the wrong way round?",
                sub: "Neither mailbox accepted its password. " + u1 +
                    " is set as the mailbox you're moving away from and " + u2 +
                    " as the new one — swap them and we'll try again.",
                action: "Swap the accounts and retry",
                fix: function () {
                    swapFields([
                        ["user1", "user2"],
                        ["password1", "password2"],
                    ]);
                }
            };
        }
        // 114 covers every kind of refusal; imapsync's own classification is
        // the only thing that separates "too big" from the rest.
        if (114 === exit && log.indexOf("most frequent error is ERR_APPEND_SIZE") !== -1) {
            return {
                title: "Some e-mails are too big for the new server",
                sub: "The new server caps how large a single message may be and turned down the biggest ones. Everything else copied across — contact support to have the cap raised.",
                partial: true
            };
        }
        return SYNC_FAILURES[exit] || CATCH_ALL_FAILURE;
    };

    const refreshLog = function refreshLog(xhr) {
        const eta_obj = extract_eta(xhr);
        const hasEta = Boolean(eta_obj.str && eta_obj.str.length);
        if (hasEta) {
            lastEta = eta_obj;
        }

        progress_bar_update(eta_obj);

        if (xhr.readyState === 4) {
            // Finished — the completion UI is handled by showSyncComplete().
            $("#output").text(sanitizeLog(xhr.responseText));
            return;
        }

        if (hasEta) {
            $("#progress-percent").text(
                Math.round(Number(eta_obj.percent_done())) + "%"
            );
            $("#progress-eta").text(
                format_eta(eta_obj.seconds_left) || "Estimating time…"
            );
            $("#progress-msgs").text(
                (lastPhase ? lastPhase + " — " : "") +
                    fmtInt(eta_obj.msgs_done()) +
                    " of " +
                    fmtInt(eta_obj.msgs_total) +
                    " e-mails"
            );
        } else {
            // Everything before the first ETA line: connecting, listing and
            // counting. Minutes of it on a big mailbox, so say what's going on.
            $("#progress-bar-done").addClass("indeterminate");
            $("#progress-percent").text("…");
            $("#progress-eta").text("Starting migration…");
            $("#progress-msgs").text(lastPhase || "Connecting…");
        }
        const last_lines = last_x_lines(
            sanitizeLog(xhr.responseText).slice(-2000),
            -10
        );
        $("#output").text(last_lines);
    };

    const showSyncComplete = function showSyncComplete() {
        // Collapse the console if the user had opened it.
        $("#console-area").addClass("hidden");
        $("#toggleConsole").text("Show logs").attr("aria-expanded", "false");
        $("#bt-abort").addClass("hidden");

        if (syncError) {
            // Half-copied is not the same failure as never-started: a partial
            // run gets a warning and a "run it again", not a red cross.
            const partial = Boolean(syncError.partial);
            pendingFix = syncError.fix || null;
            $("#progress-bar-done").removeClass("indeterminate");
            $("#progress-eta").text(partial ? "Finished with errors" : "Migration stopped");
            $("#sync-done-icon").attr(
                "class",
                partial
                    ? "ph-bold ph-warning-circle sync-done-icon warned"
                    : "ph-bold ph-x-circle sync-done-icon stopped"
            );
            $("#sync-done-title").text(syncError.title);
            $("#sync-done-sub").text(syncError.sub);
            $("#bt-artifact").text(syncError.action || "Try again");
            $("#artifact-hint").addClass("hidden");
        } else if (migrationAborted) {
            $("#progress-eta").text("Migration stopped");
            $("#sync-done-icon").attr("class", "ph-bold ph-x-circle sync-done-icon stopped");
            $("#sync-done-title").text("Migration stopped");
            $("#sync-done-sub").text(
                "You stopped the migration. Nothing was deleted on either side — you can resume where it left off or start over."
            );
            $("#bt-artifact").text("Resume migration");
            $("#artifact-hint").addClass("hidden");
        } else {
            $("#progress-bar-done")
                .removeClass("indeterminate")
                .css("width", "100%")
                .attr("aria-valuenow", 100);
            $("#progress-percent").text("100%");
            $("#progress-eta").text("Migration complete");
            if (lastEta && lastEta.str) {
                $("#progress-msgs").text(
                    fmtInt(lastEta.msgs_total) +
                        " of " +
                        fmtInt(lastEta.msgs_total) +
                        " e-mails copied"
                );
            }
            $("#sync-done-icon").attr("class", "ph-bold ph-check-circle sync-done-icon");
            $("#sync-done-title").text("Migration complete");
            $("#sync-done-sub").text(
                "All your e-mail has been copied across — folders, flags, and dates intact."
            );
            $("#bt-artifact").text("Sync artifact messages");
            $("#artifact-hint").removeClass("hidden");
        }
        $("#sync-done").css({ display: "flex" });
    };

    const traceStatus = function traceStatus(xhr) {
        $("#console").text(
            "Status: " +
                xhr.status +
                " " +
                xhr.statusText +
                "\n" +
                "State: " +
                readyStateStr[xhr.readyState] +
                "\n"
        );
    };

    const endRun = function endRun(failure) {
        clearInterval(pollTimer);
        pollTimer = null;
        syncError = failure; // null on a clean finish
        $("#bt-sync").prop("disabled", false);
        showSyncComplete();
    };

    // The run POST no longer carries the log — it just starts the job and
    // hands back an id (202). Anything else is the guard refusing (403) or
    // erroring (500), or the connection failing (0).
    const handleStart = function handleStart(xhr) {
        traceStatus(xhr);
        if (xhr.readyState !== 4) {
            return;
        }
        if (xhr.status !== 202) {
            endRun(transportFailure(xhr.status));
            return;
        }
        jobId = xhr.getResponseHeader("X-Imapsync-Job");
        if (!jobId) {
            endRun(transportFailure(xhr.status));
            return;
        }
        jobLog = "";
        jobOffset = 0;
        pollTimer = setInterval(pollJob, refresh_interval_ms);
        pollJob(); // don't make the user wait a full interval for line one
    };

    // Tail the job's log. Each poll is its own short request, so nothing here
    // is ever open long enough for a proxy to time it out.
    const pollJob = function pollJob() {
        const xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function () {
            traceStatus(xhr);
            if (xhr.readyState !== 4) {
                return;
            }
            if (xhr.status !== 200) {
                endRun(transportFailure(xhr.status));
                return;
            }
            const phase = detect(LOG_PHASES, xhr.responseText); // new bytes only
            if (phase) {
                lastPhase = phase;
            }
            const alert = detect(LOG_ALERTS, xhr.responseText);
            if (alert && alert !== lastAlert) {
                lastAlert = alert;
                $("#run-alert-text").text(alert);
                $("#run-alert").removeClass("hidden");
            }
            jobLog = jobLog + xhr.responseText;
            const offset = Number(xhr.getResponseHeader("X-Imapsync-Offset"));
            if (!isNaN(offset)) {
                jobOffset = offset;
            }
            const done = xhr.getResponseHeader("X-Imapsync-Done") === "1";
            // refreshLog/extract_eta read .readyState and .responseText off an
            // xhr; the accumulated log stands in for one unchanged.
            refreshLog({
                readyState: done ? 4 : 3,
                responseText: jobLog
            });
            if (done) {
                // The exit code is imapsync's own verdict on the run. A
                // migration that failed must never come back as "complete";
                // a migration the customer stopped keeps its own wording.
                // Anything that isn't a clean 0 — a missing or unreadable
                // header included — is a failure, never a silent success.
                const exit = Number(xhr.getResponseHeader("X-Imapsync-Exit"));
                const clean = migrationAborted || 0 === exit;
                endRun(clean ? null : diagnoseFailure(exit, jobLog));
            }
        };
        xhr.open(
            "GET",
            "/cgi-bin/imapsync-log?job=" +
                encodeURIComponent(jobId) +
                "&from=" +
                jobOffset,
            true
        );
        xhr.send();
    };

    const imapsync = function imapsync() {
        // Fresh run: reset completion/abort state and the progress header.
        migrationAborted = false;
        lastEta = null;
        syncError = null;
        lastPhase = null;
        lastAlert = null;
        $("#run-alert").addClass("hidden");
        $("#sync-done").css({ display: "none" });
        $("#bt-abort").removeClass("hidden").prop("disabled", false);
        $("#progress-percent").text("…");
        $("#progress-eta").text("Starting migration…");
        $("#progress-msgs").text("Connecting…");
        $("#progress-bar-done").addClass("indeterminate").css("width", "30%");

        let querystring = $("#form").serialize();
        $("#abort").text("\n\n");
        $("#output").text("Here comes the log!\n\n");

        if ("imap.gmail.com" === $("#host1").val()) {
            querystring = querystring + "&gmail1=on";
        }
        if ("imap.gmail.com" === $("#host2").val()) {
            querystring = querystring + "&gmail2=on";
        }

        if ("outlook.office365.com" === $("#host1").val()) {
            querystring = querystring + "&office1=on";
        }
        if ("outlook.office365.com" === $("#host2").val()) {
            querystring = querystring + "&office2=on";
        }

        // Disable imapsync's CGI heavy-load gate (free-RAM check). The host
        // has ample swap; exitonload=0 makes the CGI pass --noexitonload so
        // small-RAM boxes don't get a spurious "Server is on heavy load".
        querystring = querystring + "&exitonload=0";

        // Map the well-known folders (Sent, Drafts, Junk, Trash, Archive, All,
        // Flagged) onto whatever the destination calls them. Off by default in
        // imapsync, which copies names verbatim — so a Gmail source would land
        // as a literal "[Gmail]/Sent Mail" folder and the new mailbox's own
        // Sent would look empty to the customer.
        querystring = querystring + "&automap=on";

        const xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function () {
            handleStart(xhr);
        };

        xhr.open("POST", "/cgi-bin/imapsync", true);
        xhr.setRequestHeader(
            "Content-type",
            "application/x-www-form-urlencoded"
        );
        xhr.send(querystring);
    };

    const handleAbort = function handleAbort(xhr) {
        $("#abort").text(
            "Status: " +
                xhr.status +
                " " +
                xhr.statusText +
                "\n" +
                "State: " +
                readyStateStr[xhr.readyState] +
                "\n\n"
        );

        if (xhr.readyState === 4) {
            $("#abort").append(sanitizeLog(xhr.responseText));
            $("#bt-sync").prop("disabled", false);
            $("#bt-abort").prop("disabled", false);
        }
    };

    const abort = function abort() {
        const querystring = $("#form").serialize() + "&abort=on";
        const xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function () {
            handleAbort(xhr);
        };
        xhr.open("POST", "/cgi-bin/imapsync", true);
        xhr.setRequestHeader(
            "Content-type",
            "application/x-www-form-urlencoded"
        );
        xhr.send(querystring);
    };

    const store = function store(id) {
        let stored;
        if (
            "text" === $(id).attr("type") ||
            "password" === $(id).attr("type")
        ) {
            localStorage.setItem(id, $(id).val());
            stored = $(id).val();
        } else if ("checkbox" === $(id).attr("type")) {
            localStorage.setItem(id, $(id)[0].checked);
            stored = $(id)[0].checked;
        }
        return stored;
    };

    const retrieve = function retrieve(id) {
        let retrieved;
        if (
            "text" === $(id).attr("type") ||
            "password" === $(id).attr("type")
        ) {
            $(id).val(localStorage.getItem(id));
            retrieved = $(id).val();
        } else if ("checkbox" === $(id).attr("type")) {
            $(id)[0].checked = JSON.parse(localStorage.getItem(id));
            retrieved = $(id)[0].checked;
        }
        return retrieved;
    };

    const tests_store_retrieve = function tests_store_retrieve() {
        if ($("#tests").length !== 0) {
            is(1, 1, "one equals one");

            // no exist
            is(undefined, store("#test_noexists"), "store: #test_noexists");
            is(
                undefined,
                retrieve("#test_noexists"),
                "retrieve: #test_noexists"
            );
            is(
                undefined,
                retrieve("#test_noexists2"),
                "retrieve: #test_noexists2"
            );

            // input text
            $("#test_text").val("foo");
            is("foo", $("#test_text").val(), "#test_text val = foo");
            is("foo", store("#test_text"), "store: #test_text");
            $("#test_text").val("bar");
            is("bar", $("#test_text").val(), "#test_text val = bar");
            is("foo", retrieve("#test_text"), "retrieve: #test_text = foo");
            is("foo", $("#test_text").val(), "#test_text val = foo");

            // input check button
            $("#test_checkbox").prop("checked", true);
            is(true, store("#test_checkbox"), "store: #test_checkbox checked");

            $("#test_checkbox").prop("checked", false);
            is(
                true,
                retrieve("#test_checkbox"),
                "retrieve: #test_checkbox = true"
            );

            $("#test_checkbox").prop("checked", false);
            is(
                false,
                store("#test_checkbox"),
                "store: #test_checkbox not checked"
            );
            $("#test_checkbox").prop("checked", true);
            is(
                false,
                retrieve("#test_checkbox"),
                "retrieve: #test_checkbox = false"
            );
        }
    };

    const store_form = function store_form() {
        if (typeof Storage !== "undefined") {
            store("#user1");
            store("#password1");
            store("#host1");
            store("#subfolder1");
            store("#showpassword1");

            store("#user2");
            store("#password2");
            store("#host2");
            store("#subfolder2");
            store("#showpassword2");

            store("#dry");
            store("#justlogin");
            store("#justfolders");
            store("#justfoldersizes");
        }
    };

    const show_extra_if_needed = function show_extra_if_needed() {
        if ($("#subfolder1").length && $("#subfolder1").val().length > 0) {
            $(".extra_param").show();
        }
        if ($("#subfolder2").length && $("#subfolder2").val().length > 0) {
            $(".extra_param").show();
        }
    };

    const retrieve_form = function retrieve_form() {
        if (typeof Storage !== "undefined") {
            retrieve("#user1");
            retrieve("#password1");
            retrieve("#host1");
            retrieve("#subfolder1");

            retrieve("#user2");
            retrieve("#password2");
            retrieve("#host2");
            retrieve("#subfolder2");

            retrieve("#dry");
            retrieve("#justlogin");
            retrieve("#justfolders");
            retrieve("#justfoldersizes");

            // Show the extra parameters if they are not empty because it would
            //  be dangerous to retrieve them without showing them
            show_extra_if_needed();
        }
    };

    const init = function init() {
        $("#bt-sync").prop("disabled", false);
        $("#bt-abort").prop("disabled", false);
        $("#progress-bar-left")
            .css("width", 100 + "%")
            .attr("aria-valuenow", 100);

        $("#showpassword1").click(function (event) {
            const button = event.target;
            showpassword("password1", button);
        });

        $("#showpassword2").click(function (event) {
            const button = event.target;
            showpassword("password2", button);
        });

        $("#bt-sync").click(async function () {
            // Final safety net (Task 4): block submission if the core source or
            // destination details are missing. Per-step validation normally
            // prevents reaching here empty; the errors live on earlier cards, so
            // surface the feedback inline on the confirm step instead.
            const missing =
                !isEmail(($("#user1").val() || "").trim()) ||
                !($("#host1").val() || "").trim() ||
                !($("#host2").val() || "").trim() ||
                !($("#password1").val() || "").trim();
            if (missing) {
                $("#confirm-error")
                    .text("Some required details are missing. Use Back to complete every step.")
                    .removeClass("hidden");
                return;
            }
            $("#confirm-error").addClass("hidden");

            const dest = ($("#host2").val() || "").trim();
            const src = ($("#host1").val() || "").trim();

            $("#bt-sync").prop("disabled", true);
            const allowed = await isAllowedDestination(dest);
            if (!allowed) {
                // A destination that isn't ours while the *source* is ours is
                // the form filled in backwards, not an unsupported host — and
                // it's the one wrong answer we can offer to correct.
                if (await isAllowedDestination(src)) {
                    showSwapModal();
                } else {
                    showRejectModal();
                }
                $("#bt-sync").prop("disabled", false);
                return;
            }

            $("#confirmPage").css({
                display: "none"
            });
            // Hide the (now-empty) form so #consoleLogs centers on its own
            // instead of sharing the vertical space with an empty form.
            $("#form").css({
                display: "none"
            });
            $("#consoleLogs").css({
                display: "flex"
            });
            $("#bt-abort").prop("disabled", false);
            store_form();
            imapsync();
        });

        $("#bt-abort").click(function () {
            migrationAborted = true;
            $("#bt-sync").prop("disabled", true);
            $("#bt-abort").prop("disabled", true);
            abort();
        });

        // Collapsible logs
        $("#toggleConsole").click(function () {
            const $area = $("#console-area");
            const show = $area.hasClass("hidden");
            $area.toggleClass("hidden", !show);
            $(this)
                .text(show ? "Hide logs" : "Show logs")
                .attr("aria-expanded", show ? "true" : "false");
        });

        // Tabbed consoles
        $(".tabs .tab").click(function () {
            const tab = $(this).attr("data-tab");
            $(".tabs .tab").removeClass("tab-active").attr("aria-selected", "false");
            $(this).addClass("tab-active").attr("aria-selected", "true");
            $(".tab-panel").addClass("hidden");
            $(".tab-panel[data-tab='" + tab + "']").removeClass("hidden");
        });

        // Second pass — catches messages missed or delivered during the first
        // run (imapsync is idempotent; re-running only copies what's new). Reuses
        // the credentials already in the form, after repairing them first if the
        // failure came with a fix (source and destination the wrong way round).
        $("#bt-artifact").click(function () {
            if (pendingFix) {
                const fix = pendingFix;
                pendingFix = null;
                fix();
            }
            $("#sync-done").css({ display: "none" });
            $("#bt-sync").prop("disabled", true);
            imapsync();
        });

        // Start over — clear stored values and return to step 1.
        $("#bt-startover").click(function () {
            [
                "#user1", "#password1", "#host1", "#user2", "#password2", "#host2",
                "#dry", "#subfolder1", "#subfolder2", "#justlogin", "#justfolders",
                "#justfoldersizes", "#showpassword1", "#showpassword2",
            ].forEach(function (id) {
                try {
                    localStorage.removeItem(id);
                } catch (e) { /* ignore */ }
            });
            window.location.reload();
        });

    };

    const tests_bilan = function tests_bilan(nb_attended_test) {
        $("#tests").append("1.." + test.counter_all + "\n");
        if (test.counter_nok > 0) {
            $("#tests").append("\nFAILED tests \n" + test.failed_tests);
            $("#tests").collapse("show");
        }
        if (test.counter_all !== nb_attended_test) {
            $("#tests").append(
                "# Looks like you planned " +
                    nb_attended_test +
                    " tests but ran " +
                    test.counter_all +
                    ".\n"
            );
            $("#tests").collapse("show");
        }
    };

    const tests = function tests(nb_attended_test) {
        if ($("#tests").length !== 0) {
            tests_store_retrieve();
            tests_last_eta();
            tests_decompose_eta_line();
            tests_last_x_lines();

            tests_bilan(nb_attended_test);
        }
    };

    init();
    tests(38);
    retrieve_form();
});

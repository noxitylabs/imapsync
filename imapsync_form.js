// $Id: imapsync_form.js,v 1.34 2024/08/05 23:26:21 gilles Exp gilles $

/*jslint browser: true*/ /*global  $, Storage, XMLHttpRequest, document, localStorage, JSON, setInterval, clearInterval */

function last_x_lines(string, num) {
    if (undefined === string || 0 === num) {
        return "";
    }
    return string.split(/\r?\n/).slice(num).join("\n");
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

    function fillModal(info) {
        const support = window.NOXITY_SUPPORT || "mailto:support@noxity.io";
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
            dark ? "fa-solid fa-sun" : "fa-solid fa-moon"
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
            .attr("class", reveal ? "fa-solid fa-eye-slash" : "fa-solid fa-eye");
    });

    const resetPwToggle = function resetPwToggle(id) {
        const input = document.getElementById(id);
        if (input) input.type = "password";
        $(".pw-toggle[data-target='" + id + "']")
            .attr("aria-pressed", "false")
            .attr("aria-label", "Show password")
            .find("i")
            .attr("class", "fa-solid fa-eye");
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

    $("#form").on("submit", function (e) {
        e.preventDefault();
        if ($("#tos-modal").is(":visible")) {
            $("#modal-btn-ok").click();
            return;
        }
        $("#form > .box:visible").find("button[id^='next'], #bt-sync").first().click();
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

    $("#next2").click(function () {
        if (!requireFields([
            { sel: "#host1", message: "Enter the source server hostname or IP." },
            { sel: "#host2", message: "Enter the destination server hostname or IP." },
        ])) {
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
        $("#password2").prop("disabled", true);
        $("#password2").val($("#password1").val());
        $("#password1").on("input", function () {
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
        $("#password2").prop("disabled", false);
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
        // password2 is disabled when the user chose "same password", so only
        // require it when the two mailboxes use different passwords.
        if (!$("#password2").prop("disabled")) {
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

    const progress_bar_update = function progress_bar_update(eta_obj) {
        if (eta_obj.str.length) {
            $("#progress-bar-done")
                .css("width", eta_obj.percent_done() + "%")
                .attr("aria-valuenow", eta_obj.percent_done());
        }
    };

    const refreshLog = function refreshLog(xhr) {
        const eta_obj = extract_eta(xhr);

        progress_bar_update(eta_obj);

        if (xhr.readyState === 4) {
            // end of sync
            $("#progress-txt").text(
                "Ended. It remains " +
                    eta_obj.msgs_left +
                    " messages to be synced"
            );

            $("#output").text(xhr.responseText);
        } else {
            let eta_str =
                eta_obj.str +
                " (refresh done every " +
                refresh_interval_s +
                " s)";
            eta_str = eta_str.replaceAll(/[\r\n]/g, "");
            $("#progress-txt").text(eta_str);
            const last_lines = last_x_lines(xhr.responseText.slice(-2000), -10);
            $("#output").text(last_lines);
        }
    };

    const handleRun = function handleRun(xhr, timerRefreshLog) {
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

        if (xhr.readyState === 4) {
            clearInterval(timerRefreshLog);
            refreshLog(xhr); // a last time
            $("#bt-sync").prop("disabled", false);
        }
    };

    const imapsync = function imapsync() {
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

        const xhr = new XMLHttpRequest();
        const timerRefreshLog = setInterval(function () {
            refreshLog(xhr);
        }, refresh_interval_ms);

        xhr.onreadystatechange = function () {
            handleRun(xhr, timerRefreshLog);
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
            $("#abort").append(xhr.responseText);
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

            $("#bt-sync").prop("disabled", true);
            const allowed = await isAllowedDestination(dest);
            if (!allowed) {
                showRejectModal();
                $("#bt-sync").prop("disabled", false);
                return;
            }

            $("#confirmPage").css({
                display: "none"
            });
            $("#consoleLogs").css({
                display: "flex"
            });
            $("#bt-abort").prop("disabled", false);
            $("#progress-txt").text("ETA: coming soon");
            store_form();
            imapsync();
        });

        $("#bt-abort").click(function () {
            $("#bt-sync").prop("disabled", true);
            $("#bt-abort").prop("disabled", true);
            abort();
        });

        const swap = function swap(p1, p2) {
            const temp = $(p2).val();
            $(p2).val($(p1).val());
            $(p1).val(temp);
        };

        $("#swap").click(function () {
            // swaping colors can't use swap()
            const temp1 = $("#account1").css("background-color");
            const temp2 = $("#account2").css("background-color");
            $("#account1").css("background-color", temp2);
            $("#account2").css("background-color", temp1);

            swap($("#user1"), $("#user2"));
            swap($("#password1"), $("#password2"));
            swap($("#host1"), $("#host2"));
            swap($("#subfolder1"), $("#subfolder2"));

            const temp = $("#showpassword1")[0].checked;
            $("#showpassword1")[0].checked = $("#showpassword2")[0].checked;
            $("#showpassword2")[0].checked = temp;
            showpassword("password1", $("#showpassword1")[0]);
            showpassword("password2", $("#showpassword2")[0]);
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

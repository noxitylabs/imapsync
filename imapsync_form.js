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
            if (0 === eta_obj.msgs_total) {
                return "0";
            }
            const percent =
                ((eta_obj.msgs_total - eta_obj.msgs_left) /
                    eta_obj.msgs_total) *
                100;
            return percent.toFixed(2);
        },
        percent_left: function () {
            if (0 === eta_obj.msgs_total) {
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

$(document).ready(function () {
    "use strict";

    const readyStateStr = {
        0: "Request not initialized",
        1: "Server connection established",
        2: "Response headers received",
        3: "Processing request",
        4: "Finished and response is ready",
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

    $("#next1").click(function () {
        const userInput = $("#user1").val();
        $.ajax({
            url: "http://localhost:8080/run-script",
            type: "GET",
            data: { user_input: userInput },
            success: function (response) {
                $("#host1").val(response);
                $("#tos-modal").css({
                    display: "flex"
                });
            },
        });
        $("#start").css({
            display: "none"
        });
        $("#imapserver").css({
            display: "flex"
        });
    });

    $("#next2").click(function () {
        $("#imapserver").css({
            display: "none"
        });
        $("#isSameMail").css({
            display: "flex"
        });
        const src = $("#host1").val();
        const dest = $("#host2").val();
        $("#migrationText").text("Migrating from " + src + " to " + dest);
    });

    $("#yesMail").click(function () {
        $("#isSameMail").css({
            display: "none"
        });
        $("#isSamePass").css({
            display: "flex"
        });
        $("#user2").val($("#user1").val());
    });

    let flag_isMailSame = true;
    let flag_isPassSame = true;

    $("#noMail").click(function () {
        $("#isSameMail").css({
            display: "none"
        });
        $("#notSameMail").css({
            display: "flex"
        });
        flag_isMailSame = false;
    });

    $("#next3").click(function () {
        $("#notSameMail").css({
            display: "none"
        });
        $("#isSamePass").css({
            display: "flex"
        });
    });

    $("#yesPass").click(function () {
        flag_isPassSame = true;
        $("#isSamePass").css({
            display: "none"
        });
        $("#enterPass").css({
            display: "flex"
        });
        $("#password2").css({
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
        $("#isSamePass").css({
            display: "none"
        });
        $("#enterPass").css({
            display: "flex"
        });
        $("#password2").css({
            display: "inline-block"
        });
        $("#password2").prop("disabled", false);
        $("#password2").val("");
        $("#password1").off("input");
        const sourceInput = $("#user1").val();
        $("#srcLabel").text("This is for source mail: " + sourceInput);
        const destInput = $("#user2").val();
        $("#destLabel").text("This is for destination mail: " + destInput);
    });

    $("#next4").click(function () {
        $("#enterPass").css({
            display: "none"
        });
        $("#confirmPage").css({
            display: "flex"
        });
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

    const extract_eta = function extract_eta(xhr) {
        const slice_length = xhr.readyState === 4 ? -24000 : -2400;
        const slice_log = xhr.responseText.slice(slice_length);
        const eta_str = last_eta(slice_log);
        return decompose_eta_line(eta_str);
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

        $("#bt-sync").click(function () {
            $("#confirmPage").css({
                display: "none"
            });
            $("#consoleLogs").css({
                display: "flex"
            });
            $("#bt-sync").prop("disabled", true);
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

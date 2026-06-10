/* Top "signed in as" strip. For a master it becomes an identity switcher: tap
   the badge to act as any user (their data, their permissions, comments posted
   on their behalf). Safe to include anywhere; does nothing when signed out. */
(function () {
  // Register the service worker (installable + offline). On every app page.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    });
  }

  // Offline banner: field crews hit dead zones. Tell them plainly that changes
  // won't save until they reconnect, instead of failing silently.
  (function () {
    var bar = null;
    function show(off) {
      if (off) {
        if (bar) return;
        bar = document.createElement("div");
        bar.textContent = "You're offline. You can keep looking, but changes won't save until you reconnect.";
        bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:10001;background:#8a3d1c;color:#fff;text-align:center;font-size:.85rem;font-weight:600;font-family:inherit;padding:9px 14px;padding-bottom:calc(9px + env(safe-area-inset-bottom, 0px))";
        (document.body || document.documentElement).appendChild(bar);
      } else if (bar) { bar.remove(); bar = null; }
    }
    window.addEventListener("offline", function () { show(true); });
    window.addEventListener("online", function () { show(false); });
    if (navigator.onLine === false) show(true);
  })();

  function esc(s) { return (s || "").toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  // Accessibility: the CSS reset removed focus rings and many clickable rows are
  // <div onclick=...> that a keyboard can't reach. Restore visible focus and make
  // those rows focusable + operable with Enter/Space. Runs on every app page.
  (function () {
    var s = document.createElement("style");
    s.textContent = "a:focus-visible,button:focus-visible,select:focus-visible,input:focus-visible,textarea:focus-visible,[role=button]:focus-visible,[onclick]:focus-visible{outline:2px solid #2f5d50;outline-offset:2px;border-radius:4px}";
    (document.head || document.documentElement).appendChild(s);
    function tagRows() {
      var els = document.querySelectorAll("[onclick]:not([data-kb])");
      for (var i = 0; i < els.length; i++) {
        var el = els[i], t = el.tagName;
        el.setAttribute("data-kb", "1");
        // Name icon-only "×" buttons (e.g. remove-photo) for screen readers.
        if (!el.getAttribute("aria-label")) {
          var txt = (el.textContent || "").trim();
          if (txt === "×" || txt === "✕") el.setAttribute("aria-label", "Remove");
        }
        if (t === "A" || t === "BUTTON" || t === "INPUT" || t === "SELECT" || t === "TEXTAREA" || t === "LABEL") continue;
        if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
        if (!el.hasAttribute("role")) el.setAttribute("role", "button");
      }
    }
    if (document.readyState !== "loading") tagRows();
    document.addEventListener("DOMContentLoaded", tagRows);
    try { new MutationObserver(tagRows).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var el = document.activeElement;
      if (!el || !el.getAttribute) return;
      var t = el.tagName;
      if (t === "A" || t === "BUTTON" || t === "INPUT" || t === "SELECT" || t === "TEXTAREA") return;
      if (el.getAttribute("role") === "button" || el.hasAttribute("onclick")) { e.preventDefault(); el.click(); }
    });
  })();

  var css =
    ".rw-idstrip{background:var(--bg-2,#efe8d8);border-bottom:1px solid var(--line,rgba(35,40,42,.14));font-size:.8rem;color:var(--muted,#5f5d52);padding:7px 22px;padding-top:calc(7px + env(safe-area-inset-top, 0px));text-align:right;font-family:inherit}" +
    ".rw-idstrip a{color:var(--green-deep,#21443a);text-decoration:none;font-weight:600}" +
    ".rw-idstrip a:hover{text-decoration:underline}" +
    ".rw-idwrap{position:relative;display:inline-block;vertical-align:middle}" +
    ".rw-switch{display:inline-flex;align-items:center;gap:5px;background:var(--green-deep,#21443a);color:#f6f2e8;border:none;border-radius:999px;padding:2px 10px;font:inherit;font-weight:700;font-size:.74rem;cursor:pointer}" +
    ".rw-switch.acting{background:var(--clay,#a9633a)}" +
    ".rw-switch .car{opacity:.85;font-size:.7rem}" +
    ".rw-menu{position:fixed;right:10px;left:auto;top:60px;background:#fff;border:1px solid var(--line,rgba(35,40,42,.14));border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.18);min-width:220px;max-width:min(290px,92vw);max-height:70vh;overflow:auto;z-index:10000;text-align:left;padding:6px}" +
    ".rw-menu .h{font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted,#5f5d52);font-weight:700;padding:8px 10px 4px}" +
    ".rw-menu button{display:flex;align-items:center;gap:7px;width:100%;text-align:left;background:transparent;border:none;border-radius:6px;padding:8px 10px;font:inherit;font-size:.86rem;color:var(--ink,#23282a);cursor:pointer}" +
    ".rw-menu button:hover{background:var(--bg-2,#efe8d8)}" +
    ".rw-menu button.cur{font-weight:700;color:var(--green-deep,#21443a)}" +
    ".rw-menu .cli{color:var(--muted,#5f5d52);font-weight:400}" +
    ".rw-master{display:inline-flex;align-items:center;gap:4px;background:var(--green-deep,#21443a);color:#f6f2e8;border-radius:999px;padding:1px 9px;font-weight:700;font-size:.74rem;margin-right:4px;vertical-align:middle}" +
    ".rw-actbar{background:var(--clay,#a9633a);color:#f6f2e8;text-align:center;font-size:.82rem;font-weight:600;padding:6px 12px}" +
    ".rw-actbar a{color:#fff;text-decoration:underline;cursor:pointer;font-weight:700}" +
    ".rw-filing{display:inline-block;background:var(--bg-2,#efe8d8);border:1px solid var(--line,rgba(35,40,42,.14));color:var(--green-deep,#21443a);border-radius:999px;padding:6px 13px;font-size:.85rem;font-weight:600;margin-bottom:16px}";

  var CROWN = "<svg width='11' height='11' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'><path d='M3 7l4 4 5-7 5 7 4-4-2 12H5z'/></svg>";

  function switchTo(payload) {
    fetch("/api/admin/actas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.ok) location.reload(); else alert((d && d.error) || "Couldn't switch."); })
      .catch(function () { alert("Couldn't reach the server."); });
  }

  fetch("/api/whoami").then(function (r) { return r.json(); }).then(function (w) {
    if (!w || !w.ok) return;

    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    var isMaster = w.realRole === "master"; // real account is master (maybe impersonating)

    // A clear banner across the top while impersonating.
    if (w.impersonating) {
      var bar = document.createElement("div");
      bar.className = "rw-actbar";
      bar.innerHTML = "Acting as <strong>" + esc(w.name || "user") + "</strong> &middot; <a id='rwBackTop'>Back to " + esc(w.realName || "master") + "</a>";
      document.body.insertBefore(bar, document.body.firstChild);
      var bt = document.getElementById("rwBackTop");
      if (bt) bt.addEventListener("click", function () { switchTo({ clear: true }); });
    }

    var strip = document.createElement("div");
    strip.className = "rw-idstrip";

    var idHtml;
    if (isMaster) {
      var label = w.impersonating
        ? "Acting as " + esc(w.name || "user")
        : CROWN + esc(w.realName || w.name || "Master");
      idHtml =
        "<span class='rw-idwrap'>" +
          "<button class='rw-switch" + (w.impersonating ? " acting" : "") + "' id='rwSwitch'>" + label + " <span class='car'>&#9662;</span></button>" +
          "<div class='rw-menu' id='rwMenu' style='display:none'></div>" +
        "</span>" + (w.impersonating ? "" : " &middot; all clients");
    } else {
      idHtml = "Signed in as <a href='/account'>" + esc(w.client || w.name || "your account") + "</a>";
    }

    strip.innerHTML = idHtml + " &middot; <a href='#' id='rwSignout'>Sign out</a>";
    document.body.insertBefore(strip, document.body.firstChild);

    var so = document.getElementById("rwSignout");
    if (so) so.addEventListener("click", function (e) {
      e.preventDefault();
      fetch("/api/logout", { method: "POST" }).then(function () { location.href = "/login"; }).catch(function () { location.href = "/login"; });
    });

    // The switcher dropdown (master only).
    if (isMaster) {
      var sw = document.getElementById("rwSwitch"), menu = document.getElementById("rwMenu");
      function loadMenu() {
        menu.innerHTML = "<div class='h'>View as</div><div style='padding:8px 10px;color:var(--muted,#5f5d52)'>Loading…</div>";
        fetch("/api/admin/actas/users").then(function (r) { return r.json(); }).then(function (d) {
          if (!d || !d.ok) { menu.innerHTML = "<div style='padding:10px'>Couldn't load users.</div>"; return; }
          var html = "";
          if (w.impersonating) html += "<button data-clear='1'>↩ Back to " + esc(w.realName || "master") + " (you)</button><div class='h'>View as</div>";
          else html += "<div class='h'>View as</div>";
          d.users.forEach(function (u) {
            var cur = (u.label && u.label === w.name) ? " cur" : "";
            var crown = u.role === "master" ? CROWN + " " : "";
            var cli = (u.role === "client" && u.client && u.client !== u.label) ? " <span class='cli'>· " + esc(u.client) + "</span>" : "";
            // A client with a login carries an id; one without is viewed by name.
            var attr = u.id ? ("data-id='" + esc(u.id) + "'") : ("data-client='" + esc(u.client || u.label) + "'");
            html += "<button class='" + cur.trim() + "' " + attr + ">" + crown + esc(u.label) + cli + "</button>";
          });
          menu.innerHTML = html;
        }).catch(function () { menu.innerHTML = "<div style='padding:10px'>Couldn't reach the server.</div>"; });
      }
      sw.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        if (menu.style.display === "none") {
          var r = sw.getBoundingClientRect();
          menu.style.top = Math.round(r.bottom + 6) + "px"; // sit just below the badge, pinned to the right edge
          menu.style.display = "block";
          loadMenu();
        } else menu.style.display = "none";
      });
      menu.addEventListener("click", function (e) {
        e.stopPropagation();
        var b = e.target.closest ? e.target.closest("button") : null;
        if (!b) return;
        if (b.getAttribute("data-clear")) switchTo({ clear: true });
        else if (b.getAttribute("data-id")) switchTo({ userId: b.getAttribute("data-id") });
        else if (b.getAttribute("data-client")) switchTo({ client: b.getAttribute("data-client") });
      });
      document.addEventListener("click", function () { menu.style.display = "none"; });
    }

    // "Filing as <client>" on the create forms (also shows while acting as a client).
    if (w.role === "client" && w.client) {
      var p = location.pathname.replace(/\/+$/, "");
      if (p === "/tickets" || p === "/assets" || p === "/service" || /\/(tickets|assets|service)$/.test(p)) {
        var form = document.querySelector("form");
        if (form) {
          var pill = document.createElement("div");
          pill.className = "rw-filing";
          pill.innerHTML = "Filing as <strong>" + esc(w.client) + "</strong>";
          form.insertBefore(pill, form.firstChild);
        }
      }
    }
  }).catch(function () {});
})();

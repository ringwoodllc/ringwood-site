/* Shows who's signed in. Adds a thin "Signed in as <name>" strip at the top of
   every app page, and a "Filing as <client>" pill on the create forms. Safe to
   include anywhere: it does nothing when no one is signed in. */
(function () {
  // Install the service worker so the app is installable (Add to Home Screen /
  // Install app) and works offline. Registered from here because this script is
  // already on every signed-in app page.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    });
  }

  function esc(s) { return (s || "").toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  var css =
    ".rw-idstrip{background:var(--bg-2,#efe8d8);border-bottom:1px solid var(--line,rgba(35,40,42,.14));font-size:.8rem;color:var(--muted,#5f5d52);padding:7px 22px;text-align:right;font-family:inherit}" +
    ".rw-idstrip a{color:var(--green-deep,#21443a);text-decoration:none;font-weight:600}" +
    ".rw-idstrip a:hover{text-decoration:underline}" +
    ".rw-master{display:inline-flex;align-items:center;gap:4px;background:var(--green-deep,#21443a);color:#f6f2e8;border-radius:999px;padding:1px 9px;font-weight:700;font-size:.74rem;margin-right:4px;vertical-align:middle}" +
    ".rw-filing{display:inline-block;background:var(--bg-2,#efe8d8);border:1px solid var(--line,rgba(35,40,42,.14));color:var(--green-deep,#21443a);border-radius:999px;padding:6px 13px;font-size:.85rem;font-weight:600;margin-bottom:16px}";

  var CROWN = "<svg width='11' height='11' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'><path d='M3 7l4 4 5-7 5 7 4-4-2 12H5z'/></svg>";

  fetch("/api/whoami").then(function (r) { return r.json(); }).then(function (w) {
    if (!w || !w.ok) return;

    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    var strip = document.createElement("div");
    strip.className = "rw-idstrip";
    var idHtml = w.role === "master"
      ? "<a href='/account'><span class='rw-master'>" + CROWN + "Master</span></a> &middot; all clients"
      : "Signed in as <a href='/account'>" + esc(w.client || "your account") + "</a>";
    var canSvc = w.role === "master" || (w.perms && (w.perms.service === "view" || w.perms.service === "edit"));
    var nav = canSvc ? "<a href='/services'>Service records</a> &middot; " : "";
    strip.innerHTML = idHtml + " &middot; " + nav + "<a href='#' id='rwSignout'>Sign out</a>";
    document.body.insertBefore(strip, document.body.firstChild);
    var so = document.getElementById("rwSignout");
    if (so) so.addEventListener("click", function (e) {
      e.preventDefault();
      fetch("/api/logout", { method: "POST" }).then(function () { location.href = "/login"; }).catch(function () { location.href = "/login"; });
    });

    // "Filing as <client>" on the create forms.
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

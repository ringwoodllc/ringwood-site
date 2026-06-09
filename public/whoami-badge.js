/* Shows who's signed in. Adds a thin "Signed in as <name>" strip at the top of
   every app page, and a "Filing as <client>" pill on the create forms. Safe to
   include anywhere: it does nothing when no one is signed in. */
(function () {
  function esc(s) { return (s || "").toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  var css =
    ".rw-idstrip{background:var(--bg-2,#efe8d8);border-bottom:1px solid var(--line,rgba(35,40,42,.14));font-size:.8rem;color:var(--muted,#5f5d52);padding:7px 22px;text-align:right;font-family:inherit}" +
    ".rw-idstrip a{color:var(--green-deep,#21443a);text-decoration:none;font-weight:600}" +
    ".rw-idstrip a:hover{text-decoration:underline}" +
    ".rw-filing{display:inline-block;background:var(--bg-2,#efe8d8);border:1px solid var(--line,rgba(35,40,42,.14));color:var(--green-deep,#21443a);border-radius:999px;padding:6px 13px;font-size:.85rem;font-weight:600;margin-bottom:16px}";

  fetch("/api/whoami").then(function (r) { return r.json(); }).then(function (w) {
    if (!w || !w.ok) return;
    var who = w.role === "master" ? "master (all clients)" : (w.client || "your account");

    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    var strip = document.createElement("div");
    strip.className = "rw-idstrip";
    strip.innerHTML = "Signed in as <a href='/account'>" + esc(who) + "</a> &middot; <a href='#' id='rwSignout'>Sign out</a>";
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

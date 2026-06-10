/* "Get the app" prompt for the login screen.
   - Android/Chrome: shows a real Install button (fires the native install).
   - iPhone/Safari: shows the Add to Home Screen instructions (iOS has no API).
   - Already installed (running standalone): shows nothing.
   Renders into #installSlot if present, otherwise appends to the page. */
(function () {
  // Make sure the app is installable from here too: register the service worker.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(function () {});
  }

  var standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
  if (standalone) return; // already running as an installed app

  var ua = navigator.userAgent || "";
  var isIOS = /iphone|ipad|ipod/i.test(ua);
  var inSafari = /^((?!crios|fxios|edgios).)*safari/i.test(ua); // not Chrome/Firefox/Edge on iOS

  var GREEN = "#2f5d50", DEEP = "#21443a", PAPER = "#f6f2e8", BG2 = "#efe8d8", LINE = "rgba(35,40,42,.14)", MUTED = "#5f5d52";

  function slot() {
    var s = document.getElementById("installSlot");
    if (!s) { s = document.createElement("div"); s.id = "installSlot"; document.body.appendChild(s); }
    return s;
  }
  function rings() {
    return "<svg width='22' height='22' viewBox='0 0 26 26' style='flex:0 0 auto'><g fill='none' stroke='" + GREEN + "' stroke-width='1.4'><circle cx='13' cy='13' r='2.6'/><circle cx='13' cy='13' r='6'/><circle cx='13' cy='13' r='9.5'/></g></svg>";
  }
  function card(html) {
    slot().innerHTML = "<div style='background:" + BG2 + ";border:1px solid " + LINE + ";border-radius:8px;padding:14px 16px;margin-top:16px;font-size:.92rem;color:#23282a'>" + html + "</div>";
  }

  // Android / desktop Chrome: capture the install event and offer a button.
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    var deferred = e;
    card(
      "<div style='display:flex;align-items:center;gap:12px;flex-wrap:wrap'>" +
        rings() +
        "<div style='flex:1;min-width:150px'><strong style='color:" + DEEP + "'>Install the Ringwood app</strong>" +
        "<div style='color:" + MUTED + ";margin-top:2px'>Add it to your home screen for one-tap access.</div></div>" +
        "<button id='rwInstallBtn' style='background:" + GREEN + ";color:" + PAPER + ";border:none;border-radius:999px;padding:10px 18px;font:inherit;font-weight:600;cursor:pointer'>Install</button>" +
      "</div>"
    );
    document.getElementById("rwInstallBtn").addEventListener("click", function () {
      slot().innerHTML = "";
      deferred.prompt();
    });
  });

  // iOS Safari: no install API, so show the manual steps.
  if (isIOS && inSafari) {
    card(
      "<div style='display:flex;align-items:flex-start;gap:11px'>" +
        rings() +
        "<div><strong style='color:" + DEEP + "'>Install the app</strong>" +
        "<div style='color:" + MUTED + ";margin-top:2px'>Tap the Share button, then <strong>Add to Home Screen</strong>.</div></div>" +
      "</div>"
    );
  }
})();

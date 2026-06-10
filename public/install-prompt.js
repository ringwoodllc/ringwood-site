/* "Get the app" block for the login screen.
   - Android/Chrome: a real Install button (fires the native PWA install).
   - iPhone/Safari: Add to Home Screen instructions.
   - App Store + Google Play badges. Until each app is published, fill the URLs
     below; an empty URL shows "Coming soon" instead of a dead link.
   - Hidden entirely when already running as the installed app. */
(function () {
  // ===== Paste the real store URLs here when the apps go live =====
  var STORES = {
    ios: "",      // e.g. "https://apps.apple.com/app/ringwood/id0000000000"
    android: ""   // e.g. "https://play.google.com/store/apps/details?id=ai.ringwood.app"
  };
  // Direct Android download that works today (no Play Store needed). Empty to hide.
  var APK_URL = "/downloads/ringwood-android.apk";
  // ================================================================

  // Make the page installable: register the service worker.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(function () {});
  }

  var standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
  if (standalone) return; // already installed

  var ua = navigator.userAgent || "";
  var isIOS = /iphone|ipad|ipod/i.test(ua);
  var inSafari = /^((?!crios|fxios|edgios).)*safari/i.test(ua);

  var GREEN = "#2f5d50", DEEP = "#21443a", PAPER = "#f6f2e8", BG2 = "#efe8d8", LINE = "rgba(35,40,42,.14)", MUTED = "#5f5d52", DARK = "#1f3d2b";

  function slot() {
    var s = document.getElementById("installSlot");
    if (!s) { s = document.createElement("div"); s.id = "installSlot"; document.body.appendChild(s); }
    return s;
  }
  // Two sub-containers so the install button and the badges can coexist.
  var root = slot();
  var promptBox = document.createElement("div"); root.appendChild(promptBox);
  var badgeBox = document.createElement("div"); root.appendChild(badgeBox);

  function rings() {
    return "<svg width='22' height='22' viewBox='0 0 26 26' style='flex:0 0 auto'><g fill='none' stroke='" + GREEN + "' stroke-width='1.4'><circle cx='13' cy='13' r='2.6'/><circle cx='13' cy='13' r='6'/><circle cx='13' cy='13' r='9.5'/></g></svg>";
  }
  function panel(el, html) {
    el.innerHTML = "<div style='background:" + BG2 + ";border:1px solid " + LINE + ";border-radius:8px;padding:14px 16px;margin-top:16px;font-size:.92rem;color:#23282a'>" + html + "</div>";
  }

  /* ---- Android install button ---- */
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    var deferred = e;
    panel(promptBox,
      "<div style='display:flex;align-items:center;gap:12px;flex-wrap:wrap'>" + rings() +
      "<div style='flex:1;min-width:150px'><strong style='color:" + DEEP + "'>Install the Ringwood app</strong>" +
      "<div style='color:" + MUTED + ";margin-top:2px'>Add it to your home screen for one-tap access.</div></div>" +
      "<button id='rwInstallBtn' style='background:" + GREEN + ";color:" + PAPER + ";border:none;border-radius:999px;padding:10px 18px;font:inherit;font-weight:600;cursor:pointer'>Install</button></div>"
    );
    document.getElementById("rwInstallBtn").addEventListener("click", function () {
      promptBox.innerHTML = ""; deferred.prompt();
    });
  });

  /* ---- iPhone Add to Home Screen hint ---- */
  if (isIOS && inSafari) {
    panel(promptBox,
      "<div style='display:flex;align-items:flex-start;gap:11px'>" + rings() +
      "<div><strong style='color:" + DEEP + "'>Install the app</strong>" +
      "<div style='color:" + MUTED + ";margin-top:2px'>Tap the Share button, then <strong>Add to Home Screen</strong>.</div></div></div>"
    );
  }

  /* ---- App Store + Google Play badges ---- */
  var appleGlyph = "<svg viewBox='0 0 384 512' width='17' height='17' fill='currentColor' style='flex:0 0 auto'><path d='M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zM262.1 104.5c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z'/></svg>";
  var playGlyph = "<svg viewBox='0 0 24 24' width='16' height='16' fill='currentColor' style='flex:0 0 auto'><path d='M3 2.2v19.6l16-9.8z'/></svg>";

  function badge(label, sub, glyph, url) {
    var live = !!url;
    var base = "display:flex;align-items:center;gap:9px;flex:1;min-width:150px;background:" + DARK + ";color:#fff;border:none;border-radius:8px;padding:9px 14px;text-decoration:none;cursor:pointer;font:inherit;text-align:left;" + (live ? "" : "opacity:.78;");
    return "<a class='rw-badge' data-live='" + (live ? "1" : "0") + "' data-store='" + label + "' href='" + (live ? url : "#") + "'" + (live ? " target='_blank' rel='noopener'" : "") + " style='" + base + "'>" +
      glyph +
      "<span style='line-height:1.15'><span style='display:block;font-size:.66rem;opacity:.85'>" + sub + "</span>" +
      "<span style='display:block;font-size:.98rem;font-weight:600'>" + label + "</span></span></a>";
  }

  badgeBox.innerHTML =
    "<div style='margin-top:16px'>" +
      "<div style='text-align:center;color:" + MUTED + ";font-size:.82rem;letter-spacing:.12em;text-transform:uppercase;font-weight:600;margin-bottom:10px'>Get the app</div>" +
      "<div style='display:flex;gap:10px;flex-wrap:wrap'>" +
        badge("App Store", "Download on the", appleGlyph, STORES.ios) +
        badge("Google Play", "Get it on", playGlyph, STORES.android) +
      "</div>" +
      "<div id='rwBadgeMsg' style='text-align:center;color:" + MUTED + ";font-size:.82rem;margin-top:8px;min-height:14px'></div>" +
      (APK_URL ? "<div style='text-align:center;margin-top:6px'><a href='" + APK_URL + "' download style='color:" + GREEN + ";font-size:.86rem;font-weight:600;text-decoration:none;border-bottom:1px solid " + LINE + "'>Download the Android app directly (.apk)</a></div>" : "") +
    "</div>";

  badgeBox.addEventListener("click", function (e) {
    var a = e.target.closest ? e.target.closest(".rw-badge") : null;
    if (!a) return;
    if (a.getAttribute("data-live") === "0") {
      e.preventDefault();
      document.getElementById("rwBadgeMsg").textContent = "Coming soon to the " + a.getAttribute("data-store") + ".";
    }
  });
})();

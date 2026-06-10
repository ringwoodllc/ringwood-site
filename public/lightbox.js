/* Ringwood lightbox: tap any photo to see it large.
   Mark an <img> with class "zoomable" (or a data-lb="<url>") and it opens in a
   full-screen overlay. Tap the backdrop, the ×, or press Esc to close. There is
   also an "Open in new tab" link for true full-browser zoom. */
(function () {
  // Cursor hint for zoomable photos.
  var st = document.createElement("style");
  st.textContent = "img.zoomable,[data-lb]{cursor:zoom-in}";
  document.head.appendChild(st);

  function ensureOverlay() {
    var o = document.getElementById("rw-lightbox");
    if (o) return o;
    o = document.createElement("div");
    o.id = "rw-lightbox";
    o.style.cssText =
      "position:fixed;inset:0;background:rgba(20,25,22,.93);display:none;align-items:center;justify-content:center;z-index:9999;padding:24px;cursor:zoom-out";
    o.innerHTML =
      "<img alt='' style='max-width:100%;max-height:100%;object-fit:contain;border-radius:6px;box-shadow:0 12px 48px rgba(0,0,0,.55)' />" +
      "<button type='button' aria-label='Close' style='position:absolute;top:16px;right:18px;width:42px;height:42px;border-radius:999px;border:none;background:rgba(246,242,232,.16);color:#f6f2e8;font-size:24px;line-height:1;cursor:pointer'>×</button>" +
      "<a class='rw-lb-open' target='_blank' rel='noopener' style='position:absolute;bottom:18px;left:50%;transform:translateX(-50%);color:#f6f2e8;font-size:.85rem;text-decoration:none;border-bottom:1px solid rgba(246,242,232,.55);padding-bottom:1px'>Open in new tab ↗</a>";
    document.body.appendChild(o);
    function close() { o.style.display = "none"; o.querySelector("img").src = ""; }
    o.addEventListener("click", function (e) {
      // Close on backdrop or × ; let the "open in new tab" link work normally.
      if (e.target === o || e.target.tagName === "BUTTON") close();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && o.style.display !== "none") close();
    });
    o._close = close;
    return o;
  }

  window.openLightbox = function (src) {
    if (!src) return;
    var o = ensureOverlay();
    o.querySelector("img").src = src;
    o.querySelector(".rw-lb-open").href = src;
    o.style.display = "flex";
  };

  // Capture phase so a photo opens the viewer even if it sits inside a row that
  // has its own click handler.
  document.addEventListener("click", function (e) {
    var el = e.target;
    if (el && el.tagName === "IMG" && (el.classList.contains("zoomable") || el.hasAttribute("data-lb"))) {
      e.preventDefault();
      e.stopPropagation();
      window.openLightbox(el.getAttribute("data-lb") || el.currentSrc || el.src);
    }
  }, true);
})();

/* Native camera bridge.
   On the web / PWA this does nothing — the existing file inputs already open the
   camera. Inside the Capacitor native app it adds a "Take photo" button next to
   each photo input that calls the real native Camera plugin, then feeds the
   result back through the page's own file-change handler. So every capture flow
   (tickets, assets, service) gets a native capture with no page-specific code. */
(function () {
  function isNative() {
    return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === "function" && window.Capacitor.isNativePlatform());
  }
  if (!isNative()) return; // web / PWA: leave the normal file inputs alone

  function camera() {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Camera;
  }

  // Capture one photo natively -> { dataUrl, contentType }.
  function takePhoto() {
    var C = camera();
    if (!C) return Promise.reject(new Error("Camera plugin not available."));
    return C.getPhoto({ quality: 82, allowEditing: false, resultType: "base64", source: "CAMERA", saveToGallery: false })
      .then(function (photo) {
        var ct = "image/" + (photo.format || "jpeg");
        return { dataUrl: "data:" + ct + ";base64," + photo.base64String, contentType: ct };
      });
  }

  // Push a captured photo into a file input so the page handles it normally.
  function feedInput(input, dataUrl, contentType) {
    return fetch(dataUrl).then(function (r) { return r.blob(); }).then(function (blob) {
      var file = new File([blob], "photo.jpg", { type: contentType });
      try {
        var dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (e) {
        // Older WebViews: fall back to a custom event the page can opt into.
        input.dispatchEvent(new CustomEvent("rw-native-photo", { bubbles: true, detail: { file: file } }));
      }
    });
  }

  function enhance(input) {
    if (input.__rwNative) return;
    input.__rwNative = true;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "📷 Take photo";
    btn.style.cssText = "display:inline-block;margin-top:8px;background:var(--green,#2f5d50);color:#f6f2e8;border:none;border-radius:999px;padding:9px 16px;font:inherit;font-size:.9rem;font-weight:600;cursor:pointer";
    btn.addEventListener("click", function () {
      btn.disabled = true;
      takePhoto()
        .then(function (p) { return feedInput(input, p.dataUrl, p.contentType); })
        .catch(function () {})
        .then(function () { btn.disabled = false; });
    });
    input.insertAdjacentElement("afterend", btn);
  }

  function scan() {
    var inputs = document.querySelectorAll('input[type=file]');
    for (var i = 0; i < inputs.length; i++) {
      var a = (inputs[i].getAttribute("accept") || "").toLowerCase();
      if (a.indexOf("image") >= 0 || a === "") enhance(inputs[i]);
    }
  }

  // Inputs are often rendered later (editors open on demand), so keep watching.
  if (document.readyState !== "loading") scan();
  document.addEventListener("DOMContentLoaded", scan);
  var mo = new MutationObserver(scan);
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();

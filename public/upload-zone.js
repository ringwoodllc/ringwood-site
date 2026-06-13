/* Shared uploader behavior so every "scan / add files" control works the same:
   drag-drop, paste (Ctrl/Cmd+V), and tap-to-choose. The tap path is the page's
   own hidden file input; this adds drag-drop onto a zone and clipboard paste.

   RWUploadZone(zoneEl, onFiles) — onFiles receives an array of File objects.
   Paste only fires while the zone is on screen. Highlights the zone on drag. */
(function () {
  function wire(zone, onFiles) {
    if (!zone || zone.__rwwired) return;
    zone.__rwwired = 1;
    var base = zone.style.outline;
    function hi(on) { zone.style.outline = on ? "2px dashed var(--green, #2f5d50)" : base; zone.style.outlineOffset = on ? "2px" : ""; }
    ["dragenter", "dragover"].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); hi(true); });
    });
    ["dragleave", "dragend"].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); hi(false); });
    });
    zone.addEventListener("drop", function (e) {
      e.preventDefault(); e.stopPropagation(); hi(false);
      var fs = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []);
      if (fs.length) onFiles(fs);
    });
    document.addEventListener("paste", function (e) {
      if (!document.body.contains(zone)) return;          // only while this zone is live
      var items = (e.clipboardData && e.clipboardData.items) || [], fs = [];
      for (var i = 0; i < items.length; i++) { if (items[i].kind === "file") { var f = items[i].getAsFile(); if (f) fs.push(f); } }
      if (fs.length) { e.preventDefault(); onFiles(fs); }
    });
  }
  window.RWUploadZone = wire;
})();

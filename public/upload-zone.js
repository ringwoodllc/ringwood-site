/* Shared uploader behavior so every "scan / add files" control works the same:
   drag-drop, paste (Ctrl/Cmd+V), and tap-to-choose (the page's own hidden input).

   RWUploadZone(zoneEl, onFiles) — onFiles receives an array of File objects.

   Paste routing: a page can have several zones (e.g. a ticket has vendor quotes
   and parts). To avoid one paste landing in all of them, paste goes to the zone
   the pointer is currently over. If a page has only ONE zone, paste works anywhere
   (no need to hover first). */
(function () {
  var zones = [];   // every wired zone, for the single-zone-global case
  var hot = null;   // the zone the pointer is over right now

  function filesFrom(e) {
    var items = (e.clipboardData && e.clipboardData.items) || [], fs = [];
    for (var i = 0; i < items.length; i++) { if (items[i].kind === "file") { var f = items[i].getAsFile(); if (f) fs.push(f); } }
    return fs;
  }
  document.addEventListener("paste", function (e) {
    var target = hot || (zones.length === 1 ? zones[0] : null);
    if (!target || !document.body.contains(target.el)) return;
    var fs = filesFrom(e);
    if (fs.length) { e.preventDefault(); target.onFiles(fs); }
  });

  function wire(zone, onFiles) {
    if (!zone || zone.__rwwired) return;
    zone.__rwwired = 1;
    var rec = { el: zone, onFiles: onFiles };
    zones.push(rec);
    var base = zone.style.outline;
    function hi(on) { zone.style.outline = on ? "2px dashed var(--green, #2f5d50)" : base; zone.style.outlineOffset = on ? "2px" : ""; }
    zone.addEventListener("mouseenter", function () { hot = rec; });
    zone.addEventListener("mouseleave", function () { if (hot === rec) hot = null; });
    ["dragenter", "dragover"].forEach(function (ev) { zone.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); hi(true); }); });
    ["dragleave", "dragend"].forEach(function (ev) { zone.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); hi(false); }); });
    zone.addEventListener("drop", function (e) {
      e.preventDefault(); e.stopPropagation(); hi(false);
      var fs = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []);
      if (fs.length) onFiles(fs);
    });
  }
  window.RWUploadZone = wire;
})();

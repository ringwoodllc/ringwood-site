/* Ringwood card cropper. A small modal to drag-adjust the crop of a scanned
   business card or quote before it's saved. Shared by the ticket new-vendor
   panel and the /vendors add form.

   RWCardCrop.open(file, crop, onDone)
     file   : the original File (image)
     crop   : { x, y, w, h } in fractions 0..1 (the AI's box), or null for full
     onDone : function(dataUrl, cropFractions) — called on "Use crop" / "Whole image".
              Not called if cancelled.
   Caps the output to 1200px on the long edge, JPEG quality 0.85. */
(function () {
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function cropToDataUrl(img, fr) {
    var nw = img.naturalWidth, nh = img.naturalHeight;
    var sx = fr.x * nw, sy = fr.y * nh, sw = fr.w * nw, sh = fr.h * nh;
    var scale = Math.min(1, 1200 / Math.max(sw, sh, 1));
    var ow = Math.max(1, Math.round(sw * scale)), oh = Math.max(1, Math.round(sh * scale));
    var cv = document.createElement("canvas"); cv.width = ow; cv.height = oh;
    cv.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, ow, oh);
    return cv.toDataURL("image/jpeg", 0.85);
  }

  function open(file, crop, onDone) {
    if (!file) return;
    var img = new Image();
    img.onload = function () {
      var nw = img.naturalWidth, nh = img.naturalHeight;
      var maxW = Math.min(window.innerWidth * 0.92, 560);
      var maxH = window.innerHeight * 0.62;
      var s = Math.min(maxW / nw, maxH / nh, 1);
      var dw = Math.round(nw * s), dh = Math.round(nh * s);

      var ov = document.createElement("div");
      ov.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(20,22,20,.82);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;" +
        "padding:calc(16px + env(safe-area-inset-top)) calc(16px + env(safe-area-inset-right)) calc(16px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left));" +
        "-webkit-user-select:none;user-select:none;touch-action:none";

      var hint = document.createElement("div");
      hint.textContent = "Drag the box to frame the card. Drag a corner to resize.";
      hint.style.cssText = "color:#f6f2e8;font:500 .92rem/1.4 system-ui,sans-serif;text-align:center;max-width:560px";

      var stage = document.createElement("div");
      stage.style.cssText = "position:relative;width:" + dw + "px;height:" + dh + "px;box-shadow:0 8px 40px rgba(0,0,0,.5)";
      var im = document.createElement("img");
      im.src = img.src; im.style.cssText = "width:100%;height:100%;display:block;border-radius:4px";
      stage.appendChild(im);

      var box = document.createElement("div");
      box.style.cssText = "position:absolute;border:2px solid #f6f2e8;box-shadow:0 0 0 9999px rgba(20,22,20,.45);cursor:move;box-sizing:border-box";
      stage.appendChild(box);

      var c = crop && crop.w ? crop : { x: 0, y: 0, w: 1, h: 1 };
      var bx = clamp(c.x, 0, 1) * dw, by = clamp(c.y, 0, 1) * dh;
      var bw = clamp(c.w, 0.05, 1) * dw, bh = clamp(c.h, 0.05, 1) * dh;
      if (bx + bw > dw) bw = dw - bx; if (by + bh > dh) bh = dh - by;

      function paint() { box.style.left = bx + "px"; box.style.top = by + "px"; box.style.width = bw + "px"; box.style.height = bh + "px"; }
      paint();

      var handles = [["nw", 0, 0], ["ne", 1, 0], ["sw", 0, 1], ["se", 1, 1]];
      handles.forEach(function (h) {
        var el = document.createElement("div");
        el.dataset.h = h[0];
        el.style.cssText = "position:absolute;width:22px;height:22px;border-radius:50%;background:#f6f2e8;border:2px solid #21443a;" +
          (h[1] ? "right:-11px;" : "left:-11px;") + (h[2] ? "bottom:-11px;" : "top:-11px;") + "cursor:" + h[0] + "-resize;touch-action:none";
        box.appendChild(el);
      });

      var MIN = 40, mode = null, sxp = 0, syp = 0, sbx = 0, sby = 0, sbw = 0, sbh = 0;
      function pt(e) { return e.touches && e.touches[0] ? e.touches[0] : e; }
      function down(e) {
        var t = e.target, p = pt(e);
        mode = t.dataset && t.dataset.h ? t.dataset.h : "move";
        sxp = p.clientX; syp = p.clientY; sbx = bx; sby = by; sbw = bw; sbh = bh;
        e.preventDefault(); e.stopPropagation();
        document.addEventListener("pointermove", move); document.addEventListener("pointerup", up);
      }
      function move(e) {
        if (!mode) return;
        var p = pt(e), dx = p.clientX - sxp, dy = p.clientY - syp;
        if (mode === "move") {
          bx = clamp(sbx + dx, 0, dw - bw); by = clamp(sby + dy, 0, dh - bh);
        } else {
          var east = mode.indexOf("e") >= 0, south = mode.indexOf("s") >= 0;
          if (east) { bw = clamp(sbw + dx, MIN, dw - sbx); }
          else { var nx = clamp(sbx + dx, 0, sbx + sbw - MIN); bw = sbw + (sbx - nx); bx = nx; }
          if (south) { bh = clamp(sbh + dy, MIN, dh - sby); }
          else { var ny = clamp(sby + dy, 0, sby + sbh - MIN); bh = sbh + (sby - ny); by = ny; }
        }
        paint();
      }
      function up() { mode = null; document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); }
      box.addEventListener("pointerdown", down);

      var bar = document.createElement("div");
      bar.style.cssText = "display:flex;gap:10px;flex-wrap:wrap;justify-content:center";
      function btn(label, primary) {
        var b = document.createElement("button");
        b.type = "button"; b.textContent = label;
        b.style.cssText = "font:600 .92rem system-ui,sans-serif;padding:11px 16px;border-radius:8px;cursor:pointer;border:1px solid " +
          (primary ? "#21443a;background:#2f5d50;color:#f6f2e8" : "rgba(246,242,232,.5);background:transparent;color:#f6f2e8");
        return b;
      }
      var useB = btn("Use crop", true), fullB = btn("Whole image"), cancelB = btn("Cancel");
      bar.appendChild(useB); bar.appendChild(fullB); bar.appendChild(cancelB);

      function close() { try { document.body.removeChild(ov); } catch (e) {} }
      useB.addEventListener("click", function () { var fr = { x: bx / dw, y: by / dh, w: bw / dw, h: bh / dh }; close(); onDone(cropToDataUrl(img, fr), fr); });
      fullB.addEventListener("click", function () { var fr = { x: 0, y: 0, w: 1, h: 1 }; close(); onDone(cropToDataUrl(img, fr), fr); });
      cancelB.addEventListener("click", close);
      ov.addEventListener("click", function (e) { if (e.target === ov) close(); });

      ov.appendChild(hint); ov.appendChild(stage); ov.appendChild(bar);
      document.body.appendChild(ov);
    };
    img.onerror = function () {};
    img.src = URL.createObjectURL(file);
  }

  window.RWCardCrop = { open: open, cropToDataUrl: cropToDataUrl };
})();

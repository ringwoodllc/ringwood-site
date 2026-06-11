/* RWPDF: a tiny client-side PDF writer for Ringwood reports.
   Why hand-rolled: the worker has no server-side renderer and this environment
   can't pull a vendored library, and our reports only need wrapped text, a few
   colors, section bars, and JPEG photos. Uses the built-in Helvetica fonts
   (nothing embedded) and DCTDecode for images, so files stay small.
   Text is sanitized to Latin-1; width-based wrapping is approximate. */
(function () {
  function RWPDF() {
    var W = 612, H = 792, M = 40;            // US Letter, 40pt margins
    var pages = [], images = [], cur = null, y = M;

    function clean(s) {
      s = (s == null ? "" : String(s));
      s = s.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"')
           .replace(/[–—]/g, "-").replace(/≥/g, ">=").replace(/≤/g, "<=")
           .replace(/[×✕✖]/g, "x").replace(/…/g, "...").replace(/·/g, "\xB7");
      var o = "";
      for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        o += (c === 10 || c === 13) ? " " : (c < 32 ? " " : (c <= 255 ? s.charAt(i) : "?"));
      }
      return o;
    }
    function escp(s) { return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)"); }
    function col(c) { c = c || [0, 0, 0]; return c[0] + " " + c[1] + " " + c[2] + " rg"; }

    function newPage() { cur = { c: [] }; pages.push(cur); y = M; }
    newPage();
    function need(h) { if (y + h > H - M) newPage(); }
    function drawLine(x, yTop, str, o) {
      o = o || {};
      var size = o.size || 10;
      cur.c.push(col(o.color) + " BT /" + (o.bold ? "F2" : "F1") + " " + size + " Tf 1 0 0 1 " + x + " " + (H - yTop - size) + " Tm (" + escp(clean(str)) + ") Tj ET");
    }
    function wrapText(str, size, maxW, bold) {
      str = clean(str);
      var cw = size * (bold ? 0.55 : 0.5);             // approximate Helvetica advance
      var maxC = Math.max(6, Math.floor(maxW / cw));
      var words = str.split(" "), lines = [], curL = "";
      words.forEach(function (w) {
        while (w.length > maxC) { if (curL) { lines.push(curL); curL = ""; } lines.push(w.slice(0, maxC)); w = w.slice(maxC); }
        var t = curL ? curL + " " + w : w;
        if (t.length > maxC) { lines.push(curL); curL = w; } else curL = t;
      });
      if (curL) lines.push(curL);
      return lines.length ? lines : [""];
    }
    // Wrapped paragraph at the cursor; advances y, breaking pages as needed.
    function text(str, o) {
      o = o || {};
      var x = o.x != null ? o.x : M, size = o.size || 10;
      var lh = o.lh || Math.round(size * 1.4), maxW = o.maxW != null ? o.maxW : (W - M - x);
      var lines = wrapText(str, size, maxW, o.bold);
      lines.forEach(function (L) { need(lh); drawLine(x, y, L, o); y += lh; });
      return lines.length;
    }
    // Full-width section bar with white bold text.
    function bar(str, o) {
      o = o || {};
      var h = o.h || 20, size = o.size || 12;
      need(h + 8);
      cur.c.push((o.bg ? o.bg.join(" ") : "0.13 0.27 0.23") + " rg " + M + " " + (H - y - h) + " " + (W - 2 * M) + " " + h + " re f");
      drawLine(M + 8, y + (h - size) / 2, str, { size: size, bold: true, color: o.fg || [1, 1, 1] });
      y += h + 8;
    }
    function rule() {
      need(8);
      cur.c.push("0.82 0.8 0.76 RG 0.5 w " + M + " " + (H - y) + " m " + (W - M) + " " + (H - y) + " l S");
      y += 6;
    }
    // JPEG image (base64 without data: prefix). Scales to maxH, advances y.
    function image(b64, w, h, maxH, o) {
      o = o || {};
      if (!b64 || !w || !h) return;
      var dh = Math.min(maxH || 110, h), dw = w * dh / h;
      var x = o.x != null ? o.x : M, avail = W - M - x;
      if (dw > avail) { dw = avail; dh = h * dw / w; }
      need(dh + 6);
      var bytes;
      try { var bin = atob(b64); bytes = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); }
      catch (e) { return; }
      var name = "Im" + (images.length + 1);
      images.push({ name: name, bytes: bytes, w: w, h: h });
      cur.c.push("q " + dw.toFixed(2) + " 0 0 " + dh.toFixed(2) + " " + x + " " + (H - y - dh).toFixed(2) + " cm /" + name + " Do Q");
      y += dh + 6;
    }

    function output() {
      var parts = [], len = 0, off = {};
      function push(p) { parts.push(p); len += p.length; }
      function obj(id, fn) { off[id] = len; push(id + " 0 obj\n"); fn(); push("endobj\n"); }
      push("%PDF-1.4\n");
      var nPages = pages.length;
      var imgBase = 5;                          // 1 catalog, 2 pages, 3 F1, 4 F2
      var pageBase = imgBase + images.length;
      var maxId = pageBase + 2 * nPages - 1;
      obj(1, function () { push("<</Type/Catalog/Pages 2 0 R>>\n"); });
      obj(2, function () {
        var kids = [];
        for (var i = 0; i < nPages; i++) kids.push((pageBase + 2 * i + 1) + " 0 R");
        push("<</Type/Pages/Kids[" + kids.join(" ") + "]/Count " + nPages + ">>\n");
      });
      obj(3, function () { push("<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>\n"); });
      obj(4, function () { push("<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>\n"); });
      images.forEach(function (im, i) {
        obj(imgBase + i, function () {
          push("<</Type/XObject/Subtype/Image/Width " + im.w + "/Height " + im.h + "/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length " + im.bytes.length + ">>\nstream\n");
          push(im.bytes);
          push("\nendstream\n");
        });
      });
      var xo = images.map(function (im, i) { return "/" + im.name + " " + (imgBase + i) + " 0 R"; }).join("");
      pages.forEach(function (p, i) {
        var cs = p.c.join("\n");
        obj(pageBase + 2 * i, function () { push("<</Length " + cs.length + ">>\nstream\n" + cs + "\nendstream\n"); });
        obj(pageBase + 2 * i + 1, function () {
          push("<</Type/Page/Parent 2 0 R/MediaBox[0 0 " + W + " " + H + "]/Resources<</Font<</F1 3 0 R/F2 4 0 R>>" + (xo ? "/XObject<<" + xo + ">>" : "") + ">>/Contents " + (pageBase + 2 * i) + " 0 R>>\n");
        });
      });
      var xref = len;
      push("xref\n0 " + (maxId + 1) + "\n0000000000 65535 f \n");
      for (var id = 1; id <= maxId; id++) push(("0000000000" + (off[id] || 0)).slice(-10) + " 00000 n \n");
      push("trailer\n<</Size " + (maxId + 1) + "/Root 1 0 R>>\nstartxref\n" + xref + "\n%%EOF");
      var total = 0;
      parts.forEach(function (p) { total += p.length; });
      var out = new Uint8Array(total), pos = 0;
      parts.forEach(function (p) {
        if (typeof p === "string") { for (var i = 0; i < p.length; i++) out[pos++] = p.charCodeAt(i) & 255; }
        else { out.set(p, pos); pos += p.length; }
      });
      return out;
    }

    return {
      text: text, bar: bar, rule: rule, image: image, need: need, output: output,
      lineAt: function (x, str, o) { drawLine(x, y, str, o); },
      move: function (d) { y += d; },
      getY: function () { return y; },
      width: W, margin: M
    };
  }
  window.RWPDF = RWPDF;
})();

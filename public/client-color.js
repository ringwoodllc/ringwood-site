/* A stable color per client name, so the same client looks the same everywhere.
   Keep this palette + hash identical to the worker (CLIENT_PALETTE/hashColor).
   The master can assign a specific color per client; where that color is known
   the server sends it on each row, so this is the fallback for the name only. */
(function () {
  var P = ["#2f5d50", "#a9633a", "#3a5a7a", "#6b4a6e", "#2f6d62", "#8a5a2a", "#556b2f", "#7a3550", "#455a64", "#9a6a1a"];
  window.CLIENT_PALETTE = P;
  window.clientColor = function (name) {
    var s = (name || "").toLowerCase(), h = 0;
    for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
    return s ? P[h % P.length] : "#21443a";
  };
})();

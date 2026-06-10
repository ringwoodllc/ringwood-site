/* A stable color per client name, so the same client looks the same everywhere.
   All colors are dark enough for the light chip text. */
(function () {
  var P = ["#2f5d50", "#a9633a", "#3a5a7a", "#6b4a6e", "#2f6d62", "#8a5a2a", "#556b2f", "#7a3550", "#455a64", "#9a6a1a"];
  window.clientColor = function (name) {
    var s = (name || "").toLowerCase(), h = 0;
    for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
    return s ? P[h % P.length] : "#21443a";
  };
})();

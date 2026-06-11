/* Ringwood shared client picker for master screens.
   Pins a handful of clients as one-tap chips and remembers the last one you
   used, so you don't re-pick from the dropdown every visit. Pins and the last
   selection are stored per-browser in localStorage and shared across every
   screen that mounts this (Temp Log, Red Book, ...). The full dropdown stays
   for the long tail. */
(function () {
  var PIN_KEY = "rw_pinned_clients", LAST_KEY = "rw_last_client";
  function loadJSON(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function getPins() { var a = loadJSON(PIN_KEY); return Array.isArray(a) ? a : []; }
  function setPins(a) { saveJSON(PIN_KEY, a); }
  function getLast() { try { return localStorage.getItem(LAST_KEY) || ""; } catch (e) { return ""; } }
  function setLast(v) { try { localStorage.setItem(LAST_KEY, v || ""); } catch (e) {} }
  function esc(s) { return (s || "").toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }

  var styled = false;
  function ensureStyle() {
    if (styled) return; styled = true;
    var css =
      ".rwcp{margin:0 0 10px}" +
      ".rwcp-chips{display:flex;flex-wrap:wrap;gap:7px;align-items:center}" +
      ".rwcp-chip{display:inline-flex;align-items:center;gap:5px;cursor:pointer;font:inherit;font-size:.86rem;font-weight:600;border-radius:999px;padding:6px 13px;border:1px solid var(--line,rgba(35,40,42,.14));background:var(--bg,#f4efe4);color:var(--green-deep,#21443a)}" +
      ".rwcp-chip:hover{border-color:var(--green,#2f5d50)}" +
      ".rwcp-chip.on{background:var(--green,#2f5d50);color:#f6f2e8;border-color:var(--green,#2f5d50)}" +
      ".rwcp-chip.pin.pinned{background:rgba(47,93,80,.14);border-color:var(--green,#2f5d50)}" +
      ".rwcp-edit{background:transparent;border:1px dashed var(--line,rgba(35,40,42,.14));color:var(--muted,#5f5d52);border-radius:999px;padding:6px 12px;font:inherit;font-size:.82rem;font-weight:600;cursor:pointer}" +
      ".rwcp-edit:hover{border-color:var(--green,#2f5d50);color:var(--green-deep,#21443a)}" +
      ".rwcp-hint{color:var(--muted,#5f5d52);font-size:.8rem;margin-top:6px}" +
      ".rwcp-more{margin-top:8px}";
    var s = document.createElement("style"); s.textContent = css; document.head.appendChild(s);
  }

  // opts: { selectEl, clients:[name], placeholder, onPick(name) }
  function mount(opts) {
    ensureStyle();
    var sel = opts.selectEl, clients = opts.clients || [], onPick = opts.onPick || function () {};
    var placeholder = opts.placeholder || "Select a client…";
    sel.innerHTML = "<option value=''>" + esc(placeholder) + "</option>" +
      clients.map(function (c) { return "<option>" + esc(c) + "</option>"; }).join("");

    var box = document.createElement("div"); box.className = "rwcp";
    sel.parentNode.insertBefore(box, sel);
    var moreWrap = document.createElement("div"); moreWrap.className = "rwcp-more";
    sel.parentNode.insertBefore(moreWrap, sel); moreWrap.appendChild(sel);

    var current = "", editMode = false;

    function pick(name, remember) {
      current = name || "";
      sel.value = current;
      if (remember !== false) setLast(current);
      renderChips();
      onPick(current);
    }

    function renderChips() {
      var pins = getPins().filter(function (p) { return clients.indexOf(p) >= 0; });
      var html;
      if (editMode) {
        html = '<div class="rwcp-chips">' +
          clients.map(function (c) {
            var on = pins.indexOf(c) >= 0;
            return '<button type="button" class="rwcp-chip pin' + (on ? " pinned" : "") + '" data-pin="' + esc(c) + '">' + (on ? "★ " : "☆ ") + esc(c) + "</button>";
          }).join("") +
          '<button type="button" class="rwcp-edit" data-done="1">Done</button>' +
          '</div><div class="rwcp-hint">Tap a client to pin or unpin it. Pinned clients show as one-tap chips.</div>';
      } else {
        var chips = pins.map(function (c) {
          return '<button type="button" class="rwcp-chip' + (c === current ? " on" : "") + '" data-client="' + esc(c) + '">' + esc(c) + "</button>";
        }).join("");
        html = '<div class="rwcp-chips">' + chips +
          '<button type="button" class="rwcp-edit" data-edit="1">' + (pins.length ? "✎ Pins" : "☆ Pin clients") + "</button></div>";
        if (!pins.length) html += '<div class="rwcp-hint">Pin the clients you use most for one-tap switching.</div>';
      }
      box.innerHTML = html;
      Array.prototype.slice.call(box.querySelectorAll("[data-client]")).forEach(function (b) {
        b.addEventListener("click", function () { pick(b.getAttribute("data-client"), true); });
      });
      Array.prototype.slice.call(box.querySelectorAll("[data-pin]")).forEach(function (b) {
        b.addEventListener("click", function () {
          var name = b.getAttribute("data-pin"), p = getPins(), i = p.indexOf(name);
          if (i >= 0) p.splice(i, 1); else p.push(name);
          setPins(p); renderChips();
        });
      });
      var ed = box.querySelector("[data-edit]"); if (ed) ed.addEventListener("click", function () { editMode = true; renderChips(); });
      var dn = box.querySelector("[data-done]"); if (dn) dn.addEventListener("click", function () { editMode = false; renderChips(); });
    }

    sel.addEventListener("change", function () { pick(sel.value, true); });
    renderChips();

    var last = getLast();
    if (last && clients.indexOf(last) >= 0) pick(last, false);
    else onPick("");
  }

  window.RWClientPins = { mount: mount, getLast: getLast };
})();

/* Ringwood shared client picker for master screens.
   Pins a handful of clients as one-tap chips and remembers the last one you
   used, so you don't re-pick from the dropdown every visit. Pins and the last
   selection are stored per-browser in localStorage and shared across every
   screen (Temp Log, Red Book, ticket list, service records, asset entry).

   Two ways to use it:
     mount(opts)  - the component owns the <select> and fills it. For simple
                    "pick a client to view" pages (Temp Log, Red Book).
     attach(opts) - the page keeps its own <select> (counts, colors, "All
                    clients", add-client). The component only adds the chip bar,
                    remembers the choice, and drives the select via a change
                    event. Returns { refresh } to re-read options after a rebuild.
*/
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

  // Default to pick when the screen opens: your last choice if it still exists,
  // otherwise your first pinned client. That's what makes a pin act as a default.
  function defaultFor(clients) {
    var last = getLast();
    if (last && clients.indexOf(last) >= 0) return last;
    var pins = getPins().filter(function (p) { return clients.indexOf(p) >= 0; });
    return pins[0] || "";
  }

  // Build the chip bar UI. getCurrent()/getClients() are read live so the same
  // bar works whether the client list is fixed (mount) or rebuilt (attach).
  function makeChips(box, getClients, getCurrent, onChoose) {
    var editMode = false;
    function render() {
      var clients = getClients(), current = getCurrent();
      var pins = getPins().filter(function (p) { return clients.indexOf(p) >= 0; });
      var html;
      if (editMode) {
        html = '<div class="rwcp-chips">' +
          clients.map(function (c) {
            var on = pins.indexOf(c) >= 0;
            return '<button type="button" class="rwcp-chip pin' + (on ? " pinned" : "") + '" data-pin="' + esc(c) + '">' + (on ? "★ " : "☆ ") + esc(c) + "</button>";
          }).join("") +
          '<button type="button" class="rwcp-edit" data-done="1">Done</button>' +
          '</div><div class="rwcp-hint">Tap a client to pin or unpin it. Pinned clients show as one-tap chips here and on every screen.</div>';
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
        b.addEventListener("click", function () { onChoose(b.getAttribute("data-client")); });
      });
      Array.prototype.slice.call(box.querySelectorAll("[data-pin]")).forEach(function (b) {
        b.addEventListener("click", function () {
          var name = b.getAttribute("data-pin"), p = getPins(), i = p.indexOf(name);
          if (i >= 0) p.splice(i, 1); else p.push(name);
          setPins(p); render();
        });
      });
      var ed = box.querySelector("[data-edit]"); if (ed) ed.addEventListener("click", function () { editMode = true; render(); });
      var dn = box.querySelector("[data-done]"); if (dn) dn.addEventListener("click", function () { editMode = false; render(); });
    }
    return render;
  }

  // mount: { selectEl, clients:[name], placeholder, onPick(name) }
  function mount(opts) {
    ensureStyle();
    var sel = opts.selectEl, clients = opts.clients || [], onPick = opts.onPick || function () {};
    sel.innerHTML = "<option value=''>" + esc(opts.placeholder || "Select a client…") + "</option>" +
      clients.map(function (c) { return "<option>" + esc(c) + "</option>"; }).join("");

    var box = document.createElement("div"); box.className = "rwcp";
    sel.parentNode.insertBefore(box, sel);
    var moreWrap = document.createElement("div"); moreWrap.className = "rwcp-more";
    sel.parentNode.insertBefore(moreWrap, sel); moreWrap.appendChild(sel);

    var current = "";
    function pick(name, remember) {
      current = name || ""; sel.value = current;
      if (remember !== false) setLast(current);
      renderChips(); onPick(current);
    }
    var renderChips = makeChips(box, function () { return clients; }, function () { return current; }, function (n) { pick(n, true); });

    sel.addEventListener("change", function () { pick(sel.value, true); });
    renderChips();

    var def = defaultFor(clients);
    if (def) pick(def, true); else onPick("");
  }

  // attach: { selectEl, exclude:[values] } — page owns the options.
  // Returns { refresh } so the page can re-read options after rebuilding them.
  function attach(opts) {
    ensureStyle();
    var sel = opts.selectEl, exclude = opts.exclude || [];
    function clientsNow() {
      var out = [];
      Array.prototype.slice.call(sel.options).forEach(function (o) {
        if (!o.value) return;                       // placeholder / "All clients"
        if (o.value.indexOf("__") === 0) return;    // __add / __unassigned
        if (exclude.indexOf(o.value) >= 0) return;
        out.push(o.value);
      });
      return out;
    }
    var box = document.createElement("div"); box.className = "rwcp";
    sel.parentNode.insertBefore(box, sel);

    var renderChips = makeChips(box, clientsNow, function () { return sel.value; }, function (name) {
      sel.value = name;
      if (sel.value === name) { setLast(name); sel.dispatchEvent(new Event("change", { bubbles: true })); }
      renderChips();
    });
    // Keep the pin highlight and remembered default in sync when the user uses
    // the dropdown directly (don't re-dispatch — the page already handled it).
    sel.addEventListener("change", function () { setLast(sel.value); renderChips(); });
    renderChips();

    var restored = false;
    function refresh() {
      renderChips();
      if (restored) return;
      var clients = clientsNow();
      if (!clients.length) return;                  // options not loaded yet
      var def = defaultFor(clients);
      restored = true;
      if (def && sel.value !== def) {
        sel.value = def;
        if (sel.value === def) { setLast(def); sel.dispatchEvent(new Event("change", { bubbles: true })); renderChips(); }
      }
    }
    refresh();
    return { refresh: refresh };
  }

  window.RWClientPins = { mount: mount, attach: attach, getLast: getLast };
})();

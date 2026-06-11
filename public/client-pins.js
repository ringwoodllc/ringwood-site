/* Ringwood shared client picker, driven by the global client context
   (window.RWClient, defined in whoami-badge.js and set from the header chip).
     - 0 active  -> normal picker (all clients / page default).
     - 1 active  -> scoped to that client; the picker hides and the form files
                    for it automatically ("you're the admin for <client>").
     - 2+ active -> picker shows but is limited to just those clients.
   Two entry points, kept from before so pages don't change:
     mount(opts)  - the component owns and fills the <select> (food-safety pages).
     attach(opts) - the page owns its <select> options (filters, create forms);
                    we set/limit/hide it and return { refresh } to re-apply. */
(function () {
  function active() { try { return (window.RWClient && window.RWClient.active) ? window.RWClient.active() : []; } catch (e) { return []; } }
  function esc(s) { return (s || "").toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function wrapOf(sel, custom) {
    if (custom) { var w = document.querySelector(custom); if (w) return w; }
    if (sel.closest) { var c = sel.closest("#clientPick, #clientWrap, .field, .f"); if (c) return c; }
    return sel.parentNode || sel;
  }

  // mount: we control the <select>'s options.
  function mount(opts) {
    var sel = opts.selectEl, clients = opts.clients || [], onPick = opts.onPick || function () {};
    var placeholder = opts.placeholder || "Select a client…";
    var act = active().filter(function (c) { return clients.indexOf(c) >= 0; });
    var wrap = wrapOf(sel, opts.wrap);
    function fill(list, ph) { sel.innerHTML = (ph ? "<option value=''>" + esc(placeholder) + "</option>" : "") + list.map(function (c) { return "<option>" + esc(c) + "</option>"; }).join(""); }

    if (act.length === 1) {
      fill([act[0]], false); sel.value = act[0];
      if (wrap) wrap.style.display = "none";
      onPick(act[0]);
      return;
    }
    var list = act.length >= 2 ? act : clients;
    fill(list, true);
    if (wrap) wrap.style.display = "";
    sel.addEventListener("change", function () { onPick(sel.value); });
    onPick("");
  }

  // attach: the page already builds the <select> options.
  // opts.hide: "field" hides the select's closest .field (its own client field);
  // otherwise we hide just the <select> and its label (for filters that share a
  // field with another control).
  function attach(opts) {
    var sel = opts.selectEl, exclude = opts.exclude || [];
    function ensureOption(name) {
      for (var i = 0; i < sel.options.length; i++) if (sel.options[i].value === name) return;
      var op = document.createElement("option"); op.value = name; op.textContent = name; sel.appendChild(op);
    }
    function setHidden(hidden) {
      var d = hidden ? "none" : "";
      if (opts.hide === "field" && sel.closest) { var f = sel.closest(".field, .f"); if (f) { f.style.display = d; return; } }
      sel.style.display = d;
      if (sel.id) { var lb = document.querySelector("label[for='" + sel.id + "']"); if (lb) lb.style.display = d; }
    }
    function apply() {
      var act = active();
      Array.prototype.slice.call(sel.options).forEach(function (o) { o.hidden = false; });
      if (act.length === 1) {
        ensureOption(act[0]);
        if (sel.value !== act[0]) { sel.value = act[0]; sel.dispatchEvent(new Event("change", { bubbles: true })); }
        setHidden(true);
      } else if (act.length >= 2) {
        setHidden(false);
        Array.prototype.slice.call(sel.options).forEach(function (o) { if (o.value && o.value.indexOf("__") !== 0 && exclude.indexOf(o.value) < 0) o.hidden = act.indexOf(o.value) < 0; });
        if (sel.value && act.indexOf(sel.value) < 0) { sel.value = ""; sel.dispatchEvent(new Event("change", { bubbles: true })); }
      } else {
        setHidden(false);
      }
    }
    apply();
    return { refresh: apply };
  }

  window.RWClientPins = { mount: mount, attach: attach };
})();

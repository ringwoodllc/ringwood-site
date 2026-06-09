/**
 * Ringwood site Worker.
 *
 * One engine serves the marketing site and the field apps, routed by hostname /
 * path. Data lives in Supabase (Postgres); the Worker talks to it server-side
 * over the Supabase REST API + Storage using SUPABASE_URL and
 * SUPABASE_SERVICE_KEY (never exposed to the browser). Nameplate reading uses
 * Claude via ANTHROPIC_API_KEY.
 */

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const noStore = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

function sbReady(env) {
  return !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const sub = url.hostname.split(".")[0];

    // Login endpoints always reachable. The gate is opt-in: it only enforces
    // when LOGIN_REQUIRED=1 (so you can build/test users first, then lock down).
    if (url.pathname === "/api/login" && request.method === "POST") return login(request, env);
    if (url.pathname === "/api/logout" && request.method === "POST") return logout();
    if (url.pathname === "/api/whoami" && request.method === "GET") return whoami(request, env);
    if (env.LOGIN_REQUIRED === "1" && env.SUPABASE_ANON_KEY && !isPublic(url, sub)) {
      const session = await verifySession(getCookie(request, "rw_session"), env);
      if (!session) {
        if (url.pathname.startsWith("/api/")) return json({ ok: false, error: "Please sign in." }, 401);
        const next = encodeURIComponent(url.pathname + (url.search || ""));
        return Response.redirect(`${url.origin}/login?next=${next}`, 302);
      }
    }

    if (url.pathname === "/api/assets" && request.method === "POST") return handleCreateAsset(request, env, ctx);
    if (url.pathname === "/api/assets/list" && request.method === "GET") return listAssets(env);
    if (url.pathname === "/api/options" && request.method === "GET") return optionsHandler(env);
    if (url.pathname === "/api/diag" && request.method === "GET") return diag(env);
    if (url.pathname === "/api/clients" && request.method === "POST") return createClient(request, env);
    if (url.pathname === "/api/picklist" && request.method === "POST") return createPicklistValue(request, env);
    if (url.pathname === "/api/service/get" && request.method === "GET") return getService(url, env);
    if (url.pathname === "/api/service/update" && request.method === "POST") return updateService(request, env);
    if (url.pathname === "/api/assets/get" && request.method === "GET") return getAsset(url, env);
    if (url.pathname === "/api/asset" && request.method === "GET") return getAssetFull(url, env);
    if (url.pathname === "/api/asset/analyze" && request.method === "POST") return analyzeAsset(request, env);
    if (url.pathname === "/api/asset/update" && request.method === "POST") return updateAsset(request, env);
    if (url.pathname === "/api/asset/verify" && request.method === "POST") return setVerified(request, env);
    if (url.pathname === "/api/service" && request.method === "POST") return createService(request, env, ctx);
    if (url.pathname === "/api/service/list" && request.method === "GET") return listServices(url, env);
    if (url.pathname === "/api/contact" && request.method === "POST") return createContact(request, env);
    if (url.pathname === "/api/categories" && request.method === "GET") return getCategories(env);
    if (url.pathname === "/api/tickets" && request.method === "POST") return createTicket(request, env, ctx);
    if (url.pathname === "/api/tickets/list" && request.method === "GET") return listTickets(url, env);
    if (url.pathname === "/api/tickets/update" && request.method === "POST") return updateTicket(request, env);
    if (url.pathname === "/api/tickets/suggest" && request.method === "POST") return suggestTicket(request, env);

    // Asset view / lookup page (QR target).
    if (url.pathname.startsWith("/a/") && env.ASSETS) return env.ASSETS.fetch(rewrite(url, "/a/", request));
    // Ticket status page.
    if (url.pathname.startsWith("/t/") && env.ASSETS) return env.ASSETS.fetch(rewrite(url, "/ticket-status/", request));

    // Unified app (one install, several buttons): the hub plus path-based
    // sub-apps, all on one origin so navigation stays inside the app. These
    // paths work on any host so the hub's buttons and relative links resolve.
    const APP_PAGES = {
      "/assets": "/assets/",
      "/tickets": "/tickets/",
      "/status": "/ticket-status/",
      "/service": "/service/",
      "/lookup": "/a/",
      "/app": "/app/",
      "/login": "/login/",
      "/signin": "/signin/",
    };
    const cleanPath = url.pathname !== "/" ? url.pathname.replace(/\/+$/, "") : "/";
    if (env.ASSETS && APP_PAGES[cleanPath]) return env.ASSETS.fetch(rewrite(url, APP_PAGES[cleanPath], request));

    // Each app's subdomain serves its form at the root (app. -> the hub).
    if (env.ASSETS && (url.pathname === "/" || url.pathname === "")) {
      if (sub === "app") return env.ASSETS.fetch(rewrite(url, "/app/", request));
      if (sub === "assets") return env.ASSETS.fetch(rewrite(url, "/assets/", request));
      if (sub === "tickets") return env.ASSETS.fetch(rewrite(url, "/tickets/", request));
      if (sub === "service") return env.ASSETS.fetch(rewrite(url, "/service/", request));
      if (sub === "talk" || sub === "contact") return env.ASSETS.fetch(rewrite(url, "/talk/", request));
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
};

function rewrite(url, pathname, request) {
  const u = new URL(url);
  u.pathname = pathname;
  return new Request(u, request);
}

/* ===================== Auth ===================== */

// Paths that never require sign-in.
function isPublic(url, sub) {
  const p = url.pathname;
  if (p === "/login" || p === "/login/" || p === "/signin" || p === "/signin/") return true;
  if (p === "/api/login" || p === "/api/logout" || p === "/api/whoami") return true;
  if (p === "/api/contact" || p === "/api/diag") return true;
  if (p === "/manifest.json" || p.startsWith("/icons/")) return true;
  if (sub === "talk" || sub === "contact") return true; // public contact form
  if (sub === "ringwood" || sub === "www") return true; // marketing site
  return false;
}

function getCookie(request, name) {
  const c = request.headers.get("cookie") || "";
  const m = c.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? m[1] : null;
}

function b64urlBytes(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlStr(str) {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToStr(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return decodeURIComponent(escape(atob(s)));
}

// Sessions are signed by the worker (HMAC) with the service key, so they need
// no extra secret and can be long-lived.
async function hmacSign(data, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64urlBytes(new Uint8Array(sig));
}
async function signSession(payload, env) {
  const body = b64urlStr(JSON.stringify(payload));
  return `${body}.${await hmacSign(body, env.SUPABASE_SERVICE_KEY)}`;
}
async function verifySession(token, env) {
  if (!token || !env.SUPABASE_SERVICE_KEY) return null;
  const i = token.lastIndexOf(".");
  if (i < 1) return null;
  const body = token.slice(0, i);
  const sig = token.slice(i + 1);
  if (sig !== (await hmacSign(body, env.SUPABASE_SERVICE_KEY))) return null;
  let p;
  try {
    p = JSON.parse(b64urlToStr(body));
  } catch {
    return null;
  }
  if (!p.exp || Date.now() / 1000 > p.exp) return null;
  return p;
}

const SESSION_DAYS = 30;
function sessionCookie(value, maxAge) {
  return `rw_session=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=.ringwood.ai; Max-Age=${maxAge}`;
}

async function login(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_KEY) {
    return json({ ok: false, error: "Login isn't configured yet." }, 503);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const email = (body.email || "").toString().trim().toLowerCase();
  const password = (body.password || "").toString();
  if (!email || !password) return json({ ok: false, error: "Enter your email and password." }, 400);
  let r;
  try {
    r = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_ANON_KEY, "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return json({ ok: false, error: "Couldn't reach the login server." }, 502);
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) {
    return json({ ok: false, error: d.error_description || d.msg || "Wrong email or password." }, 401);
  }
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const session = await signSession({ email, exp }, env);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json", "set-cookie": sessionCookie(session, SESSION_DAYS * 86400) },
  });
}

function logout() {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json", "set-cookie": sessionCookie("", 0) },
  });
}

async function whoami(request, env) {
  const s = await verifySession(getCookie(request, "rw_session"), env);
  return json({ ok: !!s, email: s ? s.email : null, required: env.LOGIN_REQUIRED === "1" });
}

/* ===================== Supabase helpers ===================== */

function sbHeaders(env, extra) {
  return Object.assign(
    {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      "content-type": "application/json",
    },
    extra || {}
  );
}

// GET rows. `path` is everything after /rest/v1/ , e.g. "clients?select=name".
async function sbSelect(env, path) {
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders(env) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function sbInsert(env, table, row) {
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: sbHeaders(env, { Prefer: "return=representation" }),
      body: JSON.stringify(row),
    });
    if (!r.ok) return { ok: false, status: r.status, error: await r.text() };
    const data = await r.json();
    return { ok: true, data: Array.isArray(data) ? data[0] : data };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function sbUpdate(env, table, id, patch) {
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: "PATCH",
      headers: sbHeaders(env, { Prefer: "return=representation" }),
      body: JSON.stringify(patch),
    });
    if (!r.ok) return { ok: false, status: r.status, error: await r.text() };
    const data = await r.json();
    return { ok: true, data: Array.isArray(data) ? data[0] : data };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

let _bucketDone = false;
async function ensureBucket(env) {
  if (_bucketDone) return;
  _bucketDone = true;
  try {
    await fetch(`${env.SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: sbHeaders(env),
      body: JSON.stringify({ id: "photos", name: "photos", public: true }),
    });
  } catch {
    /* already exists or transient; ignore */
  }
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Upload a base64 image to the public "photos" bucket; returns its public URL.
async function uploadToStorage(env, path, base64, contentType) {
  if (!base64) return null;
  await ensureBucket(env);
  try {
    const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/photos/${path}`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        "content-type": contentType || "image/jpeg",
        "x-upsert": "true",
      },
      body: base64ToBytes(base64),
    });
    if (!r.ok) return null;
    return `${env.SUPABASE_URL}/storage/v1/object/public/photos/${path}`;
  } catch {
    return null;
  }
}

/* ----- reference lists (master tables), with name->id resolution ----- */

let _refsCache = null;
function clearRefsCache() {
  _refsCache = null;
}

async function getRefs(env) {
  if (_refsCache && Date.now() - _refsCache.t < 30000) return _refsCache.data;
  const [clients, equip, locs, svc, cats] = await Promise.all([
    sbSelect(env, "clients?select=id,name,status&order=name"),
    sbSelect(env, "equipment_types?select=id,name,active&order=sort_order"),
    sbSelect(env, "locations?select=id,name,active&order=sort_order"),
    sbSelect(env, "service_types?select=id,name,active&order=sort_order"),
    sbSelect(env, "ticket_categories?select=id,name,active,photo_required,sort_order&order=sort_order"),
  ]);
  const data = {
    clients: clients || [],
    equip: equip || [],
    locs: locs || [],
    svc: svc || [],
    cats: cats || [],
  };
  if (data.clients.length || data.equip.length || data.cats.length) _refsCache = { t: Date.now(), data };
  return data;
}

function findId(arr, name) {
  if (!name) return null;
  const hit = (arr || []).find((x) => (x.name || "").toLowerCase() === name.toLowerCase());
  return hit ? hit.id : null;
}

/* ===================== Lists / options ===================== */

async function getLists(env) {
  const out = { clients: [], types: [], locations: [], serviceTypes: [] };
  if (!sbReady(env)) return out;
  const refs = await getRefs(env);
  out.clients = refs.clients.filter((c) => (c.status || "") !== "Churned").map((c) => c.name).sort((a, b) => a.localeCompare(b));
  out.types = refs.equip.filter((x) => x.active).map((x) => x.name);
  out.locations = refs.locs.filter((x) => x.active).map((x) => x.name);
  out.serviceTypes = refs.svc.filter((x) => x.active).map((x) => x.name);
  return out;
}

async function optionsHandler(env) {
  return noStore(await getLists(env));
}

async function getCategories(env) {
  if (!sbReady(env)) return json([]);
  const refs = await getRefs(env);
  const list = refs.cats
    .filter((c) => c.active)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map((c) => ({ name: c.name, photoRequired: !!c.photo_required }));
  return json(list);
}

async function diag(env) {
  const out = { hasUrl: !!env.SUPABASE_URL, hasKey: !!env.SUPABASE_SERVICE_KEY, hasAnon: !!env.SUPABASE_ANON_KEY };
  if (sbReady(env)) {
    const lists = await getLists(env);
    out.counts = {
      clients: lists.clients.length,
      types: lists.types.length,
      locations: lists.locations.length,
      serviceTypes: lists.serviceTypes.length,
    };
    // Probe the tickets table two ways: a plain read, and the read with the
    // foreign-key embeds the status page uses. If "plain" has rows but "embed"
    // is null, the relationship embed is the thing failing.
    const plain = await sbSelect(env, "tickets?select=id,status&order=created_at.desc");
    const embed = await sbSelect(env, "tickets?select=id,client:clients(name),category:ticket_categories(name)&order=created_at.desc");
    const byStatus = {};
    (Array.isArray(plain) ? plain : []).forEach((t) => { const s = t.status || "Open"; byStatus[s] = (byStatus[s] || 0) + 1; });
    out.tickets = { plain: Array.isArray(plain) ? plain.length : null, embed: Array.isArray(embed) ? embed.length : null, byStatus };
  }
  return noStore(out);
}

async function createClient(request, env) {
  if (!sbReady(env)) return json({ ok: false, error: "Database not connected." }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const name = (body.name || "").toString().trim();
  if (!name) return json({ ok: false, error: "Please enter a client name." }, 400);
  const refs = await getRefs(env);
  const existing = refs.clients.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (existing) return json({ ok: true, name: existing.name, existed: true });
  const res = await sbInsert(env, "clients", { name, status: "Active" });
  if (!res.ok) return json({ ok: false, error: "Could not add the client." }, 502);
  clearRefsCache();
  return json({ ok: true, name });
}

async function createPicklistValue(request, env) {
  if (!sbReady(env)) return json({ ok: false, error: "Database not connected." }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const list = (body.list || "").toString().trim();
  const value = (body.value || "").toString().trim();
  const tableByList = { "Equipment Type": "equipment_types", Location: "locations", "Service Type": "service_types" };
  const arrByList = { "Equipment Type": "equip", Location: "locs", "Service Type": "svc" };
  const table = tableByList[list];
  if (!table) return json({ ok: false, error: "Unknown list." }, 400);
  if (!value) return json({ ok: false, error: "Please enter a value." }, 400);
  const refs = await getRefs(env);
  const existing = (refs[arrByList[list]] || []).find((x) => x.name.toLowerCase() === value.toLowerCase());
  if (existing) return json({ ok: true, value: existing.name, existed: true });
  const res = await sbInsert(env, table, { name: value, sort_order: 500, active: true });
  if (!res.ok) return json({ ok: false, error: "Could not add the option." }, 502);
  clearRefsCache();
  return json({ ok: true, value });
}

/* ===================== Assets ===================== */

async function handleCreateAsset(request, env, ctx) {
  if (!sbReady(env)) return json({ ok: false, error: "The asset tracker isn't connected yet. Add SUPABASE_URL and SUPABASE_SERVICE_KEY in Cloudflare." }, 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Could not read the submission." }, 400);
  }

  const clean = (v) => (v || "").toString().trim();
  const description = clean(body.description);
  const manufacturer = clean(body.manufacturer);
  const model = clean(body.model);
  const serial = clean(body.serial);
  const equipmentType = clean(body.equipmentType);
  const location = clean(body.location);
  const client = clean(body.client);
  const notes = clean(body.notes);

  const label = [description || equipmentType || "Asset", client].filter(Boolean).join(" — ") || "Asset";

  const refs = await getRefs(env);
  const row = { name: label, verification: "Pending" };
  if (description) row.description = description;
  if (manufacturer) row.make = manufacturer;
  if (model) row.model = model;
  if (serial) row.serial = serial;
  if (notes) row.notes = notes;
  const etId = findId(refs.equip, equipmentType);
  const locId = findId(refs.locs, location);
  const clId = findId(refs.clients, client);
  if (etId) row.equipment_type_id = etId;
  if (locId) row.location_id = locId;
  if (clId) row.client_id = clId;

  const res = await sbInsert(env, "assets", row);
  if (!res.ok || !res.data) return json({ ok: false, error: "Could not save the asset." }, 502);
  const id = res.data.id;

  const manual = { description, manufacturer, model, serial, equipmentType };
  if (ctx && ctx.waitUntil) ctx.waitUntil(processAssetMedia(id, body, manual, env));

  return json({ ok: true, id });
}

// An asset's photos as one list: prefer the photo_urls array; fall back to the
// three legacy single-slot columns for assets created before the switch.
function assetPhotos(a) {
  if (a && Array.isArray(a.photo_urls) && a.photo_urls.length) return a.photo_urls.filter(Boolean);
  return [a && a.overall_photo_url, a && a.nameplate_photo_url, a && a.serial_photo_url].filter(Boolean);
}

// Pull the submitted photos as a flat list. New clients send a `photos` array
// (overall first, then nameplate, then anything else); older ones may still
// send the three named slots.
function assetPicsFromBody(body) {
  if (Array.isArray(body.photos)) return body.photos.filter((p) => p && p.base64);
  return [body.overallPhoto, body.nameplatePhoto, body.serialPhoto].filter((p) => p && p.base64);
}

// Background: upload the photos to Storage, then read the nameplate with Claude
// and fill in any blanks.
async function processAssetMedia(id, body, manual, env) {
  const patch = {};
  const pics = assetPicsFromBody(body);
  const urls = [];
  for (let i = 0; i < pics.length; i++) {
    const u = await uploadToStorage(env, `assets/${id}/${i}.jpg`, pics[i].base64, pics[i].contentType);
    if (u) urls.push(u);
  }
  if (urls.length) patch.photo_urls = urls;

  const images = pics.map((p) => ({ media_type: p.contentType, base64: p.base64 }));
  if (images.length && env.ANTHROPIC_API_KEY) {
    let read = null;
    try {
      read = await runAgent(images, env);
    } catch {
      read = null;
    }
    if (read) {
      patch.verification = "AI suggested";
      if (!manual.description && read.description) patch.description = read.description;
      if (!manual.manufacturer && read.manufacturer) patch.make = read.manufacturer;
      if (!manual.model && read.model) patch.model = read.model;
      if (!manual.serial && read.serial) patch.serial = read.serial;
      if (read.assetName) patch.name = read.assetName;
      if (!manual.equipmentType && read.equipmentType) {
        const refs = await getRefs(env);
        const etId = findId(refs.equip, read.equipmentType);
        if (etId) patch.equipment_type_id = etId;
      }
      patch.nameplate_reading = buildReadingNote(read);
    }
  }
  if (Object.keys(patch).length) await sbUpdate(env, "assets", id, patch);
}

/* ----- the Ringwood AI agent (unchanged) ----- */

const AGENT_PROMPT =
  "You are Ringwood's asset agent. These photos show a piece of equipment and, where available, its data plate " +
  "and serial label. Identify the equipment and return clean, useful fields.\n\n" +
  "- assetName: a clear, specific name a facilities manager would use. Include the brand, the product line or model, " +
  "and what the thing is. Example: 'HP Color LaserJet Pro M255dw Printer'. Never return vague names like 'Other' or 'Unit'.\n" +
  "- description: one short sentence in English. Leave out marketing language, certification or regulatory text, and anything not in English.\n" +
  "- manufacturer: the brand.\n" +
  "- model: the model name or number.\n" +
  "- serial: the serial number only if it is clearly legible, otherwise an empty string. Never invent one.\n" +
  "- equipmentType: a short category for this kind of equipment, such as 'HVAC', 'Refrigeration', 'Coffee Equipment', " +
  "'Office Equipment', or 'Electrical Panel'. Pick the most fitting common category.\n\n" +
  "Use what you know about the product to fill these in accurately, even if the plate only shows a part or SKU number. " +
  "If a field cannot be determined, use an empty string.";

const AGENT_SCHEMA = {
  type: "object",
  properties: {
    assetName: { type: "string" },
    description: { type: "string" },
    manufacturer: { type: "string" },
    model: { type: "string" },
    serial: { type: "string" },
    equipmentType: { type: "string" },
  },
  required: ["assetName", "description", "manufacturer", "model", "serial", "equipmentType"],
  additionalProperties: false,
};

function buildReadingNote(r) {
  return (
    `Name: ${r.assetName || "—"}\n` +
    `Manufacturer: ${r.manufacturer || "—"}\n` +
    `Model: ${r.model || "—"}\n` +
    `Serial: ${r.serial || "—"}\n` +
    `Type: ${r.equipmentType || "—"}\n` +
    `Description: ${r.description || "—"}\n\n` +
    `Read by Ringwood AI Agent 1.0 - Please verify`
  );
}

async function runAgent(images, env) {
  const content = images.map((p) => ({
    type: "image",
    source: p.base64
      ? { type: "base64", media_type: p.media_type || "image/jpeg", data: p.base64 }
      : { type: "url", url: p.url },
  }));
  content.push({ type: "text", text: AGENT_PROMPT });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-opus-4-8",
      max_tokens: 2500,
      thinking: { type: "adaptive" },
      messages: [{ role: "user", content }],
      output_config: { format: { type: "json_schema", schema: AGENT_SCHEMA } },
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  const block = (data.content || []).find((b) => b.type === "text");
  if (!block) return null;
  try {
    return JSON.parse(block.text);
  } catch {
    return null;
  }
}

function arrayBufferToBase64(buf) {
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fetchImageBase64(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const ct = (r.headers.get("content-type") || "image/jpeg").split(";")[0];
    const buf = await r.arrayBuffer();
    return { media_type: ct, base64: arrayBufferToBase64(buf) };
  } catch {
    return null;
  }
}

// One asset's current values — used by the capture page to refresh after AI.
async function getAsset(url, env) {
  const id = url.searchParams.get("id") || "";
  if (!id || !sbReady(env)) return json({ ok: false }, 400);
  const rows = await sbSelect(env, `assets?id=eq.${id}&select=verification,description,make,model,serial,nameplate_reading`);
  const a = rows && rows[0];
  if (!a) return json({ ok: false }, 404);
  return json({
    ok: true,
    status: a.verification || "Pending",
    description: a.description || "",
    manufacturer: a.make || "",
    model: a.model || "",
    serial: a.serial || "",
    aiReading: a.nameplate_reading || "",
  });
}

// Full asset detail + service history, for /a/<id> and QR scans.
async function getAssetFull(url, env) {
  const id = url.searchParams.get("id") || "";
  if (!id || !sbReady(env)) return json({ ok: false }, 400);
  const rows = await sbSelect(
    env,
    `assets?id=eq.${id}&select=*,equipment_type:equipment_types(name),location:locations(name),client:clients(name)`
  );
  const a = rows && rows[0];
  if (!a) return json({ ok: false }, 404);

  const sr = await sbSelect(
    env,
    `service_records?asset_id=eq.${id}&select=id,service_date,technician,notes,cost,service_type:service_types(name)&order=service_date.desc`
  );
  const services = (sr || []).map((s) => ({
    id: s.id,
    date: s.service_date || "",
    type: (s.service_type && s.service_type.name) || "",
    technician: s.technician || "",
    notes: s.notes || "",
    cost: s.cost != null ? s.cost : "",
  }));

  return json({
    ok: true,
    id,
    name: a.name || a.description || "Asset",
    description: a.description || "",
    manufacturer: a.make || "",
    model: a.model || "",
    serial: a.serial || "",
    equipmentType: (a.equipment_type && a.equipment_type.name) || "",
    client: (a.client && a.client.name) || "",
    location: (a.location && a.location.name) || "",
    status: a.verification || "Pending",
    aiReading: a.nameplate_reading || "",
    photos: assetPhotos(a),
    overallPhoto: a.overall_photo_url || "",
    nameplatePhoto: a.nameplate_photo_url || "",
    serialPhoto: a.serial_photo_url || "",
    services,
  });
}

// Re-run the agent on an asset's existing photos.
async function analyzeAsset(request, env) {
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: "The AI is not connected. Add the ANTHROPIC_API_KEY in Cloudflare." }, 503);
  if (!sbReady(env)) return json({ ok: false, error: "Database not connected." }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const id = (body.id || "").trim();
  if (!id) return json({ ok: false, error: "No asset id." }, 400);

  const rows = await sbSelect(env, `assets?id=eq.${id}&select=photo_urls,overall_photo_url,nameplate_photo_url,serial_photo_url`);
  const a = rows && rows[0];
  if (!a) return json({ ok: false, error: "Asset not found." }, 404);
  const urls = assetPhotos(a);
  if (!urls.length) return json({ ok: false, error: "This asset has no photos to analyze." }, 400);

  const images = [];
  for (const u of urls) {
    const img = await fetchImageBase64(u);
    if (img) images.push(img);
  }
  if (!images.length) return json({ ok: false, error: "Could not fetch this asset's photos." }, 502);

  let read = null;
  try {
    read = await runAgent(images, env);
  } catch {
    read = null;
  }
  if (!read) return json({ ok: false, error: "The agent could not read these photos." }, 502);

  const patch = { verification: "AI suggested", nameplate_reading: buildReadingNote(read) };
  if (read.assetName) patch.name = read.assetName;
  if (read.description) patch.description = read.description;
  if (read.manufacturer) patch.make = read.manufacturer;
  if (read.model) patch.model = read.model;
  if (read.serial) patch.serial = read.serial;
  if (read.equipmentType) {
    const refs = await getRefs(env);
    const etId = findId(refs.equip, read.equipmentType);
    if (etId) patch.equipment_type_id = etId;
  }
  const up = await sbUpdate(env, "assets", id, patch);
  if (!up.ok) return json({ ok: false, error: "Could not save the result." }, 502);
  return json({ ok: true });
}

// Save manual edits; a human edit marks it Verified.
async function updateAsset(request, env) {
  if (!sbReady(env)) return json({ ok: false, error: "Database not connected." }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const id = (body.id || "").trim();
  if (!id) return json({ ok: false, error: "No asset id." }, 400);
  const c = (v) => (v == null ? "" : v.toString().trim());
  const refs = await getRefs(env);
  const patch = { verification: "Verified" };
  if ("name" in body) patch.name = c(body.name);
  if ("description" in body) patch.description = c(body.description);
  if ("manufacturer" in body) patch.make = c(body.manufacturer);
  if ("model" in body) patch.model = c(body.model);
  if ("serial" in body) patch.serial = c(body.serial);
  if ("equipmentType" in body) patch.equipment_type_id = findId(refs.equip, c(body.equipmentType));
  if ("client" in body) patch.client_id = findId(refs.clients, c(body.client));
  if ("location" in body) patch.location_id = findId(refs.locs, c(body.location));
  // Rebuild the photo list when the editor sends one: keep the photos the user
  // didn't delete, then append new uploads. Clear the legacy single-slot columns
  // so photos live in one place from now on.
  const hasKeep = Array.isArray(body.keepPhotos);
  const hasAdd = Array.isArray(body.addPhotos) && body.addPhotos.length;
  if (hasKeep || hasAdd) {
    let urls = hasKeep ? body.keepPhotos.filter(Boolean) : [];
    if (hasAdd) {
      for (let i = 0; i < body.addPhotos.length; i++) {
        const p = body.addPhotos[i];
        if (!p || !p.base64) continue;
        const u = await uploadToStorage(env, `assets/${id}/add-${Date.now()}-${i}.jpg`, p.base64, p.contentType);
        if (u) urls.push(u);
      }
    }
    patch.photo_urls = urls;
    patch.overall_photo_url = null;
    patch.nameplate_photo_url = null;
    patch.serial_photo_url = null;
  }
  const res = await sbUpdate(env, "assets", id, patch);
  if (!res.ok) return json({ ok: false, error: "Save failed." }, 502);
  return json({ ok: true });
}

async function setVerified(request, env) {
  if (!sbReady(env)) return json({ ok: false, error: "Database not connected." }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const id = (body.id || "").trim();
  if (!id) return json({ ok: false, error: "No asset id." }, 400);
  const res = await sbUpdate(env, "assets", id, { verification: "Verified" });
  if (!res.ok) return json({ ok: false, error: "Failed." }, 502);
  return json({ ok: true });
}

async function listAssets(env) {
  if (!sbReady(env)) return json([]);
  const rows = await sbSelect(env, "assets?select=id,name,description,model,client:clients(name)&order=logged_at.desc");
  return json(
    (rows || []).map((x) => ({
      id: x.id,
      name: x.name || x.description || x.model || "Asset",
      client: (x.client && x.client.name) || "",
    }))
  );
}

/* ===================== Service records ===================== */

async function listServices(url, env) {
  const assetId = url.searchParams.get("assetId") || "";
  if (!assetId || !sbReady(env)) return json([]);
  const rows = await sbSelect(
    env,
    `service_records?asset_id=eq.${assetId}&select=id,service_date,technician,notes,cost,service_type:service_types(name)&order=service_date.desc`
  );
  return json(
    (rows || []).map((s) => ({
      id: s.id,
      date: s.service_date || "",
      type: (s.service_type && s.service_type.name) || "",
      technician: s.technician || "",
      notes: s.notes || "",
      cost: s.cost != null ? s.cost : "",
    }))
  );
}

async function createService(request, env, ctx) {
  if (!sbReady(env)) return json({ ok: false, error: "Not connected yet." }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Could not read the submission." }, 400);
  }
  const clean = (v) => (v || "").toString().trim();
  const assetId = clean(body.assetId);
  if (!assetId) return json({ ok: false, error: "Please choose the asset this service is for." }, 400);
  const serviceDate = clean(body.serviceDate);
  const serviceType = clean(body.serviceType);
  const technician = clean(body.technician);
  const notes = clean(body.notes);
  const cost = body.cost === "" || body.cost == null ? null : Number(body.cost);

  const refs = await getRefs(env);
  const row = { asset_id: assetId };
  if (serviceDate) row.service_date = serviceDate;
  const stId = findId(refs.svc, serviceType);
  if (stId) row.service_type_id = stId;
  if (technician) row.technician = technician;
  if (notes) row.notes = notes;
  if (cost != null && !isNaN(cost)) row.cost = cost;
  // Carry the asset's client onto the service record.
  const arows = await sbSelect(env, `assets?id=eq.${assetId}&select=client_id`);
  if (arows && arows[0] && arows[0].client_id) row.client_id = arows[0].client_id;

  const res = await sbInsert(env, "service_records", row);
  if (!res.ok || !res.data) return json({ ok: false, error: "Could not save the service record." }, 502);
  const id = res.data.id;

  const pics = Array.isArray(body.photos) ? body.photos : [];
  if (pics.length && ctx && ctx.waitUntil) {
    ctx.waitUntil(
      (async () => {
        const urls = [];
        for (let i = 0; i < pics.length; i++) {
          const u = await uploadToStorage(env, `service/${id}/${i}.jpg`, pics[i] && pics[i].base64, pics[i] && pics[i].contentType);
          if (u) urls.push(u);
        }
        if (urls.length) await sbUpdate(env, "service_records", id, { photo_urls: urls });
      })()
    );
  }

  return json({ ok: true, id });
}

async function getService(url, env) {
  const id = url.searchParams.get("id") || "";
  if (!id || !sbReady(env)) return json({ ok: false }, 400);
  const rows = await sbSelect(env, `service_records?id=eq.${id}&select=service_date,technician,notes,cost,service_type:service_types(name)`);
  const f = rows && rows[0];
  if (!f) return json({ ok: false }, 404);
  return json({
    ok: true,
    id,
    date: f.service_date || "",
    type: (f.service_type && f.service_type.name) || "",
    technician: f.technician || "",
    notes: f.notes || "",
    cost: f.cost != null ? f.cost : "",
  });
}

async function updateService(request, env) {
  if (!sbReady(env)) return json({ ok: false, error: "Database not connected." }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const id = (body.id || "").trim();
  if (!id) return json({ ok: false, error: "No id." }, 400);
  const c = (v) => (v == null ? "" : v.toString().trim());
  const refs = await getRefs(env);
  const patch = {};
  if ("date" in body) patch.service_date = c(body.date) || null;
  if ("type" in body) patch.service_type_id = findId(refs.svc, c(body.type));
  if ("technician" in body) patch.technician = c(body.technician);
  if ("notes" in body) patch.notes = c(body.notes);
  if ("cost" in body) {
    const n = body.cost === "" || body.cost == null ? null : Number(body.cost);
    patch.cost = n != null && !isNaN(n) ? n : null;
  }
  const res = await sbUpdate(env, "service_records", id, patch);
  if (!res.ok) return json({ ok: false, error: "Save failed." }, 502);
  return json({ ok: true });
}

/* ===================== Contact ===================== */

async function createContact(request, env) {
  if (!sbReady(env)) return json({ ok: false, error: "Not connected yet." }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Could not read the form." }, 400);
  }
  const clean = (v) => (v || "").toString().trim();
  const name = clean(body.name);
  const email = clean(body.email);
  const phone = clean(body.phone);
  if (!name) return json({ ok: false, error: "Please add your name." }, 400);
  if (!email && !phone) return json({ ok: false, error: "Please add an email or a phone number." }, 400);
  const row = { name, status: "New" };
  if (email) row.email = email;
  if (phone) row.phone = phone;
  const company = clean(body.company);
  const stage = clean(body.stage);
  const timeline = clean(body.timeline);
  const message = clean(body.message);
  if (company) row.company = company;
  if (stage) row.stage = stage;
  if (timeline) row.timeline = timeline;
  if (message) row.message = message;
  const res = await sbInsert(env, "contacts", row);
  if (!res.ok) return json({ ok: false, error: "Could not send your message." }, 502);
  return json({ ok: true, id: res.data && res.data.id });
}

/* ===================== Tickets ===================== */

async function createTicket(request, env, ctx) {
  if (!sbReady(env)) return json({ ok: false, error: "Not connected yet." }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const ref = "RW-" + Math.floor(1000 + Math.random() * 9000);
  const category = body.category || "Other";
  const client = body.client || "";
  const location = body.location || "";
  const note = (body.note || "").trim();
  // Title is auto-generated from the description; fall back to a plain label.
  let title = [category, client, location].filter(Boolean).join(" · ") || ref;
  if (env.ANTHROPIC_API_KEY && note) {
    const aiTitle = await titleFromDescription(note, category, env);
    if (aiTitle) title = aiTitle;
  }

  const refs = await getRefs(env);
  const row = { ref, title, description: note, location, status: "Open" };
  const catId = findId(refs.cats, category);
  const clId = findId(refs.clients, client);
  if (catId) row.category_id = catId;
  if (clId) row.client_id = clId;

  const res = await sbInsert(env, "tickets", row);
  if (!res.ok || !res.data) return json({ ok: false, error: "Could not save the ticket." }, 502);
  const id = res.data.id;

  const pics = normalizePics(body);
  if (pics.length && ctx && ctx.waitUntil) {
    ctx.waitUntil(
      (async () => {
        const urls = [];
        for (let i = 0; i < pics.length; i++) {
          const u = await uploadToStorage(env, `tickets/${id}/${i}.jpg`, pics[i].base64, pics[i].contentType);
          if (u) urls.push(u);
        }
        if (urls.length) await sbUpdate(env, "tickets", id, { photo_urls: urls, photo_url: urls[0] });
      })()
    );
  }

  return json({ ok: true, ref, title });
}

// A short, specific ticket title from the description (Claude).
async function titleFromDescription(description, category, env) {
  try {
    const schema = { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false };
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 60,
        messages: [{ role: "user", content: "Write a short, specific ticket title (max 8 words, Title Case, no quotes, no period) for this facilities issue.\nCategory: " + category + "\nIssue: " + description }],
        output_config: { format: { type: "json_schema", schema } },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const block = (data.content || []).find((b) => b.type === "text");
    if (!block) return null;
    const out = JSON.parse(block.text);
    const t = (out.title || "").trim().replace(/^["']|["']$/g, "").replace(/\.$/, "").slice(0, 90);
    return t || null;
  } catch {
    return null;
  }
}

async function listTickets(url, env) {
  if (!sbReady(env)) return json([]);
  const client = url.searchParams.get("client") || "";
  const showArchived = url.searchParams.get("archived") === "1";
  const refs = await getRefs(env);
  let filter = "";
  if (client === "__unassigned") filter = "&client_id=is.null";
  else if (client) {
    const cid = findId(refs.clients, client);
    filter = cid ? `&client_id=eq.${cid}` : "&id=eq.00000000-0000-0000-0000-000000000000";
  }
  if (!showArchived) filter += "&status=neq.Archived";

  let rows = await sbSelect(
    env,
    `tickets?select=id,ref,title,description,location,status,photo_url,photo_urls,created_at,category:ticket_categories(name),client:clients(name)${filter}&order=created_at.desc`
  );
  // If the foreign-key embed fails (returns null), fall back to a plain read so
  // tickets still show. Resolve client/category names from the cached refs.
  let embedded = true;
  if (rows === null) {
    embedded = false;
    rows = await sbSelect(env, `tickets?select=*${filter}&order=created_at.desc`);
  }
  const nameById = (arr, id) => { const m = (arr || []).find((x) => x.id === id); return m ? m.name : ""; };
  return json(
    (rows || []).map((t) => ({
      id: t.id,
      title: t.title || "Ticket",
      category: embedded ? ((t.category && t.category.name) || "") : nameById(refs.cats, t.category_id),
      client: embedded ? ((t.client && t.client.name) || "") : nameById(refs.clients, t.client_id),
      status: t.status || "Open",
      description: t.description || "",
      ref: t.ref || "",
      location: t.location || "",
      photo: t.photo_url || "",
      photos: t.photo_urls || (t.photo_url ? [t.photo_url] : []),
      created: t.created_at || "",
    }))
  );
}

async function updateTicket(request, env) {
  if (!sbReady(env)) return json({ ok: false, error: "Database not connected." }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const id = (body.id || "").trim();
  if (!id) return json({ ok: false, error: "No ticket id." }, 400);
  const refs = await getRefs(env);
  const patch = {};
  if ("status" in body) patch.status = body.status;
  if ("category" in body) patch.category_id = findId(refs.cats, body.category);
  if ("description" in body) patch.description = body.description;
  if ("location" in body) patch.location = body.location;
  if ("title" in body && body.title) patch.title = body.title;
  if ("client" in body) patch.client_id = body.client ? findId(refs.clients, body.client) : null;
  // Rebuild the photo set when the editor sends one: keep the photos the user
  // didn't delete (keepPhotos), then append any newly added ones (addPhotos).
  const hasKeep = Array.isArray(body.keepPhotos);
  const hasAdd = Array.isArray(body.addPhotos) && body.addPhotos.length;
  if (hasKeep || hasAdd) {
    let urls;
    if (hasKeep) {
      urls = body.keepPhotos.filter(Boolean);
    } else {
      const cur = await sbSelect(env, `tickets?id=eq.${id}&select=photo_urls`);
      urls = cur && cur[0] && cur[0].photo_urls ? cur[0].photo_urls.slice() : [];
    }
    if (hasAdd) {
      for (let i = 0; i < body.addPhotos.length; i++) {
        const p = body.addPhotos[i];
        if (!p || !p.base64) continue;
        const u = await uploadToStorage(env, `tickets/${id}/add-${Date.now()}-${i}.jpg`, p.base64, p.contentType);
        if (u) urls.push(u);
      }
    }
    patch.photo_urls = urls;
    patch.photo_url = urls.length ? urls[0] : null;
  }
  const res = await sbUpdate(env, "tickets", id, patch);
  if (!res.ok) return json({ ok: false, error: "Save failed." }, 502);
  return json({ ok: true });
}

// Normalize photos from a request: prefer a `photos` array, fall back to a
// single `photoBase64`.
function normalizePics(body) {
  if (Array.isArray(body.photos)) {
    return body.photos.filter((p) => p && p.base64).map((p) => ({ base64: p.base64, contentType: p.contentType || "image/jpeg" }));
  }
  if (body.photoBase64) return [{ base64: body.photoBase64, contentType: body.photoContentType || "image/jpeg" }];
  return [];
}

// AI assist for tickets: from photos and/or a short note, write a clear,
// grounded description and pick the best work category.
async function suggestTicket(request, env) {
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: "The assistant is not connected." }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const note = (body.note || "").toString().trim();
  const pics = normalizePics(body);
  const urlPics = Array.isArray(body.photoUrls) ? body.photoUrls.filter(Boolean) : [];
  if (!note && !pics.length && !urlPics.length) return json({ ok: false, error: "Add a photo or a few words first." }, 400);

  let cats = ["Repair", "Maintenance", "Install / Setup", "Buildout / Project", "Other"];
  try {
    const refs = await getRefs(env);
    const c = refs.cats.filter((x) => x.active).map((x) => x.name);
    if (c.length) cats = c;
  } catch {
    /* use defaults */
  }

  const prompt =
    "You are Ringwood's facilities ticket assistant. Someone is reporting something at a workplace that needs done. " +
    "They may attach several photos (for example a wide shot of a wall and a close-up of a sign) plus a short note. " +
    "Work out what they want done and write the ticket.\n\n" +
    "- description: one or two plain sentences describing the request or problem and, where shown, the location or surface (e.g. 'Mount the framed sign on the drywall wall by the entrance.'). Build on their note and keep their intent.\n" +
    "- category: choose exactly one from this list: " + cats.join(", ") + ".\n" +
    "- title: a short, specific title (max 8 words, Title Case, no quotes, no period).\n\n" +
    "Important: describe only what the photos and note actually show or say. Do NOT invent brands, model numbers, measurements, dimensions, names, or any detail you cannot verify. If something is unclear, keep it general or leave it out.\n" +
    (note ? 'Their note: "' + note + '"\n' : "") +
    "If a field cannot be determined, use an empty string for it.";

  const content = [];
  pics.forEach((p) => content.push({ type: "image", source: { type: "base64", media_type: p.contentType || "image/jpeg", data: p.base64 } }));
  for (const u of urlPics) {
    const img = await fetchImageBase64(u);
    if (img) content.push({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.base64 } });
  }
  content.push({ type: "text", text: prompt });

  const schema = {
    type: "object",
    properties: { description: { type: "string" }, category: { type: "string" }, title: { type: "string" } },
    required: ["description", "category", "title"],
    additionalProperties: false,
  };

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 600,
        messages: [{ role: "user", content }],
        output_config: { format: { type: "json_schema", schema } },
      }),
    });
    if (!res.ok) return json({ ok: false, error: "The assistant couldn't respond." }, 502);
    const data = await res.json();
    const block = (data.content || []).find((b) => b.type === "text");
    if (!block) return json({ ok: false, error: "No suggestion." }, 502);
    let out;
    try {
      out = JSON.parse(block.text);
    } catch {
      return json({ ok: false, error: "Couldn't read the suggestion." }, 502);
    }
    const match = cats.find((c) => c.toLowerCase() === (out.category || "").toLowerCase());
    const title = (out.title || "").trim().replace(/^["']|["']$/g, "").replace(/\.$/, "").slice(0, 90);
    return json({ ok: true, description: out.description || "", category: match || "", title: title });
  } catch {
    return json({ ok: false, error: "Couldn't reach the assistant." }, 502);
  }
}

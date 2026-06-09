/**
 * Ringwood site Worker.
 *
 * One engine serves three things, by hostname / path:
 *   - ringwood.ai           -> marketing site (static)            public/index.html
 *   - assets.ringwood.ai    -> asset capture form                public/assets/index.html
 *   - tickets.ringwood.ai   -> ticket capture form               public/tickets/index.html
 *
 * Static pages are served from ./public. This Worker handles the APIs and
 * routes each subdomain's root to the right form. All talk to Airtable
 * server-side using the AIRTABLE_TOKEN secret (never exposed to the browser).
 * Nameplate reading uses Claude (Sonnet 4.6) via the ANTHROPIC_API_KEY secret.
 */

/* ---- Assets (Client database base — single system of record) ----
 * Everything lives in one base now: Assets, Service (Maintenance Log), and
 * Tickets, so a ticket and a service event can link to the exact asset record.
 * The capture apps feed this base; field names below match its schema. */
const ASSET_BASE_ID = "appEasFOM80bISWV8";
const ASSET_TABLE_ID = "tblPx2oQMqUMVnI7h";
const F_OVERALL_PHOTO = "fldBD2kBgv82LFXRT";
const F_NAMEPLATE_PHOTO = "fldoUMBPi3rB6FNb7";
const F_SERIAL_PHOTO = "fldShtSdGtepVypBm";

/* ---- Service events (Maintenance Log, same base) ---- */
const SERVICE_TABLE = "tblYJok5bmKI3aDrr";
const F_SVC_PHOTOS = "fldVmzwXmbQZWcumX";

/* ---- Contact requests (Ringwood — Contact Requests base) ---- */
const CONTACT_BASE = "appKR9vFoNtDfqMEU";
const CONTACT_TABLE = "tblbp0KSiSy54dBbQ";

/* ---- Ticket app: category master list (System / Method base) ---- */
const SYS_BASE = "app29fADba9FiQ25h";
const CAT_TABLE = "tblKLl5Rw8dn7rx1l";
const F_CAT_NAME = "Category";
const F_CAT_ACTIVE = "Active";
const F_CAT_SORT = "Sort Order";
const F_CAT_PHOTOREQ = "Photo Required";

/* ---- Ticket app: tickets table (Client database base) ---- */
const TPL_BASE = "appEasFOM80bISWV8";
const TICKETS_TABLE = "tblnSH5oAdyFcTx2F";
const F_TICKET = "fldwqqKgFzSF2lBBO";
const F_CATEGORY = "fldhgDR1byyHgdh60";
const F_DESCRIPTION = "fldJeZTGffRe03kkD";
const F_ANSWERS = "fldgi7AeOfXqlJbIe";
const F_STATUS = "fldKeJybW6vIwPBEU";
const F_PHOTO = "fldi8ElO0ZKVFKhDT";
const F_TICKET_CLIENT = "fldPjf0JBbs7rd2yW";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const sub = url.hostname.split(".")[0];

    // APIs (work on any hostname; the forms call them same-origin)
    if (url.pathname === "/api/assets" && request.method === "POST") {
      return handleCreateAsset(request, env, ctx);
    }
    if (url.pathname === "/api/assets/list" && request.method === "GET") {
      return listAssets(env);
    }
    if (url.pathname === "/api/options" && request.method === "GET") {
      return optionsHandler(env);
    }
    if (url.pathname === "/api/service/get" && request.method === "GET") {
      return getService(url, env);
    }
    if (url.pathname === "/api/service/update" && request.method === "POST") {
      return updateService(request, env);
    }
    if (url.pathname === "/api/assets/get" && request.method === "GET") {
      return getAsset(url, env);
    }
    if (url.pathname === "/api/asset" && request.method === "GET") {
      return getAssetFull(url, env);
    }
    if (url.pathname === "/api/asset/analyze" && request.method === "POST") {
      return analyzeAsset(request, env);
    }
    if (url.pathname === "/api/asset/update" && request.method === "POST") {
      return updateAsset(request, env);
    }
    if (url.pathname === "/api/asset/verify" && request.method === "POST") {
      return setVerified(request, env);
    }
    if (url.pathname === "/api/service" && request.method === "POST") {
      return createService(request, env, ctx);
    }
    if (url.pathname === "/api/service/list" && request.method === "GET") {
      return listServices(url, env);
    }
    if (url.pathname === "/api/contact" && request.method === "POST") {
      return createContact(request, env);
    }
    if (url.pathname === "/api/categories" && request.method === "GET") {
      return getCategories(env);
    }
    if (url.pathname === "/api/tickets" && request.method === "POST") {
      return createTicket(request, env);
    }

    // Asset view / lookup page (QR target). Serve the /a/ page for any /a/* path
    // (rewriting to the directory, not index.html, to avoid an asset redirect
    // that would strip the id).
    if (url.pathname.startsWith("/a/") && env.ASSETS) {
      return env.ASSETS.fetch(rewrite(url, "/a/", request));
    }

    // Each app's subdomain serves its form at the root.
    if (env.ASSETS && (url.pathname === "/" || url.pathname === "")) {
      if (sub === "assets") return env.ASSETS.fetch(rewrite(url, "/assets/", request));
      if (sub === "tickets") return env.ASSETS.fetch(rewrite(url, "/tickets/", request));
      if (sub === "service") return env.ASSETS.fetch(rewrite(url, "/service/", request));
      if (sub === "talk" || sub === "contact") return env.ASSETS.fetch(rewrite(url, "/talk/", request));
    }

    // Everything else: serve the static site.
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
};

function rewrite(url, pathname, request) {
  const u = new URL(url);
  u.pathname = pathname;
  return new Request(u, request);
}

/* ===================== Asset tracker ===================== */

async function handleCreateAsset(request, env, ctx) {
  if (!env.AIRTABLE_TOKEN) {
    return json(
      { ok: false, error: "The asset tracker isn't connected yet. Please add the AIRTABLE_TOKEN in Cloudflare." },
      503
    );
  }

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

  const label =
    [description || equipmentType || "Asset", client].filter(Boolean).join(" — ") || "Asset";

  const fields = { "Asset Name": label, Verification: "Pending", "Logged At": new Date().toISOString() };
  if (description) fields["Description"] = description;
  if (manufacturer) fields["Make"] = manufacturer;
  if (model) fields["Model"] = model;
  if (serial) fields["Serial"] = serial;
  if (equipmentType) fields["Category"] = equipmentType;
  if (location) fields["Location"] = location;
  if (client) fields["Client"] = client;
  if (notes) fields["Notes / Spec"] = notes;

  // 1) Create the record immediately so the user gets a fast confirmation.
  let recordId;
  try {
    const res = await fetch(`https://api.airtable.com/v0/${ASSET_BASE_ID}/${ASSET_TABLE_ID}`, {
      method: "POST",
      headers: airtableHeaders(env),
      body: JSON.stringify({ fields, typecast: true }),
    });
    const data = await res.json();
    if (!res.ok) {
      return json({ ok: false, error: data?.error?.message || "Airtable rejected the record." }, 502);
    }
    recordId = data.id;
  } catch {
    return json({ ok: false, error: "Could not reach the database." }, 502);
  }

  // 2) Upload photos + run nameplate AI in the background (doesn't block the user).
  const manual = { description, manufacturer, model, serial, equipmentType };
  if (ctx && ctx.waitUntil) {
    ctx.waitUntil(processAssetMedia(recordId, body, manual, env));
  }

  return json({ ok: true, id: recordId });
}

// Background work: attach the three photos, then have Claude read the nameplate
// and fill in any blanks the user left.
async function processAssetMedia(recordId, body, manual, env) {
  // Attach photos to their respective fields.
  await uploadPhoto(recordId, F_OVERALL_PHOTO, body.overallPhoto, env);
  await uploadPhoto(recordId, F_NAMEPLATE_PHOTO, body.nameplatePhoto, env);
  await uploadPhoto(recordId, F_SERIAL_PHOTO, body.serialPhoto, env);

  // Run the Ringwood agent on the nameplate, serial, and overall photos.
  const images = [body.nameplatePhoto, body.serialPhoto, body.overallPhoto]
    .filter((p) => p && p.base64)
    .map((p) => ({ media_type: p.contentType, base64: p.base64 }));
  if (!images.length || !env.ANTHROPIC_API_KEY) return;

  let read;
  try {
    read = await runAgent(images, env);
  } catch {
    return;
  }
  if (!read) return;

  // Fill the fields the user left blank; never overwrite an entry they made.
  const patch = { Verification: "AI suggested" };
  if (!manual.description && read.description) patch["Description"] = read.description;
  if (!manual.manufacturer && read.manufacturer) patch["Make"] = read.manufacturer;
  if (!manual.model && read.model) patch["Model"] = read.model;
  if (!manual.serial && read.serial) patch["Serial"] = read.serial;
  if (!manual.equipmentType && read.equipmentType) patch["Category"] = read.equipmentType;
  // If the user did not type a description, the saved name is weak, so use the agent's name.
  if (!manual.description && read.assetName) patch["Asset Name"] = read.assetName;
  patch["Nameplate Reading (AI)"] = buildReadingNote(read);

  try {
    await fetch(`https://api.airtable.com/v0/${ASSET_BASE_ID}/${ASSET_TABLE_ID}/${recordId}`, {
      method: "PATCH",
      headers: airtableHeaders(env),
      body: JSON.stringify({ fields: patch, typecast: true }),
    });
  } catch {
    /* ignore — the record and photos are already saved */
  }
}

function airtableHeaders(env) {
  return {
    Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
    "content-type": "application/json",
  };
}

async function uploadPhoto(recordId, fieldId, photo, env) {
  if (!photo || !photo.base64) return;
  try {
    await fetch(
      `https://content.airtable.com/v0/${ASSET_BASE_ID}/${recordId}/${fieldId}/uploadAttachment`,
      {
        method: "POST",
        headers: airtableHeaders(env),
        body: JSON.stringify({
          contentType: photo.contentType || "image/jpeg",
          filename: photo.filename || "photo.jpg",
          file: photo.base64,
        }),
      }
    );
  } catch {
    /* a failed photo upload shouldn't lose the record */
  }
}

// The Ringwood AI Agent. It identifies the equipment from its photos and
// returns a clean name, description, and details. Accepts base64 images (fresh
// captures) or image URLs (re-running on photos already saved in Airtable).
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

// One asset's current values — used by the capture page to refresh after the
// background AI fills things in.
async function getAsset(url, env) {
  const id = url.searchParams.get("id") || "";
  if (!id || !env.AIRTABLE_TOKEN) return json({ ok: false }, 400);
  try {
    const r = await fetch(`https://api.airtable.com/v0/${ASSET_BASE_ID}/${ASSET_TABLE_ID}/${id}`, {
      headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` },
    });
    if (!r.ok) return json({ ok: false }, 502);
    const data = await r.json();
    const f = data.fields || {};
    return json({
      ok: true,
      status: f["Verification"] || "Pending",
      description: f["Description"] || "",
      manufacturer: f["Make"] || "",
      model: f["Model"] || "",
      serial: f["Serial"] || "",
      aiReading: f["Nameplate Reading (AI)"] || "",
    });
  } catch {
    return json({ ok: false }, 502);
  }
}

// Full asset detail + service history, for the /a/<id> view page and QR scans.
async function getAssetFull(url, env) {
  const id = url.searchParams.get("id") || "";
  if (!id || !env.AIRTABLE_TOKEN) return json({ ok: false }, 400);
  const photoUrl = (arr) => {
    if (!Array.isArray(arr) || !arr[0]) return "";
    const a = arr[0];
    return a.thumbnails && a.thumbnails.large ? a.thumbnails.large.url : a.url;
  };
  try {
    const r = await fetch(`https://api.airtable.com/v0/${ASSET_BASE_ID}/${ASSET_TABLE_ID}/${id}`, {
      headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` },
    });
    if (!r.ok) return json({ ok: false }, 404);
    const data = await r.json();
    const f = data.fields || {};

    let services = [];
    try {
      const sr = await fetch(`https://api.airtable.com/v0/${ASSET_BASE_ID}/${SERVICE_TABLE}?pageSize=100`, {
        headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` },
      });
      const sd = await sr.json();
      services = (sd.records || [])
        .filter((x) => Array.isArray(x.fields.Asset) && x.fields.Asset.indexOf(id) !== -1)
        .map((x) => ({
          id: x.id,
          date: x.fields["Date"] || "",
          type: x.fields["Service Type"] || "",
          technician: x.fields["Technician"] || "",
          notes: x.fields["Action"] || "",
          cost: x.fields["Cost"] != null ? x.fields["Cost"] : "",
        }))
        .sort((a, b) => (a.date < b.date ? 1 : -1));
    } catch {
      /* leave services empty */
    }

    return json({
      ok: true,
      id,
      name: f["Asset Name"] || f["Description"] || "Asset",
      description: f["Description"] || "",
      manufacturer: f["Make"] || "",
      model: f["Model"] || "",
      serial: f["Serial"] || "",
      equipmentType: f["Category"] || "",
      client: f["Client"] || "",
      location: f["Location"] || "",
      status: f["Verification"] || "Pending",
      aiReading: f["Nameplate Reading (AI)"] || "",
      overallPhoto: photoUrl(f["Overall Photo"]),
      nameplatePhoto: photoUrl(f["Nameplate Photo"]),
      serialPhoto: photoUrl(f["Serial Photo"]),
      services,
    });
  } catch {
    return json({ ok: false }, 502);
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

// Download an image URL and return it as a base64 block for Claude.
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

// Run the Ringwood agent against an asset's existing photos and save the result.
async function analyzeAsset(request, env) {
  if (!env.ANTHROPIC_API_KEY) {
    return json({ ok: false, error: "The AI is not connected. Add the ANTHROPIC_API_KEY in Cloudflare." }, 503);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const id = (body.id || "").trim();
  if (!id) return json({ ok: false, error: "No asset id." }, 400);

  let f;
  try {
    const r = await fetch(`https://api.airtable.com/v0/${ASSET_BASE_ID}/${ASSET_TABLE_ID}/${id}`, {
      headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` },
    });
    if (!r.ok) return json({ ok: false, error: "Asset not found." }, 404);
    f = (await r.json()).fields || {};
  } catch {
    return json({ ok: false, error: "Could not reach the database." }, 502);
  }

  const fullUrl = (arr) => (Array.isArray(arr) && arr[0] ? arr[0].url : "");
  const urls = [f["Nameplate Photo"], f["Serial Photo"], f["Overall Photo"]].map(fullUrl).filter(Boolean);
  if (!urls.length) return json({ ok: false, error: "This asset has no photos to analyze." }, 400);

  // Download the photos in the Worker and pass them as bytes. Anthropic cannot
  // fetch Airtable's signed attachment URLs directly, so image-by-URL fails here.
  const images = [];
  for (const u of urls) {
    const img = await fetchImageBase64(u);
    if (img) images.push(img);
  }
  if (!images.length) return json({ ok: false, error: "Could not fetch this asset's photos." }, 502);

  let read;
  try {
    read = await runAgent(images, env);
  } catch {
    read = null;
  }
  if (!read) return json({ ok: false, error: "The agent could not read these photos." }, 502);

  const patch = { Verification: "AI suggested" };
  if (read.assetName) patch["Asset Name"] = read.assetName;
  if (read.description) patch["Description"] = read.description;
  if (read.manufacturer) patch["Make"] = read.manufacturer;
  if (read.model) patch["Model"] = read.model;
  if (read.serial) patch["Serial"] = read.serial;
  if (read.equipmentType) patch["Category"] = read.equipmentType;
  patch["Nameplate Reading (AI)"] = buildReadingNote(read);

  try {
    const up = await fetch(`https://api.airtable.com/v0/${ASSET_BASE_ID}/${ASSET_TABLE_ID}/${id}`, {
      method: "PATCH",
      headers: airtableHeaders(env),
      body: JSON.stringify({ fields: patch, typecast: true }),
    });
    if (!up.ok) {
      const d = await up.json();
      return json({ ok: false, error: d?.error?.message || "Could not save the result." }, 502);
    }
  } catch {
    return json({ ok: false, error: "Could not save the result." }, 502);
  }
  return json({ ok: true });
}

// Save manual edits to an asset. A human edit marks it Verified.
async function updateAsset(request, env) {
  if (!env.AIRTABLE_TOKEN) return json({ ok: false, error: "Not connected." }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const id = (body.id || "").trim();
  if (!id) return json({ ok: false, error: "No asset id." }, 400);

  const c = (v) => (v == null ? "" : v.toString().trim());
  const opts = await getDistinctValues(env);
  const fields = {};
  if ("name" in body) fields["Asset Name"] = c(body.name);
  if ("description" in body) fields["Description"] = c(body.description);
  if ("manufacturer" in body) fields["Make"] = c(body.manufacturer);
  if ("model" in body) fields["Model"] = c(body.model);
  if ("serial" in body) fields["Serial"] = c(body.serial);
  if ("equipmentType" in body) fields["Category"] = canon(c(body.equipmentType), opts.types);
  if ("client" in body) fields["Client"] = canon(c(body.client), opts.clients);
  if ("location" in body) fields["Location"] = canon(c(body.location), opts.locations);
  fields["Verification"] = "Verified";

  try {
    const res = await fetch(`https://api.airtable.com/v0/${ASSET_BASE_ID}/${ASSET_TABLE_ID}/${id}`, {
      method: "PATCH",
      headers: airtableHeaders(env),
      body: JSON.stringify({ fields, typecast: true }),
    });
    if (!res.ok) {
      const d = await res.json();
      return json({ ok: false, error: d?.error?.message || "Save failed." }, 502);
    }
    return json({ ok: true });
  } catch {
    return json({ ok: false, error: "Could not reach the server." }, 502);
  }
}

// One-tap: mark an asset Verified.
async function setVerified(request, env) {
  if (!env.AIRTABLE_TOKEN) return json({ ok: false, error: "Not connected." }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const id = (body.id || "").trim();
  if (!id) return json({ ok: false, error: "No asset id." }, 400);
  try {
    const res = await fetch(`https://api.airtable.com/v0/${ASSET_BASE_ID}/${ASSET_TABLE_ID}/${id}`, {
      method: "PATCH",
      headers: airtableHeaders(env),
      body: JSON.stringify({ fields: { Verification: "Verified" }, typecast: true }),
    });
    if (!res.ok) {
      const d = await res.json();
      return json({ ok: false, error: d?.error?.message || "Failed." }, 502);
    }
    return json({ ok: true });
  } catch {
    return json({ ok: false, error: "Could not reach the server." }, 502);
  }
}

// Distinct, de-duplicated option lists (seeds + whatever is already used in the
// data), so dropdowns stay consistent and people reuse values instead of
// creating "Office" / "office" / "offic" duplicates.
async function getDistinctValues(env) {
  const out = { types: {}, locations: {}, clients: {} };
  const add = (map, v) => {
    v = (v || "").toString().trim();
    if (v) {
      const k = v.toLowerCase();
      if (!map[k]) map[k] = v;
    }
  };
  ["HVAC", "Water Heater", "Boiler", "Electrical Panel", "Generator", "Coffee Equipment", "Office Equipment", "Refrigeration", "Other"].forEach((v) => add(out.types, v));
  ["Outside", "Attic", "Roof", "Basement", "Mechanical Room", "Garage", "Office", "Other"].forEach((v) => add(out.locations, v));
  ["Bloom", "Moment", "Ridge", "Robin", "Summit", "United"].forEach((v) => add(out.clients, v));
  try {
    const r = await fetch(`https://api.airtable.com/v0/${ASSET_BASE_ID}/${ASSET_TABLE_ID}?pageSize=100`, {
      headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` },
    });
    const data = await r.json();
    (data.records || []).forEach((x) => {
      const f = x.fields || {};
      add(out.types, f["Category"]);
      add(out.locations, f["Location"]);
      add(out.clients, f["Client"]);
    });
  } catch {
    /* seeds are still returned */
  }
  const vals = (m) => Object.keys(m).sort().map((k) => m[k]);
  return { types: vals(out.types), locations: vals(out.locations), clients: vals(out.clients) };
}

async function optionsHandler(env) {
  if (!env.AIRTABLE_TOKEN) return Response.json({ types: [], locations: [], clients: [] });
  return Response.json(await getDistinctValues(env));
}

// Map a typed value to an existing one when it matches case-insensitively, so
// "office" becomes the existing "Office" instead of a new duplicate.
function canon(value, list) {
  const v = (value || "").trim();
  if (!v || !Array.isArray(list)) return v;
  const hit = list.find((x) => x.toLowerCase() === v.toLowerCase());
  return hit || v;
}

/* ===================== Service records ===================== */

// List assets so the service form can pick one (most recent first).
async function listAssets(env) {
  if (!env.AIRTABLE_TOKEN) return Response.json([], { status: 200 });
  try {
    const r = await fetch(
      `https://api.airtable.com/v0/${ASSET_BASE_ID}/${ASSET_TABLE_ID}?pageSize=100`,
      { headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` } }
    );
    const data = await r.json();
    const list = (data.records || [])
      .sort((a, b) => (a.createdTime < b.createdTime ? 1 : -1))
      .map((x) => ({
        id: x.id,
        name: x.fields["Asset Name"] || x.fields.Description || x.fields.Model || "Asset",
        client: x.fields.Client || "",
      }));
    return Response.json(list);
  } catch {
    return Response.json([], { status: 200 });
  }
}

// Service history for one asset (newest first).
async function listServices(url, env) {
  const assetId = url.searchParams.get("assetId") || "";
  if (!assetId || !env.AIRTABLE_TOKEN) return Response.json([]);
  try {
    const r = await fetch(
      `https://api.airtable.com/v0/${ASSET_BASE_ID}/${SERVICE_TABLE}?pageSize=100`,
      { headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` } }
    );
    const data = await r.json();
    const rows = (data.records || [])
      .filter((x) => Array.isArray(x.fields.Asset) && x.fields.Asset.indexOf(assetId) !== -1)
      .map((x) => ({
        id: x.id,
        date: x.fields["Date"] || "",
        type: x.fields["Service Type"] || "",
        technician: x.fields["Technician"] || "",
        notes: x.fields["Action"] || "",
        cost: x.fields["Cost"] != null ? x.fields["Cost"] : "",
      }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    return Response.json(rows);
  } catch {
    return Response.json([]);
  }
}

async function createService(request, env, ctx) {
  if (!env.AIRTABLE_TOKEN) {
    return json({ ok: false, error: "Not connected yet. Please add the AIRTABLE_TOKEN in Cloudflare." }, 503);
  }

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
  const assetName = clean(body.assetName);
  const client = clean(body.client);
  const cost = body.cost === "" || body.cost == null ? null : Number(body.cost);

  const label = [serviceType || "Service", assetName, serviceDate].filter(Boolean).join(" — ") || "Service";

  const fields = { Entry: label, Asset: [assetId], "Logged At": new Date().toISOString() };
  if (serviceDate) fields["Date"] = serviceDate;
  if (serviceType) fields["Service Type"] = serviceType;
  if (technician) fields["Technician"] = technician;
  if (notes) fields["Action"] = notes;
  if (client) fields["Client"] = client;
  if (cost != null && !isNaN(cost)) fields["Cost"] = cost;

  let recordId;
  try {
    const res = await fetch(`https://api.airtable.com/v0/${ASSET_BASE_ID}/${SERVICE_TABLE}`, {
      method: "POST",
      headers: airtableHeaders(env),
      body: JSON.stringify({ fields, typecast: true }),
    });
    const data = await res.json();
    if (!res.ok) {
      return json({ ok: false, error: data?.error?.message || "Airtable rejected the record." }, 502);
    }
    recordId = data.id;
  } catch {
    return json({ ok: false, error: "Could not reach the database." }, 502);
  }

  // Upload any service photos in the background.
  const pics = Array.isArray(body.photos) ? body.photos : [];
  if (pics.length && ctx && ctx.waitUntil) {
    ctx.waitUntil(
      (async () => {
        for (const p of pics) {
          await uploadPhoto(recordId, F_SVC_PHOTOS, p, env);
        }
      })()
    );
  }

  return json({ ok: true, id: recordId });
}

// One service record, for the edit panel.
async function getService(url, env) {
  const id = url.searchParams.get("id") || "";
  if (!id || !env.AIRTABLE_TOKEN) return json({ ok: false }, 400);
  try {
    const r = await fetch(`https://api.airtable.com/v0/${ASSET_BASE_ID}/${SERVICE_TABLE}/${id}`, {
      headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` },
    });
    if (!r.ok) return json({ ok: false }, 404);
    const f = (await r.json()).fields || {};
    return json({
      ok: true,
      id,
      date: f["Date"] || "",
      type: f["Service Type"] || "",
      technician: f["Technician"] || "",
      notes: f["Action"] || "",
      cost: f["Cost"] != null ? f["Cost"] : "",
    });
  } catch {
    return json({ ok: false }, 502);
  }
}

async function updateService(request, env) {
  if (!env.AIRTABLE_TOKEN) return json({ ok: false, error: "Not connected." }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const id = (body.id || "").trim();
  if (!id) return json({ ok: false, error: "No id." }, 400);
  const c = (v) => (v == null ? "" : v.toString().trim());
  const fields = {};
  if ("date" in body) fields["Date"] = c(body.date);
  if ("type" in body) fields["Service Type"] = c(body.type);
  if ("technician" in body) fields["Technician"] = c(body.technician);
  if ("notes" in body) fields["Action"] = c(body.notes);
  if ("cost" in body) {
    const n = body.cost === "" || body.cost == null ? null : Number(body.cost);
    fields["Cost"] = n != null && !isNaN(n) ? n : null;
  }
  try {
    const res = await fetch(`https://api.airtable.com/v0/${ASSET_BASE_ID}/${SERVICE_TABLE}/${id}`, {
      method: "PATCH",
      headers: airtableHeaders(env),
      body: JSON.stringify({ fields, typecast: true }),
    });
    if (!res.ok) {
      const d = await res.json();
      return json({ ok: false, error: d?.error?.message || "Save failed." }, 502);
    }
    return json({ ok: true });
  } catch {
    return json({ ok: false, error: "Could not reach the server." }, 502);
  }
}

/* ===================== Contact requests ===================== */

async function createContact(request, env) {
  if (!env.AIRTABLE_TOKEN) {
    return json({ ok: false, error: "Not connected yet. Please add the AIRTABLE_TOKEN in Cloudflare." }, 503);
  }

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
  const company = clean(body.company);
  const stage = clean(body.stage);
  const timeline = clean(body.timeline);
  const message = clean(body.message);

  if (!name) return json({ ok: false, error: "Please add your name." }, 400);
  if (!email && !phone) return json({ ok: false, error: "Please add an email or a phone number." }, 400);

  const fields = { Name: name, Status: "New", "Submitted At": new Date().toISOString() };
  if (email) fields["Email"] = email;
  if (phone) fields["Phone"] = phone;
  if (company) fields["Company"] = company;
  if (stage) fields["Stage"] = stage;
  if (timeline) fields["Timeline"] = timeline;
  if (message) fields["How can we help?"] = message;

  try {
    const res = await fetch(`https://api.airtable.com/v0/${CONTACT_BASE}/${CONTACT_TABLE}`, {
      method: "POST",
      headers: airtableHeaders(env),
      body: JSON.stringify({ fields, typecast: true }),
    });
    const data = await res.json();
    if (!res.ok) {
      return json({ ok: false, error: data?.error?.message || "Could not send your message." }, 502);
    }
    return json({ ok: true, id: data.id });
  } catch {
    return json({ ok: false, error: "Could not reach the server." }, 502);
  }
}

/* ===================== Ticket app ===================== */

async function getCategories(env) {
  try {
    const r = await fetch(`https://api.airtable.com/v0/${SYS_BASE}/${CAT_TABLE}?pageSize=100`, {
      headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` },
    });
    const data = await r.json();
    const list = (data.records || [])
      .filter((x) => x.fields[F_CAT_ACTIVE])
      .sort((a, b) => (a.fields[F_CAT_SORT] || 0) - (b.fields[F_CAT_SORT] || 0))
      .map((x) => ({ name: x.fields[F_CAT_NAME], photoRequired: !!x.fields[F_CAT_PHOTOREQ] }));
    return Response.json(list);
  } catch (e) {
    return Response.json([], { status: 200 });
  }
}

async function createTicket(request, env) {
  try {
    const body = await request.json();
    const ref = "RW-" + Math.floor(1000 + Math.random() * 9000);

    const category = body.category || "Other";
    const client = body.client || "";
    const location = body.location || "";
    // Descriptive title like the asset titles, e.g. "Repair · United · Conf Room 1".
    const title = [category, client, location].filter(Boolean).join(" · ") || ref;

    const fields = {};
    fields[F_TICKET] = title;
    fields[F_CATEGORY] = category;
    fields[F_DESCRIPTION] = body.note || "";
    fields[F_ANSWERS] = "Ref: " + ref + "\nLocation: " + location;
    fields[F_STATUS] = "New";
    if (client) fields[F_TICKET_CLIENT] = client;

    const createRes = await fetch(`https://api.airtable.com/v0/${TPL_BASE}/${TICKETS_TABLE}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ typecast: true, records: [{ fields }] }),
    });

    if (!createRes.ok) {
      const t = await createRes.text();
      return Response.json({ ok: false, error: t }, { status: 500 });
    }

    const created = await createRes.json();
    const recId = created.records[0].id;

    let photoOk = true;
    if (body.photoBase64) {
      const up = await fetch(
        `https://content.airtable.com/v0/${TPL_BASE}/${recId}/${F_PHOTO}/uploadAttachment`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contentType: body.photoContentType || "image/jpeg",
            filename: body.photoFilename || "ticket.jpg",
            file: body.photoBase64,
          }),
        }
      );
      photoOk = up.ok;
    }

    return Response.json({ ok: true, ref: ref, photoOk: photoOk });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

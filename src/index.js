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

/* ---- Asset tracker (Ringwood — Asset Tracker base) ---- */
const ASSET_BASE_ID = "appLd8AQ0OgQoF0Yy";
const ASSET_TABLE_ID = "tblflKhylyuJi6esW";
const F_OVERALL_PHOTO = "fldMMvw4Ddqxi0KKh";
const F_NAMEPLATE_PHOTO = "fldezoR8bUXkZ6G8F";
const F_SERIAL_PHOTO = "fld9Xlteo8i2xvBqr";

/* ---- Service records (same Asset Tracker base) ---- */
const SERVICE_TABLE = "tbl37nOr8N6tARRZe";
const F_SVC_PHOTOS = "fldqHr91t3pgpW2DP";

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
    if (url.pathname === "/api/service" && request.method === "POST") {
      return createService(request, env, ctx);
    }
    if (url.pathname === "/api/categories" && request.method === "GET") {
      return getCategories(env);
    }
    if (url.pathname === "/api/tickets" && request.method === "POST") {
      return createTicket(request, env);
    }

    // Each app's subdomain serves its form at the root.
    if (env.ASSETS && (url.pathname === "/" || url.pathname === "")) {
      if (sub === "assets") return env.ASSETS.fetch(rewrite(url, "/assets/", request));
      if (sub === "tickets") return env.ASSETS.fetch(rewrite(url, "/tickets/", request));
      if (sub === "service") return env.ASSETS.fetch(rewrite(url, "/service/", request));
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

  const fields = { Asset: label, "Logged At": new Date().toISOString() };
  if (description) fields["Description"] = description;
  if (manufacturer) fields["Manufacturer"] = manufacturer;
  if (model) fields["Model"] = model;
  if (serial) fields["Serial Number"] = serial;
  if (equipmentType) fields["Equipment Type"] = equipmentType;
  if (location) fields["Location"] = location;
  if (client) fields["Client"] = client;
  if (notes) fields["Notes"] = notes;

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
  const manual = { description, manufacturer, model, serial };
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

  // Read the nameplate/serial close-ups with Claude.
  const images = [body.nameplatePhoto, body.serialPhoto].filter((p) => p && p.base64);
  if (!images.length || !env.ANTHROPIC_API_KEY) return;

  let read;
  try {
    read = await scanNameplate(images, env);
  } catch {
    return;
  }
  if (!read) return;

  // Fill only the fields the user left blank; never overwrite their entry.
  const patch = {};
  if (!manual.description && read.description) patch["Description"] = read.description;
  if (!manual.manufacturer && read.manufacturer) patch["Manufacturer"] = read.manufacturer;
  if (!manual.model && read.model) patch["Model"] = read.model;
  if (!manual.serial && read.serial) patch["Serial Number"] = read.serial;

  patch["Nameplate Reading (AI)"] =
    `Manufacturer: ${read.manufacturer || "—"}\n` +
    `Model: ${read.model || "—"}\n` +
    `Serial: ${read.serial || "—"}\n` +
    `Description: ${read.description || "—"}\n` +
    `(read by Claude Sonnet 4.6 — please verify)`;

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

// Claude vision: read manufacturer / model / serial / description off the plate.
async function scanNameplate(images, env) {
  const content = images.map((p) => ({
    type: "image",
    source: { type: "base64", media_type: p.contentType || "image/jpeg", data: p.base64 },
  }));
  content.push({
    type: "text",
    text:
      "These are close-up photos of an equipment data plate / nameplate. " +
      "Read the MANUFACTURER (brand), MODEL number, SERIAL number, and a short DESCRIPTION " +
      "of what the equipment is. If a value isn't clearly legible, return an empty string for it — do not guess.",
  });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      messages: [{ role: "user", content }],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              manufacturer: { type: "string" },
              model: { type: "string" },
              serial: { type: "string" },
              description: { type: "string" },
            },
            required: ["manufacturer", "model", "serial", "description"],
            additionalProperties: false,
          },
        },
      },
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
        name: x.fields.Asset || x.fields.Description || x.fields.Model || "Asset",
      }));
    return Response.json(list);
  } catch {
    return Response.json([], { status: 200 });
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
  const cost = body.cost === "" || body.cost == null ? null : Number(body.cost);

  const label = [serviceType || "Service", assetName, serviceDate].filter(Boolean).join(" — ") || "Service";

  const fields = { Service: label, Asset: [assetId], "Logged At": new Date().toISOString() };
  if (serviceDate) fields["Service Date"] = serviceDate;
  if (serviceType) fields["Service Type"] = serviceType;
  if (technician) fields["Technician"] = technician;
  if (notes) fields["Notes"] = notes;
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

    const fields = {};
    fields[F_TICKET] = ref;
    fields[F_CATEGORY] = body.category || "Other";
    fields[F_DESCRIPTION] = body.note || "";
    fields[F_ANSWERS] = "Location: " + (body.location || "");
    fields[F_STATUS] = "New";

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

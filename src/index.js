/**
 * Ringwood site Worker.
 *
 * One engine serves three things, by hostname / path:
 *   - ringwood.ai           -> marketing site (static)            public/index.html
 *   - assets.ringwood.ai    -> asset capture form                public/assets/index.html
 *   - tickets.ringwood.ai   -> ticket capture form               public/tickets/index.html
 *
 * Static pages are served from ./public. This Worker handles the APIs and
 * routes each subdomain's root to the right form. All three talk to Airtable
 * server-side using the AIRTABLE_TOKEN secret (never exposed to the browser).
 */

/* ---- Asset tracker (Ringwood — Asset Tracker base) ---- */
const ASSET_BASE_ID = "appLd8AQ0OgQoF0Yy";
const ASSET_TABLE_ID = "tblflKhylyuJi6esW";
const ASSET_PHOTO_FIELD_ID = "fldMMvw4Ddqxi0KKh";

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
  async fetch(request, env) {
    const url = new URL(request.url);
    const sub = url.hostname.split(".")[0];

    // APIs (work on any hostname; the forms call them same-origin)
    if (url.pathname === "/api/assets" && request.method === "POST") {
      return handleCreateAsset(request, env);
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

async function handleCreateAsset(request, env) {
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

  const equipmentType = (body.equipmentType || "").trim();
  const serial = (body.serial || "").trim();
  const model = (body.model || "").trim();
  const location = (body.location || "").trim();
  const client = (body.client || "").trim();
  const notes = (body.notes || "").trim();

  const label = [equipmentType || "Asset", client].filter(Boolean).join(" — ") || "Asset";

  const fields = { Asset: label, "Logged At": new Date().toISOString() };
  if (equipmentType) fields["Equipment Type"] = equipmentType;
  if (serial) fields["Serial Number"] = serial;
  if (model) fields["Model"] = model;
  if (location) fields["Location"] = location;
  if (client) fields["Client"] = client;
  if (notes) fields["Notes"] = notes;

  const headers = {
    Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
    "content-type": "application/json",
  };

  let recordId;
  try {
    const res = await fetch(`https://api.airtable.com/v0/${ASSET_BASE_ID}/${ASSET_TABLE_ID}`, {
      method: "POST",
      headers,
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

  if (body.photoBase64) {
    try {
      await fetch(
        `https://content.airtable.com/v0/${ASSET_BASE_ID}/${recordId}/${ASSET_PHOTO_FIELD_ID}/uploadAttachment`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            contentType: body.photoContentType || "image/jpeg",
            filename: body.photoFilename || "photo.jpg",
            file: body.photoBase64,
          }),
        }
      );
    } catch {
      /* a failed photo upload shouldn't lose the record */
    }
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

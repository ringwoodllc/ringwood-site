/**
 * Ringwood site Worker.
 *
 * Static pages (the marketing site and the asset-tracking form) are served
 * automatically from ./public via Cloudflare's static-assets handling. This
 * Worker only handles the asset-app API: it receives a submission from the
 * form at /assets and files it into the "Ringwood — Asset Tracker" Airtable
 * base, uploading the photo as an attachment.
 *
 * The Airtable token is read from the AIRTABLE_TOKEN secret (set in the
 * Cloudflare dashboard). base/table/field IDs below are not secret.
 */

const AIRTABLE_BASE_ID = "appLd8AQ0OgQoF0Yy";
const AIRTABLE_TABLE_ID = "tblflKhylyuJi6esW";
const PHOTO_FIELD_ID = "fldMMvw4Ddqxi0KKh";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const onAssetsSubdomain = url.hostname.split(".")[0] === "assets";

    if (url.pathname === "/api/assets" && request.method === "POST") {
      return handleCreateAsset(request, env);
    }

    // On assets.ringwood.ai, the asset form is the home page.
    if (onAssetsSubdomain && (url.pathname === "/" || url.pathname === "")) {
      const formUrl = new URL(url);
      formUrl.pathname = "/assets/";
      if (env.ASSETS) return env.ASSETS.fetch(new Request(formUrl, request));
    }

    // Anything else falls through to the static site.
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
};

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

  // Human-friendly label for the primary column.
  const label =
    [equipmentType || "Asset", client].filter(Boolean).join(" — ") || "Asset";

  const fields = {
    Asset: label,
    "Logged At": new Date().toISOString(),
  };
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

  // 1) Create the record.
  let recordId;
  try {
    const res = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ fields, typecast: true }),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      return json(
        { ok: false, error: data?.error?.message || "Airtable rejected the record." },
        502
      );
    }
    recordId = data.id;
  } catch {
    return json({ ok: false, error: "Could not reach the database." }, 502);
  }

  // 2) Upload the photo (if one was provided) as an attachment.
  if (body.photoBase64) {
    try {
      await fetch(
        `https://content.airtable.com/v0/${AIRTABLE_BASE_ID}/${recordId}/${PHOTO_FIELD_ID}/uploadAttachment`,
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
      // A failed photo upload shouldn't lose the record; the text is saved.
    } catch {
      /* ignore photo upload errors */
    }
  }

  return json({ ok: true, id: recordId });
}

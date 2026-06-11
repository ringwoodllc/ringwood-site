// apex-site Worker: serves the static marketing pages from ./public and
// handles the contact form. Same shape as the ringwood-site Worker, minus
// auth and the app API — this site is fully public.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/contact" && request.method === "POST") return createContact(request, env);
    return env.ASSETS.fetch(request);
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sbReady(env) {
  return !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY);
}

async function sbInsert(env, table, row) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) return { ok: false };
  const rows = await res.json();
  return { ok: true, data: rows[0] };
}

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
  const message = clean(body.message);
  if (company) row.company = company;
  if (message) row.message = message;
  const res = await sbInsert(env, "contacts", row);
  if (!res.ok) return json({ ok: false, error: "Could not send your message." }, 502);
  return json({ ok: true, id: res.data && res.data.id });
}

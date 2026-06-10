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

    // Login endpoints always reachable. The gate enforces when LOGIN_REQUIRED=1.
    if (url.pathname === "/api/login" && request.method === "POST") return login(request, env);
    if (url.pathname === "/api/logout" && request.method === "POST") return logout();
    if (url.pathname === "/api/whoami" && request.method === "GET") return whoami(request, env);
    if (url.pathname === "/api/account/password" && request.method === "POST") return changePassword(request, env);
    if (url.pathname === "/api/admin/token" && request.method === "POST") return adminCreateToken(request, env);
    if (url.pathname === "/api/admin/tokens" && request.method === "GET") return adminListTokens(request, env);
    if (url.pathname === "/api/admin/token/revoke" && request.method === "POST") return adminRevokeToken(request, env);

    // One session lookup, reused for the gate and for per-client data scoping.
    const session = await getSession(request, env);
    // Bootstrap safety: the gate only enforces once at least one account exists,
    // so a deploy before the accounts SQL is run can never lock everyone out.
    if (env.LOGIN_REQUIRED === "1" && !isPublic(url, sub) && !session && (await hasAnyUser(env))) {
      if (url.pathname.startsWith("/api/")) return json({ ok: false, error: "Please sign in." }, 401);
      const next = encodeURIComponent(url.pathname + (url.search || ""));
      return Response.redirect(`${url.origin}/login?next=${next}`, 302);
    }

    if (url.pathname === "/api/assets" && request.method === "POST") return handleCreateAsset(request, env, ctx, session);
    if (url.pathname === "/api/assets/list" && request.method === "GET") return listAssets(env, session);
    if (url.pathname === "/api/assets/nickname-all") return nicknameAllAssets(request, env);
    if (url.pathname === "/api/options" && request.method === "GET") return optionsHandler(env, session);
    if (url.pathname === "/api/diag" && request.method === "GET") return diag(env, request);
    if (url.pathname === "/api/clients" && request.method === "POST") return createClient(request, env);
    if (url.pathname === "/api/picklist" && request.method === "POST") return createPicklistValue(request, env);
    if (url.pathname === "/api/service/get" && request.method === "GET") return getService(url, env, session);
    if (url.pathname === "/api/service/update" && request.method === "POST") return updateService(request, env, session);
    if (url.pathname === "/api/assets/get" && request.method === "GET") return getAsset(url, env, session);
    if (url.pathname === "/api/asset" && request.method === "GET") return getAssetFull(url, env, session);
    if (url.pathname === "/api/asset/resolve" && request.method === "GET") return resolveAssetCode(url, env, session);
    if (url.pathname === "/api/asset/analyze" && request.method === "POST") return analyzeAsset(request, env, session);
    if (url.pathname === "/api/asset/update" && request.method === "POST") return updateAsset(request, env, session);
    if (url.pathname === "/api/asset/qr/generate" && request.method === "POST") return generateAssetQr(request, env, session);
    if (url.pathname === "/api/asset/delete" && request.method === "POST") return deleteAsset(request, env, session);
    if (url.pathname === "/api/assets/review" && request.method === "GET") return assetsForReview(request, env);
    if (url.pathname === "/api/asset/merge" && request.method === "POST") return mergeAssets(request, env, session);
    if (url.pathname === "/api/asset/verify" && request.method === "POST") return setVerified(request, env, session);
    if (url.pathname === "/api/service" && request.method === "POST") return createService(request, env, ctx, session);
    if (url.pathname === "/api/service/list" && request.method === "GET") return listServices(url, env, session);
    if (url.pathname === "/api/services/all" && request.method === "GET") return listAllServices(url, env, session);
    if (url.pathname === "/api/contact" && request.method === "POST") return createContact(request, env);
    if (url.pathname === "/api/categories" && request.method === "GET") return getCategories(env);
    if (url.pathname === "/api/tickets" && request.method === "POST") return createTicket(request, env, ctx, session);
    if (url.pathname === "/api/tickets/list" && request.method === "GET") return listTickets(url, env, session);
    if (url.pathname === "/api/tickets/asset" && request.method === "GET") return getTicketAsset(url, env, session);
    if (url.pathname === "/api/tickets/comments" && request.method === "GET") return listTicketComments(url, env, session);
    if (url.pathname === "/api/tickets/comment" && request.method === "POST") return addTicketComment(request, env, session);
    if (url.pathname === "/api/tickets/comment/update" && request.method === "POST") return updateTicketComment(request, env, session);
    if (url.pathname === "/api/tickets/comment/delete" && request.method === "POST") return deleteTicketComment(request, env, session);
    if (url.pathname === "/api/tickets/comment/promote" && request.method === "POST") return promoteCommentPhotos(request, env, session);
    if (url.pathname === "/api/tickets/update" && request.method === "POST") return updateTicket(request, env, session);
    if (url.pathname === "/api/tickets/delete" && request.method === "POST") return deleteTicket(request, env, session);
    if (url.pathname === "/api/tickets/suggest" && request.method === "POST") return suggestTicket(request, env, session);
    if (url.pathname === "/api/ai/polish" && request.method === "POST") return polishNote(request, env, session);
    if (url.pathname === "/api/tickets/retitle") return retitleTickets(request, env);
    if (url.pathname === "/api/tickets/relink-photos") return relinkTicketPhotos(request, env);
    // Master-only user management
    if (url.pathname === "/api/admin/clients" && request.method === "GET") return adminListClients(request, env);
    if (url.pathname === "/api/admin/client" && request.method === "POST") return adminSaveClient(request, env);
    if (url.pathname === "/api/admin/stats" && request.method === "GET") return adminStats(request, env);
    if (url.pathname === "/api/admin/qr/clear" && request.method === "POST") return adminClearQr(request, env);
    if (url.pathname === "/api/admin/users" && request.method === "GET") return adminListUsers(request, env);
    if (url.pathname === "/api/admin/user" && request.method === "POST") return adminSaveUser(request, env);
    if (url.pathname === "/api/admin/user/password" && request.method === "POST") return adminSetPassword(request, env);
    if (url.pathname === "/api/admin/actas/users" && request.method === "GET") return listActAsUsers(request, env);
    if (url.pathname === "/api/admin/actas" && request.method === "POST") return setActAs(request, env);

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
      "/download": "/download/",
      "/get": "/download/",
      "/account": "/account/",
      "/users": "/users/",
      "/review": "/review/",
      "/services": "/services/",
      "/clients": "/clients/",
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
  if (p === "/download" || p === "/download/" || p === "/get" || p === "/get/") return true;
  if (p === "/api/login" || p === "/api/logout" || p === "/api/whoami") return true;
  if (p === "/api/contact") return true;
  if (p === "/manifest.json" || p === "/sw.js" || p === "/install-prompt.js" || p.startsWith("/icons/")) return true;
  if (p.startsWith("/downloads/")) return true; // public app downloads (APK)
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
function b64urlToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Password hashing: PBKDF2-HMAC-SHA256, stored as pbkdf2$<iter>$<salt>$<hash>
// (base64url). Same scheme the seed SQL was generated with.
async function pbkdf2(password, saltBytes, iter, lenBytes) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: saltBytes, iterations: iter, hash: "SHA-256" }, key, lenBytes * 8);
  return new Uint8Array(bits);
}
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const h = await pbkdf2(password, salt, 100000, 32);
  return "pbkdf2$100000$" + b64urlBytes(salt) + "$" + b64urlBytes(h);
}
async function verifyPassword(password, stored) {
  const parts = (stored || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iter = parseInt(parts[1], 10);
  const salt = b64urlToBytes(parts[2]);
  const h = await pbkdf2(password, salt, iter, 32);
  return b64urlBytes(h) === parts[3];
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
  if (!sbReady(env)) return json({ ok: false, error: "Login isn't configured yet." }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  // Two ways in: a magic-link token, or email + password.
  let u;
  const token = (body.token || "").toString().trim();
  if (token) {
    const trows = await sbSelect(env, `login_tokens?token=eq.${encodeURIComponent(token)}&select=user_email,expires_at,revoked`);
    const t = trows && trows[0];
    if (!t || t.revoked === true || (t.expires_at && new Date(t.expires_at).getTime() < Date.now())) {
      return json({ ok: false, error: "This link is no longer valid. Ask for a new one." }, 401);
    }
    const urows = await sbSelect(env, `app_users?email=eq.${encodeURIComponent(t.user_email)}&select=email,role,active,perms,client:clients(name)`);
    u = urows && urows[0];
    if (!u || u.active === false) return json({ ok: false, error: "This account is not active." }, 401);
  } else {
    // Identifier can be an email or a simple username.
    const idRaw = (body.identifier || body.username || body.email || "").toString().trim().toLowerCase();
    const password = (body.password || "").toString();
    if (!idRaw || !password) return json({ ok: false, error: "Enter your email or username and password." }, 400);
    const enc = encodeURIComponent(idRaw);
    const rows = await sbSelect(env, `app_users?or=(email.eq.${enc},username.eq.${enc})&select=email,username,password_hash,role,active,perms,client:clients(name)`);
    u = rows && rows[0];
    if (!u || u.active === false || !(await verifyPassword(password, u.password_hash))) {
      return json({ ok: false, error: "Wrong email/username or password." }, 401);
    }
  }

  const role = u.role === "master" ? "master" : "client";
  const client = role === "client" ? (u.client && u.client.name) || "" : null;
  const perms = role === "client" ? u.perms || {} : null;
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const session = await signSession({ email: u.email, role, client, perms, exp }, env);
  return new Response(JSON.stringify({ ok: true, role, client }), {
    headers: { "content-type": "application/json", "set-cookie": sessionCookie(session, SESSION_DAYS * 86400) },
  });
}

// ---- master-only: client magic links ----
async function requireMaster(request, env) {
  const s = await verifySession(getCookie(request, "rw_session"), env);
  return s && s.role === "master" ? s : null;
}

// ---- "Act as" (impersonation), master-only ----
function actasCookie(value, maxAge) {
  return `rw_actas=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=.ringwood.ai; Max-Age=${maxAge}`;
}
// Set or clear which user the master is acting as. The real signed-in session
// must be master (checked against rw_session directly, not the effective one),
// so a client can never escalate, and a master can always switch back.
async function setActAs(request, env) {
  const master = await requireMaster(request, env);
  if (!master) return json({ ok: false, error: "Master only." }, 403);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  if (body.clear) {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json", "set-cookie": actasCookie("", 0) },
    });
  }
  const userId = (body.userId || "").toString().trim();
  const clientName = (body.client || "").toString().trim();
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  // View as a specific login (keeps that user's real perms).
  if (userId) {
    const rows = await sbSelect(env, `app_users?id=eq.${encodeURIComponent(userId)}&select=id,active`);
    const u = rows && rows[0];
    if (!u || u.active === false) return json({ ok: false, error: "User not found." }, 404);
    const tok = await signSession({ actas: u.id, exp }, env);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json", "set-cookie": actasCookie(tok, SESSION_DAYS * 86400) },
    });
  }
  // View as a client by name (works even when the client has no login yet).
  if (clientName) {
    const crows = await sbSelect(env, `clients?name=eq.${encodeURIComponent(clientName)}&select=id&limit=1`);
    if (!crows || !crows[0]) return json({ ok: false, error: "Client not found." }, 404);
    const tok = await signSession({ actasClient: clientName, exp }, env);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json", "set-cookie": actasCookie(tok, SESSION_DAYS * 86400) },
    });
  }
  return json({ ok: false, error: "Pick a user or client." }, 400);
}
// The list of users the master can act as.
async function listActAsUsers(request, env) {
  const master = await requireMaster(request, env);
  if (!master) return json({ ok: false, error: "Master only." }, 403);
  const rows = await sbSelect(env, "app_users?select=id,email,username,role,active,client:clients(name)");
  const clients = (await sbSelect(env, "clients?select=name&order=name")) || [];
  // Exclude the signed-in master's own login: acting as yourself is a no-op.
  const active = (rows || []).filter((u) => u.active !== false && u.email !== master.email);
  const out = [];
  // Master logins stay individual.
  for (const u of active) {
    if (u.role === "master") out.push({ id: u.id, role: "master", label: u.username || (u.email || "").split("@")[0], client: "" });
  }
  // A representative login per client (so a client WITH a login keeps its real
  // perms when viewed).
  const repByClient = {};
  for (const u of active) {
    if (u.role === "master") continue;
    const cname = (u.client && u.client.name) || "";
    if (cname && !repByClient[cname]) repByClient[cname] = u.id;
  }
  // One entry per CLIENT — every client, even ones with no login yet (viewed by
  // name). The admin just wants to view as "Sandbox", not pick a specific user.
  for (const c of clients) {
    if (!c.name) continue;
    out.push({ id: repByClient[c.name] || "", client: c.name, role: "client", label: c.name });
  }
  out.sort((a, b) => (a.role === b.role ? a.label.toLowerCase().localeCompare(b.label.toLowerCase()) : a.role === "master" ? -1 : 1));
  return noStore({ ok: true, users: out });
}
function randomToken() {
  return b64urlBytes(crypto.getRandomValues(new Uint8Array(24)));
}

// Create (or reuse) a client account and mint a 30-day magic link for it.
async function adminCreateToken(request, env) {
  if (!(await requireMaster(request, env))) return json({ ok: false, error: "Master only." }, 403);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const email = (body.email || "").toString().trim().toLowerCase();
  const clientName = (body.client || "").toString().trim();
  if (!email || !clientName) return json({ ok: false, error: "Pick a client and enter an email." }, 400);
  const refs = await getRefs(env);
  const cid = findId(refs.clients, clientName);
  if (!cid) return json({ ok: false, error: "Unknown client." }, 400);

  // Ensure the client account exists (password-less; magic link only).
  const exist = await sbSelect(env, `app_users?email=eq.${encodeURIComponent(email)}&select=email`);
  if (!exist || !exist.length) {
    const ins = await sbInsert(env, "app_users", { email, password_hash: await hashPassword(randomToken()), role: "client", client_id: cid });
    if (!ins.ok) return json({ ok: false, error: "Could not create the client login." }, 502);
  }
  const token = randomToken();
  const expires = new Date(Date.now() + 30 * 86400 * 1000).toISOString();
  const ins2 = await sbInsert(env, "login_tokens", { token, user_email: email, label: clientName, expires_at: expires });
  if (!ins2.ok) return json({ ok: false, error: "Could not create the link. If this keeps happening, run login_tokens.sql (or setup_all.sql) in Supabase." }, 502);
  const origin = new URL(request.url).origin;
  return json({ ok: true, token, url: `${origin}/login?token=${token}`, email, client: clientName, expires_at: expires });
}

async function adminListTokens(request, env) {
  if (!(await requireMaster(request, env))) return json({ ok: false, error: "Master only." }, 403);
  const rows = await sbSelect(env, "login_tokens?select=token,user_email,label,expires_at,revoked,created_at&order=created_at.desc");
  const origin = new URL(request.url).origin;
  return noStore({
    ok: true,
    tokens: (rows || []).map((t) => ({
      token: t.token,
      email: t.user_email,
      client: t.label || "",
      url: `${origin}/login?token=${t.token}`,
      expires_at: t.expires_at,
      revoked: t.revoked === true,
      created_at: t.created_at,
    })),
  });
}

async function adminRevokeToken(request, env) {
  if (!(await requireMaster(request, env))) return json({ ok: false, error: "Master only." }, 403);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const token = (body.token || "").toString();
  if (!token) return json({ ok: false, error: "No token." }, 400);
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/login_tokens?token=eq.${encodeURIComponent(token)}`, {
    method: "PATCH",
    headers: sbHeaders(env, { Prefer: "return=minimal" }),
    body: JSON.stringify({ revoked: true }),
  });
  if (!r.ok) return json({ ok: false, error: "Could not revoke." }, 502);
  return json({ ok: true });
}

// ---- master-only: user management ----
const PERM_AREAS = ["tickets", "assets", "service"];
const PERM_LEVELS = ["none", "view", "edit"];
function cleanPerms(p) {
  const out = {};
  for (const a of PERM_AREAS) {
    const v = p && p[a];
    out[a] = PERM_LEVELS.indexOf(v) >= 0 ? v : "edit";
  }
  return out;
}

// Emails we synthesize for username-only logins (hidden from the UI).
const SYNTH_DOMAIN = "@id.ringwood.ai";

// ---- master-only: client setup ----
async function adminListClients(request, env) {
  if (!(await requireMaster(request, env))) return json({ ok: false, error: "Master only." }, 403);
  const rows = await sbSelect(env, "clients?select=id,name,status,address,color,primary_contact,email,phone,notes&order=name");
  return noStore({
    ok: true,
    palette: CLIENT_PALETTE,
    clients: (rows || []).map((c) => ({
      id: c.id,
      name: c.name || "",
      status: c.status || "Active",
      address: c.address || "",
      color: c.color || "",
      contact: c.primary_contact || "",
      email: c.email || "",
      phone: c.phone || "",
      notes: c.notes || "",
    })),
  });
}

async function adminSaveClient(request, env) {
  if (!(await requireMaster(request, env))) return json({ ok: false, error: "Master only." }, 403);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const c = (v) => (v == null ? "" : v.toString().trim());
  const id = c(body.id);
  const name = c(body.name);
  if (!name) return json({ ok: false, error: "Enter a client name." }, 400);
  const patch = { name, address: c(body.address) || null, primary_contact: c(body.contact) || null, email: c(body.email) || null, phone: c(body.phone) || null };
  if ("status" in body) patch.status = c(body.status) || "Active";
  if ("color" in body) {
    const color = c(body.color);
    if (color) {
      // A color belongs to one client: reject if another client already has it.
      const dupe = await sbSelect(env, `clients?select=id&color=eq.${encodeURIComponent(color)}${id ? `&id=neq.${id}` : ""}&limit=1`);
      if (dupe && dupe.length) return json({ ok: false, error: "That color is already used by another client." }, 400);
    }
    patch.color = color || null;
  }
  let res;
  if (id) res = await sbUpdate(env, "clients", id, patch);
  else res = await sbInsert(env, "clients", Object.assign({ status: "Active" }, patch));
  if (!res.ok) return json({ ok: false, error: "Could not save. The name may already be in use." }, 502);
  clearRefsCache();
  return json({ ok: true });
}

// Walk the photos bucket and add up every file's size and count. Storage has no
// "total size" API, so we descend folder by folder. A subrequest budget keeps a
// huge library from blowing the Worker's request limit: if we hit it, we return
// what we have and flag the number as a floor (approx=true).
async function storageUsage(env) {
  let bytes = 0, files = 0, calls = 0, approx = false;
  const BUDGET = 45;
  async function listFolder(prefix) {
    let offset = 0, out = [];
    while (true) {
      if (calls >= BUDGET) { approx = true; break; }
      calls++;
      let page;
      try {
        const r = await fetchT(`${env.SUPABASE_URL}/storage/v1/object/list/photos`, {
          method: "POST",
          headers: sbHeaders(env),
          body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: "name", order: "asc" } }),
        });
        if (!r.ok) break;
        page = await r.json();
      } catch { break; }
      if (!Array.isArray(page) || !page.length) break;
      out = out.concat(page);
      if (page.length < 1000) break;
      offset += 1000;
    }
    return out;
  }
  async function walk(prefix) {
    if (approx) return;
    const items = await listFolder(prefix);
    for (const it of items) {
      if (!it || !it.name || it.name === ".emptyFolderPlaceholder") continue;
      if (it.id && it.metadata && typeof it.metadata.size === "number") {
        bytes += it.metadata.size; files++;        // a file
      } else {
        await walk(prefix + it.name + "/");          // a subfolder
        if (approx) return;
      }
    }
  }
  // Skip the diag/ folder (a tiny self-test file) so the photo count stays clean.
  const top = await listFolder("");
  for (const it of top) {
    if (!it || !it.name || it.name === "diag" || it.name === ".emptyFolderPlaceholder") continue;
    if (it.id && it.metadata && typeof it.metadata.size === "number") { bytes += it.metadata.size; files++; }
    else { await walk(it.name + "/"); if (approx) break; }
  }
  return { bytes, files, approx };
}

// Master dashboard numbers: storage used, photo count, and how many assets,
// clients, and logins exist.
async function adminStats(request, env) {
  if (!(await requireMaster(request, env))) return json({ ok: false, error: "Master only." }, 403);
  if (!sbReady(env)) return json({ ok: false, error: "Not connected to Supabase." }, 503);
  const [assets, clients, users, store] = await Promise.all([
    sbCount(env, "assets"),
    sbCount(env, "clients"),
    sbCount(env, "app_users"),
    storageUsage(env),
  ]);
  return noStore({
    ok: true,
    storageBytes: store.bytes,
    storageApprox: store.approx,
    photos: store.files,
    assets,
    clients,
    users,
  });
}

// Clear the QR code off every asset (wipe sample codes). Assets, photos, and
// history are untouched; only qr_tag is set back to null.
async function adminClearQr(request, env) {
  if (!(await requireMaster(request, env))) return json({ ok: false, error: "Master only." }, 403);
  if (!sbReady(env)) return json({ ok: false, error: "Not connected to Supabase." }, 503);
  const before = await sbCount(env, "assets?qr_tag=not.is.null");
  try {
    const r = await fetchT(`${env.SUPABASE_URL}/rest/v1/assets?qr_tag=not.is.null`, {
      method: "PATCH",
      headers: sbHeaders(env, { Prefer: "return=minimal" }),
      body: JSON.stringify({ qr_tag: null }),
    });
    if (!r.ok) return json({ ok: false, error: "Could not clear the QR codes." }, 502);
  } catch {
    return json({ ok: false, error: "Couldn't reach Supabase." }, 502);
  }
  return json({ ok: true, cleared: before });
}

async function adminListUsers(request, env) {
  if (!(await requireMaster(request, env))) return json({ ok: false, error: "Master only." }, 403);
  const rows = await sbSelect(env, "app_users?select=id,email,username,role,active,perms,client:clients(name,color)&order=role.desc,email");
  return noStore({
    ok: true,
    users: (rows || []).map((u) => ({
      id: u.id,
      key: u.email, // real email, for password reset / magic link
      email: (u.email || "").endsWith(SYNTH_DOMAIN) ? "" : u.email, // hide synthesized emails
      username: u.username || "",
      role: u.role,
      client: (u.client && u.client.name) || "",
      clientColor: (u.client && u.client.color) || (u.client && u.client.name ? hashColor(u.client.name) : ""),
      active: u.active !== false,
      perms: cleanPerms(u.perms || {}),
    })),
  });
}

// Create or update a login. Identify by id (so the email can change). Needs an
// email OR a username (or both); a username-only login gets a hidden synthetic
// email so the rest of the system has a stable key.
async function adminSaveUser(request, env) {
  if (!(await requireMaster(request, env))) return json({ ok: false, error: "Master only." }, 403);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const id = (body.id || "").toString().trim();
  let email = (body.email || "").toString().trim().toLowerCase();
  const username = (body.username || "").toString().trim().toLowerCase().replace(/\s+/g, "");
  if (email && email.indexOf("@") < 0) return json({ ok: false, error: "Enter a valid email." }, 400);
  if (!email && !username) return json({ ok: false, error: "Enter an email or a username." }, 400);
  if (!email) email = username + SYNTH_DOMAIN; // username-only: hidden internal key

  const role = body.role === "master" ? "master" : "client";
  const patch = { email, role, username: username || null };
  if ("perms" in body) patch.perms = cleanPerms(body.perms || {});
  if ("active" in body) patch.active = body.active !== false;
  if (role === "client") {
    const clientName = (body.client || "").toString().trim();
    const refs = await getRefs(env);
    const cid = findId(refs.clients, clientName);
    if (!cid) return json({ ok: false, error: "Pick a client for this login." }, 400);
    patch.client_id = cid;
  } else {
    patch.client_id = null;
  }

  // Update by id (lets the email change); otherwise fall back to matching email.
  let row = null;
  if (id) {
    const r = await sbSelect(env, `app_users?id=eq.${encodeURIComponent(id)}&select=id`);
    row = r && r[0];
  } else {
    const r = await sbSelect(env, `app_users?email=eq.${encodeURIComponent(email)}&select=id`);
    row = r && r[0];
  }
  if (row) {
    const res = await sbUpdate(env, "app_users", row.id, patch);
    if (!res.ok) return json({ ok: false, error: "Could not update the login. The email or username may already be in use." }, 502);
    return json({ ok: true, updated: true });
  }
  const pw = (body.password || "").toString();
  patch.password_hash = await hashPassword(pw.length >= 8 ? pw : randomToken());
  const ins = await sbInsert(env, "app_users", patch);
  if (!ins.ok) return json({ ok: false, error: "Could not create the login. The email or username may already be in use." }, 502);
  return json({ ok: true, created: true });
}

async function adminSetPassword(request, env) {
  if (!(await requireMaster(request, env))) return json({ ok: false, error: "Master only." }, 403);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const email = (body.email || "").toString().trim().toLowerCase();
  const pw = (body.password || "").toString();
  if (!email) return json({ ok: false, error: "No email." }, 400);
  if (pw.length < 8) return json({ ok: false, error: "Password must be at least 8 characters." }, 400);
  const rows = await sbSelect(env, `app_users?email=eq.${encodeURIComponent(email)}&select=id`);
  if (!rows || !rows.length) return json({ ok: false, error: "No such login." }, 404);
  const res = await sbUpdate(env, "app_users", rows[0].id, { password_hash: await hashPassword(pw) });
  if (!res.ok) return json({ ok: false, error: "Could not set the password." }, 502);
  return json({ ok: true });
}

function logout() {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json", "set-cookie": sessionCookie("", 0) },
  });
}

async function whoami(request, env) {
  const s = await getSession(request, env);
  return json({
    ok: !!s,
    email: s ? s.email : null,
    role: s ? s.role : null,
    client: s ? s.client || null : null,
    perms: s ? s.perms || null : null,
    name: s ? s.name || null : null,
    impersonating: s ? !!s.impersonating : false,
    realRole: s ? s.realRole || s.role : null,
    realName: s ? s.realName || null : null,
    required: env.LOGIN_REQUIRED === "1",
  });
}

// Change your own password (must be signed in).
async function changePassword(request, env) {
  const s = await verifySession(getCookie(request, "rw_session"), env);
  if (!s) return json({ ok: false, error: "Please sign in." }, 401);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const current = (body.current || "").toString();
  const next = (body.next || "").toString();
  if (next.length < 8) return json({ ok: false, error: "New password must be at least 8 characters." }, 400);
  const rows = await sbSelect(env, `app_users?email=eq.${encodeURIComponent(s.email)}&select=id,password_hash`);
  const u = rows && rows[0];
  if (!u || !(await verifyPassword(current, u.password_hash))) return json({ ok: false, error: "Current password is wrong." }, 401);
  const res = await sbUpdate(env, "app_users", u.id, { password_hash: await hashPassword(next) });
  if (!res.ok) return json({ ok: false, error: "Could not update the password." }, 502);
  return json({ ok: true });
}

// The signed-in session, or null. Verifies the signed cookie, then loads the
// account's CURRENT role/client/perms/active so a master's changes (access,
// client, disable) take effect right away — not on next sign-in. A short cache
// keeps this from hitting the database on every single request.
let _sessCache = new Map(); // cacheKey -> { t, data }
async function getSession(request, env) {
  const token = getCookie(request, "rw_session");
  const claims = await verifySession(token, env);
  if (!claims) return null;
  const actasTok = getCookie(request, "rw_actas") || "";
  const cacheKey = token + "|" + actasTok;
  const hit = _sessCache.get(cacheKey);
  if (hit && Date.now() - hit.t < 8000) return hit.data;
  if (!sbReady(env)) return claims; // can't look up; trust the signed claims
  const rows = await sbSelect(env, `app_users?email=eq.${encodeURIComponent(claims.email)}&select=username,role,active,perms,client:clients(name)`);
  if (rows === null) return claims; // table missing / transient error: don't lock out
  const u = rows[0];
  if (!u || u.active === false) {
    _sessCache.delete(cacheKey);
    return null; // account deleted or disabled -> session no longer valid
  }
  const realRole = u.role === "master" ? "master" : "client";
  const realName = u.username || (claims.email || "").split("@")[0];

  let data = null;
  // Impersonation ("act as"): only a real master may view/act as another user.
  // The effective session below becomes that user, so scoping, permissions, and
  // comment authorship all follow them automatically.
  if (realRole === "master" && actasTok) {
    const ap = await verifySession(actasTok, env);
    // View as a client by name (a client with no login of its own).
    if (ap && ap.actasClient && !ap.actas) {
      const crows = await sbSelect(env, `clients?name=eq.${encodeURIComponent(ap.actasClient)}&select=id&limit=1`);
      if (crows && crows[0]) {
        data = {
          email: "viewas:" + ap.actasClient,
          role: "client",
          client: ap.actasClient,
          perms: { tickets: "edit", assets: "view", service: "view" },
          name: ap.actasClient,
          impersonating: true,
          realRole: "master",
          realName,
        };
      }
    }
    if (!data && ap && ap.actas) {
      const trows = await sbSelect(env, `app_users?id=eq.${ap.actas}&select=email,username,role,active,perms,client:clients(name)`);
      const t = trows && trows[0];
      // Acting as your own login is a no-op: fall through to the normal session
      // so it doesn't show a pointless "Acting as you / Back to you" banner.
      if (t && t.active !== false && t.email !== claims.email) {
        const trole = t.role === "master" ? "master" : "client";
        const tclient = trole === "client" ? (t.client && t.client.name) || "" : null;
        data = {
          email: t.email,
          role: trole,
          client: tclient,
          perms: trole === "client" ? t.perms || {} : null,
          name: tclient || t.username || (t.email || "").split("@")[0],
          impersonating: true,
          realRole: "master",
          realName,
        };
      }
    }
  }
  if (!data) {
    data = {
      email: claims.email,
      role: realRole,
      client: realRole === "client" ? (u.client && u.client.name) || "" : null,
      perms: realRole === "client" ? u.perms || {} : null,
      name: realRole === "client" ? (u.client && u.client.name) || realName : realName,
      impersonating: false,
      realRole,
      realName,
    };
  }
  if (_sessCache.size > 500) _sessCache.clear();
  _sessCache.set(cacheKey, { t: Date.now(), data });
  return data;
}
// Has anyone created a login yet? Once true, it stays true (cached) so the gate
// doesn't read the table on every request.
let _hasUserCache = false;
async function hasAnyUser(env) {
  if (_hasUserCache) return true;
  if (!sbReady(env)) return false;
  const rows = await sbSelect(env, "app_users?select=email&limit=1");
  if (rows && rows.length) {
    _hasUserCache = true;
    return true;
  }
  return false;
}
// For a client-scoped session, the client name to force; null = see everything.
function scopeName(session) {
  return session && session.role === "client" ? session.client || "__none__" : null;
}
// Per-area access. Master (and the un-enforced/open state) always passes.
// area: "tickets" | "assets" | "service".  level: "view" | "edit".
function can(session, area, level) {
  if (!session) return true; // login not enforced yet
  if (session.role === "master") return true;
  const p = (session.perms && session.perms[area]) || "none";
  if (level === "view") return p === "view" || p === "edit";
  return p === "edit";
}
function deny(area) {
  return json({ ok: false, error: "You don't have access to " + area + "." }, 403);
}
// True if this session may touch this record (master/unscoped always may).
async function ownsRecord(env, session, table, id) {
  const forced = scopeName(session);
  if (forced == null) return true;
  const rows = await sbSelect(env, `${table}?id=eq.${id}&select=client:clients(name)`);
  const r = rows && rows[0];
  return !!(r && r.client && r.client.name === forced);
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

// fetch with a timeout, so a slow or hung Supabase/storage call can't block the
// Worker. On timeout it throws (callers already treat that as a transient error
// and return null / { ok:false }).
async function fetchT(url, opts, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 12000);
  try {
    return await fetch(url, Object.assign({}, opts || {}, { signal: ctrl.signal }));
  } finally {
    clearTimeout(t);
  }
}

// GET rows. `path` is everything after /rest/v1/ , e.g. "clients?select=name".
async function sbSelect(env, path) {
  try {
    const r = await fetchT(`${env.SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders(env) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// Exact row count for a table (or filtered path), via PostgREST's Content-Range.
// Cheap: asks for a single row but reads the total off the header.
async function sbCount(env, path) {
  try {
    const sep = path.indexOf("?") >= 0 ? "&" : "?";
    const r = await fetchT(`${env.SUPABASE_URL}/rest/v1/${path}${sep}select=id`, {
      headers: sbHeaders(env, { Prefer: "count=exact", Range: "0-0", "Range-Unit": "items" }),
    });
    const cr = r.headers.get("content-range") || "";
    const total = cr.split("/")[1];
    return total && total !== "*" ? parseInt(total, 10) : 0;
  } catch {
    return 0;
  }
}

async function sbInsert(env, table, row) {
  try {
    const r = await fetchT(`${env.SUPABASE_URL}/rest/v1/${table}`, {
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
    const r = await fetchT(`${env.SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
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
    // Create it if missing...
    await fetch(`${env.SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: sbHeaders(env),
      body: JSON.stringify({ id: "photos", name: "photos", public: true }),
    });
    // ...and force it public, in case it already existed as a private bucket
    // (the usual reason uploaded photos don't display).
    await fetch(`${env.SUPABASE_URL}/storage/v1/bucket/photos`, {
      method: "PUT",
      headers: sbHeaders(env),
      body: JSON.stringify({ public: true }),
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
    const r = await fetchT(`${env.SUPABASE_URL}/storage/v1/object/photos/${path}`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        "content-type": contentType || "image/jpeg",
        "x-upsert": "true",
      },
      body: base64ToBytes(base64),
    }, 25000);
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
    sbSelect(env, "clients?select=id,name,status,color&order=name"),
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

// Per-client color: the assigned one, else a stable fallback from the name.
// Keep this palette + hash identical to public/client-color.js.
const CLIENT_PALETTE = ["#2f5d50", "#a9633a", "#3a5a7a", "#6b4a6e", "#2f6d62", "#8a5a2a", "#556b2f", "#7a3550", "#455a64", "#9a6a1a"];
function hashColor(name) {
  const s = (name || "").toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return s ? CLIENT_PALETTE[h % CLIENT_PALETTE.length] : "#21443a";
}
function clientColorFor(refs, name) {
  const c = (refs.clients || []).find((x) => (x.name || "").toLowerCase() === (name || "").toLowerCase());
  return (c && c.color) || hashColor(name);
}

/* ===================== Lists / options ===================== */

async function getLists(env, session) {
  const out = { clients: [], types: [], locations: [], serviceTypes: [] };
  if (!sbReady(env)) return out;
  const refs = await getRefs(env);
  out.clients = refs.clients.filter((c) => (c.status || "") !== "Churned").map((c) => c.name).sort((a, b) => a.localeCompare(b));
  // A client login only sees its own client in pickers.
  const forced = scopeName(session);
  if (forced != null) out.clients = out.clients.filter((n) => n === forced);
  out.types = refs.equip.filter((x) => x.active).map((x) => x.name);
  out.locations = refs.locs.filter((x) => x.active).map((x) => x.name);
  out.serviceTypes = refs.svc.filter((x) => x.active).map((x) => x.name);
  return out;
}

async function optionsHandler(env, session) {
  return noStore(await getLists(env, session));
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

async function diag(env, request) {
  // Diagnostics leak counts / auth / storage status, so once the app has any
  // login it's master-only. Before the first account exists (setup), it's open
  // so connectivity can be checked.
  if (await hasAnyUser(env)) {
    if (!(await requireMaster(request, env))) return json({ ok: false, error: "Master only." }, 403);
  }
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
    // Is the asset-link column there? (null = the asset_id column is missing)
    out.tickets.hasAssetLink = Array.isArray(await sbSelect(env, "tickets?select=asset_id&limit=1"));
    // Login readiness: are the accounts + token tables there?
    const users = await sbSelect(env, "app_users?select=email,role");
    const toks = await sbSelect(env, "login_tokens?select=token&limit=1");
    out.auth = {
      enforced: env.LOGIN_REQUIRED === "1",
      users: Array.isArray(users) ? users.length : null, // null = app_users table missing (run setup_all.sql)
      master: Array.isArray(users) ? users.filter((u) => u.role === "master").length : 0,
      tokensTable: Array.isArray(toks),
    };
    // Photo storage: make sure the bucket is public, then report its state.
    await ensureBucket(env);
    let bucket = null;
    try {
      const br = await fetch(`${env.SUPABASE_URL}/storage/v1/bucket/photos`, { headers: sbHeaders(env) });
      bucket = br.ok ? await br.json() : null;
    } catch {
      bucket = null;
    }
    out.storage = bucket ? { bucket: "photos", public: !!bucket.public } : { bucket: "missing" };
    // Actually try a write so we see the real reason uploads fail (if they do).
    try {
      const wr = await fetch(`${env.SUPABASE_URL}/storage/v1/object/photos/diag/test.txt`, {
        method: "POST",
        headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, "content-type": "text/plain", "x-upsert": "true" },
        body: "ringwood storage test",
      });
      out.storage.writeOk = wr.ok;
      if (!wr.ok) out.storage.writeError = (await wr.text()).slice(0, 300);
    } catch (e) {
      out.storage.writeOk = false;
      out.storage.writeError = String(e).slice(0, 300);
    }
  }
  return noStore(out);
}

async function createClient(request, env) {
  if (!(await requireMaster(request, env))) return json({ ok: false, error: "Master only." }, 403);
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

async function handleCreateAsset(request, env, ctx, session) {
  if (!sbReady(env)) return json({ ok: false, error: "The asset tracker isn't connected yet. Add SUPABASE_URL and SUPABASE_SERVICE_KEY in Cloudflare." }, 503);
  if (!can(session, "assets", "edit")) return deny("assets");

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
  const forcedClient = scopeName(session);
  const client = forcedClient != null ? forcedClient : clean(body.client);
  const notes = clean(body.notes);

  const label = [description || equipmentType || "Asset", client].filter(Boolean).join(" — ") || "Asset";

  const refs = await getRefs(env);
  const row = { name: label, verification: "Pending" };
  if (description) row.description = description;
  if (manufacturer) row.make = manufacturer;
  if (model) row.model = model;
  if (serial) row.serial = serial;
  if (notes) row.notes = notes;
  // Every asset gets a QR key by default (or the one the submitter assigned).
  // Only set a QR tag if one was provided (scanned/typed). Don't auto-generate —
  // a code is assigned on demand from the asset page.
  const qrTag = clean(body.qrTag);
  if (qrTag) row.qr_tag = qrTag;
  const etId = findId(refs.equip, equipmentType);
  const locId = findId(refs.locs, location);
  const clId = findId(refs.clients, client);
  if (etId) row.equipment_type_id = etId;
  if (locId) row.location_id = locId;
  if (clId) row.client_id = clId;
  // A short nickname: from the typed description, else the equipment type. The
  // AI fills/refines it in the background if photos were sent.
  const nickBase = description || equipmentType;
  if (nickBase) row.nickname = await uniqueNickname(env, nickBase, clId);

  const res = await sbInsert(env, "assets", row);
  if (!res.ok || !res.data) return json({ ok: false, error: "Could not save the asset." }, 502);
  const id = res.data.id;

  // Upload photos synchronously so they're saved before we reply.
  const pics = assetPicsFromBody(body);
  let savedPhotos = 0;
  if (pics.length) {
    const urls = [];
    for (let i = 0; i < pics.length; i++) {
      const u = await uploadToStorage(env, `assets/${id}/${i}.jpg`, pics[i].base64, pics[i].contentType);
      if (u) urls.push(u);
    }
    if (urls.length) {
      await sbUpdate(env, "assets", id, { photo_urls: urls });
      savedPhotos = urls.length;
    }
  }

  // Read the nameplate with Claude in the background (it's slow); it fills blanks.
  const manual = { description, manufacturer, model, serial, equipmentType };
  if (pics.length && ctx && ctx.waitUntil) ctx.waitUntil(processAssetAI(id, pics, manual, env));

  return json({ ok: true, id, savedPhotos });
}

// An asset's photos as one list: prefer the photo_urls array; fall back to the
// three legacy single-slot columns for assets created before the switch.
function assetPhotos(a) {
  if (a && Array.isArray(a.photo_urls) && a.photo_urls.length) return a.photo_urls.filter(Boolean);
  return [a && a.overall_photo_url, a && a.nameplate_photo_url, a && a.serial_photo_url].filter(Boolean);
}

// A unique, human-readable asset key like RW-7K2QM (skips confusable letters).
async function genAssetKey(env) {
  const alpha = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  for (let attempt = 0; attempt < 8; attempt++) {
    let s = "RW-";
    const r = crypto.getRandomValues(new Uint8Array(5));
    for (let i = 0; i < 5; i++) s += alpha[r[i] % alpha.length];
    const exists = await sbSelect(env, `assets?qr_tag=eq.${s}&select=id&limit=1`);
    if (!exists || !exists.length) return s;
  }
  return "RW-" + Date.now().toString(36).toUpperCase();
}

// Turn a short name into a unique nickname for the client: "Ice Machine", then
// "Ice Machine 2", "Ice Machine 3"... so repeats are easy to tell apart.
async function uniqueNickname(env, base, clientId) {
  base = (base || "").toString().trim();
  if (!base) return "";
  const scope = clientId ? `&client_id=eq.${clientId}` : "";
  const rows = await sbSelect(env, `assets?select=nickname&nickname=ilike.${encodeURIComponent(base)}*${scope}`);
  const taken = new Set((rows || []).map((r) => (r.nickname || "").trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has((base + " " + n).toLowerCase())) n++;
  return base + " " + n;
}

// Pull the submitted photos as a flat list. New clients send a `photos` array
// (overall first, then nameplate, then anything else); older ones may still
// send the three named slots.
function assetPicsFromBody(body) {
  if (Array.isArray(body.photos)) return body.photos.filter((p) => p && p.base64);
  return [body.overallPhoto, body.nameplatePhoto, body.serialPhoto].filter((p) => p && p.base64);
}

// Background: read the nameplate with Claude and fill in any blanks. Photos are
// already uploaded synchronously by handleCreateAsset.
async function processAssetAI(id, pics, manual, env) {
  const images = pics.map((p) => ({ media_type: p.contentType, base64: p.base64 }));
  if (!images.length || !env.ANTHROPIC_API_KEY) return;
  let read = null;
  try {
    read = await runAgent(images, env);
  } catch {
    read = null;
  }
  if (!read) return;
  const patch = { verification: "AI suggested" };
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
  // Set the short nickname only if the asset doesn't already have one.
  const cur = await sbSelect(env, `assets?id=eq.${id}&select=nickname,client_id`);
  const row0 = cur && cur[0];
  if (read.shortName && row0 && !(row0.nickname || "").trim()) {
    patch.nickname = await uniqueNickname(env, read.shortName, row0.client_id);
  }
  await sbUpdate(env, "assets", id, patch);
}

/* ----- the Ringwood AI agent (unchanged) ----- */

const AGENT_PROMPT =
  "You are Ringwood's asset agent. These photos show a piece of equipment and, where available, its data plate " +
  "and serial label. Identify the equipment and return clean, useful fields.\n\n" +
  "- assetName: a clear, specific name a facilities manager would use. Include the brand, the product line or model, " +
  "and what the thing is. Example: 'HP Color LaserJet Pro M255dw Printer'. Never return vague names like 'Other' or 'Unit'.\n" +
  "- shortName: the everyday name a person calls this kind of equipment, 1 to 3 words, Title Case, NO brand and NO model. " +
  "Examples: 'Ice Machine', 'Fridge', 'Freezer', 'Printer', 'Rooftop HVAC Unit', 'Espresso Machine'. Be specific about the kind: an espresso machine is 'Espresso Machine', not 'Coffee Machine'.\n" +
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
    shortName: { type: "string" },
    description: { type: "string" },
    manufacturer: { type: "string" },
    model: { type: "string" },
    serial: { type: "string" },
    equipmentType: { type: "string" },
  },
  required: ["assetName", "shortName", "description", "manufacturer", "model", "serial", "equipmentType"],
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
async function getAsset(url, env, session) {
  if (!can(session, "assets", "view")) return json({ ok: false }, 403);
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
async function getAssetFull(url, env, session) {
  if (!can(session, "assets", "view")) return json({ ok: false }, 403);
  const id = url.searchParams.get("id") || "";
  if (!id || !sbReady(env)) return json({ ok: false }, 400);
  const rows = await sbSelect(
    env,
    `assets?id=eq.${id}&select=*,equipment_type:equipment_types(name),location:locations(name),client:clients(name)`
  );
  const a = rows && rows[0];
  if (!a) return json({ ok: false }, 404);
  // A client login can only open its own assets.
  const forced = scopeName(session);
  if (forced != null && ((a.client && a.client.name) || "") !== forced) return json({ ok: false }, 404);

  // No QR auto-generation: an asset has no code until one is scanned/assigned or
  // generated on demand from the asset page.

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
    qr: a.qr_tag || "",
    nickname: a.nickname || "",
    loggedAt: a.logged_at || "",
    photos: assetPhotos(a),
    overallPhoto: a.overall_photo_url || "",
    nameplatePhoto: a.nameplate_photo_url || "",
    serialPhoto: a.serial_photo_url || "",
    services,
  });
}

// Re-run the agent on an asset's existing photos.
async function analyzeAsset(request, env, session) {
  if (!can(session, "assets", "edit")) return deny("assets");
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

// Generate a Ringwood QR code for an asset, on demand (only when asked).
async function generateAssetQr(request, env, session) {
  if (!sbReady(env)) return json({ ok: false, error: "Database not connected." }, 503);
  if (!can(session, "assets", "edit")) return deny("assets");
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const id = (body.id || "").trim();
  if (!id) return json({ ok: false, error: "No asset id." }, 400);
  if (!(await ownsRecord(env, session, "assets", id))) return json({ ok: false, error: "Not found." }, 404);
  const key = await genAssetKey(env);
  const res = await sbUpdate(env, "assets", id, { qr_tag: key });
  if (!res.ok) return json({ ok: false, error: "Could not generate a code." }, 502);
  return json({ ok: true, qr: key });
}

// Save manual edits; a human edit marks it Verified.
async function updateAsset(request, env, session) {
  if (!sbReady(env)) return json({ ok: false, error: "Database not connected." }, 503);
  if (!can(session, "assets", "edit")) return deny("assets");
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const id = (body.id || "").trim();
  if (!id) return json({ ok: false, error: "No asset id." }, 400);
  if (!(await ownsRecord(env, session, "assets", id))) return json({ ok: false, error: "Not found." }, 404);
  const c = (v) => (v == null ? "" : v.toString().trim());
  const refs = await getRefs(env);
  const patch = { verification: "Verified" };
  if ("name" in body) patch.name = c(body.name);
  if ("nickname" in body) patch.nickname = c(body.nickname);
  if ("description" in body) patch.description = c(body.description);
  if ("manufacturer" in body) patch.make = c(body.manufacturer);
  if ("model" in body) patch.model = c(body.model);
  if ("serial" in body) patch.serial = c(body.serial);
  if ("equipmentType" in body) patch.equipment_type_id = findId(refs.equip, c(body.equipmentType));
  if ("client" in body && scopeName(session) == null) patch.client_id = findId(refs.clients, c(body.client));
  if ("location" in body) patch.location_id = findId(refs.locs, c(body.location));
  if ("qrTag" in body) patch.qr_tag = c(body.qrTag);
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

// Master review queue: assets the AI created/suggested that a human should
// confirm, with a likely-duplicate flag so they can be merged.
async function assetsForReview(request, env) {
  if (!(await requireMaster(request, env))) return json({ ok: false, error: "Master only." }, 403);
  const all = await sbSelect(env, "assets?select=id,name,nickname,make,model,serial,verification,photo_urls,overall_photo_url,nameplate_photo_url,serial_photo_url,client_id,client:clients(name,color)&order=logged_at.desc");
  const baseOf = (s) => (s || "").replace(/\s+\d+$/, "").trim().toLowerCase(); // "Ice Machine 2" -> "ice machine"
  const list = (all || []).filter((a) => (a.verification || "Pending") !== "Verified");
  const assets = list.map((a) => {
    const ab = baseOf(a.nickname || a.name);
    // Prefer to merge INTO a Verified, lower/no-numbered sibling of the same client.
    let cand = null;
    for (const b of all || []) {
      if (b.id === a.id || b.client_id !== a.client_id) continue;
      if (baseOf(b.nickname || b.name) !== ab) continue;
      if (!cand) cand = b;
      else if ((b.verification === "Verified") && cand.verification !== "Verified") cand = b;
    }
    return {
      id: a.id,
      name: a.nickname || a.name || "Asset",
      fullName: a.name || "",
      client: (a.client && a.client.name) || "",
      clientColor: (a.client && a.client.color) || (a.client && a.client.name ? hashColor(a.client.name) : ""),
      make: a.make || "",
      model: a.model || "",
      serial: a.serial || "",
      verification: a.verification || "Pending",
      photo: assetPhotos(a)[0] || "",
      dup: cand ? { id: cand.id, name: cand.nickname || cand.name || "Asset" } : null,
    };
  });
  // For older assets created before photos were carried over, borrow a photo from
  // a ticket that points at the asset, so review still shows something.
  const needPhoto = assets.filter((a) => !a.photo).map((a) => a.id);
  if (needPhoto.length) {
    const tix = await sbSelect(env, `tickets?select=asset_id,photo_url,photo_urls&asset_id=in.(${needPhoto.join(",")})`);
    const byAsset = {};
    (tix || []).forEach((t) => {
      if (byAsset[t.asset_id]) return;
      const p = (t.photo_urls && t.photo_urls[0]) || t.photo_url || "";
      if (p) byAsset[t.asset_id] = p;
    });
    assets.forEach((a) => { if (!a.photo && byAsset[a.id]) a.photo = byAsset[a.id]; });
  }
  return noStore({ ok: true, assets });
}

// Merge one asset into another: move its tickets and service records over, then
// delete it.
async function mergeAssets(request, env, session) {
  if (!(await requireMaster(request, env))) return json({ ok: false, error: "Master only." }, 403);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const fromId = (body.fromId || "").trim(), intoId = (body.intoId || "").trim();
  if (!fromId || !intoId || fromId === intoId) return json({ ok: false, error: "Pick two different assets." }, 400);
  await fetch(`${env.SUPABASE_URL}/rest/v1/tickets?asset_id=eq.${fromId}`, { method: "PATCH", headers: sbHeaders(env, { Prefer: "return=minimal" }), body: JSON.stringify({ asset_id: intoId }) });
  await fetch(`${env.SUPABASE_URL}/rest/v1/service_records?asset_id=eq.${fromId}`, { method: "PATCH", headers: sbHeaders(env, { Prefer: "return=minimal" }), body: JSON.stringify({ asset_id: intoId }) });
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/assets?id=eq.${fromId}`, { method: "DELETE", headers: sbHeaders(env) });
  if (!r.ok) return json({ ok: false, error: "Could not merge." }, 502);
  return json({ ok: true });
}

async function deleteAsset(request, env, session) {
  if (!sbReady(env)) return json({ ok: false, error: "Database not connected." }, 503);
  if (!can(session, "assets", "edit")) return deny("assets");
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const id = (body.id || "").trim();
  if (!id) return json({ ok: false, error: "No asset id." }, 400);
  if (!(await ownsRecord(env, session, "assets", id))) return json({ ok: false, error: "Not found." }, 404);
  // Unlink references first so the delete isn't blocked by foreign keys.
  await fetch(`${env.SUPABASE_URL}/rest/v1/tickets?asset_id=eq.${id}`, { method: "PATCH", headers: sbHeaders(env, { Prefer: "return=minimal" }), body: JSON.stringify({ asset_id: null }) });
  await fetch(`${env.SUPABASE_URL}/rest/v1/service_records?asset_id=eq.${id}`, { method: "PATCH", headers: sbHeaders(env, { Prefer: "return=minimal" }), body: JSON.stringify({ asset_id: null }) });
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/assets?id=eq.${id}`, { method: "DELETE", headers: sbHeaders(env) });
  if (!r.ok) return json({ ok: false, error: "Could not delete the asset." }, 502);
  return json({ ok: true });
}

async function setVerified(request, env, session) {
  if (!sbReady(env)) return json({ ok: false, error: "Database not connected." }, 503);
  if (!can(session, "assets", "edit")) return deny("assets");
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

// Turn a scanned/typed code into an asset id. Accepts an /a/?id= link, a bare
// asset id (uuid or rec...), or a store-bought sticker matched on qr_tag. Honors
// client scope so a client login can't resolve another client's asset.
async function resolveAssetCode(url, env, session) {
  if (!sbReady(env) || !can(session, "assets", "view")) return json({ ok: false, error: "Not allowed." }, 403);
  const raw = (url.searchParams.get("code") || "").trim();
  if (!raw) return json({ ok: false, error: "No code." }, 400);
  let cand = raw;
  let m = raw.match(/[?&]id=([A-Za-z0-9-]+)/) || raw.match(/\/a\/([A-Za-z0-9-]+)/);
  if (m) cand = m[1];
  // Scope filter for client logins.
  let scope = "";
  const forced = scopeName(session);
  if (forced != null) {
    const refs = await getRefs(env);
    const cid = findId(refs.clients, forced);
    scope = cid ? `&client_id=eq.${cid}` : "&id=eq.00000000-0000-0000-0000-000000000000";
  }
  const nameOf = (r) => r.nickname || r.name || "Asset";
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cand);
  // A direct id from the link/typed value: confirm it exists in scope.
  if (isUuid) {
    const rows = await sbSelect(env, `assets?id=eq.${cand}${scope}&select=id,name,nickname&limit=1`);
    if (rows && rows.length) return json({ ok: true, id: rows[0].id, name: nameOf(rows[0]) });
  }
  // Otherwise match a sticker code (try the whole scan, then the extracted part).
  for (const v of [raw, cand]) {
    const rows = await sbSelect(env, `assets?qr_tag=eq.${encodeURIComponent(v)}${scope}&select=id,name,nickname&limit=1`);
    if (rows && rows.length) return json({ ok: true, id: rows[0].id, name: nameOf(rows[0]) });
  }
  return json({ ok: false, error: "No asset matches that code." });
}

async function listAssets(env, session) {
  if (!sbReady(env) || !can(session, "assets", "view")) return json([]);
  let filter = "";
  const forced = scopeName(session);
  if (forced != null) {
    const refs = await getRefs(env);
    const cid = findId(refs.clients, forced);
    filter = cid ? `&client_id=eq.${cid}` : "&id=eq.00000000-0000-0000-0000-000000000000";
  }
  let rows = await sbSelect(
    env,
    `assets?select=id,name,nickname,description,make,model,serial,qr_tag,logged_at,service_records(count),equipment_type:equipment_types(name),location:locations(name),client:clients(name)${filter}&order=logged_at.desc`
  );
  // If the count embed isn't supported, fall back to the plain list.
  if (rows === null) {
    rows = await sbSelect(
      env,
      `assets?select=id,name,nickname,description,make,model,serial,qr_tag,logged_at,equipment_type:equipment_types(name),location:locations(name),client:clients(name)${filter}&order=logged_at.desc`
    );
  }
  const cref = await getRefs(env);
  return json(
    (rows || []).map((x) => ({
      id: x.id,
      name: x.nickname || x.name || x.description || x.model || "Asset",
      fullName: x.name || "",
      client: (x.client && x.client.name) || "",
      clientColor: clientColorFor(cref, (x.client && x.client.name) || ""),
      type: (x.equipment_type && x.equipment_type.name) || "",
      location: (x.location && x.location.name) || "",
      model: x.model || "",
      make: x.make || "",
      serial: x.serial || "",
      qr: x.qr_tag || "",
      services: (x.service_records && x.service_records[0] && x.service_records[0].count) || 0,
      loggedAt: x.logged_at || "",
    }))
  );
}

/* ===================== Service records ===================== */

// All service records (scoped to the client for client logins) — the global view.
async function listAllServices(url, env, session) {
  if (!can(session, "service", "view") || !sbReady(env)) return json([]);
  let filter = "";
  const forced = scopeName(session);
  if (forced != null) {
    const refs = await getRefs(env);
    const cid = findId(refs.clients, forced);
    filter = cid ? `&client_id=eq.${cid}` : "&id=eq.00000000-0000-0000-0000-000000000000";
  }
  const rows = await sbSelect(
    env,
    `service_records?select=id,service_date,technician,notes,cost,asset_id,asset:assets(id,name,nickname),client:clients(name),service_type:service_types(name)${filter}&order=service_date.desc`
  );
  const cref = await getRefs(env);
  return json(
    (rows || []).map((s) => ({
      id: s.id,
      date: s.service_date || "",
      type: (s.service_type && s.service_type.name) || "",
      asset: (s.asset && (s.asset.nickname || s.asset.name)) || "",
      assetId: s.asset_id || "",
      client: (s.client && s.client.name) || "",
      clientColor: clientColorFor(cref, (s.client && s.client.name) || ""),
      technician: s.technician || "",
      notes: s.notes || "",
      cost: s.cost != null ? s.cost : "",
    }))
  );
}

async function listServices(url, env, session) {
  if (!can(session, "service", "view")) return json([]);
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

async function createService(request, env, ctx, session) {
  if (!sbReady(env)) return json({ ok: false, error: "Not connected yet." }, 503);
  if (!can(session, "service", "edit")) return deny("service");
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Could not read the submission." }, 400);
  }
  const clean = (v) => (v || "").toString().trim();
  const assetId = clean(body.assetId);
  if (!assetId) return json({ ok: false, error: "Please choose the asset this service is for." }, 400);
  if (!(await ownsRecord(env, session, "assets", assetId))) return json({ ok: false, error: "Not found." }, 404);
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

  // Upload photos synchronously so they're saved before we reply.
  const pics = Array.isArray(body.photos) ? body.photos : [];
  let savedPhotos = 0;
  if (pics.length) {
    const urls = [];
    for (let i = 0; i < pics.length; i++) {
      const u = await uploadToStorage(env, `service/${id}/${i}.jpg`, pics[i] && pics[i].base64, pics[i] && pics[i].contentType);
      if (u) urls.push(u);
    }
    if (urls.length) {
      await sbUpdate(env, "service_records", id, { photo_urls: urls });
      savedPhotos = urls.length;
    }
  }

  return json({ ok: true, id, savedPhotos });
}

async function getService(url, env, session) {
  if (!can(session, "service", "view")) return json({ ok: false }, 403);
  const id = url.searchParams.get("id") || "";
  if (!id || !sbReady(env)) return json({ ok: false }, 400);
  const rows = await sbSelect(env, `service_records?id=eq.${id}&select=service_date,technician,notes,cost,photo_urls,service_type:service_types(name)`);
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
    photos: f.photo_urls || [],
  });
}

async function updateService(request, env, session) {
  if (!sbReady(env)) return json({ ok: false, error: "Database not connected." }, 503);
  if (!can(session, "service", "edit")) return deny("service");
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const id = (body.id || "").trim();
  if (!id) return json({ ok: false, error: "No id." }, 400);
  if (!(await ownsRecord(env, session, "service_records", id))) return json({ ok: false, error: "Not found." }, 404);
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
  // Rebuild photos only when they actually changed (keep + new uploads).
  const hasKeep = Array.isArray(body.keepPhotos);
  const hasAdd = Array.isArray(body.addPhotos) && body.addPhotos.length;
  let photoPatch = null;
  if (hasKeep || hasAdd) {
    const cur = await sbSelect(env, `service_records?id=eq.${id}&select=photo_urls`);
    const current = cur && cur[0] && cur[0].photo_urls ? cur[0].photo_urls : [];
    let urls = hasKeep ? body.keepPhotos.filter(Boolean) : current.slice();
    if (hasAdd) {
      for (let i = 0; i < body.addPhotos.length; i++) {
        const p = body.addPhotos[i];
        if (!p || !p.base64) continue;
        const u = await uploadToStorage(env, `service/${id}/add-${Date.now()}-${i}.jpg`, p.base64, p.contentType);
        if (u) urls.push(u);
      }
    }
    const changed = hasAdd || urls.length !== current.length || urls.some((u, i) => u !== current[i]);
    if (changed) photoPatch = { photo_urls: urls };
  }

  if (Object.keys(patch).length) {
    const res = await sbUpdate(env, "service_records", id, patch);
    if (!res.ok) return json({ ok: false, error: ("Save failed. " + (res.error || "")).slice(0, 300) }, 502);
  }
  if (photoPatch) {
    const res2 = await sbUpdate(env, "service_records", id, photoPatch);
    if (!res2.ok) return json({ ok: false, error: ("Saved the details, but the photos did not update. " + (res2.error || "")).slice(0, 300) }, 502);
  }
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

// Work out the asset a ticket links to: an existing asset (id), a brand-new
// minimal asset (newAssetName), or nothing. Returns the asset id or null.
async function resolveTicketAsset(env, body, clientId, session) {
  const assetId = (body.assetId || "").toString().trim();
  const newName = (body.newAssetName || "").toString().trim();
  if (assetId) {
    if (!(await ownsRecord(env, session, "assets", assetId))) return null;
    return assetId;
  }
  if (newName) {
    const row = { name: newName, nickname: await uniqueNickname(env, newName, clientId), verification: "Pending" };
    if (clientId) row.client_id = clientId;
    const res = await sbInsert(env, "assets", row);
    if (res.ok && res.data) return res.data.id;
  }
  return null;
}

// Background: read the ticket's photos with the asset agent, find a matching
// asset (by serial, then make+model) or auto-create one, and link it to the
// ticket. Only creates an asset when it actually read equipment details, so
// non-equipment photos don't spawn junk assets.
async function detectAndLinkAsset(ticketId, pics, clientId, env, photoUrls) {
  if (!pics.length || !env.ANTHROPIC_API_KEY) return null;
  const images = pics.map((p) => ({ media_type: p.contentType, base64: p.base64 }));
  let read = null;
  try {
    read = await runAgent(images, env);
  } catch {
    read = null;
  }
  if (!read) return null;
  const c = (v) => (v || "").toString().trim();
  const serial = c(read.serial), make = c(read.manufacturer), model = c(read.model);
  if (!serial && !make && !model) return null; // no nameplate read -> don't invent an asset
  const scope = clientId ? `&client_id=eq.${clientId}` : "";
  let assetId = null;
  if (serial) {
    const m = await sbSelect(env, `assets?serial=eq.${encodeURIComponent(serial)}${scope}&select=id&limit=1`);
    if (m && m[0]) assetId = m[0].id;
  }
  if (!assetId && make && model) {
    const m = await sbSelect(env, `assets?make=eq.${encodeURIComponent(make)}&model=eq.${encodeURIComponent(model)}${scope}&select=id&limit=1`);
    if (m && m[0]) assetId = m[0].id;
  }
  // 3) match by the everyday type for this client (nickname or name), so a
  // second photo of the same kind links the existing asset instead of a twin.
  if (!assetId && c(read.shortName)) {
    const base = c(read.shortName);
    let m = await sbSelect(env, `assets?select=id&nickname=ilike.${encodeURIComponent(base)}*${scope}&limit=1`);
    if (!(m && m[0])) m = await sbSelect(env, `assets?select=id&name=ilike.*${encodeURIComponent(base)}*${scope}&limit=1`);
    if (m && m[0]) assetId = m[0].id;
  }
  if (!assetId) {
    const row = { name: c(read.assetName) || [make, model].filter(Boolean).join(" ") || "Asset", verification: "AI suggested", nameplate_reading: buildReadingNote(read) };
    if (c(read.shortName)) row.nickname = await uniqueNickname(env, c(read.shortName), clientId);
    if (make) row.make = make;
    if (model) row.model = model;
    if (serial) row.serial = serial;
    if (c(read.description)) row.description = c(read.description);
    if (clientId) row.client_id = clientId;
    if (c(read.equipmentType)) {
      const refs = await getRefs(env);
      const et = findId(refs.equip, c(read.equipmentType));
      if (et) row.equipment_type_id = et;
    }
    // Carry the ticket's photos onto the new asset so review and the asset page
    // show what the AI looked at, instead of "no photo".
    if (Array.isArray(photoUrls) && photoUrls.length) {
      row.photo_urls = photoUrls.filter(Boolean);
      row.overall_photo_url = photoUrls[0];
    }
    const ins = await sbInsert(env, "assets", row);
    if (ins.ok && ins.data) assetId = ins.data.id;
  }
  if (assetId) await sbUpdate(env, "tickets", ticketId, { asset_id: assetId });
  return assetId || null;
}

// After a ticket is filed, draft it the way the asset agent reads a nameplate:
// identify/link the equipment from the photos, then write a clean title,
// description, and category from the report + equipment + photos, and leave an
// "agent reading" entry in the update log. The ticket stays Needs review.
async function autoEnrichTicket(ticketId, opts, env) {
  try {
    if (!env.ANTHROPIC_API_KEY) return;
    const pics = opts.pics || [];
    const photoUrls = (opts.photoUrls || []).filter(Boolean);
    let assetId = opts.assetId || null;
    let assetName = "";
    // Identify the equipment from the photos if it wasn't picked/scanned.
    if (!assetId && pics.length) {
      assetId = await detectAndLinkAsset(ticketId, pics, opts.clientId, env, photoUrls);
    }
    if (assetId) {
      const a = await sbSelect(env, `assets?id=eq.${assetId}&select=name,nickname&limit=1`);
      if (a && a[0]) assetName = a[0].nickname || a[0].name || "";
    }
    const fields = await suggestTicketFields({ note: opts.note || "", asset: assetName, pics, urlPics: photoUrls, env });
    if (!fields) return;
    const patch = {};
    if (fields.title) patch.title = fields.title;
    if (fields.description) patch.description = fields.description;
    if (fields.category) {
      const refs = await getRefs(env);
      const cid = findId(refs.cats, fields.category);
      if (cid) patch.category_id = cid;
    }
    if (Object.keys(patch).length) await sbUpdate(env, "tickets", ticketId, patch);
    // Preserve exactly what the customer entered as a dedicated "intake" record,
    // so the ticket can show a collapsible "Entered by <client>" block separate
    // from the AI draft. (kind=intake keeps it out of the normal note stream.)
    if (opts.note) {
      await sbInsert(env, "ticket_comments", { ticket_id: ticketId, author: opts.clientName || "Customer", role: "client", kind: "intake", body: opts.note.slice(0, 4000) });
    }
    // Leave a short agent reading in the log too.
    const lines = ["✨ Ringwood AI Agent read this report" + (pics.length ? " and the photos" : "") + " and drafted the ticket for review."];
    if (assetName) lines.push("Linked equipment: " + assetName + ".");
    await sbInsert(env, "ticket_comments", { ticket_id: ticketId, author: "Ringwood AI Agent", role: "agent", kind: "event", body: lines.join("\n").slice(0, 4000) });
  } catch {
    /* background best-effort; never blocks the submit */
  }
}

async function createTicket(request, env, ctx, session) {
  if (!sbReady(env)) return json({ ok: false, error: "Not connected yet." }, 503);
  if (!can(session, "tickets", "edit")) return deny("tickets");
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const ref = "RW-" + Math.floor(1000 + Math.random() * 9000);
  const category = body.category || "Other";
  // A client login can only file against its own client.
  const forced = scopeName(session);
  const client = forced != null ? forced : body.client || "";
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
  const linkAsset = await resolveTicketAsset(env, body, clId, session);
  if (linkAsset) row.asset_id = linkAsset;

  const res = await sbInsert(env, "tickets", row);
  if (!res.ok || !res.data) return json({ ok: false, error: ("Could not save the ticket. " + (res.error || "")).slice(0, 300) }, 502);
  const id = res.data.id;

  // Upload photos synchronously so the ticket truly carries them before we reply
  // (and we can report exactly how many saved).
  const pics = normalizePics(body);
  let savedPhotos = 0;
  let savedUrls = [];
  if (pics.length) {
    const urls = [];
    for (let i = 0; i < pics.length; i++) {
      const u = await uploadToStorage(env, `tickets/${id}/${i}.jpg`, pics[i].base64, pics[i].contentType);
      if (u) urls.push(u);
    }
    if (urls.length) {
      await sbUpdate(env, "tickets", id, { photo_urls: urls, photo_url: urls[0] });
      savedPhotos = urls.length;
      savedUrls = urls;
    }
  }

  // In the background, let the agent draft the ticket: identify the equipment
  // from the photos (if not already picked), then write a clean title,
  // description, and category and leave an agent reading in the log. Mirrors how
  // the asset agent reads a nameplate. Never blocks the submit response.
  let detecting = false;
  if (env.ANTHROPIC_API_KEY && (note || pics.length) && ctx && ctx.waitUntil) {
    detecting = !linkAsset && pics.length > 0; // the UI's "identifying…" hint only applies when detecting an asset
    ctx.waitUntil(autoEnrichTicket(id, { note, pics, photoUrls: savedUrls, clientId: clId, clientName: client, assetId: linkAsset || null }, env));
  }

  return json({ ok: true, id, ref, title, photoCount: pics.length, savedPhotos, detecting });
}

// Lightweight: the asset currently linked to a ticket (for the "identifying…" poll).
async function getTicketAsset(url, env, session) {
  if (!can(session, "tickets", "view")) return json({ ok: false }, 403);
  const id = url.searchParams.get("id") || "";
  if (!id || !sbReady(env)) return json({ ok: false }, 400);
  const rows = await sbSelect(env, `tickets?id=eq.${id}&select=asset_id,asset:assets(id,name,nickname),client:clients(name)`);
  const t = rows && rows[0];
  if (!t) return json({ ok: false }, 404);
  const forced = scopeName(session);
  if (forced != null && ((t.client && t.client.name) || "") !== forced) return json({ ok: false }, 404);
  return noStore({ ok: true, assetId: t.asset_id || "", asset: (t.asset && (t.asset.nickname || t.asset.name)) || "" });
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
        messages: [{ role: "user", content:
          "Write a short, action-led title for this facilities ticket so someone scanning a list instantly knows the job. " +
          "Start with a verb (Repair, Replace, Install, Reattach, Configure, Remove, Patch, Clean, Restore...). " +
          "Name the specific thing, and where if it is clear. Max 7 words, Title Case, no quotes, no period, no client name, no category label. " +
          "Describe only what the request says. Do not invent details.\n" +
          "Example request: 'The vehicle's factory radio/head unit needs to be replaced.' -> 'Replace Vehicle Radio/Head Unit'\n" +
          "Category: " + category + "\nRequest: " + description }],
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

// The short everyday name for an asset, from its existing fields (no photos needed).
async function shortNameFromAsset(a, env) {
  const ctx = [a.name, a.make, a.model, a.equipmentType].filter(Boolean).join(" / ");
  if (!ctx) return "";
  try {
    const schema = { type: "object", properties: { shortName: { type: "string" } }, required: ["shortName"], additionalProperties: false };
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 40,
        messages: [{ role: "user", content:
          "Give the everyday name a person calls this kind of equipment: 1 to 3 words, Title Case, NO brand and NO model number. " +
          "Examples: 'Ice Machine', 'Fridge', 'Freezer', 'Printer', 'Rooftop HVAC Unit', 'Espresso Machine'. Be specific about the kind: an espresso machine is 'Espresso Machine', not 'Coffee Machine'.\n" +
          "Equipment: " + ctx }],
        output_config: { format: { type: "json_schema", schema } },
      }),
    });
    if (!res.ok) return "";
    const data = await res.json();
    const block = (data.content || []).find((b) => b.type === "text");
    if (!block) return "";
    return (JSON.parse(block.text).shortName || "").trim().replace(/^["']|["']$/g, "").slice(0, 40);
  } catch {
    return "";
  }
}

// One-shot (master): give every asset that lacks a nickname a short AI nickname,
// auto-numbered per client. Leaves any nickname you've already set alone.
async function nicknameAllAssets(request, env) {
  if (!(await requireMaster(request, env))) return json({ ok: false, error: "Master only." }, 403);
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: "The assistant is not connected." }, 503);
  const rows = await sbSelect(env, "assets?select=id,name,nickname,make,model,client_id,equipment_type:equipment_types(name)&order=logged_at.desc");
  let checked = 0, updated = 0;
  for (const a of rows || []) {
    if ((a.nickname || "").trim()) continue;
    checked++;
    const sn = await shortNameFromAsset({ name: a.name, make: a.make, model: a.model, equipmentType: a.equipment_type && a.equipment_type.name }, env);
    if (sn) {
      const nick = await uniqueNickname(env, sn, a.client_id);
      await sbUpdate(env, "assets", a.id, { nickname: nick });
      updated++;
    }
  }
  return noStore({ ok: true, checked, updated });
}

// One-time backfill: regenerate the plain "Category · Client" titles on older
// tickets into proper action-led titles. Only touches tickets that still have a
// fallback-looking title and an actual description to work from.
async function retitleTickets(request, env) {
  if (!(await requireMaster(request, env))) return json({ ok: false, error: "Master only." }, 403);
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: "The assistant is not connected." }, 503);
  if (!sbReady(env)) return json({ ok: false, error: "Database not connected." }, 503);
  const rows = await sbSelect(env, "tickets?select=id,title,ref,description,category:ticket_categories(name)&order=created_at.desc");
  let updated = 0, checked = 0;
  for (const t of rows || []) {
    const desc = (t.description || "").trim();
    if (!desc) continue;
    const title = t.title || "";
    const looksFallback = !title || title === t.ref || title.indexOf(" · ") >= 0;
    if (!looksFallback) continue;
    checked++;
    const cat = (t.category && t.category.name) || "";
    const nt = await titleFromDescription(desc, cat, env);
    if (nt) {
      await sbUpdate(env, "tickets", t.id, { title: nt });
      updated++;
    }
  }
  return noStore({ ok: true, checked, updated });
}

// List the files saved under a storage prefix (e.g. "tickets/<id>/").
async function listStorage(env, prefix) {
  try {
    const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/list/photos`, {
      method: "POST",
      headers: sbHeaders(env),
      body: JSON.stringify({ prefix, limit: 100, sortBy: { column: "name", order: "asc" } }),
    });
    if (!r.ok) return [];
    return await r.json();
  } catch {
    return [];
  }
}

// Recovery: for any ticket whose photo_urls is empty, look for photo files left
// in storage (uploads that never got linked) and re-link them.
async function relinkTicketPhotos(request, env) {
  if (!(await requireMaster(request, env))) return json({ ok: false, error: "Master only." }, 403);
  const rows = await sbSelect(env, "tickets?select=id,ref,photo_urls");
  let fixed = 0, scanned = 0;
  const fixedRefs = [];
  for (const t of rows || []) {
    if (t.photo_urls && t.photo_urls.length) continue;
    scanned++;
    const objs = await listStorage(env, `tickets/${t.id}/`);
    const urls = (objs || [])
      .filter((o) => o && o.id && o.name && !o.name.endsWith("/"))
      .map((o) => `${env.SUPABASE_URL}/storage/v1/object/public/photos/tickets/${t.id}/${o.name}`);
    if (urls.length) {
      await sbUpdate(env, "tickets", t.id, { photo_urls: urls, photo_url: urls[0] });
      fixed++;
      fixedRefs.push((t.ref || t.id) + " (" + urls.length + ")");
    }
  }
  return noStore({ ok: true, scanned, fixed, fixedRefs });
}

async function listTickets(url, env, session) {
  if (!sbReady(env) || !can(session, "tickets", "view")) return json([]);
  // A client login only ever sees its own tickets, regardless of the filter.
  const forced = scopeName(session);
  const client = forced != null ? forced : url.searchParams.get("client") || "";
  const showArchived = url.searchParams.get("archived") === "1";
  const refs = await getRefs(env);
  let filter = "";
  if (client === "__unassigned") filter = "&client_id=is.null";
  else if (client) {
    const cid = findId(refs.clients, client);
    filter = cid ? `&client_id=eq.${cid}` : "&id=eq.00000000-0000-0000-0000-000000000000";
  }
  const assetId = url.searchParams.get("assetId") || "";
  if (assetId) filter += `&asset_id=eq.${assetId}`;
  // Archived tickets are master-only. Clients see Open and Closed (Complete), but
  // never Archived, no matter what the filter asks for.
  const isClient = session && session.role === "client";
  if (!showArchived || isClient) filter += "&status=neq.Archived";

  let rows = await sbSelect(
    env,
    `tickets?select=id,ref,title,description,location,status,reviewed,assigned_to,photo_url,photo_urls,created_at,asset_id,category:ticket_categories(name),client:clients(name),asset:assets(id,name,nickname)${filter}&order=created_at.desc`
  );
  // If the foreign-key embed fails (returns null), fall back to a plain read so
  // tickets still show. Resolve client/category names from the cached refs.
  let embedded = true;
  if (rows === null) {
    embedded = false;
    rows = await sbSelect(env, `tickets?select=*${filter}&order=created_at.desc`);
  }
  const nameById = (arr, id) => { const m = (arr || []).find((x) => x.id === id); return m ? m.name : ""; };

  // Latest activity per ticket: the most recent note/event time, or the ticket's
  // own created time if it has none. Lets the list sort by what changed most
  // recently. Resilient: if the comments table is missing, fall back to created.
  const lastActById = {};
  const ids = (rows || []).map((t) => t.id).filter(Boolean);
  if (ids.length) {
    const cmts = await sbSelect(env, `ticket_comments?select=ticket_id,created_at&ticket_id=in.(${ids.join(",")})`);
    (cmts || []).forEach((c) => {
      const cur = lastActById[c.ticket_id];
      if (!cur || (c.created_at || "") > cur) lastActById[c.ticket_id] = c.created_at || "";
    });
  }

  return json(
    (rows || []).map((t) => {
      const cAct = lastActById[t.id] || "";
      const created = t.created_at || "";
      return {
        id: t.id,
        title: t.title || "Ticket",
        category: embedded ? ((t.category && t.category.name) || "") : nameById(refs.cats, t.category_id),
        client: embedded ? ((t.client && t.client.name) || "") : nameById(refs.clients, t.client_id),
        clientColor: clientColorFor(refs, embedded ? ((t.client && t.client.name) || "") : nameById(refs.clients, t.client_id)),
        assetId: t.asset_id || "",
        asset: embedded ? ((t.asset && (t.asset.nickname || t.asset.name)) || "") : "",
        status: t.status || "Open",
        description: t.description || "",
        ref: t.ref || "",
        location: t.location || "",
        photo: t.photo_url || "",
        photos: t.photo_urls || (t.photo_url ? [t.photo_url] : []),
        reviewed: t.reviewed === true,
        assignedTo: t.assigned_to || "",
        created: created,
        lastActivity: cAct > created ? cAct : created,
        hasNote: !!cAct,
      };
    })
  );
}

// The label to show for who wrote a comment / made a change.
function authorOf(session) {
  if (!session) return { author: "Ringwood", role: "master" };
  if (session.role === "master") return { author: "Ringwood", role: "master" };
  return { author: session.client || "Client", role: "client" };
}

async function listTicketComments(url, env, session) {
  if (!can(session, "tickets", "view")) return json([]);
  const id = url.searchParams.get("id") || "";
  if (!id || !sbReady(env)) return json([]);
  if (!(await ownsRecord(env, session, "tickets", id))) return json([]);
  const rows = await sbSelect(env, `ticket_comments?ticket_id=eq.${id}&select=id,author,role,kind,body,photo_urls,created_at&order=created_at.asc`);
  return json(
    (rows || []).map((c) => ({ id: c.id, author: c.author, role: c.role, kind: c.kind || "note", body: c.body || "", photos: c.photo_urls || [], created: c.created_at || "" }))
  );
}

async function addTicketComment(request, env, session) {
  if (!sbReady(env)) return json({ ok: false, error: "Database not connected." }, 503);
  if (!can(session, "tickets", "view")) return deny("tickets");
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const id = (body.id || "").trim();
  const text = (body.body || "").toString().trim();
  const pics = normalizePics(body);
  if (!id || (!text && !pics.length)) return json({ ok: false, error: "Write a note or add a photo first." }, 400);
  if (!(await ownsRecord(env, session, "tickets", id))) return json({ ok: false, error: "Not found." }, 404);
  const a = authorOf(session);
  const res = await sbInsert(env, "ticket_comments", { ticket_id: id, author: a.author, role: a.role, kind: "note", body: text.slice(0, 4000) });
  if (!res.ok || !res.data) return json({ ok: false, error: "Could not add the note." }, 502);
  const cid = res.data.id;

  // Photos attached to the note: stored under the note, shown inline in the log.
  let topPhotos = null;
  if (pics.length) {
    const urls = [];
    for (let i = 0; i < pics.length; i++) {
      const u = await uploadToStorage(env, `tickets/${id}/notes/${cid}-${i}.jpg`, pics[i].base64, pics[i].contentType);
      if (u) urls.push(u);
    }
    if (urls.length) {
      await sbUpdate(env, "ticket_comments", cid, { photo_urls: urls });
      // Optionally also append to the ticket's top photo set.
      if (body.alsoTop) {
        const cur = await sbSelect(env, `tickets?id=eq.${id}&select=photo_urls`);
        const existing = cur && cur[0] && cur[0].photo_urls ? cur[0].photo_urls : [];
        const merged = existing.concat(urls.filter((u) => existing.indexOf(u) < 0));
        await sbUpdate(env, "tickets", id, { photo_urls: merged, photo_url: merged[0] });
        topPhotos = merged;
      }
    }
  }
  return json({ ok: true, topPhotos });
}

// Promote a note's photos to the ticket's top photo set (no re-upload needed).
async function promoteCommentPhotos(request, env, session) {
  if (!sbReady(env)) return json({ ok: false, error: "Database not connected." }, 503);
  if (!can(session, "tickets", "edit")) return deny("tickets");
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const cid = (body.commentId || "").trim();
  if (!cid) return json({ ok: false, error: "Bad request." }, 400);
  const rows = await sbSelect(env, `ticket_comments?id=eq.${cid}&select=ticket_id,photo_urls`);
  const c = rows && rows[0];
  if (!c || !c.ticket_id) return json({ ok: false, error: "Not found." }, 404);
  if (!(await ownsRecord(env, session, "tickets", c.ticket_id))) return json({ ok: false, error: "Not found." }, 404);
  const notePhotos = Array.isArray(c.photo_urls) ? c.photo_urls.filter(Boolean) : [];
  if (!notePhotos.length) return json({ ok: false, error: "This note has no photos." }, 400);
  const cur = await sbSelect(env, `tickets?id=eq.${c.ticket_id}&select=photo_urls`);
  const existing = cur && cur[0] && cur[0].photo_urls ? cur[0].photo_urls : [];
  const merged = existing.concat(notePhotos.filter((u) => existing.indexOf(u) < 0));
  const res = await sbUpdate(env, "tickets", c.ticket_id, { photo_urls: merged, photo_url: merged[0] });
  if (!res.ok) return json({ ok: false, error: "Could not move the photos." }, 502);
  return json({ ok: true, topPhotos: merged });
}

// Master-only: edit the text of a note on a ticket.
async function updateTicketComment(request, env, session) {
  if (!sbReady(env)) return json({ ok: false, error: "Database not connected." }, 503);
  if (!session || session.role !== "master") return json({ ok: false, error: "Master only." }, 403);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const cid = (body.commentId || "").trim();
  const text = (body.body || "").toString().trim();
  if (!cid || !text) return json({ ok: false, error: "Nothing to save." }, 400);
  const rows = await sbSelect(env, `ticket_comments?id=eq.${cid}&select=id,kind`);
  const row = rows && rows[0];
  if (!row) return json({ ok: false, error: "Not found." }, 404);
  if (row.kind === "event") return json({ ok: false, error: "Status events can't be edited." }, 400);
  const res = await sbUpdate(env, "ticket_comments", cid, { body: text.slice(0, 4000) });
  if (!res.ok) return json({ ok: false, error: "Could not save the change." }, 502);
  return json({ ok: true });
}

// Master-only: delete a comment (note or event) from a ticket.
async function deleteTicketComment(request, env, session) {
  if (!sbReady(env)) return json({ ok: false, error: "Database not connected." }, 503);
  if (!session || session.role !== "master") return json({ ok: false, error: "Master only." }, 403);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const cid = (body.commentId || "").trim();
  if (!cid) return json({ ok: false, error: "Bad request." }, 400);
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/ticket_comments?id=eq.${cid}`, { method: "DELETE", headers: sbHeaders(env) });
    if (!r.ok) return json({ ok: false, error: "Could not delete." }, 502);
  } catch {
    return json({ ok: false, error: "Could not delete." }, 502);
  }
  return json({ ok: true });
}

// Record an automatic event on a ticket (e.g., a status change).
async function logTicketEvent(env, ticketId, session, text) {
  const a = authorOf(session);
  await sbInsert(env, "ticket_comments", { ticket_id: ticketId, author: a.author, role: a.role, kind: "event", body: text });
}

// Master-only: permanently delete a ticket (its log/comments cascade away).
async function deleteTicket(request, env, session) {
  if (!(await requireMaster(request, env))) return json({ ok: false, error: "Master only." }, 403);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const id = (body.id || "").trim();
  if (!id) return json({ ok: false, error: "No ticket id." }, 400);
  try {
    const r = await fetchT(`${env.SUPABASE_URL}/rest/v1/tickets?id=eq.${id}`, { method: "DELETE", headers: sbHeaders(env) });
    if (!r.ok) return json({ ok: false, error: "Could not delete the ticket." }, 502);
  } catch {
    return json({ ok: false, error: "Could not delete the ticket." }, 502);
  }
  return json({ ok: true });
}

async function updateTicket(request, env, session) {
  if (!sbReady(env)) return json({ ok: false, error: "Database not connected." }, 503);
  if (!can(session, "tickets", "edit")) return deny("tickets");
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const id = (body.id || "").trim();
  if (!id) return json({ ok: false, error: "No ticket id." }, 400);
  if (!(await ownsRecord(env, session, "tickets", id))) return json({ ok: false, error: "Not found." }, 404);
  // A client gets a simple experience: add photos and notes, and dismiss
  // (Archive) or reopen their ticket. Everything else (review/confirm, status
  // beyond Archive/reopen, title, category, location, assigned tech, asset,
  // description) is admin-only. Strip those server-side so the API can't be used
  // to bypass the simpler UI.
  if (session && session.role === "client") {
    ["reviewed", "assignedTo", "title", "category", "location", "description", "assetId", "newAssetName"].forEach(function (k) { delete body[k]; });
    if (body.status && body.status !== "Open" && body.status !== "Archived") delete body.status;
  }
  const refs = await getRefs(env);
  // Remember the status so we can log a change event.
  let prevStatus = null;
  if ("status" in body) {
    const curT = await sbSelect(env, `tickets?id=eq.${id}&select=status`);
    prevStatus = curT && curT[0] ? curT[0].status : null;
  }
  const patch = {};
  if ("status" in body) patch.status = body.status;
  if ("category" in body) patch.category_id = findId(refs.cats, body.category);
  if ("description" in body) patch.description = body.description;
  if ("location" in body) patch.location = body.location;
  if ("title" in body && body.title) patch.title = body.title;
  if ("reviewed" in body) patch.reviewed = !!body.reviewed;
  if ("assignedTo" in body) patch.assigned_to = (body.assignedTo || "").toString().trim() || null;
  if ("client" in body && scopeName(session) == null) patch.client_id = body.client ? findId(refs.clients, body.client) : null;
  // Link / relink / unlink an asset.
  if ("assetId" in body) {
    const aid = (body.assetId || "").toString().trim();
    if (aid) { if (await ownsRecord(env, session, "assets", aid)) patch.asset_id = aid; }
    else patch.asset_id = null;
  } else if (body.newAssetName) {
    const tr = await sbSelect(env, `tickets?id=eq.${id}&select=client_id`);
    const cid = tr && tr[0] ? tr[0].client_id : null;
    const ar = await sbInsert(env, "assets", { name: body.newAssetName.toString().trim(), verification: "Pending", client_id: cid });
    if (ar.ok && ar.data) patch.asset_id = ar.data.id;
  }
  // Only touch the photo columns when the photos actually changed. The editor
  // always sends keepPhotos, so writing them every time would (a) be wasteful
  // and (b) fail an ordinary status/text save if anything about the photo write
  // is off. Apply the core fields first so a change like Archive always lands.
  const hasKeep = Array.isArray(body.keepPhotos);
  const hasAdd = Array.isArray(body.addPhotos) && body.addPhotos.length;
  let photoPatch = null;
  let finalPhotos = null;
  let addFailed = 0;
  if (hasKeep || hasAdd) {
    const cur = await sbSelect(env, `tickets?id=eq.${id}&select=photo_urls`);
    const current = cur && cur[0] && cur[0].photo_urls ? cur[0].photo_urls : [];
    let urls = hasKeep ? body.keepPhotos.filter(Boolean) : current.slice();
    if (hasAdd) {
      for (let i = 0; i < body.addPhotos.length; i++) {
        const p = body.addPhotos[i];
        if (!p || !p.base64) continue;
        const u = await uploadToStorage(env, `tickets/${id}/add-${Date.now()}-${i}.jpg`, p.base64, p.contentType);
        if (u) urls.push(u);
        else addFailed++;
      }
    }
    const changed = hasAdd || urls.length !== current.length || urls.some((u, i) => u !== current[i]);
    if (changed) photoPatch = { photo_urls: urls, photo_url: urls.length ? urls[0] : null };
    finalPhotos = urls;
  }

  if (Object.keys(patch).length) {
    const res = await sbUpdate(env, "tickets", id, patch);
    if (!res.ok) return json({ ok: false, error: ("Save failed. " + (res.error || "")).slice(0, 300) }, 502);
    if ("status" in body && prevStatus && body.status && body.status !== prevStatus) {
      await logTicketEvent(env, id, session, "Status changed from " + prevStatus + " to " + body.status);
    }
    if ("reviewed" in body && body.reviewed === true) {
      await logTicketEvent(env, id, session, "Marked reviewed");
    }
    if ("assignedTo" in body && (body.assignedTo || "").toString().trim()) {
      await logTicketEvent(env, id, session, "Assigned to " + body.assignedTo.toString().trim());
    }
  }
  if (photoPatch) {
    const res2 = await sbUpdate(env, "tickets", id, photoPatch);
    if (!res2.ok) return json({ ok: false, error: ("Saved the details, but the photos did not update. " + (res2.error || "")).slice(0, 300) }, 502);
  }
  return json({
    ok: true,
    photos: finalPhotos,
    photoWarning: addFailed ? addFailed + " photo" + (addFailed === 1 ? "" : "s") + " didn't upload. Try adding " + (addFailed === 1 ? "it" : "them") + " again." : undefined,
  });
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
// Clean up a free-text note (service note, ticket update) into clear, plain
// language without inventing anything. Returns { ok, text } for the caller to
// preview before saving.
async function polishNote(request, env, session) {
  if (!session || !(can(session, "service", "edit") || can(session, "tickets", "edit") || can(session, "assets", "edit"))) {
    return json({ ok: false, error: "Not allowed." }, 403);
  }
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: "The assistant is not connected." }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const text = (body.text || "").toString().trim();
  if (!text) return json({ ok: false, error: "Write a note first." }, 400);
  const kind = (body.kind || "note").toString();
  const schema = { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        messages: [{ role: "user", content:
          "Clean up this " + (kind === "service" ? "field service note" : "work note") + " into clear, professional, plain language. " +
          "Fix spelling and grammar, tighten wording, and make it easy to scan. " +
          "Keep every fact and the original meaning. Do NOT invent details, numbers, parts, or names that are not in the note. " +
          "No marketing words, no em dashes. Return only the cleaned note.\n\nNote: " + text }],
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
    const cleaned = (out.text || "").trim();
    return json({ ok: true, text: cleaned || text });
  } catch {
    return json({ ok: false, error: "Couldn't reach the assistant." }, 502);
  }
}

async function suggestTicket(request, env, session) {
  if (!can(session, "tickets", "edit")) return deny("tickets");
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: "The assistant is not connected." }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const note = (body.note || "").toString().trim();
  const asset = (body.asset || "").toString().trim();
  const pics = normalizePics(body);
  const urlPics = Array.isArray(body.photoUrls) ? body.photoUrls.filter(Boolean) : [];
  if (!note && !asset && !pics.length && !urlPics.length) return json({ ok: false, error: "Add a photo or a few words first." }, 400);
  const out = await suggestTicketFields({ note, asset, pics, urlPics, env });
  if (!out) return json({ ok: false, error: "The assistant couldn't respond." }, 502);
  return json({ ok: true, description: out.description || "", category: out.category || "", title: out.title || "" });
}

// The shared AI pass behind "Rewrite with AI" and the automatic enrichment on
// submit. Reads the note, the named/linked equipment, and any photos, and
// returns a clean { title, description, category }. Returns null on failure.
async function suggestTicketFields({ note, asset, pics, urlPics, env }) {
  note = (note || "").toString().trim();
  asset = (asset || "").toString().trim();
  pics = pics || [];
  urlPics = (urlPics || []).filter(Boolean);
  if (!env.ANTHROPIC_API_KEY) return null;
  if (!note && !asset && !pics.length && !urlPics.length) return null;

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
    "- title: a short, specific title (max 8 words, Title Case, no quotes, no period). Name the actual thing and what is happening, not the category. Prefer 'Label Maker Won't Turn On' over 'Repair'.\n\n" +
    (asset ? "This ticket is about a specific piece of equipment: \"" + asset + "\". Use that exact name in the title and description (e.g. \"" + asset + " Won't Turn On\").\n" : "") +
    "Important: describe only what the photos, note, and the named equipment actually show or say. Do NOT invent brands, model numbers, measurements, dimensions, names, or any detail you cannot verify. If something is unclear, keep it general or leave it out.\n" +
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
    if (!res.ok) return null;
    const data = await res.json();
    const block = (data.content || []).find((b) => b.type === "text");
    if (!block) return null;
    let out;
    try {
      out = JSON.parse(block.text);
    } catch {
      return null;
    }
    const match = cats.find((c) => c.toLowerCase() === (out.category || "").toLowerCase());
    const title = (out.title || "").trim().replace(/^["']|["']$/g, "").replace(/\.$/, "").slice(0, 90);
    return { description: out.description || "", category: match || "", title: title };
  } catch {
    return null;
  }
}

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
    if (url.pathname === "/api/options" && request.method === "GET") return optionsHandler(env, session);
    if (url.pathname === "/api/diag" && request.method === "GET") return diag(env);
    if (url.pathname === "/api/clients" && request.method === "POST") return createClient(request, env);
    if (url.pathname === "/api/picklist" && request.method === "POST") return createPicklistValue(request, env);
    if (url.pathname === "/api/service/get" && request.method === "GET") return getService(url, env, session);
    if (url.pathname === "/api/service/update" && request.method === "POST") return updateService(request, env, session);
    if (url.pathname === "/api/assets/get" && request.method === "GET") return getAsset(url, env, session);
    if (url.pathname === "/api/asset" && request.method === "GET") return getAssetFull(url, env, session);
    if (url.pathname === "/api/asset/analyze" && request.method === "POST") return analyzeAsset(request, env, session);
    if (url.pathname === "/api/asset/update" && request.method === "POST") return updateAsset(request, env, session);
    if (url.pathname === "/api/asset/verify" && request.method === "POST") return setVerified(request, env, session);
    if (url.pathname === "/api/service" && request.method === "POST") return createService(request, env, ctx, session);
    if (url.pathname === "/api/service/list" && request.method === "GET") return listServices(url, env, session);
    if (url.pathname === "/api/contact" && request.method === "POST") return createContact(request, env);
    if (url.pathname === "/api/categories" && request.method === "GET") return getCategories(env);
    if (url.pathname === "/api/tickets" && request.method === "POST") return createTicket(request, env, ctx, session);
    if (url.pathname === "/api/tickets/list" && request.method === "GET") return listTickets(url, env, session);
    if (url.pathname === "/api/tickets/update" && request.method === "POST") return updateTicket(request, env, session);
    if (url.pathname === "/api/tickets/suggest" && request.method === "POST") return suggestTicket(request, env, session);
    if (url.pathname === "/api/tickets/retitle") return retitleTickets(request, env);
    if (url.pathname === "/api/tickets/relink-photos") return relinkTicketPhotos(request, env);
    // Master-only user management
    if (url.pathname === "/api/admin/users" && request.method === "GET") return adminListUsers(request, env);
    if (url.pathname === "/api/admin/user" && request.method === "POST") return adminSaveUser(request, env);
    if (url.pathname === "/api/admin/user/password" && request.method === "POST") return adminSetPassword(request, env);

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
      "/account": "/account/",
      "/users": "/users/",
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

async function adminListUsers(request, env) {
  if (!(await requireMaster(request, env))) return json({ ok: false, error: "Master only." }, 403);
  const rows = await sbSelect(env, "app_users?select=id,email,username,role,active,perms,client:clients(name)&order=role.desc,email");
  return noStore({
    ok: true,
    users: (rows || []).map((u) => ({
      id: u.id,
      key: u.email, // real email, for password reset / magic link
      email: (u.email || "").endsWith(SYNTH_DOMAIN) ? "" : u.email, // hide synthesized emails
      username: u.username || "",
      role: u.role,
      client: (u.client && u.client.name) || "",
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
  return json({ ok: !!s, email: s ? s.email : null, role: s ? s.role : null, client: s ? s.client || null : null, perms: s ? s.perms || null : null, required: env.LOGIN_REQUIRED === "1" });
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
let _sessCache = new Map(); // token -> { t, data }
async function getSession(request, env) {
  const token = getCookie(request, "rw_session");
  const claims = await verifySession(token, env);
  if (!claims) return null;
  const hit = _sessCache.get(token);
  if (hit && Date.now() - hit.t < 8000) return hit.data;
  if (!sbReady(env)) return claims; // can't look up; trust the signed claims
  const rows = await sbSelect(env, `app_users?email=eq.${encodeURIComponent(claims.email)}&select=role,active,perms,client:clients(name)`);
  if (rows === null) return claims; // table missing / transient error: don't lock out
  const u = rows[0];
  if (!u || u.active === false) {
    _sessCache.delete(token);
    return null; // account deleted or disabled -> session no longer valid
  }
  const role = u.role === "master" ? "master" : "client";
  const data = {
    email: claims.email,
    role,
    client: role === "client" ? (u.client && u.client.name) || "" : null,
    perms: role === "client" ? u.perms || {} : null,
  };
  if (_sessCache.size > 500) _sessCache.clear();
  _sessCache.set(token, { t: Date.now(), data });
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
  const qrTag = clean(body.qrTag);
  row.qr_tag = qrTag || (await genAssetKey(env));
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

  // Backfill a QR key for assets created before keys existed.
  if (!a.qr_tag) {
    const key = await genAssetKey(env);
    const up = await sbUpdate(env, "assets", id, { qr_tag: key });
    if (up.ok) a.qr_tag = key;
  }

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

async function listAssets(env, session) {
  if (!sbReady(env) || !can(session, "assets", "view")) return json([]);
  let filter = "";
  const forced = scopeName(session);
  if (forced != null) {
    const refs = await getRefs(env);
    const cid = findId(refs.clients, forced);
    filter = cid ? `&client_id=eq.${cid}` : "&id=eq.00000000-0000-0000-0000-000000000000";
  }
  const rows = await sbSelect(
    env,
    `assets?select=id,name,description,make,model,serial,qr_tag,equipment_type:equipment_types(name),location:locations(name),client:clients(name)${filter}&order=logged_at.desc`
  );
  return json(
    (rows || []).map((x) => ({
      id: x.id,
      name: x.name || x.description || x.model || "Asset",
      client: (x.client && x.client.name) || "",
      type: (x.equipment_type && x.equipment_type.name) || "",
      location: (x.location && x.location.name) || "",
      model: x.model || "",
      make: x.make || "",
      serial: x.serial || "",
      qr: x.qr_tag || "",
    }))
  );
}

/* ===================== Service records ===================== */

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
    const row = { name: newName, verification: "Pending", qr_tag: await genAssetKey(env) };
    if (clientId) row.client_id = clientId;
    const res = await sbInsert(env, "assets", row);
    if (res.ok && res.data) return res.data.id;
  }
  return null;
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
  if (!res.ok || !res.data) return json({ ok: false, error: "Could not save the ticket." }, 502);
  const id = res.data.id;

  // Upload photos synchronously so the ticket truly carries them before we reply
  // (and we can report exactly how many saved).
  const pics = normalizePics(body);
  let savedPhotos = 0;
  if (pics.length) {
    const urls = [];
    for (let i = 0; i < pics.length; i++) {
      const u = await uploadToStorage(env, `tickets/${id}/${i}.jpg`, pics[i].base64, pics[i].contentType);
      if (u) urls.push(u);
    }
    if (urls.length) {
      await sbUpdate(env, "tickets", id, { photo_urls: urls, photo_url: urls[0] });
      savedPhotos = urls.length;
    }
  }

  return json({ ok: true, ref, title, photoCount: pics.length, savedPhotos });
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

// One-time backfill: regenerate the plain "Category · Client" titles on older
// tickets into proper action-led titles. Only touches tickets that still have a
// fallback-looking title and an actual description to work from.
async function retitleTickets(request, env) {
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
  if (!showArchived) filter += "&status=neq.Archived";

  let rows = await sbSelect(
    env,
    `tickets?select=id,ref,title,description,location,status,photo_url,photo_urls,created_at,asset_id,category:ticket_categories(name),client:clients(name),asset:assets(id,name)${filter}&order=created_at.desc`
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
      assetId: t.asset_id || "",
      asset: embedded ? ((t.asset && t.asset.name) || "") : "",
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
  const refs = await getRefs(env);
  const patch = {};
  if ("status" in body) patch.status = body.status;
  if ("category" in body) patch.category_id = findId(refs.cats, body.category);
  if ("description" in body) patch.description = body.description;
  if ("location" in body) patch.location = body.location;
  if ("title" in body && body.title) patch.title = body.title;
  if ("client" in body && scopeName(session) == null) patch.client_id = body.client ? findId(refs.clients, body.client) : null;
  // Link / relink / unlink an asset.
  if ("assetId" in body) {
    const aid = (body.assetId || "").toString().trim();
    if (aid) { if (await ownsRecord(env, session, "assets", aid)) patch.asset_id = aid; }
    else patch.asset_id = null;
  } else if (body.newAssetName) {
    const tr = await sbSelect(env, `tickets?id=eq.${id}&select=client_id`);
    const cid = tr && tr[0] ? tr[0].client_id : null;
    const ar = await sbInsert(env, "assets", { name: body.newAssetName.toString().trim(), verification: "Pending", qr_tag: await genAssetKey(env), client_id: cid });
    if (ar.ok && ar.data) patch.asset_id = ar.data.id;
  }
  // Only touch the photo columns when the photos actually changed. The editor
  // always sends keepPhotos, so writing them every time would (a) be wasteful
  // and (b) fail an ordinary status/text save if anything about the photo write
  // is off. Apply the core fields first so a change like Archive always lands.
  const hasKeep = Array.isArray(body.keepPhotos);
  const hasAdd = Array.isArray(body.addPhotos) && body.addPhotos.length;
  let photoPatch = null;
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
      }
    }
    const changed = hasAdd || urls.length !== current.length || urls.some((u, i) => u !== current[i]);
    if (changed) photoPatch = { photo_urls: urls, photo_url: urls.length ? urls[0] : null };
  }

  if (Object.keys(patch).length) {
    const res = await sbUpdate(env, "tickets", id, patch);
    if (!res.ok) return json({ ok: false, error: ("Save failed. " + (res.error || "")).slice(0, 300) }, 502);
  }
  if (photoPatch) {
    const res2 = await sbUpdate(env, "tickets", id, photoPatch);
    if (!res2.ok) return json({ ok: false, error: ("Saved the details, but the photos did not update. " + (res2.error || "")).slice(0, 300) }, 502);
  }
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

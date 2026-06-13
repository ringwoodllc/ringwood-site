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
    if (url.pathname === "/api/asset/events" && request.method === "GET") return listAssetEvents(url, env, request);
    if (url.pathname === "/api/asset/analyze" && request.method === "POST") return analyzeAsset(request, env, session);
    if (url.pathname === "/api/asset/update" && request.method === "POST") return updateAsset(request, env, session);
    if (url.pathname === "/api/asset/scan-warranty" && request.method === "POST") return scanWarranty(request, env, session);
    if (url.pathname === "/api/asset/docs/add" && request.method === "POST") return addAssetDocs(request, env, session);
    if (url.pathname === "/api/asset/docs/delete" && request.method === "POST") return deleteAssetDoc(request, env, session);
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
    if (url.pathname === "/api/tickets/services" && request.method === "GET") return listTicketServices(url, env, session);
    if (url.pathname === "/api/tickets/comments" && request.method === "GET") return listTicketComments(url, env, session);
    if (url.pathname === "/api/tickets/comment" && request.method === "POST") return addTicketComment(request, env, session);
    if (url.pathname === "/api/tickets/comment/update" && request.method === "POST") return updateTicketComment(request, env, session);
    if (url.pathname === "/api/tickets/comment/delete" && request.method === "POST") return deleteTicketComment(request, env, session);
    if (url.pathname === "/api/tickets/comment/promote" && request.method === "POST") return promoteCommentPhotos(request, env, session);
    if (url.pathname === "/api/tickets/update" && request.method === "POST") return updateTicket(request, env, session);
    if (url.pathname === "/api/tickets/delete" && request.method === "POST") return deleteTicket(request, env, session);
    if (url.pathname === "/api/tickets/suggest" && request.method === "POST") return suggestTicket(request, env, session);
    if (url.pathname === "/api/tickets/suggest-asset" && request.method === "POST") return suggestTicketAsset(request, env, session);
    if (url.pathname === "/api/ai/polish" && request.method === "POST") return polishNote(request, env, session);
    if (url.pathname === "/api/tickets/fold-notes" && request.method === "POST") return foldNotesIntoDescription(request, env, session);
    if (url.pathname === "/api/tickets/parts" && request.method === "GET") return listTicketParts(url, env, session);
    if (url.pathname === "/api/tickets/labor" && request.method === "GET") return listTicketLabor(url, env, session);
    if (url.pathname === "/api/tickets/labor/save" && request.method === "POST") return saveTicketLabor(request, env, session);
    if (url.pathname === "/api/tickets/labor/delete" && request.method === "POST") return deleteTicketLabor(request, env, session);
    if (url.pathname === "/api/tickets/quotes" && request.method === "GET") return listTicketQuotes(url, env, session);
    if (url.pathname === "/api/tickets/quote" && request.method === "POST") return saveTicketQuote(request, env, session);
    if (url.pathname === "/api/tickets/quote/delete" && request.method === "POST") return deleteTicketQuote(request, env, session);
    if (url.pathname === "/api/tickets/quote/accept" && request.method === "POST") return acceptTicketQuote(request, env, session);
    if (url.pathname === "/api/tickets/quote/select" && request.method === "POST") return selectTicketQuote(request, env, session);
    if (url.pathname === "/api/tickets/pricing" && request.method === "GET") return getTicketPricing(url, env, session);
    if (url.pathname === "/api/tickets/pricing/save" && request.method === "POST") return saveTicketPricing(request, env, session);
    if (url.pathname === "/api/tickets/part" && request.method === "POST") return saveTicketPart(request, env, session);
    if (url.pathname === "/api/tickets/part/delete" && request.method === "POST") return deleteTicketPart(request, env, session);
    if (url.pathname === "/api/tickets/parts/suggest" && request.method === "POST") return suggestTicketParts(request, env, session);
    if (url.pathname === "/api/tickets/parts/scan-invoice" && request.method === "POST") return scanInvoiceParts(request, env, session);
    if (url.pathname === "/api/tickets/bill" && request.method === "GET") return getTicketBill(url, env, session);
    if (url.pathname === "/api/tickets/rfq" && request.method === "GET") return getTicketRfq(url, env, session);
    if (url.pathname === "/api/parts/list" && request.method === "GET") return listAllParts(url, env, session);
    if (url.pathname === "/api/redbook" && request.method === "GET") return listRedbook(url, env, session);
    if (url.pathname === "/api/redbook/upload" && request.method === "POST") return uploadRedbookDoc(request, env, session);
    if (url.pathname === "/api/redbook/delete" && request.method === "POST") return deleteRedbookDoc(request, env, session);
    if (url.pathname === "/api/redbook/rename" && request.method === "POST") return renameRedbookDoc(request, env, session);
    if (url.pathname === "/api/redbook/read-doc" && request.method === "POST") return readRedbookDoc(request, env, session);
    if (url.pathname === "/api/inventory" && request.method === "GET") return listInventory(url, env, session);
    if (url.pathname === "/api/inventory/count" && request.method === "POST") return createInventoryCount(request, env, session);
    if (url.pathname === "/api/inventory/count/close" && request.method === "POST") return closeInventoryCount(request, env, session);
    if (url.pathname === "/api/inventory/count/delete" && request.method === "POST") return deleteInventoryCount(request, env, session);
    if (url.pathname === "/api/inventory/photo" && request.method === "POST") return addInventoryPhoto(request, env, session, ctx);
    if (url.pathname === "/api/inventory/photo/delete" && request.method === "POST") return deleteInventoryPhoto(request, env, session);
    if (url.pathname === "/api/inventory/item" && request.method === "POST") return saveInventoryItem(request, env, session);
    if (url.pathname === "/api/inventory/orders" && request.method === "GET") return listInventoryOrders(url, env, session);
    if (url.pathname === "/api/inventory/order" && request.method === "POST") return saveInventoryOrder(request, env, session);
    if (url.pathname === "/api/inventory/order/delete" && request.method === "POST") return deleteInventoryOrder(request, env, session);
    if (url.pathname === "/api/inventory/order/scan" && request.method === "POST") return scanOrder(request, env, session);
    if (url.pathname === "/api/inventory/catalog" && request.method === "GET") return listInventoryCatalog(url, env, session);
    if (url.pathname === "/api/inventory/catalog" && request.method === "POST") return saveInventoryCatalog(request, env, session);
    if (url.pathname === "/api/redbook/tidy-title" && request.method === "POST") return tidyRedbookTitle(request, env, session);
    if (url.pathname === "/api/redbook/tidy-all" && request.method === "POST") return tidyAllRedbook(request, env, session);
    if (url.pathname === "/api/checklist" && request.method === "GET") return listChecklist(url, env, session);
    if (url.pathname === "/api/checklist/section" && request.method === "POST") return saveChecklistSection(request, env, session);
    if (url.pathname === "/api/checklist/day" && request.method === "POST") return saveChecklistDay(request, env, session);
    if (url.pathname === "/api/checklist/populate" && request.method === "POST") return populateChecklist(request, env, session);
    if (url.pathname === "/api/checklist/reset" && request.method === "POST") return resetChecklist(request, env, session);
    if (url.pathname === "/api/assessment" && request.method === "GET") return listAssessment(url, env, session);
    if (url.pathname === "/api/assessment/day" && request.method === "POST") return saveAssessmentDay(request, env, session);
    if (url.pathname === "/api/assessment/question" && request.method === "POST") return saveAssessmentQuestion(request, env, session);
    if (url.pathname === "/api/assessment/reset" && request.method === "POST") return resetAssessment(request, env, session);
    if (url.pathname === "/api/assessment/photo" && request.method === "POST") return uploadAssessmentPhoto(request, env, session);
    if (url.pathname === "/api/assessment/file" && request.method === "POST") return fileAssessmentToBinder(request, env, session);
    if (url.pathname === "/api/receiving" && request.method === "GET") return listReceiving(url, env, session);
    if (url.pathname === "/api/receiving/add" && request.method === "POST") return addReceiving(request, env, session);
    if (url.pathname === "/api/receiving/scan" && request.method === "POST") return scanReceiving(request, env, session);
    if (url.pathname === "/api/receiving/delete" && request.method === "POST") return deleteReceiving(request, env, session);
    if (url.pathname === "/api/receiving/update" && request.method === "POST") return updateReceiving(request, env, session);
    if (url.pathname === "/api/receiving/vendor" && request.method === "POST") return saveReceivingVendor(request, env, session);
    if (url.pathname === "/api/hotholding" && request.method === "GET") return listHotHolding(url, env, session);
    if (url.pathname === "/api/hotholding/add" && request.method === "POST") return addHotHolding(request, env, session);
    if (url.pathname === "/api/hotholding/scan" && request.method === "POST") return scanHotHolding(request, env, session);
    if (url.pathname === "/api/hotholding/delete" && request.method === "POST") return deleteHotHolding(request, env, session);
    if (url.pathname === "/api/hotholding/update" && request.method === "POST") return updateHotHolding(request, env, session);
    if (url.pathname === "/api/hotholding/item" && request.method === "POST") return saveHotHoldingItem(request, env, session);
    if (url.pathname === "/api/foodsafety/summary" && request.method === "GET") return foodSafetySummary(url, env, session);
    if (url.pathname === "/api/temps" && request.method === "GET") return listTemps(url, env, session);
    if (url.pathname === "/api/temps/units" && request.method === "GET") return listTempUnits(url, env, session);
    if (url.pathname === "/api/temps/history" && request.method === "GET") return listTempHistory(url, env, session);
    if (url.pathname === "/api/temps/unit" && request.method === "POST") return setTempUnit(request, env, session);
    if (url.pathname === "/api/temps/log" && request.method === "POST") return logTemp(request, env, session);
    if (url.pathname === "/api/temps/round" && request.method === "POST") return logTempRound(request, env, session);
    if (url.pathname === "/api/temps/grid" && request.method === "POST") return logTempGrid(request, env, session);
    if (url.pathname === "/api/temps/generate" && request.method === "POST") return generateTemps(request, env, session);
    if (url.pathname === "/api/temps/auto" && request.method === "POST") return setTempAuto(request, env, session);
    if (url.pathname === "/api/temps/scan" && request.method === "POST") return scanTempLog(request, env, session);
    if (url.pathname === "/api/temps/log/delete" && request.method === "POST") return deleteTempLog(request, env, session);
    if (url.pathname === "/api/temps/log/update" && request.method === "POST") return updateTempLog(request, env, session);
    if (url.pathname === "/api/temps/demo" && request.method === "POST") return setTempDemo(request, env, session);
    if (url.pathname === "/api/tickets/retitle") return retitleTickets(request, env);
    if (url.pathname === "/api/tickets/relink-photos") return relinkTicketPhotos(request, env);
    // Master-only user management
    if (url.pathname === "/api/admin/clients" && request.method === "GET") return adminListClients(request, env);
    if (url.pathname === "/api/admin/client" && request.method === "POST") return adminSaveClient(request, env);
    if (url.pathname === "/api/admin/client/delete" && request.method === "POST") return deleteClient(request, env);
    if (url.pathname === "/api/vendors" && request.method === "GET") return listVendors(request, env, session);
    if (url.pathname === "/api/vendors/scan" && request.method === "POST") return scanVendorCard(request, env, session);
    if (url.pathname === "/api/admin/vendors" && request.method === "GET") return adminListVendors(request, env);
    if (url.pathname === "/api/admin/vendor" && request.method === "POST") return adminSaveVendor(request, env);
    if (url.pathname === "/api/admin/vendor/delete" && request.method === "POST") return deleteVendor(request, env);
    if (url.pathname === "/api/google/status" && request.method === "GET") return googleStatus(request, env);
    if (url.pathname === "/api/google/connect" && request.method === "GET") return googleConnect(request, env);
    if (url.pathname === "/api/google/callback" && request.method === "GET") return googleCallback(request, env);
    if (url.pathname === "/api/google/disconnect" && request.method === "POST") return googleDisconnect(request, env);
    if (url.pathname === "/api/gmail/draft" && request.method === "POST") return gmailCreateDraft(request, env);
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
      "/vendors": "/vendors/",
      "/admin": "/admin/",
      "/architecture": "/architecture/",
      "/parts": "/parts/",
      "/redbook": "/redbook/",
      "/temps": "/temps/",
      "/checklist": "/checklist/",
      "/assessment": "/assessment/",
      "/receiving": "/receiving/",
      "/hotholding": "/hotholding/",
      "/inventory": "/inventory/",
      "/privacy": "/privacy/",
      "/support": "/support/",
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
  // Cron (runs at minute 1 of every hour, UTC). The handler checks New York time
  // and only fills a round at 6/10/14/18 ET for Demo-enabled clients.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduledTemps(env).catch(function () {}));
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
  // Public legal/support pages (App Store requires reachable URLs without login).
  if (p === "/privacy" || p === "/privacy/" || p === "/support" || p === "/support/") return true;
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
    const urows = await sbSelect(env, `app_users?email=eq.${encodeURIComponent(t.user_email)}&select=email,role,active,perms,client:clients(name,status)`);
    u = urows && urows[0];
    if (!u || u.active === false) return json({ ok: false, error: "This account is not active." }, 401);
  } else {
    // Identifier can be an email or a simple username.
    const idRaw = (body.identifier || body.username || body.email || "").toString().trim().toLowerCase();
    const password = (body.password || "").toString();
    if (!idRaw || !password) return json({ ok: false, error: "Enter your email or username and password." }, 400);
    const enc = encodeURIComponent(idRaw);
    const rows = await sbSelect(env, `app_users?or=(email.eq.${enc},username.eq.${enc})&select=email,username,password_hash,role,active,perms,client:clients(name,status)`);
    u = rows && rows[0];
    if (!u || u.active === false || !(await verifyPassword(password, u.password_hash))) {
      return json({ ok: false, error: "Wrong email/username or password." }, 401);
    }
  }

  // A client whose account is Archived can't sign in (admin hid them for now).
  if (u.role !== "master" && u.client && u.client.status === "Archived") {
    return json({ ok: false, error: "This account is not active." }, 401);
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
const PERM_AREAS = ["tickets", "assets", "service", "foodSafety"];
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
  let rows = await sbSelect(env, "clients?select=id,name,status,address,color,primary_contact,email,phone,notes,auto_temps,markup_pct,service_fee&order=name");
  if (rows === null) rows = await sbSelect(env, "clients?select=id,name,status,address,color,primary_contact,email,phone,notes,auto_temps&order=name");
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
      markupPct: c.markup_pct != null ? c.markup_pct : "",
      serviceFee: c.service_fee != null ? c.service_fee : "",
      // RedBook Demo: when Active, this client's logs auto-fill on the NY
      // schedule. Off by default so real food-safety records are never written.
      demo: !!c.auto_temps,
    })),
  });
}

// Permanently remove a client. Its tickets, assets, and service records are
// unlinked (kept as Unassigned, not destroyed); its logins are removed.
async function deleteClient(request, env) {
  if (!(await requireMaster(request, env))) return json({ ok: false, error: "Master only." }, 403);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const id = (body.id || "").toString().trim();
  if (!id) return json({ ok: false, error: "No client id." }, 400);
  // Unlink work records so history survives as Unassigned.
  for (const tbl of ["tickets", "assets", "service_records"]) {
    await fetch(`${env.SUPABASE_URL}/rest/v1/${tbl}?client_id=eq.${id}`, {
      method: "PATCH", headers: sbHeaders(env, { Prefer: "return=minimal" }), body: JSON.stringify({ client_id: null }),
    });
  }
  // Remove the client's logins (they belong to a client that's going away).
  await fetch(`${env.SUPABASE_URL}/rest/v1/app_users?client_id=eq.${id}`, { method: "DELETE", headers: sbHeaders(env) });
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/clients?id=eq.${id}`, { method: "DELETE", headers: sbHeaders(env) });
  if (!r.ok) return json({ ok: false, error: "Could not delete the client." }, 502);
  clearRefsCache();
  return json({ ok: true });
}

/* ===================== Vendors / technicians ===================== */
// The people and companies work gets assigned to. "Internal" = a Ringwood
// person; "Vendor" = an outside company. Stored in the `vendors` table.

// For the ticket "Assigned to" dropdown: active vendors only, names + trade.
async function listVendors(request, env, session) {
  if (!sbReady(env) || !can(session, "tickets", "view")) return json([]);
  let rows = await sbSelect(env, "vendors?select=id,name,kind,trade,hourly_rate,active&order=name");
  if (rows === null) rows = await sbSelect(env, "vendors?select=id,name,kind,trade,active&order=name");
  if (rows === null) return json([]); // table not added yet -> empty, app keeps working
  return noStore(
    (rows || []).filter((v) => v.active !== false).map((v) => ({ id: v.id, name: v.name || "", kind: v.kind || "Vendor", trade: v.trade || "", rate: v.hourly_rate != null ? v.hourly_rate : "" }))
  );
}

async function adminListVendors(request, env) {
  if (!(await requireMaster(request, env))) return json({ ok: false, error: "Master only." }, 403);
  let rows = await sbSelect(env, "vendors?select=id,name,kind,trade,phone,email,notes,hourly_rate,active,card_url&order=name");
  if (rows === null) rows = await sbSelect(env, "vendors?select=id,name,kind,trade,phone,email,notes,hourly_rate,active&order=name");
  if (rows === null) rows = await sbSelect(env, "vendors?select=id,name,kind,trade,phone,email,notes,active&order=name");
  if (rows === null) return noStore({ ok: true, vendors: [], missing: true });
  return noStore({
    ok: true,
    vendors: (rows || []).map((v) => ({
      id: v.id, name: v.name || "", kind: v.kind || "Vendor", trade: v.trade || "",
      phone: v.phone || "", email: v.email || "", notes: v.notes || "", rate: v.hourly_rate != null ? v.hourly_rate : "", active: v.active !== false,
      cardUrl: v.card_url || "",
    })),
  });
}

// Read a business card, a vendor's quote sheet, or an ID photo and pull out
// the vendor details (company, person, phone, email, trade). The source file
// is kept in storage and its link lands in the notes, so the vendor record
// carries its own proof. Returns fields for review; saving is a separate step.
async function scanVendorCard(request, env, session) {
  if (!session || session.role !== "master") return json({ ok: false, error: "Master only." }, 403);
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: "The AI is not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const base64 = (body.base64 || "").toString();
  if (!base64) return json({ ok: false, error: "No file to read." }, 400);
  const ct = (body.contentType || "image/jpeg").toString();
  const isPdf = ct.indexOf("pdf") >= 0;
  // Keep the card/quote itself for the record (best-effort).
  let fileUrl = null;
  try { fileUrl = await uploadToStorage(env, `vendors/card-${Date.now()}.${isPdf ? "pdf" : "jpg"}`, base64, isPdf ? "application/pdf" : ct); } catch { /* fields still useful */ }
  const source = { type: "base64", media_type: isPdf ? "application/pdf" : ct, data: base64 };
  const block = isPdf ? { type: "document", source } : { type: "image", source };
  const prompt =
    "You are reading a business card, a vendor's quote document, or a contractor's ID so the vendor can be added to a directory. Return:\n" +
    "- company: the business name (e.g. 'Florez Tree Service'). If only a person's name is shown, use that.\n" +
    "- person: the contact person's name, or empty.\n" +
    "- phone: the best phone number shown, as printed, or empty.\n" +
    "- email: the email address shown, or empty.\n" +
    "- trade: what they do, in two or three plain words (e.g. 'tree removal', 'HVAC', 'plumbing'). Empty if unclear.\n" +
    "- notes: one short line of anything else useful (license number, address, scope). Empty if nothing.\n" +
    "- amount: if this is a price quote, estimate, or invoice, the TOTAL quoted dollar amount as a number. If it's just a business card with no price, use 0.\n" +
    "- crop: the tight bounding box of just the card or document within the photo, as fractions of the image from 0 to 1: x (left edge), y (top edge), w (width), h (height). If it already fills the frame, use {x:0,y:0,w:1,h:1}.\n" +
    "Only what is actually visible. Do not invent names, numbers, or emails.";
  const schema = {
    type: "object",
    properties: { company: { type: "string" }, person: { type: "string" }, phone: { type: "string" }, email: { type: "string" }, trade: { type: "string" }, notes: { type: "string" }, amount: { type: "number" },
      crop: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } }, required: ["x", "y", "w", "h"], additionalProperties: false } },
    required: ["company", "person", "phone", "email", "trade", "notes", "amount", "crop"],
    additionalProperties: false,
  };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-opus-4-8", max_tokens: 500, messages: [{ role: "user", content: [block, { type: "text", text: prompt }] }], output_config: { format: { type: "json_schema", schema } } }),
    });
    if (!res.ok) return json({ ok: false, error: "The assistant couldn't read that." }, 502);
    const data = await res.json();
    const tb = (data.content || []).find((b) => b.type === "text");
    if (!tb) return json({ ok: false, error: "The assistant couldn't read that." }, 502);
    let out;
    try { out = JSON.parse(tb.text); } catch { return json({ ok: false, error: "The assistant couldn't read that." }, 502); }
    const c = (v) => (v == null ? "" : v.toString().trim());
    return json({
      ok: true,
      company: c(out.company).slice(0, 120),
      person: c(out.person).slice(0, 120),
      phone: c(out.phone).slice(0, 40),
      email: c(out.email).slice(0, 120),
      trade: c(out.trade).slice(0, 80),
      notes: c(out.notes).slice(0, 300),
      amount: (out.amount != null && !isNaN(Number(out.amount)) && Number(out.amount) > 0) ? Number(out.amount) : "",
      fileUrl: fileUrl || "",
      crop: (out.crop && typeof out.crop === "object" && !isPdf) ? { x: +out.crop.x || 0, y: +out.crop.y || 0, w: +out.crop.w || 1, h: +out.crop.h || 1 } : null,
    });
  } catch {
    return json({ ok: false, error: "Couldn't reach the assistant." }, 502);
  }
}

async function adminSaveVendor(request, env) {
  if (!(await requireMaster(request, env))) return json({ ok: false, error: "Master only." }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const c = (v) => (v == null ? "" : v.toString().trim());
  const name = c(body.name);
  if (!name) return json({ ok: false, error: "Enter a name." }, 400);
  const kind = c(body.kind) === "Internal" ? "Internal" : "Vendor";
  const patch = { name, kind, trade: c(body.trade) || null, phone: c(body.phone) || null, email: c(body.email) || null, notes: c(body.notes) || null };
  if ("rate" in body) { const rt = Number(body.rate); patch.hourly_rate = body.rate === "" || isNaN(rt) ? null : rt; }
  if ("active" in body) patch.active = body.active !== false;
  // A scanned business card / quote, AI-cropped client-side, kept on the vendor
  // for human verification. New column, so degrade gracefully if not migrated.
  let cardUrl = typeof body.cardUrl === "string" ? body.cardUrl : null;
  if (body.cardBase64) { try { cardUrl = await uploadToStorage(env, `vendors/card-${Date.now()}.jpg`, body.cardBase64, "image/jpeg"); } catch { /* keep going */ } }
  const extra = {};
  if (cardUrl) extra.card_url = cardUrl;
  const id = c(body.id);
  let res = id ? await sbUpdate(env, "vendors", id, Object.assign({}, patch, extra)) : await sbInsert(env, "vendors", Object.assign({ active: true }, patch, extra));
  if (!res.ok && Object.keys(extra).length) { res = id ? await sbUpdate(env, "vendors", id, patch) : await sbInsert(env, "vendors", Object.assign({ active: true }, patch)); }
  if (!res.ok) return json({ ok: false, error: ("Could not save. " + (res.error || "")).slice(0, 200) }, 502);
  return json({ ok: true, vendor: res.data || null, cardUrl: cardUrl || "" });
}

async function deleteVendor(request, env) {
  if (!(await requireMaster(request, env))) return json({ ok: false, error: "Master only." }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const id = (body.id || "").toString().trim();
  if (!id) return json({ ok: false, error: "No vendor id." }, 400);
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/vendors?id=eq.${id}`, { method: "DELETE", headers: sbHeaders(env) });
  if (!r.ok) return json({ ok: false, error: "Could not delete." }, 502);
  return json({ ok: true });
}

/* ===================== Google / Gmail (OAuth) ===================== */
// One org-wide Google connection (the admin's Gmail). The app uses it to create
// a ready draft in Gmail automatically (gmail.compose scope). Tokens live in
// app_oauth and never reach the browser. Needs GOOGLE_CLIENT_ID and
// GOOGLE_CLIENT_SECRET as Cloudflare Worker secrets.
const GOOGLE_SCOPES = "openid email https://www.googleapis.com/auth/gmail.compose";
function googleRedirectUri(request) { return new URL(request.url).origin + "/api/google/callback"; }

async function googleStatus(request, env) {
  if (!(await requireMaster(request, env))) return json({ ok: false, error: "Master only." }, 403);
  const configured = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  let connected = false, email = "";
  if (configured) {
    const rows = await sbSelect(env, "app_oauth?provider=eq.google&select=email,refresh_token");
    const row = rows && rows[0];
    connected = !!(row && row.refresh_token); email = (row && row.email) || "";
  }
  return noStore({ ok: true, configured, connected, email });
}

async function googleConnect(request, env) {
  if (!(await requireMaster(request, env))) return new Response("Master only.", { status: 403 });
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return new Response("Google is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Cloudflare.", { status: 503 });
  const state = randomToken();
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  u.searchParams.set("redirect_uri", googleRedirectUri(request));
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", GOOGLE_SCOPES);
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("state", state);
  return new Response(null, { status: 302, headers: { Location: u.toString(), "Set-Cookie": `rw_goauth=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600` } });
}

async function googleCallback(request, env) {
  const master = await requireMaster(request, env);
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const cookieState = getCookie(request, "rw_goauth") || "";
  const back = (msg) => new Response(null, { status: 302, headers: { Location: "/admin?gmail=" + msg, "Set-Cookie": "rw_goauth=; Path=/; Max-Age=0" } });
  if (!master) return new Response("Master only.", { status: 403 });
  if (!code || !state || state !== cookieState) return back("error");
  let tok;
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: googleRedirectUri(request), grant_type: "authorization_code" }),
    });
    tok = await r.json();
    if (!r.ok || !tok.access_token) return back("error");
  } catch { return back("error"); }
  let email = "";
  try {
    const ui = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: "Bearer " + tok.access_token } });
    if (ui.ok) { const u2 = await ui.json(); email = u2.email || ""; }
  } catch { /* email is just for display */ }
  const expires_at = new Date(Date.now() + ((tok.expires_in || 3600) - 60) * 1000).toISOString();
  const patch = { provider: "google", email, access_token: tok.access_token, expires_at, updated_at: new Date().toISOString() };
  if (tok.refresh_token) patch.refresh_token = tok.refresh_token;
  const existing = await sbSelect(env, "app_oauth?provider=eq.google&select=provider");
  if (existing && existing.length) {
    await fetch(`${env.SUPABASE_URL}/rest/v1/app_oauth?provider=eq.google`, { method: "PATCH", headers: sbHeaders(env, { Prefer: "return=minimal" }), body: JSON.stringify(patch) });
  } else {
    await sbInsert(env, "app_oauth", patch);
  }
  return back(tok.refresh_token ? "connected" : "noreftoken");
}

async function googleDisconnect(request, env) {
  if (!(await requireMaster(request, env))) return json({ ok: false, error: "Master only." }, 403);
  await fetch(`${env.SUPABASE_URL}/rest/v1/app_oauth?provider=eq.google`, { method: "DELETE", headers: sbHeaders(env) });
  return json({ ok: true });
}

// Fresh access token, refreshing via the stored refresh_token when needed.
async function getGoogleAccessToken(env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  const rows = await sbSelect(env, "app_oauth?provider=eq.google&select=access_token,refresh_token,expires_at");
  const row = rows && rows[0];
  if (!row || !row.refresh_token) return null;
  if (row.access_token && row.expires_at && new Date(row.expires_at).getTime() > Date.now() + 30000) return row.access_token;
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: row.refresh_token, grant_type: "refresh_token" }),
    });
    const tok = await r.json();
    if (!r.ok || !tok.access_token) return null;
    const expires_at = new Date(Date.now() + ((tok.expires_in || 3600) - 60) * 1000).toISOString();
    await fetch(`${env.SUPABASE_URL}/rest/v1/app_oauth?provider=eq.google`, { method: "PATCH", headers: sbHeaders(env, { Prefer: "return=minimal" }), body: JSON.stringify({ access_token: tok.access_token, expires_at, updated_at: new Date().toISOString() }) });
    return tok.access_token;
  } catch { return null; }
}

// UTF-8 safe base64url (for the raw RFC822 message).
function b64urlUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function rfc2047(s) {
  if (!/[^\x00-\x7F]/.test(s)) return s;
  const bytes = new TextEncoder().encode(s);
  let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return "=?UTF-8?B?" + btoa(bin) + "?=";
}
// Standard (not url-safe) base64 of UTF-8 text, for MIME part bodies.
function b64stdUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function gmailCreateDraft(request, env) {
  if (!(await requireMaster(request, env))) return json({ ok: false, error: "Master only." }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const to = (body.to || "").toString().trim();
  const subject = (body.subject || "").toString();
  const text = (body.body || "").toString();
  const att = body.attachment && body.attachment.base64 ? body.attachment : null;
  const token = await getGoogleAccessToken(env);
  if (!token) return json({ ok: false, error: "Gmail is not connected." }, 409);
  let raw;
  if (att) {
    // multipart/mixed: a text part plus the (PDF) attachment, both base64.
    const boundary = "rwb_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    const attB64 = (att.base64 || "").replace(/\s+/g, "");
    const attWrapped = (attB64.match(/.{1,76}/g) || []).join("\r\n");
    const textWrapped = (b64stdUtf8(text).match(/.{1,76}/g) || []).join("\r\n");
    const fn = (att.filename || "document.pdf").replace(/["\r\n]/g, "");
    const lines = [];
    if (to) lines.push("To: " + to);
    lines.push("Subject: " + rfc2047(subject));
    lines.push("MIME-Version: 1.0");
    lines.push('Content-Type: multipart/mixed; boundary="' + boundary + '"');
    lines.push("");
    lines.push("--" + boundary);
    lines.push("Content-Type: text/plain; charset=UTF-8");
    lines.push("Content-Transfer-Encoding: base64");
    lines.push("");
    lines.push(textWrapped);
    lines.push("--" + boundary);
    lines.push("Content-Type: " + (att.contentType || "application/pdf") + '; name="' + fn + '"');
    lines.push("Content-Transfer-Encoding: base64");
    lines.push('Content-Disposition: attachment; filename="' + fn + '"');
    lines.push("");
    lines.push(attWrapped);
    lines.push("--" + boundary + "--");
    raw = lines.join("\r\n");
  } else {
    const h = [];
    if (to) h.push("To: " + to);
    h.push("Subject: " + rfc2047(subject));
    h.push("MIME-Version: 1.0");
    h.push("Content-Type: text/plain; charset=UTF-8");
    raw = h.join("\r\n") + "\r\n\r\n" + text;
  }
  try {
    const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
      method: "POST", headers: { Authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify({ message: { raw: b64urlUtf8(raw) } }),
    });
    const d = await r.json();
    if (!r.ok) return json({ ok: false, error: (d && d.error && d.error.message) || "Couldn't create the draft." }, 502);
    const msgId = (d.message && d.message.id) || "";
    const link = msgId ? ("https://mail.google.com/mail/u/0/#drafts?compose=" + msgId) : "https://mail.google.com/mail/u/0/#drafts";
    return json({ ok: true, draftId: d.id || "", link });
  } catch { return json({ ok: false, error: "Couldn't reach Gmail." }, 502); }
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
  if ("demo" in body) patch.auto_temps = !!body.demo;
  if ("color" in body) {
    const color = c(body.color);
    if (color) {
      // A color belongs to one client: reject if another client already has it.
      const dupe = await sbSelect(env, `clients?select=id&color=eq.${encodeURIComponent(color)}${id ? `&id=neq.${id}` : ""}&limit=1`);
      if (dupe && dupe.length) return json({ ok: false, error: "That color is already used by another client." }, 400);
    }
    patch.color = color || null;
  }
  // Default pricing for this client's jobs. New columns, so degrade gracefully:
  // if the migration hasn't run, retry the save without them.
  const extra = {};
  if ("markupPct" in body) { const n = Number(body.markupPct); extra.markup_pct = body.markupPct === "" || isNaN(n) ? null : n; }
  if ("serviceFee" in body) { const n = Number(body.serviceFee); extra.service_fee = body.serviceFee === "" || isNaN(n) ? null : n; }
  let res;
  const full = Object.assign({}, patch, extra);
  if (id) res = await sbUpdate(env, "clients", id, full);
  else res = await sbInsert(env, "clients", Object.assign({ status: "Active" }, full));
  if (!res.ok && Object.keys(extra).length) {
    if (id) res = await sbUpdate(env, "clients", id, patch);
    else res = await sbInsert(env, "clients", Object.assign({ status: "Active" }, patch));
  }
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

// An Archived client's records are hidden across the admin. Returns a PostgREST
// clause (AND'd onto a query) that keeps unassigned rows and non-archived clients.
function archivedClientClause(refs) {
  const ids = (refs.clients || []).filter((c) => (c.status || "") === "Archived").map((c) => c.id);
  return ids.length ? `&or=(client_id.is.null,client_id.not.in.(${ids.join(",")}))` : "";
}

async function getLists(env, session) {
  const out = { clients: [], types: [], locations: [], serviceTypes: [] };
  if (!sbReady(env)) return out;
  const refs = await getRefs(env);
  out.clients = refs.clients.filter((c) => (c.status || "") !== "Churned" && (c.status || "") !== "Archived").map((c) => c.name).sort((a, b) => a.localeCompare(b));
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

  // ticket_id ties a record back to the ticket it came from, so the history
  // can show them as one job. Fall back without it until the migration runs.
  let sr = await sbSelect(
    env,
    `service_records?asset_id=eq.${id}&select=id,service_date,technician,notes,cost,ticket_id,service_type:service_types(name)&order=service_date.desc`
  );
  if (sr === null) {
    sr = await sbSelect(
      env,
      `service_records?asset_id=eq.${id}&select=id,service_date,technician,notes,cost,service_type:service_types(name)&order=service_date.desc`
    );
  }
  const services = (sr || []).map((s) => ({
    id: s.id,
    date: s.service_date || "",
    type: (s.service_type && s.service_type.name) || "",
    technician: s.technician || "",
    notes: s.notes || "",
    cost: s.cost != null ? s.cost : "",
    ticketId: s.ticket_id || "",
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
    // Warranty and purchase (optional, often read from an invoice or receipt).
    purchasedOn: a.purchased_on || "",
    purchasedFrom: a.purchased_from || "",
    purchasePrice: a.purchase_price != null ? a.purchase_price : "",
    warrantyProvider: a.warranty_provider || "",
    warrantyLength: a.warranty_length || "",
    warrantyExpires: a.warranty_expires || "",
    // Extended / 2nd warranty (a protection plan that runs after the manufacturer's).
    extProvider: a.ext_warranty_provider || "",
    extLength: a.ext_warranty_length || "",
    extExpires: a.ext_warranty_expires || "",
    supportContact: a.support_contact || "",
    warrantyNotes: a.warranty_notes || "",
    // Admin-only troubleshoot files (invoices, screenshots). Withheld from clients.
    adminDocs: scopeName(session) == null ? (Array.isArray(a.admin_docs) ? a.admin_docs : []) : undefined,
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
  try {
    const bits = [read.assetName ? "name" : "", read.make || read.manufacturer ? "manufacturer" : "", read.model ? "model" : "", read.serial ? "serial" : ""].filter(Boolean);
    await logAssetEvent(env, id, "Ringwood AI Agent", "✨ Read the nameplate from the photos" + (bits.length ? " and filled the " + bits.join(", ") : "") + ".", buildReadingNote(read));
  } catch { /* best-effort */ }
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
// Asset revision history (admin-only): a log of edits and AI agent reads, in the
// `asset_events` table. `detail` is optional expandable before/after text.
async function logAssetEvent(env, assetId, author, text, detail) {
  const body = detail ? (text + "\n⋮\n" + detail) : text;
  await sbInsert(env, "asset_events", { asset_id: assetId, author: author || "Ringwood", kind: "event", body: body.slice(0, 4000) });
}
async function listAssetEvents(url, env, request) {
  if (!(await requireMaster(request, env))) return json([]);
  const id = url.searchParams.get("id") || "";
  if (!id || !sbReady(env)) return json([]);
  const rows = await sbSelect(env, `asset_events?asset_id=eq.${id}&select=id,author,body,created_at&order=created_at.asc`);
  if (rows === null) return json([]); // table not added yet
  return noStore((rows || []).map((c) => ({ id: c.id, author: c.author || "Ringwood", body: c.body || "", created: c.created_at || "" })));
}

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
  // Remember the prior text fields so we can log what changed (revision history).
  const prevRows = await sbSelect(env, `assets?id=eq.${id}&select=name,nickname,description,make,model,serial,qr_tag,verification`);
  const prev = (prevRows && prevRows[0]) || {};
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
  // Warranty and purchase fields. Only touched when a value is actually given,
  // so a normal asset save never writes these columns (and won't fail if the
  // warranty migration hasn't been run yet). See supabase/asset_warranty.sql.
  if (c(body.purchasedOn)) patch.purchased_on = c(body.purchasedOn);
  if (c(body.purchasedFrom)) patch.purchased_from = c(body.purchasedFrom);
  if (c(body.purchasePrice)) { const n = parseFloat(body.purchasePrice); if (!isNaN(n)) patch.purchase_price = n; }
  if (c(body.warrantyProvider)) patch.warranty_provider = c(body.warrantyProvider);
  if (c(body.warrantyLength)) patch.warranty_length = c(body.warrantyLength);
  if (c(body.warrantyExpires)) patch.warranty_expires = c(body.warrantyExpires);
  if (c(body.extProvider)) patch.ext_warranty_provider = c(body.extProvider);
  if (c(body.extLength)) patch.ext_warranty_length = c(body.extLength);
  if (c(body.extExpires)) patch.ext_warranty_expires = c(body.extExpires);
  if (c(body.supportContact)) patch.support_contact = c(body.supportContact);
  if (c(body.warrantyNotes)) patch.warranty_notes = c(body.warrantyNotes);
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
  // Log the edit as one combined revision entry.
  try {
    const parts = [], detail = [];
    const fields = [
      ["name", "name", "Name"], ["nickname", "nickname", "Nickname"], ["description", "description", "Description"],
      ["make", "make", "Manufacturer"], ["model", "model", "Model"], ["serial", "serial", "Serial"], ["qr_tag", "qr_tag", "QR code"],
    ];
    for (const [col, pcol, lbl] of fields) {
      if (col in patch) {
        const nv = (patch[col] || "").toString(), ov = (prev[pcol] || "").toString();
        if (nv !== ov) { parts.push(lbl.toLowerCase()); detail.push(lbl + ':\nFrom: "' + ov + '"\nTo: "' + nv + '"'); }
      }
    }
    if (patch.photo_urls) parts.push("photos");
    if (prev.verification !== "Verified") parts.push("marked verified");
    if (parts.length) {
      const author = (session && session.role === "client" && session.client) ? session.client : "Ringwood";
      await logAssetEvent(env, id, author, "Updated " + parts.join(", "), detail.length ? detail.join("\n\n") : undefined);
    }
  } catch { /* logging is best-effort */ }
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
  const refsA = await getRefs(env);
  if (forced != null) {
    const cid = findId(refsA.clients, forced);
    filter = cid ? `&client_id=eq.${cid}` : "&id=eq.00000000-0000-0000-0000-000000000000";
  } else {
    filter += archivedClientClause(refsA);  // hide Archived clients' assets from admin
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
      description: x.description || "",
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
  const refsS = await getRefs(env);
  if (forced != null) {
    const cid = findId(refsS.clients, forced);
    filter = cid ? `&client_id=eq.${cid}` : "&id=eq.00000000-0000-0000-0000-000000000000";
  } else {
    filter += archivedClientClause(refsS);  // hide Archived clients' service records
  }
  // ticket_id marks a record as a service call (spawned from a ticket) rather
  // than standard maintenance. Fall back without it until the migration runs.
  let rows = await sbSelect(
    env,
    `service_records?select=id,service_date,technician,notes,cost,asset_id,ticket_id,asset:assets(id,name,nickname),client:clients(name),service_type:service_types(name)${filter}&order=service_date.desc`
  );
  if (rows === null) {
    rows = await sbSelect(
      env,
      `service_records?select=id,service_date,technician,notes,cost,asset_id,asset:assets(id,name,nickname),client:clients(name),service_type:service_types(name)${filter}&order=service_date.desc`
    );
  }
  const cref = await getRefs(env);
  return json(
    (rows || []).map((s) => ({
      id: s.id,
      date: s.service_date || "",
      type: (s.service_type && s.service_type.name) || "",
      asset: (s.asset && (s.asset.nickname || s.asset.name)) || "",
      assetId: s.asset_id || "",
      ticketId: s.ticket_id || "",
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
  const num = (v) => (v === "" || v == null ? null : (isNaN(Number(v)) ? null : Number(v)));

  const refs = await getRefs(env);
  const row = { asset_id: assetId };
  if (serviceDate) row.service_date = serviceDate;
  const stId = findId(refs.svc, serviceType);
  if (stId) row.service_type_id = stId;
  if (technician) row.technician = technician;
  if (notes) row.notes = notes;
  if (cost != null && !isNaN(cost)) row.cost = cost;
  // Invoice detail (only set when provided, so it works before the migration).
  if (clean(body.tech2)) row.tech2 = clean(body.tech2);
  if (num(body.travelHours) != null) row.travel_hours = num(body.travelHours);
  if (num(body.vendorCost) != null) row.vendor_cost = num(body.vendorCost);
  if (clean(body.parts)) row.parts = clean(body.parts);
  if (num(body.partsCost) != null) row.parts_cost = num(body.partsCost);
  if (clean(body.ticketId)) row.ticket_id = clean(body.ticketId);
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
  const rows = await sbSelect(env, `service_records?id=eq.${id}&select=*,service_type:service_types(name)`);
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
    tech2: f.tech2 || "",
    travelHours: f.travel_hours != null ? f.travel_hours : "",
    vendorCost: f.vendor_cost != null ? f.vendor_cost : "",
    parts: f.parts || "",
    partsCost: f.parts_cost != null ? f.parts_cost : "",
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
  // Invoice detail. Only touched when sent, so it works before the migration.
  const num = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));
  if (c(body.tech2)) patch.tech2 = c(body.tech2);
  if (num(body.travelHours) != null) patch.travel_hours = num(body.travelHours);
  if (num(body.vendorCost) != null) patch.vendor_cost = num(body.vendorCost);
  if (c(body.parts)) patch.parts = c(body.parts);
  if (num(body.partsCost) != null) patch.parts_cost = num(body.partsCost);
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
    // Leave a short agent reading in the log too (brief line + expandable detail).
    var did = [];
    if (patch.title) did.push("title");
    if (patch.description) did.push("description");
    if (patch.category_id) did.push("category");
    var brief = "Read the report" + (pics.length ? " and photos" : "") + (did.length ? " and updated the " + did.join(", ") + "." : " and drafted the ticket.");
    var detail = [];
    if (patch.title) detail.push('Title: "' + patch.title + '"');
    if (assetName) detail.push("Linked equipment: " + assetName);
    var agentBody = "✨ " + brief + (detail.length ? "\n⋮\n" + detail.join("\n") : "");
    await sbInsert(env, "ticket_comments", { ticket_id: ticketId, author: "Ringwood AI Agent", role: "agent", kind: "event", body: agentBody.slice(0, 4000) });
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
  // A fresh, sequential ticket number every time: one past the highest RW-#### so
  // far (floor 1000), instead of a random number that could repeat.
  let nextNum = 1000;
  const refRows = await sbSelect(env, "tickets?select=ref&order=created_at.desc&limit=1000");
  (refRows || []).forEach((r) => { const m = /RW-0*(\d+)/.exec((r.ref || "").toString()); if (m) { const n = parseInt(m[1], 10); if (n >= nextNum) nextNum = n + 1; } });
  const ref = "RW-" + nextNum;
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
  if (forced == null) filter += archivedClientClause(refs);  // hide Archived clients' tickets from admin
  // Archived tickets are master-only. Clients see Open and Closed (Complete), but
  // never Archived, no matter what the filter asks for.
  const isClient = session && session.role === "client";
  if (!showArchived || isClient) filter += "&status=neq.Archived";

  let rows = await sbSelect(
    env,
    `tickets?select=id,ref,title,description,location,status,reviewed,assigned_to,client_price,photo_url,photo_urls,created_at,asset_id,category:ticket_categories(name),client:clients(name),asset:assets(id,name,nickname)${filter}&order=created_at.desc`
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
        clientPrice: t.client_price != null ? t.client_price : "",
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
  let rows = await sbSelect(env, `ticket_comments?ticket_id=eq.${id}&select=id,author,role,kind,body,photo_urls,created_at&order=created_at.asc`);
  rows = rows || [];
  // Clients see the note stream plus their own original submission. Admin actions
  // and AI agent reads stay internal.
  if (session && session.role === "client") {
    rows = rows.filter((c) => (c.kind || "note") === "note" || c.kind === "intake");
  }
  return json(
    rows.map((c) => ({ id: c.id, author: c.author, role: c.role, kind: c.kind || "note", body: c.body || "", photos: c.photo_urls || [], created: c.created_at || "" }))
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
  // Staff notes default to INTERNAL (kind "internal"), which clients never see
  // (their list filters to note/intake). The explicit "Share with client"
  // button sends share:true, which posts a customer-visible "note". This keeps
  // hours/costs/back-and-forth from leaking into the client's ticket view.
  const isStaff = !(session && session.role === "client");
  const kind = isStaff && !body.share ? "internal" : "note";
  const res = await sbInsert(env, "ticket_comments", { ticket_id: id, author: a.author, role: a.role, kind: kind, body: text.slice(0, 4000) });
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
  const hasShare = typeof body.share === "boolean";
  if (!cid || (!text && !hasShare)) return json({ ok: false, error: "Nothing to save." }, 400);
  const rows = await sbSelect(env, `ticket_comments?id=eq.${cid}&select=id,kind`);
  const row = rows && rows[0];
  if (!row) return json({ ok: false, error: "Not found." }, 404);
  if (row.kind === "event") return json({ ok: false, error: "Status events can't be edited." }, 400);
  const patch = {};
  if (text) patch.body = text.slice(0, 4000);
  // Flip a staff note between internal and shared after the fact, so a detail
  // worked out internally can be handed to the customer when it's ready.
  if (hasShare && (row.kind === "note" || row.kind === "internal")) patch.kind = body.share ? "note" : "internal";
  if (!Object.keys(patch).length) return json({ ok: true });
  const res = await sbUpdate(env, "ticket_comments", cid, patch);
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
// Log an admin action on a ticket (status change, edit, AI rewrite). `detail`
// is optional expandable text (before/after), separated so the UI can hide it
// behind a "+". These entries are admin-only (hidden from client logins).
async function logTicketEvent(env, ticketId, session, text, detail) {
  const a = authorOf(session);
  const body = detail ? (text + "\n⋮\n" + detail) : text;
  await sbInsert(env, "ticket_comments", { ticket_id: ticketId, author: a.author, role: a.role, kind: "event", body: body.slice(0, 4000) });
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
    // Clients can add photos but not remove existing ones: ignore keepPhotos so
    // current photos are always preserved (addPhotos still append).
    delete body.keepPhotos;
  }
  const refs = await getRefs(env);
  // Remember the prior values so we can log what changed (revision history).
  let prevStatus = null, prevTitle = null, prevDesc = null, prevAssigned = null;
  if ("status" in body || "title" in body || "description" in body || "assignedTo" in body) {
    const curT = await sbSelect(env, `tickets?id=eq.${id}&select=status,title,description,assigned_to`);
    if (curT && curT[0]) { prevStatus = curT[0].status; prevTitle = curT[0].title; prevDesc = curT[0].description; prevAssigned = curT[0].assigned_to; }
  }
  const patch = {};
  if ("status" in body) patch.status = body.status;
  if ("category" in body) patch.category_id = findId(refs.cats, body.category);
  if ("description" in body) patch.description = body.description;
  if ("location" in body) patch.location = body.location;
  if ("title" in body && body.title) patch.title = body.title;
  if ("reviewed" in body) patch.reviewed = !!body.reviewed;
  if ("assignedTo" in body) patch.assigned_to = (body.assignedTo || "").toString().trim() || null;
  if ("clientPrice" in body) { const cp = Number(body.clientPrice); patch.client_price = body.clientPrice === "" || isNaN(cp) ? null : cp; }
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
    // Combine everything changed in this one Save into a single log entry, so the
    // history stays readable. Brief lists what changed; the + holds the details.
    const parts = [], details = [];
    if ("status" in body && prevStatus && body.status && body.status !== prevStatus) {
      parts.push("status"); details.push("Status: " + prevStatus + " → " + body.status);
    }
    if ("title" in body && body.title && prevTitle != null && body.title !== prevTitle) {
      parts.push("title"); details.push('Title:\nFrom: "' + (prevTitle || "") + '"\nTo: "' + body.title + '"');
    }
    if ("description" in body && prevDesc != null && (body.description || "") !== (prevDesc || "")) {
      parts.push("description"); details.push("Description — previous:\n" + (prevDesc || "(empty)"));
    }
    if ("assignedTo" in body) {
      const av = (body.assignedTo || "").toString().trim();
      if (av !== (prevAssigned || "")) { parts.push("tech"); details.push(av ? ("Assigned to " + av) : "Tech unassigned"); }
    }
    let brief = parts.length ? ("Updated " + parts.join(", ")) : "";
    if ("reviewed" in body && body.reviewed === true) brief = brief ? (brief + ", marked reviewed") : "Marked reviewed";
    if (brief) await logTicketEvent(env, id, session, brief, details.length ? details.join("\n\n") : undefined);
    // Accepting a ticket spawns the internal service call: when the status moves
    // into Scheduled or In Progress and the ticket has an asset, create a linked
    // service record (tech + intake prefilled) if none exists yet. The ticket
    // stays the client-facing thread; the service record is the internal work.
    if ("status" in body && (body.status === "Scheduled" || body.status === "In Progress") && body.status !== prevStatus) {
      try {
        const tr2 = await sbSelect(env, `tickets?id=eq.${id}&select=asset_id,client_id,ref,title,assigned_to`);
        const tk = tr2 && tr2[0];
        if (tk) {
          const existing = await sbSelect(env, `service_records?ticket_id=eq.${id}&select=id&limit=1`);
          // existing === null means the ticket_id column isn't there yet (run
          // supabase/service_invoice.sql); skip rather than create unlinked rows.
          if (existing !== null && !existing.length) {
            // The job's ledger exists as soon as work starts — an asset is not
            // required; tagging one later backfills onto the call.
            const row = { ticket_id: id, service_date: new Date().toISOString().slice(0, 10), notes: "Service call for ticket " + (tk.ref || "") + ": " + (tk.title || "") };
            if (tk.asset_id) row.asset_id = tk.asset_id;
            if (tk.client_id) row.client_id = tk.client_id;
            if (tk.assigned_to) row.technician = tk.assigned_to;
            const made = await sbInsert(env, "service_records", row);
            if (made.ok) await logTicketEvent(env, id, session, "Service call opened", "Hours and costs for this job track on its service call.");
          }
        }
      } catch { /* best-effort; never block the status change */ }
    }
    // Tagging an asset later backfills it onto the job's service call.
    if (patch.asset_id) {
      try {
        await fetch(`${env.SUPABASE_URL}/rest/v1/service_records?ticket_id=eq.${id}&asset_id=is.null`, {
          method: "PATCH", headers: sbHeaders(env, { Prefer: "return=minimal" }), body: JSON.stringify({ asset_id: patch.asset_id }),
        });
      } catch { /* best-effort */ }
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

// The internal service calls spawned from a ticket (the dispatch view). Staff
// only; a client's ticket view never shows the internal work.
async function listTicketServices(url, env, session) {
  if (!session || session.role === "client") return json({ ok: true, services: [] });
  if (!can(session, "service", "view")) return json({ ok: true, services: [] });
  const id = url.searchParams.get("id") || "";
  if (!id || !sbReady(env)) return json({ ok: true, services: [] });
  const rows = await sbSelect(env, `service_records?ticket_id=eq.${id}&select=id,service_date,technician,tech2,cost,vendor_cost,parts_cost,asset_id,service_type:service_types(name)&order=service_date.desc`);
  if (rows === null) return noStore({ ok: true, services: [], missing: true });
  return noStore({
    ok: true,
    services: (rows || []).map((s) => ({
      id: s.id,
      date: s.service_date || "",
      type: (s.service_type && s.service_type.name) || "",
      technician: s.technician || "",
      tech2: s.tech2 || "",
      cost: s.cost != null ? s.cost : "",
      vendorCost: s.vendor_cost != null ? s.vendor_cost : "",
      partsCost: s.parts_cost != null ? s.parts_cost : "",
      assetId: s.asset_id || "",
    })),
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

// Admin-only: redraft a ticket's description so it folds in any new actionable
// asks from the note thread (e.g. "bring extra paper"), keeping it scope-focused.
// Returns { ok, description } to preview before saving. The thread stays intact.
async function foldNotesIntoDescription(request, env, session) {
  if (!can(session, "tickets", "edit") || (session && session.role === "client")) return deny("tickets");
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: "The assistant is not connected." }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const id = (body.id || "").trim();
  if (!id) return json({ ok: false, error: "No ticket id." }, 400);
  if (!(await ownsRecord(env, session, "tickets", id))) return json({ ok: false, error: "Not found." }, 404);
  const trows = await sbSelect(env, `tickets?id=eq.${id}&select=description`);
  const desc = (trows && trows[0] && trows[0].description) || "";
  const crows = await sbSelect(env, `ticket_comments?ticket_id=eq.${id}&select=author,kind,body,created_at&order=created_at.asc`);
  const notes = (crows || []).filter((c) => (c.kind || "note") === "note" || c.kind === "intake");
  if (!notes.length) return json({ ok: false, error: "No notes to pull in yet." }, 400);
  const thread = notes.map((c) => (c.author || "Note") + ": " + (c.body || "")).join("\n");
  const schema = { type: "object", properties: { description: { type: "string" } }, required: ["description"], additionalProperties: false };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        messages: [{ role: "user", content:
          "You maintain the work description (job scope) for a facilities ticket. Rewrite the description so it includes every concrete action or requirement the worker needs, folding in any NEW actionable asks from the notes below (for example 'bring extra paper'). " +
          "Keep it short and scope-focused: what needs to be done and where. Do NOT include conversational back-and-forth, names, greetings, thanks, or status chatter. Do NOT invent anything that isn't stated. No marketing words, no em dashes. Return only the updated description.\n\n" +
          "Current description:\n" + (desc || "(none)") + "\n\nNotes (oldest first):\n" + thread }],
        output_config: { format: { type: "json_schema", schema } },
      }),
    });
    if (!res.ok) return json({ ok: false, error: "The assistant couldn't respond." }, 502);
    const data = await res.json();
    const block = (data.content || []).find((b) => b.type === "text");
    if (!block) return json({ ok: false, error: "No suggestion." }, 502);
    let out;
    try { out = JSON.parse(block.text); } catch { return json({ ok: false, error: "Couldn't read the suggestion." }, 502); }
    const next = (out.description || "").trim();
    return json({ ok: true, description: next || desc });
  } catch {
    return json({ ok: false, error: "Couldn't reach the assistant." }, 502);
  }
}

/* ===================== Food Safety (Red Book) ===================== */
// A per-client binder of food-safety documents (PDF/photo), organized by section.
// Gated by the "foodSafety" permission. Lives in the `redbook_docs` table;
// degrades gracefully until that table exists.

// Resolve which client's book this request is for: a client login is locked to
// its own client; a master may pass ?client=<name>.
async function redbookClientId(env, session, nameParam) {
  const forced = scopeName(session);
  const name = forced != null ? forced : (nameParam || "");
  if (!name) return { id: null, name: "" };
  const refs = await getRefs(env);
  return { id: findId(refs.clients, name), name };
}

async function listRedbook(url, env, session) {
  if (!can(session, "foodSafety", "view")) return json({ ok: false, error: "Not allowed." }, 403);
  const who = await redbookClientId(env, session, url.searchParams.get("client") || "");
  if (!who.id) return noStore({ ok: true, client: who.name, docs: [], expiry: true });
  const base = `redbook_docs?client_id=eq.${who.id}`;
  // Try with the optional columns (expires_at, doc_date); fall back step by step
  // so the binder keeps working before the migrations. doc_date is the paperwork
  // date (when the inspection/cert actually happened), editable since documents
  // are often filed as a follow-up; created_at stays the upload time.
  let expiry = true, dateOn = true;
  let rows = await sbSelect(env, `${base}&select=id,section,title,file_url,file_type,uploaded_by,created_at,expires_at,doc_date&order=created_at.desc`);
  if (rows === null) {
    dateOn = false;
    rows = await sbSelect(env, `${base}&select=id,section,title,file_url,file_type,uploaded_by,created_at,expires_at&order=created_at.desc`);
  }
  if (rows === null) {
    rows = await sbSelect(env, `${base}&select=id,section,title,file_url,file_type,uploaded_by,created_at&order=created_at.desc`);
    expiry = false;
    if (rows === null) return noStore({ ok: true, client: who.name, docs: [], missing: true, expiry: false, dateOn: false });
  }
  return noStore({ ok: true, client: who.name, expiry, dateOn, docs: (rows || []).map((d) => ({ id: d.id, section: d.section || "Other", title: d.title || "", url: d.file_url || "", type: d.file_type || "", uploadedBy: d.uploaded_by || "", created: d.created_at || "", expires: d.expires_at || "", docDate: d.doc_date || "" })) });
}

// A filename-ish title we should replace with what the AI reads off the document
// (e.g. "Image", "IMG_6186", "Scan 2", "photo"), versus a real title to keep.
function looksGenericTitle(t) {
  const s = (t || "").trim().toLowerCase();
  if (!s || s.length < 3) return true;
  return /^(image|img|photo|pic|picture|scan|scanned|document|doc|untitled|file|screenshot|capture|new)([-_ ]?\d+)?$/.test(s);
}

// Read a Red Book document (image or PDF) with Claude and propose a clean title,
// plus the document date and expiry when they're visible. `source` is an
// Anthropic content source: { type:"base64", media_type, data } or { type:"url", url }.
// Conservative: only what's visible, nothing invented. Returns {title,date,expiry} or null.
//
// DATE RULE (do not forget, per Tamer): document dates here are plain calendar
// dates (YYYY-MM-DD) with NO time and NO timezone — they go straight into the
// `doc_date` / `expires_at` date columns as written, so there is no UTC shift to
// worry about (unlike temp_logs.reading_at; see the TIMEZONE note on that table).
// EXPIRY RULE: if the document shows no expiration, leave expiry blank and ignore
// it. Never guess, compute, or default an expiry that is not printed on the doc.
async function readDocFields(source, ct, section, env) {
  if (!env.ANTHROPIC_API_KEY) return null;
  const isPdf = (ct || "").indexOf("pdf") >= 0;
  const block = isPdf ? { type: "document", source } : { type: "image", source };
  const prompt =
    "You are filing a document into a food business's Red Book (the binder a health inspector reviews)" +
    (section ? ", under the section \"" + section + "\"" : "") + ". Read the document shown and return:\n" +
    "- title: a short, professional document title an inspector would expect. If it is a personal certificate, license, " +
    "permit, or ID (for example a NYC Food Protection Certificate or a food handler card), include the person's name, like " +
    "\"NYC Food Protection Certificate - Tamer\". Use the real agency or brand name shown (NYC Health, ServSafe, EcoSure). " +
    "No surrounding quotes and no trailing period.\n" +
    "- date: the issue or performed date as YYYY-MM-DD (a plain calendar date, no time) if clearly shown, otherwise an empty string.\n" +
    "- expiry: the expiration date as YYYY-MM-DD ONLY if one is actually printed on the document. If there is no expiration, " +
    "return an empty string. Never guess, calculate, or assume an expiry that is not written on the document.\n" +
    "Only use what is visible on the document. Do not invent names, dates, or facts.";
  const schema = { type: "object", properties: { title: { type: "string" }, date: { type: "string" }, expiry: { type: "string" } }, required: ["title", "date", "expiry"], additionalProperties: false };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-opus-4-8", max_tokens: 700, messages: [{ role: "user", content: [block, { type: "text", text: prompt }] }], output_config: { format: { type: "json_schema", schema } } }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const tb = (data.content || []).find((b) => b.type === "text");
    if (!tb) return null;
    const out = JSON.parse(tb.text);
    const okd = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || "") ? s : "");
    const title = (out.title || "").trim().replace(/^["']|["']$/g, "").replace(/\.$/, "").slice(0, 200);
    return { title, date: okd(out.date), expiry: okd(out.expiry) };
  } catch { return null; }
}

// Normalize an incoming file payload into [{base64, contentType, name}].
function normalizeDocFiles(body) {
  const list = [];
  if (Array.isArray(body.files)) {
    for (const f of body.files) { if (f && f.base64) list.push({ base64: f.base64, contentType: (f.contentType || "image/jpeg").toString(), name: (f.name || "").toString() }); }
  } else if (body.base64) {
    list.push({ base64: body.base64, contentType: (body.contentType || "image/jpeg").toString(), name: (body.name || "").toString() });
  }
  return list.slice(0, 8);
}

// Save uploaded admin/troubleshoot files (invoices, screenshots) onto an asset's
// admin_docs and return the full list. Best-effort: a missing column or storage
// failure leaves the read fields working. files: [{base64, contentType, name}].
async function appendAdminDocs(env, id, files) {
  const cur = await sbSelect(env, `assets?id=eq.${id}&select=admin_docs`);
  let docs = cur && cur[0] && Array.isArray(cur[0].admin_docs) ? cur[0].admin_docs.slice() : [];
  const ts = Date.now();
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!f || !f.base64) continue;
    const isPdf = (f.contentType || "").indexOf("pdf") >= 0;
    const u = await uploadToStorage(env, `assets/${id}/docs/${ts}-${i}.${isPdf ? "pdf" : "jpg"}`, f.base64, isPdf ? "application/pdf" : (f.contentType || "image/jpeg"));
    if (u) docs.push({ url: u, name: (f.name || (isPdf ? "Invoice.pdf" : "Screenshot")).toString().slice(0, 120), type: isPdf ? "pdf" : "image", at: new Date().toISOString() });
  }
  const res = await sbUpdate(env, "assets", id, { admin_docs: docs });
  return res && res.ok ? docs : null;
}

// Read a purchase receipt, invoice, or warranty document (images and/or PDFs) and
// pull out the warranty and purchase details for an asset. Fills the editor for
// review (does not change the saved fields). When an asset id is given, the
// uploaded files are also saved to the asset's admin documents. Conservative.
async function scanWarranty(request, env, session) {
  if (!can(session, "assets", "edit")) return deny("assets");
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: "The AI is not connected." }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const c = (v) => (v == null ? "" : v.toString().trim());
  const files = normalizeDocFiles(body);
  if (!files.length) return json({ ok: false, error: "No file to read." }, 400);
  const blocks = files.map((f) => {
    const isPdf = (f.contentType || "").indexOf("pdf") >= 0;
    const source = { type: "base64", media_type: isPdf ? "application/pdf" : (f.contentType || "image/jpeg"), data: f.base64 };
    return isPdf ? { type: "document", source } : { type: "image", source };
  });
  const today = new Date().toISOString().slice(0, 10);

  const prompt =
    "You are reading a purchase receipt, invoice, order confirmation, or warranty document for a piece of equipment " +
    "(for example a Costco order, a Home Depot receipt, or a manufacturer warranty card). Today is " + today + ". " +
    "Equipment often has TWO layers of coverage: the manufacturer's warranty (included, usually 1 year), and a separate " +
    "extended protection plan bought on top (for example an Allstate, Asurion, or Square Trade plan) that takes over after " +
    "the manufacturer's warranty ends. Capture both when present. Return:\n" +
    "- purchasedOn: the order or purchase date as YYYY-MM-DD, or empty.\n" +
    "- purchasedFrom: the store or retailer it was bought from (e.g. Costco, Home Depot, Amazon, Best Buy), or empty.\n" +
    "- purchasePrice: the price paid for the main equipment item as a plain number, no currency symbol. If there are several " +
    "line items, use the main appliance or equipment, not the protection plans or delivery. Empty if unclear.\n" +
    "- warrantyProvider: the MANUFACTURER's warranty backer (the brand, e.g. LG, GE). Empty if not shown.\n" +
    "- warrantyLength: the manufacturer warranty term in plain words (e.g. \"1 year\"). Empty if not shown.\n" +
    "- warrantyExpires: the manufacturer warranty end date as YYYY-MM-DD. If not printed but you have the purchase date and a length in years, add them. Empty if you cannot tell.\n" +
    "- extProvider: the EXTENDED / protection plan provider (e.g. Allstate, Asurion, Square Trade). Empty if there is no extended plan.\n" +
    "- extLength: the extended plan term in plain words (e.g. \"3 years\"). Empty if none.\n" +
    "- extExpires: the extended plan end date as YYYY-MM-DD. Extended plans usually run from the purchase date for the plan term (some begin only after the manufacturer warranty ends; use what the document states, otherwise purchase date plus the plan term). Empty if you cannot tell.\n" +
    "- supportContact: who to call for support or a claim, with the phone number and hours if shown. IMPORTANT: when the retailer offers its own concierge/tech support, that is who to call first, not the manufacturer. For a Costco purchase the support line is Costco Concierge at 1-866-861-0450 (5 a.m. to 10 p.m., 7 days), so return something like \"Costco Concierge 1-866-861-0450 (5am-10pm, 7 days)\". Otherwise use the support number printed on the document. Empty if none.\n" +
    "- notes: a short plain summary of anything else useful (order number, which appliance the plan covers, plan price). One or two lines. Empty if nothing.\n" +
    "If there are several protection plans on one order, pick the one whose price tier matches this equipment. " +
    "Only use what the document actually shows. Do not invent prices, dates, order numbers, or coverage.";

  const schema = {
    type: "object",
    properties: {
      purchasedOn: { type: "string" }, purchasedFrom: { type: "string" }, purchasePrice: { type: "string" },
      warrantyProvider: { type: "string" }, warrantyLength: { type: "string" }, warrantyExpires: { type: "string" },
      extProvider: { type: "string" }, extLength: { type: "string" }, extExpires: { type: "string" },
      supportContact: { type: "string" }, notes: { type: "string" },
    },
    required: ["purchasedOn", "purchasedFrom", "purchasePrice", "warrantyProvider", "warrantyLength", "warrantyExpires", "extProvider", "extLength", "extExpires", "supportContact", "notes"],
    additionalProperties: false,
  };

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-opus-4-8", max_tokens: 700, messages: [{ role: "user", content: blocks.concat([{ type: "text", text: prompt }]) }], output_config: { format: { type: "json_schema", schema } } }),
    });
    if (!res.ok) return json({ ok: false, error: "The assistant couldn't read that file." }, 502);
    const data = await res.json();
    const tb = (data.content || []).find((b) => b.type === "text");
    if (!tb) return json({ ok: false, error: "The assistant couldn't read that file." }, 502);
    let out;
    try {
      out = JSON.parse(tb.text);
    } catch {
      return json({ ok: false, error: "The assistant couldn't read that file." }, 502);
    }
    const okd = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || "") ? s : "");
    const price = (out.purchasePrice || "").toString().replace(/[^0-9.]/g, "");
    const purchasedFrom = (out.purchasedFrom || "").toString().trim().slice(0, 120);
    let supportContact = (out.supportContact || "").toString().trim().slice(0, 200);
    // Safety net: a Costco purchase routes support to Costco Concierge, not the maker.
    if (!supportContact && /costco/i.test(purchasedFrom)) supportContact = "Costco Concierge 1-866-861-0450 (5am-10pm, 7 days)";
    // Save the uploaded files to the asset's troubleshoot documents (best-effort).
    let docs = null;
    const id = c(body.id);
    if (id && (await ownsRecord(env, session, "assets", id))) {
      try { docs = await appendAdminDocs(env, id, files); } catch { docs = null; }
    }
    return json({
      ok: true,
      purchasedOn: okd(out.purchasedOn),
      purchasedFrom,
      purchasePrice: price,
      warrantyProvider: (out.warrantyProvider || "").toString().trim().slice(0, 120),
      warrantyLength: (out.warrantyLength || "").toString().trim().slice(0, 120),
      warrantyExpires: okd(out.warrantyExpires),
      extProvider: (out.extProvider || "").toString().trim().slice(0, 120),
      extLength: (out.extLength || "").toString().trim().slice(0, 120),
      extExpires: okd(out.extExpires),
      supportContact,
      notes: (out.notes || "").toString().trim().slice(0, 500),
      docs: docs || undefined,
    });
  } catch {
    return json({ ok: false, error: "Couldn't reach the assistant." }, 502);
  }
}

// Add troubleshoot files (invoices, screenshots) to an asset without reading them.
async function addAssetDocs(request, env, session) {
  if (!can(session, "assets", "edit")) return deny("assets");
  if (scopeName(session) != null) return json({ ok: false, error: "Admin only." }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const id = (body.id || "").toString().trim();
  if (!id || !(await ownsRecord(env, session, "assets", id))) return json({ ok: false, error: "Not found." }, 404);
  const files = normalizeDocFiles(body);
  if (!files.length) return json({ ok: false, error: "No files." }, 400);
  const docs = await appendAdminDocs(env, id, files);
  if (!docs) return json({ ok: false, error: "Couldn't save. Run the asset_warranty migration first." }, 502);
  return json({ ok: true, docs });
}

// Remove one troubleshoot file from an asset (and from storage, best-effort).
async function deleteAssetDoc(request, env, session) {
  if (!can(session, "assets", "edit")) return deny("assets");
  if (scopeName(session) != null) return json({ ok: false, error: "Admin only." }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const id = (body.id || "").toString().trim();
  const url = (body.url || "").toString().trim();
  if (!id || !url || !(await ownsRecord(env, session, "assets", id))) return json({ ok: false, error: "Not found." }, 404);
  const cur = await sbSelect(env, `assets?id=eq.${id}&select=admin_docs`);
  const docs = (cur && cur[0] && Array.isArray(cur[0].admin_docs) ? cur[0].admin_docs : []).filter((d) => d && d.url !== url);
  const res = await sbUpdate(env, "assets", id, { admin_docs: docs });
  if (!res.ok) return json({ ok: false, error: "Couldn't update." }, 502);
  // Best-effort storage cleanup.
  const m = url.match(/\/object\/public\/photos\/(.+)$/);
  if (m) { try { await fetch(`${env.SUPABASE_URL}/storage/v1/object/photos/${m[1]}`, { method: "DELETE", headers: sbHeaders(env) }); } catch { /* ignore */ } }
  return json({ ok: true, docs });
}

async function uploadRedbookDoc(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  if (!sbReady(env)) return json({ ok: false, error: "Not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const c = (v) => (v == null ? "" : v.toString().trim());
  const who = await redbookClientId(env, session, c(body.client));
  if (!who.id) return json({ ok: false, error: "Pick a client first." }, 400);
  const section = c(body.section) || "Other";
  const title = c(body.title) || "Document";
  const base64 = body.fileBase64 || "";
  const ct = c(body.contentType) || "application/pdf";
  if (!base64) return json({ ok: false, error: "No file." }, 400);
  const ext = ct.indexOf("pdf") >= 0 ? "pdf" : (ct.indexOf("png") >= 0 ? "png" : "jpg");
  const path = `redbook/${who.id}/${Date.now()}-${Math.floor(Math.random() * 1e4)}.${ext}`;
  const fileUrl = await uploadToStorage(env, path, base64, ct);
  if (!fileUrl) return json({ ok: false, error: "Upload failed." }, 502);
  const a = authorOf(session);
  const patch = { client_id: who.id, section, title, file_url: fileUrl, file_type: ct, uploaded_by: a.author };
  // Read the document to name it (and pull its date/expiry). We override a
  // filename-ish title; a real title the user typed is kept.
  const isReadable = ct.indexOf("image") >= 0 || ct.indexOf("pdf") >= 0;
  if (isReadable) {
    const read = await readDocFields({ type: "base64", media_type: ct.indexOf("pdf") >= 0 ? "application/pdf" : ct, data: base64 }, ct, section, env);
    if (read) {
      if (read.title && (looksGenericTitle(title) || body.autoName === true)) patch.title = read.title;
      if (read.date) patch.doc_date = read.date;
      // No expiry printed on the document -> ignore it, never set one ourselves.
      if (read.expiry) patch.expires_at = read.expiry;
    }
  }
  let res = await sbInsert(env, "redbook_docs", patch);
  // Pre-migration fallback if doc_date / expires_at columns don't exist yet.
  if (!res.ok && (patch.doc_date || patch.expires_at)) { delete patch.doc_date; delete patch.expires_at; res = await sbInsert(env, "redbook_docs", patch); }
  if (!res.ok) return json({ ok: false, error: ("Saved the file, but couldn't record it. " + (res.error || "")).slice(0, 200) }, 502);
  return json({ ok: true, doc: res.data || null });
}

// Re-read an already-filed document and suggest a title/date/expiry (for docs
// uploaded before auto-naming, or to refresh a guess). Saves nothing.
async function readRedbookDoc(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: "The assistant is not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const id = (body.id || "").toString().trim();
  if (!id) return json({ ok: false, error: "No id." }, 400);
  const rows = await sbSelect(env, `redbook_docs?id=eq.${id}&select=file_url,file_type,section`);
  const doc = rows && rows[0];
  if (!doc || !doc.file_url) return json({ ok: false, error: "No file to read." }, 404);
  const ct = (doc.file_type || "").indexOf("pdf") >= 0 || /\.pdf(\?|$)/i.test(doc.file_url) ? "application/pdf" : (doc.file_type || "image/jpeg");
  const read = await readDocFields({ type: "url", url: doc.file_url }, ct, doc.section || "", env);
  if (!read || !read.title) return json({ ok: false, error: "Couldn't read the document." }, 502);
  return json({ ok: true, title: read.title, docDate: read.date, expires: read.expiry });
}

async function deleteRedbookDoc(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const id = (body.id || "").toString().trim();
  if (!id) return json({ ok: false, error: "No id." }, 400);
  // A client login may only delete its own client's docs.
  const forced = scopeName(session);
  if (forced != null) {
    const rows = await sbSelect(env, `redbook_docs?id=eq.${id}&select=client:clients(name)`);
    const cn = rows && rows[0] && rows[0].client && rows[0].client.name;
    if (cn !== forced) return json({ ok: false, error: "Not found." }, 404);
  }
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/redbook_docs?id=eq.${id}`, { method: "DELETE", headers: sbHeaders(env) });
  if (!r.ok) return json({ ok: false, error: "Could not delete." }, 502);
  return json({ ok: true });
}

// AI cleanup for a document title: fix spelling and capitalization and tidy the
// formatting into a short, professional title. Conservative: it must not invent
// dates, names, or facts that aren't already in the title. Returns a suggestion
// to preview; nothing is saved until the user hits Save.
async function tidyRedbookTitle(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: "The assistant is not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const title = (body.title || "").toString().trim();
  const section = (body.section || "").toString().trim();
  if (!title) return json({ ok: false, error: "Enter a name first." }, 400);
  const schema = { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 120,
        messages: [{ role: "user", content:
          "Tidy the title of a food-safety document" + (section ? " filed under the section \"" + section + "\"" : "") + ". " +
          "Fix spelling and capitalization (for example correct brand names like EcoSure and ServSafe) and tidy it into a short, professional document title. " +
          "House style you may apply only when the information is already present: write any date in ISO form (YYYY-MM-DD or YYYY-MM), and write an expiry already in the title as \"exp YYYY-MM\". " +
          "Do NOT add dates, names, locations, or any fact that is not already in the title. Do not change its meaning or expand abbreviations into new claims. " +
          "Keep it a concise title, not a sentence. No surrounding quotes and no trailing period.\n\nTitle: " + title }],
        output_config: { format: { type: "json_schema", schema } },
      }),
    });
    if (!res.ok) return json({ ok: false, error: "The assistant couldn't respond." }, 502);
    const data = await res.json();
    const block = (data.content || []).find((b) => b.type === "text");
    if (!block) return json({ ok: false, error: "No suggestion." }, 502);
    let out;
    try { out = JSON.parse(block.text); } catch { return json({ ok: false, error: "Couldn't read the suggestion." }, 502); }
    const cleaned = (out.title || "").trim().replace(/^["']|["']$/g, "").replace(/\.$/, "").slice(0, 200);
    return json({ ok: true, title: cleaned || title });
  } catch {
    return json({ ok: false, error: "Couldn't reach the assistant." }, 502);
  }
}

// Batch version of Tidy: clean every document title for a client in one pass and
// return only the ones that changed, as { id, old, title } for the user to review
// and approve. Saves nothing; the page applies the ones the user keeps.
async function tidyAllRedbook(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: "The assistant is not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const who = await redbookClientId(env, session, (body.client || "").toString().trim());
  if (!who.id) return json({ ok: false, error: "Pick a client first." }, 400);
  const docs = await sbSelect(env, `redbook_docs?client_id=eq.${who.id}&select=id,section,title&order=created_at.desc`);
  if (docs === null) return json({ ok: true, items: [] });
  const list = (docs || []).filter((d) => (d.title || "").trim());
  if (!list.length) return json({ ok: true, items: [] });
  // Send a numbered list and map results back by index (never trust model ids).
  const payload = list.map((d, i) => ({ i, section: d.section || "", title: d.title || "" }));
  const schema = { type: "object", properties: { items: { type: "array", items: { type: "object", properties: { i: { type: "integer" }, title: { type: "string" } }, required: ["i", "title"], additionalProperties: false } } }, required: ["items"], additionalProperties: false };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: Math.min(4000, 120 + list.length * 60),
        messages: [{ role: "user", content:
          "These are food-safety document titles, each with an index i and the section it is filed under. " +
          "For each, fix spelling and capitalization (correct brand names like EcoSure and ServSafe) and tidy it into a short, professional document title. " +
          "House style you may apply only when the information is already present: write any date in ISO form (YYYY-MM-DD or YYYY-MM), and write an expiry already in the title as \"exp YYYY-MM\". " +
          "Do NOT add dates, names, locations, or facts not already in the title, and do not change meaning. Keep each a concise title with no surrounding quotes and no trailing period. " +
          "Return items as an array of { i, title } using the same index i for each.\n\n" + JSON.stringify(payload) }],
        output_config: { format: { type: "json_schema", schema } },
      }),
    });
    if (!res.ok) return json({ ok: false, error: "The assistant couldn't respond." }, 502);
    const data = await res.json();
    const block = (data.content || []).find((b) => b.type === "text");
    if (!block) return json({ ok: false, error: "No suggestion." }, 502);
    let out;
    try { out = JSON.parse(block.text); } catch { return json({ ok: false, error: "Couldn't read the suggestion." }, 502); }
    const items = [];
    for (const r of (out.items || [])) {
      const d = list[r.i];
      if (!d) continue;
      const cleaned = (r.title || "").trim().replace(/^["']|["']$/g, "").replace(/\.$/, "").slice(0, 200);
      if (cleaned && cleaned !== (d.title || "").trim()) items.push({ id: d.id, section: d.section || "", old: d.title || "", title: cleaned });
    }
    return json({ ok: true, items });
  } catch {
    return json({ ok: false, error: "Couldn't reach the assistant." }, 502);
  }
}

async function renameRedbookDoc(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  if (!sbReady(env)) return json({ ok: false, error: "Not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const id = (body.id || "").toString().trim();
  const title = (body.title || "").toString().trim().slice(0, 200);
  if (!id) return json({ ok: false, error: "No id." }, 400);
  if (!title) return json({ ok: false, error: "Enter a name." }, 400);
  // A client login may only rename its own client's docs.
  const forced = scopeName(session);
  if (forced != null) {
    const rows = await sbSelect(env, `redbook_docs?id=eq.${id}&select=client:clients(name)`);
    const cn = rows && rows[0] && rows[0].client && rows[0].client.name;
    if (cn !== forced) return json({ ok: false, error: "Not found." }, 404);
  }
  const patch = { title };
  // Optional move to another section.
  if ("section" in body) {
    const sec = (body.section || "").toString().trim().slice(0, 120);
    if (sec) patch.section = sec;
  }
  // Optional expiry date (YYYY-MM-DD). Only set it when the caller sends the key,
  // and only when the column exists (the page passes it only if supported).
  if ("expires" in body) {
    const e = (body.expires || "").toString().trim();
    patch.expires_at = /^\d{4}-\d{2}-\d{2}$/.test(e) ? e : null;
  }
  // Optional document date (when the paperwork actually happened) — same deal.
  if ("docDate" in body) {
    const dd = (body.docDate || "").toString().trim();
    patch.doc_date = /^\d{4}-\d{2}-\d{2}$/.test(dd) ? dd : null;
  }
  const res = await sbUpdate(env, "redbook_docs", id, patch);
  if (!res.ok) return json({ ok: false, error: "Could not save." }, 502);
  return json({ ok: true });
}

/* ===================== Baskin Robbins Inventory ===================== */
// Photo-driven inventory. A "count" is one session; photos are filed under it
// and Claude reads each photo into line items (3-gallon tubs, 8-packs, or a
// dipping-cabinet partial with a fullness estimate). Items carry a "need to buy"
// quantity. Degrades gracefully until the inventory_* tables exist (run
// supabase/inventory.sql once).

const INVENTORY_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          product: { type: "string" },
          label: { type: "string" },
          kind: { type: "string" },
          count: { type: "number" },
          fullness: { type: "string" },
          placement: { type: "string" },
        },
        required: ["product", "label", "kind", "count", "fullness", "placement"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

function inventoryPrompt(catalog) {
  return "You are taking inventory at a Baskin Robbins ice cream shop from a photo. The photo shows one of:\n" +
  "- 3-gallon tubs of ice cream (round cardboard tubs; the flavor is printed or written on the side, often abbreviated, " +
  "like 'B-R STRBY CHS' or 'B-R PRLN B CRML' or 'B-R CKY MONSTER'),\n" +
  "- a case, shelf, or 8-pack box of pre-packed pints/quarts,\n" +
  "- the dipping cabinet (open round tubs you scoop from, each with a small name tag; you can see how full each tub is).\n\n" +
  "For every distinct product you can clearly see, return one item:\n" +
  "- label: the exact text on the tub or tag, as written.\n" +
  "- kind: 'tub' for a 3-gallon tub, 'pack' for a pre-pack or 8-pack box, 'cabinet' for an open dipping-cabinet tub, else 'other'.\n" +
  "- product: MATCH the flavor to the closest name in the known product list below and return that name EXACTLY as listed. " +
  "Match the size from the kind: a dipping-cabinet or 3-gallon tub is a '3 Gallon' product (its name ends in 3G); a pre-pack is " +
  "a Quart (ends in QT). Expand abbreviations to find the match (STRBY CHS = Strawberry Cheesecake, PRLN = Pralines, CKY/CKIE = " +
  "Cookie, MNT = Mint, CHOC = Chocolate, VAN = Vanilla, ORE = Oreo). If it does not clearly match any known product, return your " +
  "best readable flavor name instead.\n" +
  "- count: how many of that item are visible (count the tubs or packs of that flavor). For a single dipping-cabinet tub use 1.\n" +
  "- fullness: ONLY for a dipping-cabinet tub, estimate how full it is: 'full' (more than half), 'half' (about half), or " +
  "'low' (less than half). Leave it an empty string for sealed tubs and packs.\n" +
  "- placement: a short note on where it is in the photo (e.g. 'top shelf left', 'cabinet front row', 'freezer door').\n\n" +
  "Read carefully and do not invent flavors you cannot see. If a label is unreadable, use 'Unknown' for product.\n\n" +
  "Known products:\n" + (catalog && catalog.length ? catalog.map((n) => "- " + n).join("\n") : "(none yet)");
}

const INV_KINDS = { tub: 1, pack: 1, cabinet: 1, other: 1 };

// Resolve the client and confirm a count belongs to it. Returns { who, count } or
// a Response error to return directly.
async function invScope(env, session, clientName, countId) {
  const who = await redbookClientId(env, session, (clientName || "").toString().trim());
  if (!who.id) return { error: json({ ok: false, error: "Pick a client first." }, 400) };
  if (countId) {
    const rows = await sbSelect(env, `inventory_counts?id=eq.${countId}&client_id=eq.${who.id}&select=id,status`);
    if (rows === null) return { error: json({ ok: false, error: "The inventory tables aren't set up yet. Run supabase/inventory.sql once." }, 400) };
    if (!rows[0]) return { error: json({ ok: false, error: "Count not found." }, 404) };
    return { who, count: rows[0] };
  }
  return { who };
}

async function listInventory(url, env, session) {
  if (!can(session, "foodSafety", "view")) return deny("foodSafety");
  const who = await redbookClientId(env, session, url.searchParams.get("client") || "");
  if (!who.id) return noStore({ ok: true, client: who.name, counts: [] });
  const countId = (url.searchParams.get("count") || "").trim();
  if (countId) {
    const [counts, photos] = await Promise.all([
      sbSelect(env, `inventory_counts?id=eq.${countId}&client_id=eq.${who.id}&select=id,status,note,created_by,created_at,finished_at&limit=1`),
      sbSelect(env, `inventory_photos?count_id=eq.${countId}&select=id,url,kind,created_at&order=created_at.asc`),
    ]);
    let items = await sbSelect(env, `inventory_items?count_id=eq.${countId}&select=id,photo_id,product,label,kind,qty,fullness,placement,need,onhand,created_at&order=created_at.asc`);
    if (items === null) items = await sbSelect(env, `inventory_items?count_id=eq.${countId}&select=id,photo_id,product,label,kind,qty,fullness,placement,need,created_at&order=created_at.asc`); // pre-migration (no onhand)
    if (counts === null) return noStore({ ok: true, client: who.name, missing: true, counts: [] });
    const c = counts[0];
    if (!c) return noStore({ ok: false, error: "Count not found." }, 404);
    return noStore({ ok: true, client: who.name, count: c, photos: photos || [], items: items || [] });
  }
  const counts = await sbSelect(env, `inventory_counts?client_id=eq.${who.id}&select=id,status,note,created_by,created_at,finished_at&order=created_at.desc&limit=60`);
  if (counts === null) return noStore({ ok: true, client: who.name, missing: true, counts: [] });
  return noStore({ ok: true, client: who.name, counts: counts || [] });
}

async function createInventoryCount(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  if (!sbReady(env)) return json({ ok: false, error: "Not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const s = await invScope(env, session, body.client, null);
  if (s.error) return s.error;
  const a = authorOf(session);
  const res = await sbInsert(env, "inventory_counts", { client_id: s.who.id, status: "open", note: (body.note || "").toString().slice(0, 300), created_by: a.author });
  if (!res.ok) return json({ ok: false, error: "The inventory tables aren't set up yet. Run supabase/inventory.sql once." }, 400);
  return json({ ok: true, count: res.data || null });
}

async function closeInventoryCount(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const s = await invScope(env, session, body.client, (body.id || "").toString().trim());
  if (s.error) return s.error;
  const done = body.reopen ? "open" : "done";
  const res = await sbUpdate(env, "inventory_counts", s.count.id, { status: done, finished_at: done === "done" ? new Date().toISOString() : null });
  if (!res.ok) return json({ ok: false, error: "Could not update." }, 502);
  return json({ ok: true, status: done });
}

async function deleteInventoryCount(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const s = await invScope(env, session, body.client, (body.id || "").toString().trim());
  if (s.error) return s.error;
  // Photos and items cascade-delete with the count (FK on delete cascade).
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/inventory_counts?id=eq.${s.count.id}&client_id=eq.${s.who.id}`, { method: "DELETE", headers: sbHeaders(env) });
  if (!r.ok) return json({ ok: false, error: "Could not delete." }, 502);
  return json({ ok: true });
}

// Read one inventory photo with Claude and insert its line items. Runs in the
// background (after the upload response) so the browser doesn't wait and you can
// navigate away — the flavors fill in on the server and show on the next reload.
async function readInventoryPhotoInBackground(env, who, count, photo, base64, ct, catalog) {
  if (!env.ANTHROPIC_API_KEY) return;
  let read = null;
  try { read = await claudeReadSheet(base64, ct, inventoryPrompt(catalog || []), INVENTORY_SCHEMA, env); } catch { read = null; }
  if (!read || !Array.isArray(read.items)) return;
  const rows = [];
  for (const it of read.items) {
    const kind = INV_KINDS[(it.kind || "").toLowerCase()] ? (it.kind || "").toLowerCase() : "tub";
    const qty = kind === "cabinet" ? 1 : Math.max(1, Math.round(parseFloat(it.count) || 1));
    const fullness = kind === "cabinet" ? (["full", "half", "low"].indexOf((it.fullness || "").toLowerCase()) >= 0 ? (it.fullness || "").toLowerCase() : "half") : null;
    rows.push({ count_id: count.id, client_id: who.id, photo_id: photo.id || null, product: (it.product || "").toString().slice(0, 160), label: (it.label || "").toString().slice(0, 160), kind, qty, fullness, placement: (it.placement || "").toString().slice(0, 160) });
  }
  if (rows.length) await sbInsert(env, "inventory_items", rows);
}

async function addInventoryPhoto(request, env, session, ctx) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  if (!sbReady(env)) return json({ ok: false, error: "Not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const s = await invScope(env, session, body.client, (body.count || "").toString().trim());
  if (s.error) return s.error;
  const base64 = (body.imageBase64 || "").toString();
  const ct = (body.contentType || "image/jpeg").toString();
  if (!base64) return json({ ok: false, error: "No photo." }, 400);
  const ext = ct.indexOf("png") >= 0 ? "png" : "jpg";
  const path = `inventory/${s.who.id}/${Date.now()}-${Math.floor(Math.random() * 1e4)}.${ext}`;
  const fileUrl = await uploadToStorage(env, path, base64, ct);
  if (!fileUrl) return json({ ok: false, error: "Upload failed." }, 502);
  const pRes = await sbInsert(env, "inventory_photos", { count_id: s.count.id, client_id: s.who.id, url: fileUrl, kind: (body.kind || "").toString().slice(0, 20) || null });
  if (!pRes.ok) return json({ ok: false, error: "Saved the photo, but couldn't record it." }, 502);
  const photo = pRes.data || {};
  // Kick off the AI read AFTER returning, so the upload is fast and the browser
  // is free to move on. Fall back to inline if no execution context is available.
  const catalog = Array.isArray(body.catalog) ? body.catalog.slice(0, 500) : [];
  const job = readInventoryPhotoInBackground(env, s.who, s.count, photo, base64, ct, catalog);
  if (ctx && ctx.waitUntil) { ctx.waitUntil(job); return json({ ok: true, photo, reading: true }); }
  await job;
  return json({ ok: true, photo, read: true });
}

async function deleteInventoryPhoto(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const s = await invScope(env, session, body.client, null);
  if (s.error) return s.error;
  const id = (body.id || "").toString().trim();
  if (!id) return json({ ok: false, error: "No id." }, 400);
  // Scope: only delete a photo (and its items) that belongs to this client.
  await fetch(`${env.SUPABASE_URL}/rest/v1/inventory_items?photo_id=eq.${id}&client_id=eq.${s.who.id}`, { method: "DELETE", headers: sbHeaders(env) });
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/inventory_photos?id=eq.${id}&client_id=eq.${s.who.id}`, { method: "DELETE", headers: sbHeaders(env) });
  if (!r.ok) return json({ ok: false, error: "Could not delete." }, 502);
  return json({ ok: true });
}

async function saveInventoryItem(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  if (!sbReady(env)) return json({ ok: false, error: "Not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const s = await invScope(env, session, body.client, null);
  if (s.error) return s.error;
  const id = (body.id || "").toString().trim();
  if (body.delete && id) {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/inventory_items?id=eq.${id}&client_id=eq.${s.who.id}`, { method: "DELETE", headers: sbHeaders(env) });
    if (!r.ok) return json({ ok: false, error: "Could not delete." }, 502);
    return json({ ok: true });
  }
  const num = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
  const fields = {};
  if ("product" in body) fields.product = (body.product || "").toString().slice(0, 160);
  if ("label" in body) fields.label = (body.label || "").toString().slice(0, 160);
  if ("kind" in body) fields.kind = INV_KINDS[(body.kind || "").toLowerCase()] ? (body.kind || "").toLowerCase() : "tub";
  if ("qty" in body) fields.qty = num(body.qty) == null ? 1 : num(body.qty);
  if ("fullness" in body) fields.fullness = (["full", "half", "low"].indexOf((body.fullness || "").toLowerCase()) >= 0) ? (body.fullness || "").toLowerCase() : null;
  if ("placement" in body) fields.placement = (body.placement || "").toString().slice(0, 160);
  if ("need" in body) fields.need = num(body.need);
  if ("onhand" in body) fields.onhand = num(body.onhand);
  if (id) {
    let res = await sbUpdate(env, "inventory_items", id, fields);
    if (!res.ok && "onhand" in fields) { const f2 = Object.assign({}, fields); delete f2.onhand; res = await sbUpdate(env, "inventory_items", id, f2); } // pre-migration fallback
    if (!res.ok) return json({ ok: false, error: "Could not save." }, 502);
    return json({ ok: true });
  }
  // New manual item: requires a count.
  const cid = (body.count || "").toString().trim();
  const cs = await invScope(env, session, body.client, cid);
  if (cs.error) return cs.error;
  fields.count_id = cs.count.id; fields.client_id = s.who.id;
  if (!("kind" in fields)) fields.kind = "tub";
  if (!("qty" in fields)) fields.qty = 1;
  let res = await sbInsert(env, "inventory_items", fields);
  if (!res.ok && "onhand" in fields) { const f2 = Object.assign({}, fields); delete f2.onhand; res = await sbInsert(env, "inventory_items", f2); } // pre-migration fallback
  if (!res.ok) return json({ ok: false, error: "Could not add." }, 502);
  return json({ ok: true, item: res.data || null });
}

// Orders / purchase history, by day. Each order is a date + a list of
// { product, qty } (cost not tracked). The page lays them out as a trend grid so
// you can see how much of each product you bought over time and when to reorder.
function cleanOrderItems(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const it of arr) {
    const product = (it && it.product != null ? it.product : "").toString().trim().slice(0, 160);
    const qty = parseFloat(it && it.qty);
    if (!product && (isNaN(qty) || qty === 0)) continue;
    out.push({ product, qty: isNaN(qty) ? 0 : qty });
    if (out.length >= 300) break;
  }
  return out;
}

async function listInventoryOrders(url, env, session) {
  if (!can(session, "foodSafety", "view")) return deny("foodSafety");
  const who = await redbookClientId(env, session, url.searchParams.get("client") || "");
  if (!who.id) return noStore({ ok: true, client: who.name, orders: [] });
  const base = `inventory_orders?client_id=eq.${who.id}&order=order_date.asc,created_at.asc&limit=200`;
  let rows = await sbSelect(env, `${base}&select=id,order_date,label,items,order_no,amount,ordered_on,created_by,created_at`);
  if (rows === null) { // pre-migration: columns order_no/amount/ordered_on may not exist
    rows = await sbSelect(env, `${base}&select=id,order_date,label,items,created_by,created_at`);
    if (rows === null) return noStore({ ok: true, client: who.name, missing: true, orders: [] });
  }
  return noStore({ ok: true, client: who.name, orders: rows || [] });
}

async function saveInventoryOrder(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  if (!sbReady(env)) return json({ ok: false, error: "Not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const s = await invScope(env, session, body.client, null);
  if (s.error) return s.error;
  const date = (body.date || "").toString().slice(0, 10);
  const order_date = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
  const label = (body.label || "").toString().slice(0, 120);
  const items = cleanOrderItems(body.items);
  const extra = {};
  if ("orderNo" in body) extra.order_no = (body.orderNo || "").toString().slice(0, 40) || null;
  if ("amount" in body) { const a2 = parseFloat(body.amount); extra.amount = isNaN(a2) ? null : a2; }
  if ("orderedOn" in body) { const od = (body.orderedOn || "").toString().slice(0, 10); extra.ordered_on = /^\d{4}-\d{2}-\d{2}$/.test(od) ? od : null; }
  const id = (body.id || "").toString().trim();
  if (id) {
    let res = await sbUpdate(env, "inventory_orders", id, Object.assign({ order_date, label, items }, extra));
    if (!res.ok && Object.keys(extra).length) res = await sbUpdate(env, "inventory_orders", id, { order_date, label, items }); // pre-migration fallback
    if (!res.ok) return json({ ok: false, error: "Could not save." }, 502);
    return json({ ok: true });
  }
  const a = authorOf(session);
  const row = Object.assign({ client_id: s.who.id, order_date, label, items, created_by: a.author }, extra);
  let res = await sbInsert(env, "inventory_orders", row);
  if (!res.ok && Object.keys(extra).length) { const r2 = { client_id: s.who.id, order_date, label, items, created_by: a.author }; res = await sbInsert(env, "inventory_orders", r2); }
  if (!res.ok) return json({ ok: false, error: "The inventory tables aren't set up yet. Run the latest supabase/inventory.sql once." }, 400);
  return json({ ok: true, order: res.data || null });
}

async function deleteInventoryOrder(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const s = await invScope(env, session, body.client, null);
  if (s.error) return s.error;
  const id = (body.id || "").toString().trim();
  if (!id) return json({ ok: false, error: "No id." }, 400);
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/inventory_orders?id=eq.${id}&client_id=eq.${s.who.id}`, { method: "DELETE", headers: sbHeaders(env) });
  if (!r.ok) return json({ ok: false, error: "Could not delete." }, 502);
  return json({ ok: true });
}

// The product catalog (the order form's list). It grows when you identify an
// unknown line on an uploaded order.
async function listInventoryCatalog(url, env, session) {
  if (!can(session, "foodSafety", "view")) return deny("foodSafety");
  const who = await redbookClientId(env, session, url.searchParams.get("client") || "");
  if (!who.id) return noStore({ ok: true, products: [] });
  const rows = await sbSelect(env, `inventory_products?client_id=eq.${who.id}&select=name,category&order=name.asc`);
  if (rows === null) return noStore({ ok: true, products: [], missing: true });
  return noStore({ ok: true, products: rows || [] });
}

async function saveInventoryCatalog(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  if (!sbReady(env)) return json({ ok: false, error: "Not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const who = await redbookClientId(env, session, (body.client || "").toString().trim());
  if (!who.id) return json({ ok: false, error: "Pick a client first." }, 400);
  let arr = Array.isArray(body.products) ? body.products : (body.name ? [{ name: body.name, category: body.category }] : []);
  arr = arr.map((p) => ({ name: (p.name || "").toString().trim().slice(0, 160), category: (p.category || "").toString().slice(0, 40) || null })).filter((p) => p.name);
  if (!arr.length) return json({ ok: true, added: 0 });
  const existing = await sbSelect(env, `inventory_products?client_id=eq.${who.id}&select=name`);
  if (existing === null) return json({ ok: false, error: "The inventory_products table isn't set up yet. Run the latest supabase/inventory.sql once." }, 400);
  const have = {}; (existing || []).forEach((r) => { have[(r.name || "").toLowerCase()] = 1; });
  const rows = []; const seen = {};
  arr.forEach((p) => { const k = p.name.toLowerCase(); if (have[k] || seen[k]) return; seen[k] = 1; rows.push({ client_id: who.id, name: p.name, category: p.category }); });
  if (!rows.length) return json({ ok: true, added: 0 });
  const added = await insertChunks(env, "inventory_products", rows);
  return json({ ok: true, added });
}

// Read a photo or PDF of an order/invoice into line items, mapping each to the
// client's known product list (unmatched lines come back for the user to
// identify). Suggests Order 1 / Order 2 / Last from how many orders exist. Saves
// nothing; the page opens the order editor prefilled for review.
const ORDERSCAN_SCHEMA = {
  type: "object",
  properties: {
    date: { type: "string" },
    orderDate: { type: "string" },
    orderNo: { type: "string" },
    amount: { type: "number" },
    items: { type: "array", items: { type: "object", properties: { label: { type: "string" }, product: { type: "string" }, qty: { type: "number" } }, required: ["label", "product", "qty"], additionalProperties: false } },
  },
  required: ["date", "orderDate", "orderNo", "amount", "items"],
  additionalProperties: false,
};

async function scanOrder(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  if (!sbReady(env)) return json({ ok: false, error: "Not connected." }, 503);
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: "The AI is not connected. Add the ANTHROPIC_API_KEY in Cloudflare." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const who = await redbookClientId(env, session, (body.client || "").toString().trim());
  if (!who.id) return json({ ok: false, error: "Pick a client first." }, 400);
  const base64 = (body.imageBase64 || "").toString();
  const ct = (body.contentType || "image/jpeg").toString();
  if (!base64) return json({ ok: false, error: "No file." }, 400);
  const catalog = Array.isArray(body.catalog) ? body.catalog.slice(0, 500) : [];
  const isPdf = ct.indexOf("pdf") >= 0;
  const block = isPdf ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } } : { type: "image", source: { type: "base64", media_type: ct, data: base64 } };
  const prompt =
    "This is a Baskin Robbins order or invoice (for example an Order History Detail). Read the whole order.\n" +
    "Return:\n" +
    "- date: the DELIVERY date as YYYY-MM-DD if shown, else empty string.\n" +
    "- orderDate: the date the order was placed as YYYY-MM-DD if shown, else empty string.\n" +
    "- orderNo: the order number if shown, else empty string.\n" +
    "- amount: the order total as a number if shown, else 0.\n" +
    "- items: one entry per line: { label (the product description exactly as printed), qty (quantity ordered as a number), " +
    "product (map it to the closest name in the known product list below if it clearly is the same item, matching the size such " +
    "as 3G vs QT; if it does not clearly match any known product, leave product an empty string) }.\n" +
    "Read every line; do not skip any.\n\n" +
    "Known products:\n" + (catalog.length ? catalog.map((n) => "- " + n).join("\n") : "(none yet)");
  let read = null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-opus-4-8", max_tokens: 4500, thinking: { type: "adaptive" }, messages: [{ role: "user", content: [block, { type: "text", text: prompt }] }], output_config: { format: { type: "json_schema", schema: ORDERSCAN_SCHEMA } } }),
    });
    if (res.ok) { const data = await res.json(); const tb = (data.content || []).find((b) => b.type === "text"); if (tb) read = JSON.parse(tb.text); }
  } catch { read = null; }
  if (!read || !Array.isArray(read.items)) return json({ ok: false, error: "Couldn't read the order. Try a clearer photo or PDF." }, 502);
  const okDate = (x) => /^\d{4}-\d{2}-\d{2}$/.test((x || "").slice(0, 10));
  const items = read.items.map((it) => { const qty = parseFloat(it.qty); return { label: (it.label || "").toString().slice(0, 160), product: (it.product || "").toString().slice(0, 160), qty: isNaN(qty) ? 1 : qty }; }).filter((it) => it.label || it.product);
  const existing = await sbSelect(env, `inventory_orders?client_id=eq.${who.id}&select=id`);
  const n = (existing || []).length;
  const suggestLabel = n === 0 ? "Order 1" : (n === 1 ? "Order 2" : "Last");
  const amt = parseFloat(read.amount);
  return json({ ok: true, date: okDate(read.date) ? read.date.slice(0, 10) : "", orderedOn: okDate(read.orderDate) ? read.orderDate.slice(0, 10) : "", orderNo: (read.orderNo || "").toString().slice(0, 40), amount: isNaN(amt) ? null : amt, suggestLabel, items, unknownCount: items.filter((i) => !i.product).length });
}

/* ===================== Cold Storage Temperature Log ===================== */
// Phase 2 of the Red Book. Mark assets as cold units (cooler/freezer) with a
// safe range, then log temperature readings per day. Readings live in the
// `temp_logs` table; the cold-unit flag and range live on the asset itself
// (temp_min, temp_max, cold_unit). Degrades gracefully until those exist.
// Default safe ranges (Fahrenheit): cooler 32-41, freezer -10-0.
//
// TIMEZONE (important): `temp_logs.reading_at` is a timestamptz, i.e. an absolute
// instant in time, NOT a wall-clock time. The grid lays each reading out under a
// time-slot column by the reading's LOCAL time in the viewer's browser. Normal
// entry is always correct because the page builds reading_at from the browser's
// own clock (new Date(y,m,d,hh,mm).toISOString()), so it round-trips back to the
// same slot. The trap is BULK IMPORTS done in SQL: a naive literal like
// '2026-05-24 06:00:00' is read as UTC and then shifts by the store's offset on
// display (e.g. 6am Eastern lands in the 2am... so it falls a slot early and the
// last slot looks empty). Always attach the store's timezone when importing, e.g.
// '2026-05-24 06:00:00 America/New_York'::timestamptz, which is also DST-aware.

function tempUnitOut(temp, min, max) {
  if (temp == null || isNaN(temp)) return false;
  if (min != null && temp < min) return true;
  if (max != null && temp > max) return true;
  return false;
}

// Confirm an asset is in the caller's scope, returning its row (or null).
async function tempAssetInScope(env, assetId, clientId) {
  if (!assetId) return null;
  const rows = await sbSelect(env, `assets?id=eq.${assetId}&client_id=eq.${clientId}&select=id,name,nickname,temp_min,temp_max,cold_unit&limit=1`);
  return rows && rows.length ? rows[0] : null;
}

// Cold units for a client, in walk order: the optional temp_sort column is the
// number you pass each unit while walking the store (set in Manage units),
// nulls last, name as the tiebreaker. Falls back pre-migration.
async function coldUnits(env, cid) {
  let rows = await sbSelect(env, `assets?client_id=eq.${cid}&cold_unit=is.true&select=id,name,nickname,temp_min,temp_max,temp_sort&order=temp_sort.asc.nullslast,name.asc`);
  if (rows !== null) return rows;
  return sbSelect(env, `assets?client_id=eq.${cid}&cold_unit=is.true&select=id,name,nickname,temp_min,temp_max&order=name.asc`);
}

async function listTemps(url, env, session) {
  if (!can(session, "foodSafety", "view")) return json({ ok: false, error: "Not allowed." }, 403);
  const who = await redbookClientId(env, session, url.searchParams.get("client") || "");
  const date = (url.searchParams.get("date") || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  if (!who.id) return noStore({ ok: true, client: who.name, date, units: [], readings: [] });
  const units = await coldUnits(env, who.id);
  if (units === null) return noStore({ ok: true, client: who.name, date, units: [], readings: [], missing: true });
  const logs = await sbSelect(env, `temp_logs?client_id=eq.${who.id}&log_date=eq.${date}&select=id,asset_id,temp,logged_by,reading_at&order=reading_at.asc`);
  if (logs === null) return noStore({ ok: true, client: who.name, date, units: [], readings: [], missing: true });
  const u = (units || []).map((a) => ({ id: a.id, name: a.nickname || a.name || "Unit", min: a.temp_min, max: a.temp_max, sort: a.temp_sort != null ? a.temp_sort : null }));
  const r = (logs || []).map((l) => ({ id: l.id, assetId: l.asset_id, temp: l.temp, by: l.logged_by || "", at: l.reading_at || "", demo: (l.logged_by || "") === DEMO_TAG }));
  const anyDemo = r.some((x) => x.demo);
  return noStore({ ok: true, client: who.name, date, units: u, readings: r, demo: anyDemo });
}

// Look back at logged readings over a date range (the History panel). Returns the
// client's cold units plus every reading in [from, to], for the page to lay out.
async function listTempHistory(url, env, session) {
  if (!can(session, "foodSafety", "view")) return json({ ok: false, error: "Not allowed." }, 403);
  const who = await redbookClientId(env, session, url.searchParams.get("client") || "");
  const okDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
  let to = url.searchParams.get("to") || ""; if (!okDate(to)) to = new Date().toISOString().slice(0, 10);
  let from = url.searchParams.get("from") || ""; if (!okDate(from)) { const d = new Date(to + "T00:00:00"); d.setDate(d.getDate() - 6); from = d.toISOString().slice(0, 10); }
  if (from > to) { const t = from; from = to; to = t; }
  // Clamp the window so the query stays bounded.
  const span = (Date.parse(to) - Date.parse(from)) / 86400000;
  if (span > 92) { const d = new Date(to + "T00:00:00"); d.setDate(d.getDate() - 92); from = d.toISOString().slice(0, 10); }
  if (!who.id) return noStore({ ok: true, client: who.name, units: [], readings: [], from, to });
  const units = await coldUnits(env, who.id);
  if (units === null) return noStore({ ok: true, client: who.name, units: [], readings: [], from, to, missing: true });
  const logs = await sbSelect(env, `temp_logs?client_id=eq.${who.id}&log_date=gte.${from}&log_date=lte.${to}&select=asset_id,temp,reading_at,log_date,logged_by&order=reading_at.asc`);
  if (logs === null) return noStore({ ok: true, client: who.name, units: [], readings: [], from, to, missing: true });
  const u = (units || []).map((a) => ({ id: a.id, name: a.nickname || a.name || "Unit", min: a.temp_min, max: a.temp_max, sort: a.temp_sort != null ? a.temp_sort : null }));
  const r = (logs || []).map((l) => ({ assetId: l.asset_id, temp: l.temp, at: l.reading_at || "", date: l.log_date || "", demo: (l.logged_by || "") === DEMO_TAG }));
  return noStore({ ok: true, client: who.name, units: u, readings: r, from, to });
}

async function listTempUnits(url, env, session) {
  if (!can(session, "foodSafety", "view")) return json({ ok: false, error: "Not allowed." }, 403);
  const who = await redbookClientId(env, session, url.searchParams.get("client") || "");
  if (!who.id) return noStore({ ok: true, client: who.name, assets: [] });
  let rows = await sbSelect(env, `assets?client_id=eq.${who.id}&select=id,name,nickname,temp_min,temp_max,cold_unit,temp_sort&order=temp_sort.asc.nullslast,name.asc`);
  if (rows === null) rows = await sbSelect(env, `assets?client_id=eq.${who.id}&select=id,name,nickname,temp_min,temp_max,cold_unit&order=name.asc`);
  if (rows === null) return noStore({ ok: true, client: who.name, assets: [], missing: true });
  // The per-client "Demo" auto-fill flag (best-effort; null if the column isn't there yet).
  let demo = false;
  const cr = await sbSelect(env, `clients?id=eq.${who.id}&select=auto_temps`);
  if (cr && cr[0]) demo = !!cr[0].auto_temps;
  return noStore({ ok: true, client: who.name, demo, assets: (rows || []).map((a) => ({ id: a.id, name: a.nickname || a.name || "Asset", coldUnit: !!a.cold_unit, min: a.temp_min, max: a.temp_max, sort: a.temp_sort != null ? a.temp_sort : null })) });
}

async function setTempUnit(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  if (!sbReady(env)) return json({ ok: false, error: "Not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const who = await redbookClientId(env, session, (body.client || "").toString().trim());
  if (!who.id) return json({ ok: false, error: "Pick a client first." }, 400);
  const assetId = (body.assetId || "").toString().trim();
  const inScope = await tempAssetInScope(env, assetId, who.id);
  if (!inScope) return json({ ok: false, error: "Asset not found." }, 404);
  const num = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };
  const patch = { cold_unit: !!body.coldUnit, temp_min: num(body.tempMin), temp_max: num(body.tempMax) };
  // Walk order (optional column): include when sent, drop it if the column
  // doesn't exist yet so saves keep working pre-migration.
  if ("tempSort" in body) { const s = parseInt(body.tempSort, 10); patch.temp_sort = isNaN(s) ? null : s; }
  let res = await sbUpdate(env, "assets", assetId, patch);
  if (!res.ok && "temp_sort" in patch) { delete patch.temp_sort; res = await sbUpdate(env, "assets", assetId, patch); }
  if (!res.ok) return json({ ok: false, error: ("Could not save. " + (res.error || "")).slice(0, 200) }, 502);
  return json({ ok: true });
}

/* ----- Demo auto-fill (sandbox): generate in-range readings on the NY schedule -----
   Standard rounds at 6 AM, 10 AM, 2 PM, 6 PM Eastern. The manual Generate fills
   every round that has already passed in New York time; a cron fills the current
   round at ~:01 past the hour. Opt-in per client (the "Demo" toggle), so real
   food-safety logs are never auto-written. Readings carry no label. */
const TEMP_SLOTS = [6, 10, 14, 18];
function nyParts(d) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const p = {}; for (const x of f.formatToParts(d)) p[x.type] = x.value;
  let hour = +p.hour; if (hour === 24) hour = 0;
  return { date: `${p.year}-${p.month}-${p.day}`, hour, minute: +p.minute };
}
// A New York wall time (date + hour:minute) -> the true UTC instant.
function nyInstant(dateStr, hour, minute) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d, hour, minute || 0, 0);
  const p = nyParts(new Date(utc));
  const asNy = Date.UTC(+p.date.slice(0, 4), +p.date.slice(5, 7) - 1, +p.date.slice(8, 10), p.hour, p.minute);
  return new Date(utc + (utc - asNy));
}
// Generate readings for every passed round (slot hour <= uptoHour) that isn't
// already logged, in each cold unit's range, to one decimal. Returns how many.
async function generateTempReadings(env, clientId, dateStr, uptoHour) {
  const units = await sbSelect(env, `assets?client_id=eq.${clientId}&cold_unit=is.true&select=id,name,nickname,temp_min,temp_max`);
  if (!units || !units.length) return 0;
  const logs = await sbSelect(env, `temp_logs?client_id=eq.${clientId}&log_date=eq.${dateStr}&select=asset_id,reading_at`);
  const have = {}; (logs || []).forEach((l) => { let hr = ""; if (l.reading_at) hr = nyParts(new Date(l.reading_at)).hour; have[l.asset_id + "|" + hr] = true; });
  const rows = [];
  for (const u of units) {
    const rg = effTempRange(u.nickname || u.name, u.temp_min, u.temp_max);
    if (rg.min == null || rg.max == null) continue;
    for (const h of TEMP_SLOTS) {
      if (h > uptoHour) continue;
      if (have[u.id + "|" + h]) continue;
      const steps = Math.max(0, Math.round((rg.max - rg.min) * 10));
      const temp = Math.round((rg.min + Math.floor(Math.random() * (steps + 1)) / 10) * 10) / 10;
      rows.push({ asset_id: u.id, client_id: clientId, log_date: dateStr, temp, logged_by: "", reading_at: nyInstant(dateStr, h, 0).toISOString() });
    }
  }
  if (!rows.length) return 0;
  await insertChunks(env, "temp_logs", rows);
  return rows.length;
}

async function generateTemps(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  if (!sbReady(env)) return json({ ok: false, error: "Not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const who = await redbookClientId(env, session, (body.client || "").toString().trim());
  if (!who.id) return json({ ok: false, error: "Pick a client first." }, 400);
  const date = (body.date || "").toString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ ok: false, error: "Bad date." }, 400);
  const now = nyParts(new Date());
  const upto = date < now.date ? 24 : (date > now.date ? -1 : now.hour);
  const filled = await generateTempReadings(env, who.id, date, upto);
  return json({ ok: true, filled, nyHour: now.hour, nyDate: now.date });
}

// Toggle the per-client "Demo" auto-fill flag (master only).
async function setTempAuto(request, env, session) {
  if (!session || session.role !== "master") return json({ ok: false, error: "Master only." }, 403);
  if (!sbReady(env)) return json({ ok: false, error: "Not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const who = await redbookClientId(env, session, (body.client || "").toString().trim());
  if (!who.id) return json({ ok: false, error: "Pick a client first." }, 400);
  const res = await sbUpdate(env, "clients", who.id, { auto_temps: !!body.on });
  if (!res.ok) return json({ ok: false, error: "Run once: alter table clients add column if not exists auto_temps boolean default false;" }, 400);
  return json({ ok: true, on: !!body.on });
}

// Cron: at each NY round (6/10/2/6), fill that round for every Demo-enabled client.
async function runScheduledTemps(env) {
  if (!sbReady(env)) return;
  const now = nyParts(new Date());
  if (TEMP_SLOTS.indexOf(now.hour) < 0) return; // only act on a round hour
  const clients = await sbSelect(env, `clients?auto_temps=is.true&select=id`);
  for (const c of (clients || [])) {
    try { await generateTempReadings(env, c.id, now.date, now.hour); } catch (e) { /* keep going */ }
  }
}

async function logTemp(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  if (!sbReady(env)) return json({ ok: false, error: "Not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const who = await redbookClientId(env, session, (body.client || "").toString().trim());
  if (!who.id) return json({ ok: false, error: "Pick a client first." }, 400);
  const assetId = (body.assetId || "").toString().trim();
  const inScope = await tempAssetInScope(env, assetId, who.id);
  if (!inScope) return json({ ok: false, error: "Asset not found." }, 404);
  const temp = parseFloat(body.temp);
  if (isNaN(temp)) return json({ ok: false, error: "Enter a temperature." }, 400);
  const date = (body.date || "").toString().slice(0, 10) || new Date().toISOString().slice(0, 10);
  const a = authorOf(session);
  const res = await sbInsert(env, "temp_logs", { asset_id: assetId, client_id: who.id, log_date: date, temp, logged_by: a.author });
  if (!res.ok) return json({ ok: false, error: ("Could not save. " + (res.error || "")).slice(0, 200) }, 502);
  const r = res.data || {};
  const out = tempUnitOut(temp, inScope.temp_min, inScope.temp_max);
  return json({ ok: true, reading: { id: r.id, assetId, temp, by: a.author, at: r.reading_at || "", out } });
}

// Sample data for client demos. Every demo reading is stamped with this tag in
// logged_by so it's clearly labeled as demo (never mistaken for a real check)
// and can be wiped in one call. Demo mode is master-only.
const DEMO_TAG = "Demo";

async function setTempDemo(request, env, session) {
  if (!session || session.role !== "master") return json({ ok: false, error: "Master only." }, 403);
  if (!sbReady(env)) return json({ ok: false, error: "Not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const who = await redbookClientId(env, session, (body.client || "").toString().trim());
  if (!who.id) return json({ ok: false, error: "Pick a client first." }, 400);
  // Always clear any existing demo rows first (so toggling on never piles up).
  await fetch(`${env.SUPABASE_URL}/rest/v1/temp_logs?client_id=eq.${who.id}&logged_by=eq.${encodeURIComponent(DEMO_TAG)}`, { method: "DELETE", headers: sbHeaders(env) });
  if (!body.on) return json({ ok: true, on: false, count: 0 });
  // Build a believable history: the last 14 days, two rounds a day, one reading
  // per cold unit, each a random value inside that unit's safe range (to 0.1).
  const units = await sbSelect(env, `assets?client_id=eq.${who.id}&cold_unit=is.true&select=id,temp_min,temp_max`);
  if (units === null) return json({ ok: false, error: "The temperature log table isn't set up yet." }, 400);
  const ranged = (units || []).filter((u) => u.temp_min != null && u.temp_max != null && u.temp_max >= u.temp_min);
  if (!ranged.length) return json({ ok: false, error: "No cold units with a safe range set. Add ranges in Manage units first." }, 400);
  const rnd = (min, max) => Math.round((min + Math.random() * (max - min)) * 10) / 10;
  const pad = (n) => String(n).padStart(2, "0");
  const rows = [];
  const now = new Date();
  for (let d = 0; d < 14; d++) {
    const day = new Date(now.getTime() - d * 86400000);
    const ds = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
    // Two rounds: morning ~7am, afternoon ~2pm, with a little jitter.
    const rounds = [{ h: 7, m: 5 + Math.floor(Math.random() * 40) }, { h: 14, m: 5 + Math.floor(Math.random() * 40) }];
    for (const rd of rounds) {
      const at = `${ds}T${pad(rd.h)}:${pad(rd.m)}:00`;
      for (const u of ranged) {
        rows.push({ asset_id: u.id, client_id: who.id, log_date: ds, temp: rnd(u.temp_min, u.temp_max), logged_by: DEMO_TAG, reading_at: at });
      }
    }
  }
  // Insert in chunks so the request body stays small.
  let count = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const res = await sbInsert(env, "temp_logs", rows.slice(i, i + 200));
    if (res.ok) count += Math.min(200, rows.length - i);
  }
  return json({ ok: true, on: true, count });
}

// Save a whole round at once (the table view): many units, one timestamp. Only
// values for the client's own cold units are accepted.
async function logTempRound(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  if (!sbReady(env)) return json({ ok: false, error: "Not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const who = await redbookClientId(env, session, (body.client || "").toString().trim());
  if (!who.id) return json({ ok: false, error: "Pick a client first." }, 400);
  const date = (body.date || "").toString().slice(0, 10) || new Date().toISOString().slice(0, 10);
  const readings = Array.isArray(body.readings) ? body.readings : [];
  if (!readings.length) return json({ ok: false, error: "Enter at least one temperature." }, 400);
  // Verify every asset belongs to this client and is a cold unit (one query).
  const units = await sbSelect(env, `assets?client_id=eq.${who.id}&cold_unit=is.true&select=id`);
  if (units === null) return json({ ok: false, error: "The temperature log table isn't set up yet." }, 400);
  const ok = {}; (units || []).forEach((u) => { ok[u.id] = true; });
  const a = authorOf(session);
  const at = new Date().toISOString();
  const rows = [];
  for (const r of readings) {
    const aid = (r.assetId || "").toString();
    const temp = parseFloat(r.temp);
    if (!ok[aid] || isNaN(temp)) continue;
    rows.push({ asset_id: aid, client_id: who.id, log_date: date, temp, logged_by: a.author, reading_at: at });
  }
  if (!rows.length) return json({ ok: false, error: "Nothing to save." }, 400);
  const res = await sbInsert(env, "temp_logs", rows);
  if (!res.ok) return json({ ok: false, error: ("Could not save. " + (res.error || "")).slice(0, 200) }, 502);
  return json({ ok: true, count: rows.length });
}

// Save a grid of readings: each cell carries its own time (reading_at), so a
// whole day of paper rounds can be transcribed at once. Each cell is an insert
// at its given timestamp; the page only sends cells that weren't already logged.
async function logTempGrid(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  if (!sbReady(env)) return json({ ok: false, error: "Not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const who = await redbookClientId(env, session, (body.client || "").toString().trim());
  if (!who.id) return json({ ok: false, error: "Pick a client first." }, 400);
  const date = (body.date || "").toString().slice(0, 10) || new Date().toISOString().slice(0, 10);
  const cells = Array.isArray(body.cells) ? body.cells : [];
  if (!cells.length) return json({ ok: false, error: "Enter at least one temperature." }, 400);
  const units = await sbSelect(env, `assets?client_id=eq.${who.id}&cold_unit=is.true&select=id`);
  if (units === null) return json({ ok: false, error: "The temperature log table isn't set up yet." }, 400);
  const ok = {}; (units || []).forEach((u) => { ok[u.id] = true; });
  const a = authorOf(session);
  const rows = [];
  for (const c of cells) {
    const aid = (c.assetId || "").toString();
    const temp = parseFloat(c.temp);
    const at = (c.at || "").toString();
    if (!ok[aid] || isNaN(temp)) continue;
    const row = { asset_id: aid, client_id: who.id, log_date: date, temp, logged_by: a.author };
    if (at && !isNaN(Date.parse(at))) row.reading_at = at;
    rows.push(row);
  }
  if (!rows.length) return json({ ok: false, error: "Nothing to save." }, 400);
  const res = await sbInsert(env, "temp_logs", rows);
  if (!res.ok) return json({ ok: false, error: ("Could not save. " + (res.error || "")).slice(0, 200) }, 502);
  return json({ ok: true, count: rows.length });
}

// Read a photo of a paper temperature sheet with Claude and return the readings
// for review (we never save straight from a photo). The page fills the grid with
// what comes back so a person can check it and hit Save. We pass the client's own
// unit names so the model maps each column to the right cooler, and match the
// labels back to asset ids here.
function normLabel(s) { return (s || "").toString().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function matchByName(label, rows) {
  const n = normLabel(label);
  if (!n) return null;
  let best = null, bestScore = 0;
  for (const u of rows) {
    for (const cand of [u.nickname, u.name]) {
      const c = normLabel(cand);
      if (!c) continue;
      let score = 0;
      if (c === n) score = 100;
      else if (c.includes(n) || n.includes(c)) score = 70 + Math.min(20, Math.min(c.length, n.length));
      else {
        const cw = new Set(c.split(" ")), nw = n.split(" ");
        const hit = nw.filter((w) => w.length > 2 && cw.has(w)).length;
        if (hit) score = 40 + hit * 8;
      }
      if (score > bestScore) { bestScore = score; best = u; }
    }
  }
  return bestScore >= 48 ? best : null;
}

// One Claude vision call that returns structured JSON for a scanned sheet, or
// null. Shared by every "scan a paper sheet" endpoint (temps, hot holding,
// receiving). Reads handwritten or computer-printed numbers alike.
async function claudeReadSheet(base64, ct, prompt, schema, env) {
  try {
    const content = [
      { type: "image", source: { type: "base64", media_type: ct, data: base64 } },
      { type: "text", text: prompt },
    ];
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-opus-4-8",
        max_tokens: 4000,
        thinking: { type: "adaptive" },
        messages: [{ role: "user", content }],
        output_config: { format: { type: "json_schema", schema } },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const block = (data.content || []).find((b) => b.type === "text");
    if (!block) return null;
    return JSON.parse(block.text);
  } catch { return null; }
}

const TEMPSCAN_SCHEMA = {
  type: "object",
  properties: {
    readings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          unit: { type: "string" },
          date: { type: "string" },
          time: { type: "string" },
          temp: { type: "number" },
        },
        required: ["unit", "date", "time", "temp"],
        additionalProperties: false,
      },
    },
  },
  required: ["readings"],
  additionalProperties: false,
};

// Insert rows in chunks so the request body stays small; returns how many saved.
async function insertChunks(env, table, rows) {
  let saved = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const res = await sbInsert(env, table, rows.slice(i, i + 200));
    if (res.ok) saved += Math.min(200, rows.length - i);
  }
  return saved;
}

// Re-scanning a sheet replaces, not stacks: before inserting, clear the existing
// rows for exactly the cells this scan covers (the matched column on that date),
// so values are overwritten while anything the scan didn't read is left alone.
// byDate maps a log_date to the set of column values (asset id, item, vendor).
async function clearScannedCells(env, table, colField, byDate, cid) {
  for (const date of Object.keys(byDate)) {
    const vals = Array.from(byDate[date]);
    if (!vals.length) continue;
    const list = "in.(" + vals.map((v) => '"' + String(v).replace(/["\\]/g, "") + '"').join(",") + ")";
    await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?client_id=eq.${cid}&log_date=eq.${date}&${colField}=${encodeURIComponent(list)}`,
      { method: "DELETE", headers: sbHeaders(env) });
  }
}

async function scanTempLog(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  if (!sbReady(env)) return json({ ok: false, error: "Not connected." }, 503);
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: "The AI is not connected. Add the ANTHROPIC_API_KEY in Cloudflare." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const who = await redbookClientId(env, session, (body.client || "").toString().trim());
  if (!who.id) return json({ ok: false, error: "Pick a client first." }, 400);
  const base64 = (body.imageBase64 || "").toString();
  const ct = (body.contentType || "image/jpeg").toString();
  if (!base64) return json({ ok: false, error: "No photo." }, 400);
  const today = new Date().toISOString().slice(0, 10);
  const hint = (body.date || "").toString().slice(0, 10) || today;
  // DATE/TIME RULE (do not forget, per Tamer): a scanned reading's time must be
  // stored the SAME way manual entry stores it, or it lands a few hours off and
  // shows in the wrong slot (see the TIMEZONE note on temp_logs above). The page
  // sends its getTimezoneOffset(); we turn the local wall time into a true UTC
  // instant below so 6 AM written on paper comes back as 6 AM in the grid.
  const tzOffset = Number.isFinite(+body.tzOffset) ? +body.tzOffset : 0;
  const units = await sbSelect(env, `assets?client_id=eq.${who.id}&cold_unit=is.true&select=id,name,nickname,temp_min,temp_max`);
  if (units === null) return json({ ok: false, error: "The temperature log table isn't set up yet." }, 400);
  if (!units.length) return json({ ok: false, error: "No cold units set up yet. Add them in Manage units first." }, 400);

  const names = units.map((u) => {
    const rg = effTempRange(u.nickname || u.name, u.temp_min, u.temp_max);
    const r = (rg.min != null && rg.max != null) ? " [normal range " + rg.min + " to " + rg.max + " F]" : "";
    return "- " + (u.nickname ? u.nickname + " (" + u.name + ")" : u.name) + r;
  }).join("\n");
  const prompt =
    "This is a photo of a paper Cold Storage Temperature Log for a food business. The columns are coolers and freezers " +
    "(units); each row is a reading at a date and time. Read every temperature you can see clearly, whether handwritten or " +
    "computer printed, and return one entry per filled cell. Read every date on the sheet, not just one day.\n\n" +
    "For each reading return:\n" +
    "- unit: the column header text for that cell, copied as printed.\n" +
    "- date: the row's date as YYYY-MM-DD. The sheet may show it as M/D; this log is from around " + hint + ", and today is " + today + ", so use that for the year.\n" +
    "- time: the row's time in 24h HH:MM if shown, otherwise an empty string.\n" +
    "- temp: the number as a number (may be negative for freezers; keep one decimal if written).\n\n" +
    "The rows are in calendar order, normally one day after another. If a row's date is blank or unreadable, work it out from " +
    "the rows around it by counting days in sequence (the row above is the day before, the row below the day after; the latest " +
    "filled row is usually today, " + today + ", the one above it yesterday). Always give your best date; do not drop a reading " +
    "just because its date cell is hard to read.\n\n" +
    "Each unit's normal operating range is shown in [brackets]. Use it to resolve the sign and any unclear digits. Freezers run " +
    "below zero, and people often leave the minus sign off, so a freezer value written as 10 means -10. When the sign or a digit " +
    "is ambiguous, read it as the value that falls within that unit's range. These daily sheets are routine in-range checks; a " +
    "genuine out-of-range event is recorded separately, so when the writing is unclear prefer the in-range reading. Do not change " +
    "a value that is clearly written, and never invent a value for a blank cell.\n\n" +
    "Only include cells with a legible number. Skip blank or illegible cells.\n\n" +
    "This client's known units (match the column to the closest one, but still return the header text you see):\n" + names;

  const read = await claudeReadSheet(base64, ct, prompt, TEMPSCAN_SCHEMA, env);
  if (!read || !Array.isArray(read.readings)) return json({ ok: false, error: "Couldn't read the sheet. Try a sharper, straight-on photo." }, 502);

  const okDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
  const a = authorOf(session);
  const rows = [];
  const unmatched = {};
  const dates = {};
  const byDate = {};
  const times = {}; // diagnostic: wall-clock times read per date
  for (const r of read.readings) {
    const temp = parseFloat(r.temp);
    if (isNaN(temp)) continue;
    const u = matchByName(r.unit, units);
    if (!u) { unmatched[normLabel(r.unit)] = r.unit || "(blank)"; continue; }
    const d = (r.date || "").toString().slice(0, 10);
    const date = okDate(d) ? d : hint;
    const time = /^\d{1,2}:\d{2}$/.test((r.time || "").trim()) ? r.time.trim() : "";
    const row = { asset_id: u.id, client_id: who.id, log_date: date, temp, logged_by: a.author };
    if (time) {
      const t = time.split(":");
      // Local wall time -> UTC instant, the same round-trip the grid does on entry.
      const utcMs = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), +t[0], +t[1]) + tzOffset * 60000;
      row.reading_at = new Date(utcMs).toISOString();
    }
    rows.push(row);
    dates[date] = true;
    (byDate[date] = byDate[date] || new Set()).add(u.id);
    (times[date] = times[date] || new Set()).add(time || "(no time)");
  }
  if (!rows.length) return json({ ok: false, error: "Couldn't match any readings to your units." + (Object.keys(unmatched).length ? " Columns seen: " + Object.values(unmatched).join(", ") : ""), unmatched: Object.values(unmatched), rawCount: read.readings.length }, 200);
  await clearScannedCells(env, "temp_logs", "asset_id", byDate, who.id);
  const saved = await insertChunks(env, "temp_logs", rows);
  const timesOut = {}; Object.keys(times).forEach((k) => { timesOut[k] = Array.from(times[k]).sort(); });
  return json({ ok: true, saved, dates: Object.keys(dates).sort(), unmatched: Object.values(unmatched), times: timesOut, rawCount: read.readings.length });
}

// A reading on a weekly sheet: a column label, the row's date, and the number.
const WEEKSCAN_SCHEMA = {
  type: "object",
  properties: {
    readings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          column: { type: "string" },
          date: { type: "string" },
          temp: { type: "number" },
        },
        required: ["column", "date", "temp"],
        additionalProperties: false,
      },
    },
  },
  required: ["readings"],
  additionalProperties: false,
};

// Shared reader for the two weekly grids (hot holding, receiving). Columns are
// the client's own template lines; rows are dates. Reads every date on the sheet
// and saves the readings straight to the log, so a scan needs no follow-up Save
// and isn't limited to the week on screen.
async function scanWeekSheet(request, env, session, opts) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  if (!sbReady(env)) return json({ ok: false, error: "Not connected." }, 503);
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: "The AI is not connected. Add the ANTHROPIC_API_KEY in Cloudflare." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const who = await redbookClientId(env, session, (body.client || "").toString().trim());
  if (!who.id) return json({ ok: false, error: "Pick a client first." }, 400);
  const base64 = (body.imageBase64 || "").toString();
  const ct = (body.contentType || "image/jpeg").toString();
  if (!base64) return json({ ok: false, error: "No photo." }, 400);
  const okDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
  const hint = okDate(body.from) ? body.from : new Date().toISOString().slice(0, 10);
  const cols = await opts.loadColumns(who.id);
  if (cols === null) return json({ ok: false, error: opts.missingError }, 400);
  if (!cols.length) return json({ ok: false, error: opts.emptyError }, 400);

  const today = new Date().toISOString().slice(0, 10);
  const names = cols.map(opts.colLabel || ((c) => "- " + c.name)).join("\n");
  const prompt = opts.prompt(names, hint, today);
  const read = await claudeReadSheet(base64, ct, prompt, WEEKSCAN_SCHEMA, env);
  if (!read || !Array.isArray(read.readings)) return json({ ok: false, error: "Couldn't read the sheet. Try a sharper, straight-on photo." }, 502);

  const a = authorOf(session);
  const rows = [];
  const unmatched = {};
  const dates = {};
  const byDate = {};
  for (const r of read.readings) {
    const temp = parseFloat(r.temp);
    if (isNaN(temp)) continue;
    const col = matchByName(r.column, cols);
    if (!col) { unmatched[normLabel(r.column)] = r.column || "(blank)"; continue; }
    const date = (r.date || "").toString().slice(0, 10);
    if (!okDate(date)) continue;
    rows.push(opts.row(col, date, temp, who.id, a.author));
    dates[date] = true;
    (byDate[date] = byDate[date] || new Set()).add(col.name);
  }
  if (!rows.length) return json({ ok: false, error: "Couldn't match any readings to your columns." + (Object.keys(unmatched).length ? " Columns seen: " + Object.values(unmatched).join(", ") : ""), unmatched: Object.values(unmatched) }, 200);
  await clearScannedCells(env, opts.table, opts.colField, byDate, who.id);
  let saved = await insertChunks(env, opts.table, rows);
  // Pre-migration fallback (e.g. receiving_logs without the storage column).
  if (saved === 0 && opts.retryWithout) {
    const stripped = rows.map((r) => { const c = { ...r }; opts.retryWithout.forEach((k) => delete c[k]); return c; });
    saved = await insertChunks(env, opts.table, stripped);
  }
  return json({ ok: true, saved, dates: Object.keys(dates).sort(), unmatched: Object.values(unmatched) });
}

async function scanHotHolding(request, env, session) {
  return scanWeekSheet(request, env, session, {
    table: "hotholding_logs",
    colField: "item",
    loadColumns: (cid) => sbSelect(env, `hotholding_items?client_id=eq.${cid}&select=id,name,kind,min_temp`),
    colLabel: (c) => "- " + c.name + (c.min_temp != null ? " [hot food, at or above " + c.min_temp + " F]" : " [hot food]"),
    missingError: "The hot holding table isn't set up yet.",
    emptyError: "No items set up yet. Add them in Edit items first.",
    prompt: (names, hint, today) =>
      "This is a photo of a Hot Holding / Cooking Temperature sheet for a food business. The columns are food items; " +
      "each row is a date. Read every temperature you can see clearly, handwritten or computer printed, and return one entry " +
      "per filled cell. Read every date on the sheet, not just one.\n\n" +
      "For each reading return:\n" +
      "- column: the item's column header text, copied as printed.\n" +
      "- date: the row's date as YYYY-MM-DD. The sheet may show it as M/D; this log is from around " + hint + ", and today is " + today + ", so use that for the year.\n" +
      "- temp: the number as a number (keep one decimal if written).\n\n" +
      "The rows are in calendar order, normally one day after another. If a row's date is blank or unreadable, work it out from " +
      "the rows around it by counting days in sequence (the row above is the day before, the row below the day after; the latest " +
      "filled row is usually today, " + today + ", the one above it yesterday). Always give your best date; do not drop a reading " +
      "just because its date cell is hard to read.\n\n" +
      "Each item's minimum is shown in [brackets]. These are hot foods, so the temperatures are well above freezing (typically in " +
      "the 130s to 190s F). Use the minimum to settle any unclear digit, reading toward the in-range value. These are routine " +
      "in-range checks; a real out-of-range event is recorded separately, so when the writing is unclear prefer the in-range " +
      "reading. Do not change a clearly written value, and never invent one.\n\n" +
      "Only include cells with a legible number. Skip blank or illegible cells.\n\n" +
      "This client's known items (match each column to the closest one):\n" + names,
    row: (col, date, temp, cid, author) => ({ client_id: cid, log_date: date, kind: col.kind === "cooking" ? "cooking" : "holding", item: col.name, temp, logged_by: author }),
  });
}

async function scanReceiving(request, env, session) {
  return scanWeekSheet(request, env, session, {
    table: "receiving_logs",
    retryWithout: ["storage"],
    colField: "vendor",
    loadColumns: (cid) => sbSelect(env, `receiving_vendors?client_id=eq.${cid}&select=id,name,storage`),
    colLabel: (c) => "- " + c.name + (c.storage === "frozen" ? " [Walk-in Freezer, runs below 0 F]" : " [Walk-in Refrigerator, about 33 to 41 F]"),
    missingError: "The receiving table isn't set up yet.",
    emptyError: "No vendor lines set up yet. Add them in Edit vendors first.",
    prompt: (names, hint, today) =>
      "This is a photo of a Receiving Log for a food business: deliveries checked in by vendor. The columns are vendor " +
      "delivery lines; each row is a date; the cells are the temperature of that delivery. Read every temperature you can see " +
      "clearly, handwritten or computer printed, and return one entry per filled cell. Read every date on the sheet, not just one.\n\n" +
      "For each reading return:\n" +
      "- column: the vendor line's column header text, copied as printed.\n" +
      "- date: the row's date as YYYY-MM-DD. The sheet may show it as M/D; this log is from around " + hint + ", and today is " + today + ", so use that for the year.\n" +
      "- temp: the number as a number (keep one decimal if written).\n\n" +
      "The rows are in calendar order, normally one day after another. If a row's date is blank or unreadable, work it out from " +
      "the rows around it by counting days in sequence (the row above is the day before, the row below the day after; the latest " +
      "filled row is usually today, " + today + ", the one above it yesterday). Always give your best date; do not drop a reading " +
      "just because its date cell is hard to read.\n\n" +
      "Each vendor line's storage type is shown in [brackets]. Frozen lines run below zero and people often leave the minus sign " +
      "off, so a frozen value written as 8 means -8. When the sign or a digit is ambiguous, read it as the value that fits that " +
      "line's storage type. These are routine in-range checks; a real out-of-range delivery is recorded separately, so when the " +
      "writing is unclear prefer the in-range reading. Do not change a clearly written value, and never invent one.\n\n" +
      "Only include cells with a legible number. Skip blank or illegible cells.\n\n" +
      "This client's known vendor lines (match each column to the closest one):\n" + names,
    row: (col, date, temp, cid, author) => ({ client_id: cid, log_date: date, vendor: col.name, storage: col.storage === "frozen" ? "frozen" : "refrigerated", temp, status: "Accepted", logged_by: author }),
  });
}

async function deleteTempLog(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const id = (body.id || "").toString().trim();
  if (!id) return json({ ok: false, error: "No id." }, 400);
  // A client login may only delete its own client's readings.
  const forced = scopeName(session);
  if (forced != null) {
    const rows = await sbSelect(env, `temp_logs?id=eq.${id}&select=client:clients(name)`);
    const cn = rows && rows[0] && rows[0].client && rows[0].client.name;
    if (cn !== forced) return json({ ok: false, error: "Not found." }, 404);
  }
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/temp_logs?id=eq.${id}`, { method: "DELETE", headers: sbHeaders(env) });
  if (!r.ok) return json({ ok: false, error: "Could not delete." }, 502);
  return json({ ok: true });
}

// Override an already-logged reading (admin fixing a value entered in error).
async function updateTempLog(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const id = (body.id || "").toString().trim();
  const temp = parseFloat(body.temp);
  if (!id) return json({ ok: false, error: "No id." }, 400);
  if (isNaN(temp)) return json({ ok: false, error: "Enter a temperature." }, 400);
  const forced = scopeName(session);
  if (forced != null) {
    const rows = await sbSelect(env, `temp_logs?id=eq.${id}&select=client:clients(name)`);
    const cn = rows && rows[0] && rows[0].client && rows[0].client.name;
    if (cn !== forced) return json({ ok: false, error: "Not found." }, 404);
  }
  const res = await sbUpdate(env, "temp_logs", id, { temp });
  if (!res.ok) return json({ ok: false, error: "Could not update." }, 502);
  return json({ ok: true });
}

/* ===================== Daily Pre-Shift Checklist ===================== */
// A simple per-client checklist. The template (the list of sections) lives in
// checklist_sections and is editable; each section is either "single" (one box)
// or "shift" (Open / Mid / Close boxes). The day's checked boxes and the Open/
// Mid/Close assignments are stored as one JSON blob per date in checklist_days.
// Degrades gracefully until those tables exist.
const CHECKLIST_DEFAULTS = [
  ["Exterior", "shift", ["Exterior Building (signage/lighting/awnings/operational/good repair)", "POP Materials (current/posted properly)"]],
  ["Dining Room", "shift", ["Trash Receptacles (clean/empty as needed/empty at close)", "Napkin/Straws/Lids/Condiment Holders (clean/stocked)", "Drink Cooler (clean/stocked/FIFO)", "Ceiling/Lights/Vents/Walls/Floors/Floor Mats (clean/good repair)", "Windows/Doors/Sills (clean/good repair)", "Music (working/proper station/proper volume)", "TVs (proper channels/no sound - close captioned only)"]],
  ["Upright Dessert Freezer & Dessert Display Case", "shift", ["Glass (clean/streak free)", "Interior (clean/free of debris)", "Properly Merchandised (fully stocked)", "Shelves (tilted/shelf strips)", "Lights & Vents (working/clean)", "Holding Temperature", "P.O.P. (current to plan/in good condition)", "All Required Designs (available)", "All Expired Product (recorded/discarded)"]],
  ["Restroom", "shift", ["Restroom Fixtures (clean/operating/good repair)", "Ceilings/Lights/Vents/Walls/Floors (clean/good repair)", "Trash Receptacles (covered in Ladies' room/clean/empty as needed)", "Antibacterial Soap/Towels/Toilet Paper (stocked)"]],
  ["Queuing/Counter Area", "shift", ["Rails/Stanchions (clean/good repair)", "POS Area (clean/organized/clutter free/receipt paper stocked) check", "pink receipt paper levels in the On-the-Go printer", "All Counters/Cases/Millwork (clean/good repair)", "Retail Displays (stocked/priced/faced using standards, guidelines)", "All POP (current/good repair)", "Dress Code Policy followed"]],
  ["Service Area", "shift", ["Work Stations Stocked (food/paper/condiments)", "Counters/Work Areas (clean/good repair)", "Reach-in Coolers (clean/stocked/good repair)", "Ceiling/Lights/Vents/Walls/Floors (clean/good repair)", "Equipment/Stainless (clean)", "Donut Case (organized/stocked/back case stds met during operating hrs)", "Sanitizer Buckets/Cloths (proper concentration)"]],
  ["Service Area (Cont.)", "shift", ["All Hand Wash Sinks (clean/stocked)", "Trash Receptacles (clean/empty as needed/empty at close)", "Ice Caddy (clean/stocked/emptied at close)", "Espresso Machine & Area (clean/stocked)", "Fill ice to Island Oasis hopper and calibrate ice using Daily Island", "Oasis Ice Calibration worksheet", "Dipping Cabinets (proper temp./exterior clean/streak free)", "Dipping Cabinet Flavor Strips are accurately in place per tub", "Ice Cream Tubs (scrape/level/partial/rims clean)", "Dipper Wells (clean/water running)", "Pink Taster Spoons (stocked)", "Cone Displays & Holders (clean/stocked)", "Sundae Station (clean/toppings stocked and date coded/organized)", "Milk & Bananas (product level/expiration date/quality)", "Undercounter Refrigerators (proper temp./clean/stocked/FIFO)", "Food/Food Storage (properly labeled/date coded/stored/temp./logged)", "Beverage Equipment (clean/working order)"]],
  ["Sandwich Station", "shift", ["Functioning Approved Calibrated Thermometer (clean/sanitized)", "Station Stocked (food/paper/condiments)", "Utensils/Cutting Boards (clean/sanitized)", "Food Products (properly stored/labeled/dated/rotated)", "Ceiling/Lights/Vents/Walls/Floors (clean/good repair)", "Trash Receptacles (clean/empty as needed/empty at close)", "Chemicals/Cleaning Supplies (stored away from food)", "Sanitizer Buckets/Cloths (proper concentration)", "Single-use Gloves (available/in use)"]],
  ["Kitchen/Back Room", "shift", ["Prep/Finishing Table (clean)", "Ovens/Hoods (clean)", "Ceiling/Lights/Vents/Walls/Floors (clean/good repair)", "Sinks (clean/good repair)", "Trash Receptacles (clean/empty as needed/empty at close)", "Racks/Baskets/Trays/Boards (clean/organized)", "Dishes/Utensils (washed/sanitized/inverted)", "Cleaning Supplies (stored properly)", "Mops/Brooms (clean/hung)", "Donut Hoppers (clean/stocked/rotated)", "Frosting Buckets (scraped/dated)", "Racks/Buckets/Trays (clean)", "Walk-in (clean/organized/FIFO)"]],
];
// Tidy an items array from a request: trim, drop blanks, cap counts/length.
function cleanChecklistItems(arr) {
  if (!Array.isArray(arr)) return null;
  return arr.map((s) => (s == null ? "" : s.toString().trim()).slice(0, 200)).filter(Boolean).slice(0, 60);
}

async function listChecklist(url, env, session) {
  if (!can(session, "foodSafety", "view")) return json({ ok: false, error: "Not allowed." }, 403);
  const who = await redbookClientId(env, session, url.searchParams.get("client") || "");
  const date = (url.searchParams.get("date") || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  if (!who.id) return noStore({ ok: true, client: who.name, date, sections: [], marks: {}, assign: { open: "", mid: "", close: "" }, itemsOn: true });
  // Try selecting the optional items column; fall back if it doesn't exist yet.
  let itemsOn = true;
  const selWith = `checklist_sections?client_id=eq.${who.id}&select=id,name,mode,sort,items&order=sort.asc,created_at.asc`;
  const selBase = `checklist_sections?client_id=eq.${who.id}&select=id,name,mode,sort&order=sort.asc,created_at.asc`;
  let secs = await sbSelect(env, selWith);
  if (secs === null) { itemsOn = false; secs = await sbSelect(env, selBase); }
  if (secs === null) return noStore({ ok: true, client: who.name, date, sections: [], marks: {}, assign: { open: "", mid: "", close: "" }, missing: true, itemsOn: false });
  // First time for this client: seed the default sections so there's something to edit.
  if (secs.length === 0 && can(session, "foodSafety", "edit")) {
    const rows = CHECKLIST_DEFAULTS.map((d, i) => { const row = { client_id: who.id, name: d[0], mode: d[1], sort: i * 10 }; if (itemsOn) row.items = d[2] || []; return row; });
    await sbInsert(env, "checklist_sections", rows);
    secs = await sbSelect(env, itemsOn ? selWith : selBase) || [];
  }
  const days = await sbSelect(env, `checklist_days?client_id=eq.${who.id}&log_date=eq.${date}&select=data&limit=1`);
  const data = (days && days[0] && days[0].data) || {};
  const assign = Object.assign({ open: "", mid: "", close: "" }, data.assign || {});
  return noStore({ ok: true, client: who.name, date, itemsOn, sections: (secs || []).map((s) => ({ id: s.id, name: s.name || "", mode: s.mode === "shift" ? "shift" : "single", sort: s.sort || 0, items: Array.isArray(s.items) ? s.items : [] })), marks: data.marks || {}, assign });
}

async function saveChecklistSection(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  if (!sbReady(env)) return json({ ok: false, error: "Not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const who = await redbookClientId(env, session, (body.client || "").toString().trim());
  if (!who.id) return json({ ok: false, error: "Pick a client first." }, 400);
  const id = (body.id || "").toString().trim();
  if (body.delete && id) {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/checklist_sections?id=eq.${id}&client_id=eq.${who.id}`, { method: "DELETE", headers: sbHeaders(env) });
    if (!r.ok) return json({ ok: false, error: "Could not delete." }, 502);
    return json({ ok: true });
  }
  const name = (body.name || "").toString().trim().slice(0, 120);
  const mode = body.mode === "shift" ? "shift" : "single";
  if (!name) return json({ ok: false, error: "Enter a name." }, 400);
  const items = "items" in body ? cleanChecklistItems(body.items) : null;
  if (id) {
    const patch = { name, mode };
    if (body.sort != null && !isNaN(parseInt(body.sort, 10))) patch.sort = parseInt(body.sort, 10);
    if (items != null) patch.items = items;
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/checklist_sections?id=eq.${id}&client_id=eq.${who.id}`, { method: "PATCH", headers: sbHeaders(env, { Prefer: "return=representation" }), body: JSON.stringify(patch) });
    if (!r.ok) return json({ ok: false, error: "Could not save." }, 502);
    const d = await r.json();
    return json({ ok: true, section: Array.isArray(d) ? d[0] : d });
  }
  const sort = body.sort != null && !isNaN(parseInt(body.sort, 10)) ? parseInt(body.sort, 10) : 9990;
  const insert = { client_id: who.id, name, mode, sort };
  if (items != null) insert.items = items;
  const res = await sbInsert(env, "checklist_sections", insert);
  if (!res.ok) return json({ ok: false, error: "Could not add." }, 502);
  return json({ ok: true, section: res.data || null });
}

// Fill the suggested item list into any section that currently has none, matching
// by section name. Never overwrites sections that already have items.
async function populateChecklist(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  if (!sbReady(env)) return json({ ok: false, error: "Not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const who = await redbookClientId(env, session, (body.client || "").toString().trim());
  if (!who.id) return json({ ok: false, error: "Pick a client first." }, 400);
  const secs = await sbSelect(env, `checklist_sections?client_id=eq.${who.id}&select=id,name,items`);
  if (secs === null) return json({ ok: false, error: "Add the items column first (run the SQL), then try again." }, 400);
  const defMap = {};
  CHECKLIST_DEFAULTS.forEach((d) => { defMap[d[0].toLowerCase()] = d[2]; });
  let count = 0;
  for (const s of (secs || [])) {
    const cur = Array.isArray(s.items) ? s.items : [];
    if (cur.length) continue;
    const def = defMap[(s.name || "").toLowerCase()];
    if (def && def.length) {
      const r = await fetch(`${env.SUPABASE_URL}/rest/v1/checklist_sections?id=eq.${s.id}&client_id=eq.${who.id}`, { method: "PATCH", headers: sbHeaders(env), body: JSON.stringify({ items: def }) });
      if (r.ok) count++;
    }
  }
  return json({ ok: true, count });
}

// Replace a client's whole section list with the standard default sheet. Admin
// action; clears the existing sections first (the day marks reference old ids,
// so they simply won't line up afterward, which is fine for a fresh template).
async function resetChecklist(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  if (!sbReady(env)) return json({ ok: false, error: "Not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const who = await redbookClientId(env, session, (body.client || "").toString().trim());
  if (!who.id) return json({ ok: false, error: "Pick a client first." }, 400);
  // Does the items column exist?
  let itemsOn = (await sbSelect(env, `checklist_sections?client_id=eq.${who.id}&select=id,items&limit=1`)) !== null;
  if (!itemsOn && (await sbSelect(env, `checklist_sections?client_id=eq.${who.id}&select=id&limit=1`)) === null) {
    return json({ ok: false, error: "The checklist tables aren't set up yet." }, 400);
  }
  const del = await fetch(`${env.SUPABASE_URL}/rest/v1/checklist_sections?client_id=eq.${who.id}`, { method: "DELETE", headers: sbHeaders(env) });
  if (!del.ok) return json({ ok: false, error: "Could not clear the old sections." }, 502);
  const rows = CHECKLIST_DEFAULTS.map((d, i) => { const row = { client_id: who.id, name: d[0], mode: d[1], sort: i * 10 }; if (itemsOn) row.items = d[2] || []; return row; });
  const res = await sbInsert(env, "checklist_sections", rows);
  if (!res.ok) return json({ ok: false, error: "Could not load the sheet." }, 502);
  return json({ ok: true, count: rows.length });
}

async function saveChecklistDay(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  if (!sbReady(env)) return json({ ok: false, error: "Not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const who = await redbookClientId(env, session, (body.client || "").toString().trim());
  if (!who.id) return json({ ok: false, error: "Pick a client first." }, 400);
  const date = (body.date || "").toString().slice(0, 10) || new Date().toISOString().slice(0, 10);
  const marks = (body.marks && typeof body.marks === "object") ? body.marks : {};
  const assignIn = (body.assign && typeof body.assign === "object") ? body.assign : {};
  const assign = { open: (assignIn.open || "").toString().slice(0, 80), mid: (assignIn.mid || "").toString().slice(0, 80), close: (assignIn.close || "").toString().slice(0, 80) };
  const data = { marks, assign };
  const a = authorOf(session);
  const existing = await sbSelect(env, `checklist_days?client_id=eq.${who.id}&log_date=eq.${date}&select=id&limit=1`);
  if (existing === null) return json({ ok: false, error: "The checklist table isn't set up yet." }, 400);
  if (existing[0]) {
    const res = await sbUpdate(env, "checklist_days", existing[0].id, { data, updated_by: a.author });
    if (!res.ok) return json({ ok: false, error: "Could not save." }, 502);
  } else {
    const res = await sbInsert(env, "checklist_days", { client_id: who.id, log_date: date, data, updated_by: a.author });
    if (!res.ok) return json({ ok: false, error: "Could not save." }, 502);
  }
  return json({ ok: true });
}

/* ===================== Food Safety Self-Assessment ===================== */
// A Yes/No questionnaire (EcoSure-style), grouped into sections, with an optional
// finding per question. The question template lives in `assessment_questions`
// (editable, admin-only) and the day's answers live as one JSON blob per date in
// `assessment_days`. Degrades gracefully until those tables exist.
// [section, [[code, question], ...]]
const ASSESSMENT_DEFAULTS = [
  ["Imminent Health Risk", [
    ["D-IHR.1", "Running hot and cold water is available"],
    ["D-IHR.2", "Manager and team members are free of illnesses and symptoms"],
    ["D-IHR.3", "Free of adulterated/contaminated products"],
    ["D-IHR.4", "Free of Flood/Sewer Backup"],
    ["D-IHR.5", "Free of pest infestation leading to food/contact surface contamination"],
    ["D-IHR.6", "Restaurant has sanitizer"],
    ["D-IHR.7", "Hand washing sinks are provided"],
  ]],
  ["Cleaning and Sanitation", [
    ["D-CS.1", "Hot water reaches a minimum of 85°F at all hand sinks, 110°F at Ware washing sink, and 160°F surface temperature in all high temp dish washing machines"],
    ["D-CS.2", "Sanitizer is at proper concentration at all sinks, buckets, cups and low temp ware washing machines"],
    ["D-CS.3", "Chemicals are all approved, properly labeled, and stored correctly"],
    ["D-CS.4", "Premises of exterior & interior (back of house) Non-food contact surfaces are clean and maintained"],
    ["D-CS.5", "All sinks and dish washing machines are set up correctly and used properly"],
    ["D-CS.6", "In-use equipment and prep tables are clean and sanitized at proper frequency and maintained"],
    ["D-CS.7", "In-use utensils and smallwares are clean and sanitized at proper frequency and maintained"],
  ]],
  ["Employee Health and Hygiene", [
    ["D-EH.1", "Person in charge understands Brand Standards for reportable illnesses & symptoms and team members know what to report"],
    ["D-EH.2", "Hand washing sinks are fully stocked and team members are washing hands properly"],
    ["D-EH.4", "Team members are using gloves properly and avoiding bare hand contact"],
  ]],
  ["Time and Temperature", [
    ["D-TT.1", "Refrigerated food held at 41°F or below"],
    ["D-TT.2", "Time/Temperature Control for Safety (TCS) food is handled properly"],
    ["D-TT.3", "Food is cooked to the correct temperature"],
    ["D-TT.4", "Time/Temperature Control for Safety (TCS) food in hot holding is maintained ≥ 135°F"],
    ["D-TT.5", "Thermometers are properly calibrated and in-use"],
  ]],
  ["Good Retail Practices", [
    ["D-GRP.1", "Food is stored off the floor and properly organized"],
    ["D-GRP.2", "Food is properly labeled and date-coded"],
    ["D-GRP.3", "FIFO rotation is followed"],
    ["D-GRP.4", "Food is thawed using an approved method"],
    ["D-GRP.5", "Single-use items are stored and dispensed properly"],
  ]],
  ["Pest Management", [
    ["D-PM.1", "No signs of live pests or pest activity"],
    ["D-PM.2", "Pest control service is current and documented"],
    ["D-PM.3", "Entry points, doors, and screens are sealed and in good repair"],
    ["D-PM.4", "No harborage or food/water sources for pests"],
  ]],
  ["Documentation", [
    ["D-DOC.1", "Required food safety certificates are current and posted"],
    ["D-DOC.2", "Temperature logs are complete and up to date"],
    ["D-DOC.3", "Cleaning and sanitation schedules are maintained"],
    ["D-DOC.4", "Pest control and service records are on file"],
  ]],
];

function seedAssessmentRows(cid) {
  const rows = []; let sort = 0;
  for (const [sec, qs] of ASSESSMENT_DEFAULTS) {
    for (const [code, q] of qs) { rows.push({ client_id: cid, section: sec, code, question: q, sort }); sort += 10; }
  }
  return rows;
}

async function listAssessment(url, env, session) {
  if (!can(session, "foodSafety", "view")) return json({ ok: false, error: "Not allowed." }, 403);
  const who = await redbookClientId(env, session, url.searchParams.get("client") || "");
  const date = (url.searchParams.get("date") || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  if (!who.id) return noStore({ ok: true, client: who.name, date, questions: [], ans: {}, find: {} });
  const sel = `assessment_questions?client_id=eq.${who.id}&select=id,section,code,question,sort&order=sort.asc,created_at.asc`;
  let qs = await sbSelect(env, sel);
  if (qs === null) return noStore({ ok: true, client: who.name, date, questions: [], ans: {}, find: {}, missing: true });
  if (qs.length === 0 && can(session, "foodSafety", "edit")) {
    await sbInsert(env, "assessment_questions", seedAssessmentRows(who.id));
    qs = await sbSelect(env, sel) || [];
  }
  const days = await sbSelect(env, `assessment_days?client_id=eq.${who.id}&log_date=eq.${date}&select=data&limit=1`);
  const data = (days && days[0] && days[0].data) || {};
  // Has this date's assessment already been filed into the Red Book binder?
  const filedRows = await sbSelect(env, `redbook_docs?client_id=eq.${who.id}&title=eq.${encodeURIComponent("Self-Assessment — " + date)}&select=file_url&limit=1`);
  const filed = !!(filedRows && filedRows[0]);
  return noStore({ ok: true, client: who.name, date, questions: (qs || []).map((q) => ({ id: q.id, section: q.section || "Other", code: q.code || "", question: q.question || "", sort: q.sort || 0 })), ans: data.ans || {}, find: data.find || {}, findpics: data.findpics || {}, filed, filedUrl: filed ? (filedRows[0].file_url || "") : "" });
}

async function uploadAssessmentPhoto(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  if (!sbReady(env)) return json({ ok: false, error: "Not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const who = await redbookClientId(env, session, (body.client || "").toString().trim());
  if (!who.id) return json({ ok: false, error: "Pick a client first." }, 400);
  const base64 = body.fileBase64 || "";
  const ct = (body.contentType || "image/jpeg").toString();
  if (!base64) return json({ ok: false, error: "No photo." }, 400);
  const ext = ct.indexOf("png") >= 0 ? "png" : "jpg";
  const path = `assessment/${who.id}/${Date.now()}-${Math.floor(Math.random() * 1e4)}.${ext}`;
  const url = await uploadToStorage(env, path, base64, ct);
  if (!url) return json({ ok: false, error: "Upload failed." }, 502);
  return json({ ok: true, url });
}

// File a frozen copy of a completed assessment into the Red Book binder
// (Monthly Self-Assessments). The page sends its rendered report; we store it
// and upsert one binder entry per assessment date, so re-filing the same date
// replaces the copy instead of piling up duplicates. The binder entry's
// doc_date is the assessment date (paperwork is often filed as a follow-up).
async function fileAssessmentToBinder(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  if (!sbReady(env)) return json({ ok: false, error: "Not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const who = await redbookClientId(env, session, (body.client || "").toString().trim());
  if (!who.id) return json({ ok: false, error: "Pick a client first." }, 400);
  const date = (body.date || "").toString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ ok: false, error: "Bad date." }, 400);
  // The page builds a real PDF client-side and sends it; htmlBase64 is the
  // legacy shape (kept so an un-refreshed page doesn't break mid-rollout).
  const pdfBase64 = body.pdfBase64 || "", htmlBase64 = body.htmlBase64 || "";
  if (!pdfBase64 && !htmlBase64) return json({ ok: false, error: "Nothing to file." }, 400);
  const ext = pdfBase64 ? "pdf" : "html";
  const ct = pdfBase64 ? "application/pdf" : "text/html";
  const path = `assessment/${who.id}/report-${date}-${Date.now()}.${ext}`;
  const fileUrl = await uploadToStorage(env, path, pdfBase64 || htmlBase64, ct);
  if (!fileUrl) return json({ ok: false, error: "Upload failed." }, 502);
  const section = "Monthly Self-Assessments";
  const title = `Self-Assessment — ${date}`;
  const a = authorOf(session);
  // Upsert by client + title: one binder copy per assessment date.
  const existing = await sbSelect(env, `redbook_docs?client_id=eq.${who.id}&title=eq.${encodeURIComponent(title)}&select=id&limit=1`);
  if (existing === null) return json({ ok: false, error: "The Red Book table isn't set up yet." }, 400);
  if (existing[0]) {
    let res = await sbUpdate(env, "redbook_docs", existing[0].id, { file_url: fileUrl, file_type: ct, section, doc_date: date });
    if (!res.ok) res = await sbUpdate(env, "redbook_docs", existing[0].id, { file_url: fileUrl, file_type: ct, section }); // pre-migration fallback
    if (!res.ok) return json({ ok: false, error: "Couldn't update the binder copy." }, 502);
    return json({ ok: true, updated: true });
  }
  const row = { client_id: who.id, section, title, file_url: fileUrl, file_type: ct, uploaded_by: a.author, doc_date: date };
  let res = await sbInsert(env, "redbook_docs", row);
  if (!res.ok) { delete row.doc_date; res = await sbInsert(env, "redbook_docs", row); } // pre-migration fallback
  if (!res.ok) return json({ ok: false, error: "Couldn't file it." }, 502);
  return json({ ok: true });
}

/* ===================== Receiving Log ===================== */
// Per-delivery entries, laid out weekly like the paper sheet: Date | Vendor |
// Walk-in Refrigerator temp | Walk-in Freezer temp. `storage` says which column
// the temp belongs in ('refrigerated' or 'frozen'). Lives in `receiving_logs`;
// degrades gracefully until the table (and the storage column) exist.
function weekRange(url) {
  const okDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
  let from = url.searchParams.get("from") || "", to = url.searchParams.get("to") || "";
  if (!okDate(from) || !okDate(to)) {
    const d = (url.searchParams.get("date") || "").slice(0, 10);
    from = to = okDate(d) ? d : new Date().toISOString().slice(0, 10);
  }
  if (from > to) { const t = from; from = to; to = t; }
  return { from, to };
}

// Staff stay on the week they're working: the pages hide week navigation for
// non-admins, and this is the server-side backstop. Client-scoped sessions get
// the range clamped to roughly the current week (±8 days of slack so timezone
// drift never clips the active week). Masters pass through untouched.
function clampWeekForClient(session, range) {
  if (scopeName(session) == null) return range;
  const ms = 86400000, now = Date.now();
  const lo = new Date(now - 8 * ms).toISOString().slice(0, 10);
  const hi = new Date(now + 8 * ms).toISOString().slice(0, 10);
  let { from, to } = range;
  if (from < lo) from = lo;
  if (to > hi) to = hi;
  return { from, to };
}

// The fixed vendor rows of the weekly sheet (the same lines week over week).
const RECEIVING_DEFAULTS = [
  ["DCP (Refrigerated) - Dairy", "refrigerated"],
  ["DCP (Frozen) - Bagels", "frozen"],
  ["Dean (Frozen) - Ice Cream", "frozen"],
];

async function listReceiving(url, env, session) {
  if (!can(session, "foodSafety", "view")) return json({ ok: false, error: "Not allowed." }, 403);
  const who = await redbookClientId(env, session, url.searchParams.get("client") || "");
  const { from, to } = clampWeekForClient(session, weekRange(url));
  if (!who.id) return noStore({ ok: true, client: who.name, from, to, entries: [], vendors: [], storageOn: true, vendorsOn: true });
  // Vendor columns: a per-client template (seeded with the standard lines).
  const vSel = `receiving_vendors?client_id=eq.${who.id}&select=id,name,storage,sort&order=sort.asc,created_at.asc`;
  let vendorsOn = true;
  let vendors = await sbSelect(env, vSel);
  if (vendors === null) { vendorsOn = false; vendors = []; }
  if (vendorsOn && vendors.length === 0 && can(session, "foodSafety", "edit")) {
    await sbInsert(env, "receiving_vendors", RECEIVING_DEFAULTS.map((d, i) => ({ client_id: who.id, name: d[0], storage: d[1], sort: i * 10 })));
    vendors = await sbSelect(env, vSel) || [];
  }
  const base = `receiving_logs?client_id=eq.${who.id}&log_date=gte.${from}&log_date=lte.${to}`;
  // Try with the storage column; fall back without it so the page still works
  // before the one-time migration.
  let storageOn = true;
  let rows = await sbSelect(env, `${base}&select=id,log_date,vendor,item,temp,status,storage,notes,logged_by,created_at&order=log_date.asc,created_at.asc`);
  if (rows === null) {
    storageOn = false;
    rows = await sbSelect(env, `${base}&select=id,log_date,vendor,item,temp,status,notes,logged_by,created_at&order=log_date.asc,created_at.asc`);
    if (rows === null) return noStore({ ok: true, client: who.name, from, to, entries: [], vendors: [], missing: true, storageOn: false, vendorsOn });
  }
  return noStore({ ok: true, client: who.name, from, to, storageOn, vendorsOn,
    vendors: (vendors || []).map((v) => ({ id: v.id, name: v.name || "", storage: v.storage === "frozen" ? "frozen" : "refrigerated", sort: v.sort || 0 })),
    entries: (rows || []).map((r) => ({ id: r.id, date: r.log_date || "", vendor: r.vendor || "", item: r.item || "", temp: r.temp, status: r.status || "Accepted", storage: r.storage === "frozen" ? "frozen" : "refrigerated", notes: r.notes || "", by: r.logged_by || "", at: r.created_at || "" })) });
}

// Admin editor for the vendor rows.
async function saveReceivingVendor(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  if (!sbReady(env)) return json({ ok: false, error: "Not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const who = await redbookClientId(env, session, (body.client || "").toString().trim());
  if (!who.id) return json({ ok: false, error: "Pick a client first." }, 400);
  const id = (body.id || "").toString().trim();
  if (body.delete && id) {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/receiving_vendors?id=eq.${id}&client_id=eq.${who.id}`, { method: "DELETE", headers: sbHeaders(env) });
    if (!r.ok) return json({ ok: false, error: "Could not delete." }, 502);
    return json({ ok: true });
  }
  const name = (body.name || "").toString().trim().slice(0, 120);
  const storage = body.storage === "frozen" ? "frozen" : "refrigerated";
  if (!name) return json({ ok: false, error: "Enter a name." }, 400);
  if (id) {
    const patch = { name, storage };
    if (body.sort != null && !isNaN(parseInt(body.sort, 10))) patch.sort = parseInt(body.sort, 10);
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/receiving_vendors?id=eq.${id}&client_id=eq.${who.id}`, { method: "PATCH", headers: sbHeaders(env, { Prefer: "return=representation" }), body: JSON.stringify(patch) });
    if (!r.ok) return json({ ok: false, error: "Could not save." }, 502);
    return json({ ok: true });
  }
  const sort = body.sort != null && !isNaN(parseInt(body.sort, 10)) ? parseInt(body.sort, 10) : 9990;
  const res = await sbInsert(env, "receiving_vendors", { client_id: who.id, name, storage, sort });
  if (!res.ok) return json({ ok: false, error: "Could not add." }, 502);
  return json({ ok: true });
}

// Admin override of a logged temp (entered in error). Mirrors the temp log.
async function updateReceiving(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const id = (body.id || "").toString().trim();
  const temp = parseFloat(body.temp);
  if (!id) return json({ ok: false, error: "No id." }, 400);
  if (isNaN(temp)) return json({ ok: false, error: "Enter a temperature." }, 400);
  const forced = scopeName(session);
  if (forced != null) {
    const rows = await sbSelect(env, `receiving_logs?id=eq.${id}&select=client:clients(name)`);
    const cn = rows && rows[0] && rows[0].client && rows[0].client.name;
    if (cn !== forced) return json({ ok: false, error: "Not found." }, 404);
  }
  const res = await sbUpdate(env, "receiving_logs", id, { temp });
  if (!res.ok) return json({ ok: false, error: "Could not update." }, 502);
  return json({ ok: true });
}

// Correct a logged hot-holding/cooking temp. Staff are locked to the current
// week, so they fix mistakes in place rather than re-navigating.
async function updateHotHolding(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const id = (body.id || "").toString().trim();
  const temp = parseFloat(body.temp);
  if (!id) return json({ ok: false, error: "No id." }, 400);
  if (isNaN(temp)) return json({ ok: false, error: "Enter a temperature." }, 400);
  const forced = scopeName(session);
  if (forced != null) {
    const rows = await sbSelect(env, `hotholding_logs?id=eq.${id}&select=client:clients(name)`);
    const cn = rows && rows[0] && rows[0].client && rows[0].client.name;
    if (cn !== forced) return json({ ok: false, error: "Not found." }, 404);
  }
  const res = await sbUpdate(env, "hotholding_logs", id, { temp });
  if (!res.ok) return json({ ok: false, error: "Could not update." }, 502);
  return json({ ok: true });
}

async function addReceiving(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  if (!sbReady(env)) return json({ ok: false, error: "Not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const who = await redbookClientId(env, session, (body.client || "").toString().trim());
  if (!who.id) return json({ ok: false, error: "Pick a client first." }, 400);
  const c = (v) => (v == null ? "" : v.toString().trim());
  const date = c(body.date).slice(0, 10) || new Date().toISOString().slice(0, 10);
  const vendor = c(body.vendor).slice(0, 120), item = c(body.item).slice(0, 160), notes = c(body.notes).slice(0, 500);
  if (!vendor && !item) return json({ ok: false, error: "Enter a vendor or item." }, 400);
  const tp = parseFloat(body.temp); const temp = isNaN(tp) ? null : tp;
  const status = c(body.status) === "Rejected" ? "Rejected" : "Accepted";
  const storage = c(body.storage) === "frozen" ? "frozen" : "refrigerated";
  const a = authorOf(session);
  const row = { client_id: who.id, log_date: date, vendor, item, temp, status, storage, notes, logged_by: a.author };
  let res = await sbInsert(env, "receiving_logs", row);
  if (!res.ok) { delete row.storage; res = await sbInsert(env, "receiving_logs", row); } // pre-migration fallback
  if (!res.ok) return json({ ok: false, error: ("Could not save. " + (res.error || "")).slice(0, 200) }, 502);
  return json({ ok: true });
}

async function deleteReceiving(request, env, session) {
  return deleteFoodLogRow(request, env, session, "receiving_logs");
}

/* ===================== Hot Holding / Cooking Temps ===================== */
// A weekly grid like the paper sheet: a few food items as columns (each with
// its own minimum), days of the week as rows. The item list is a per-client
// template in `hotholding_items` (admin-edited, seeded with defaults); the
// readings live in `hotholding_logs` keyed by item name. Cooking defaults to a
// 165°F minimum and hot holding to 135°F when an item has none.
const HOTHOLDING_DEFAULTS = [
  ["Hash Brown", "cooking", 165],
  ["Single Egg", "cooking", 135],
  ["Batch Egg", "cooking", 135],
  ["Egg", "holding", 135],
  ["Sausage", "holding", 135],
];

async function listHotHolding(url, env, session) {
  if (!can(session, "foodSafety", "view")) return json({ ok: false, error: "Not allowed." }, 403);
  const who = await redbookClientId(env, session, url.searchParams.get("client") || "");
  const { from, to } = clampWeekForClient(session, weekRange(url));
  if (!who.id) return noStore({ ok: true, client: who.name, from, to, items: [], entries: [], itemsOn: true });
  const itemSel = `hotholding_items?client_id=eq.${who.id}&select=id,name,kind,min_temp,sort&order=sort.asc,created_at.asc`;
  let itemsOn = true;
  let items = await sbSelect(env, itemSel);
  if (items === null) { itemsOn = false; items = []; }
  // First time for this client: seed the standard items so the grid has columns.
  if (itemsOn && items.length === 0 && can(session, "foodSafety", "edit")) {
    await sbInsert(env, "hotholding_items", HOTHOLDING_DEFAULTS.map((d, i) => ({ client_id: who.id, name: d[0], kind: d[1], min_temp: d[2], sort: i * 10 })));
    items = await sbSelect(env, itemSel) || [];
  }
  const rows = await sbSelect(env, `hotholding_logs?client_id=eq.${who.id}&log_date=gte.${from}&log_date=lte.${to}&select=id,log_date,kind,item,temp,notes,logged_by,created_at&order=created_at.asc`);
  if (rows === null) return noStore({ ok: true, client: who.name, from, to, items: [], entries: [], missing: true, itemsOn });
  return noStore({ ok: true, client: who.name, from, to, itemsOn,
    items: (items || []).map((i) => ({ id: i.id, name: i.name || "", kind: i.kind === "cooking" ? "cooking" : "holding", min: i.min_temp, sort: i.sort || 0 })),
    entries: (rows || []).map((r) => ({ id: r.id, date: r.log_date || "", kind: r.kind === "cooking" ? "cooking" : "holding", item: r.item || "", temp: r.temp, notes: r.notes || "", by: r.logged_by || "", at: r.created_at || "" })) });
}

// Admin editor for the item columns (add / rename / re-kind / set min / delete).
async function saveHotHoldingItem(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  if (!sbReady(env)) return json({ ok: false, error: "Not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const who = await redbookClientId(env, session, (body.client || "").toString().trim());
  if (!who.id) return json({ ok: false, error: "Pick a client first." }, 400);
  const id = (body.id || "").toString().trim();
  if (body.delete && id) {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/hotholding_items?id=eq.${id}&client_id=eq.${who.id}`, { method: "DELETE", headers: sbHeaders(env) });
    if (!r.ok) return json({ ok: false, error: "Could not delete." }, 502);
    return json({ ok: true });
  }
  const name = (body.name || "").toString().trim().slice(0, 120);
  const kind = body.kind === "cooking" ? "cooking" : "holding";
  if (!name) return json({ ok: false, error: "Enter a name." }, 400);
  const mn = parseFloat(body.min); const min_temp = isNaN(mn) ? null : mn;
  if (id) {
    const patch = { name, kind, min_temp };
    if (body.sort != null && !isNaN(parseInt(body.sort, 10))) patch.sort = parseInt(body.sort, 10);
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/hotholding_items?id=eq.${id}&client_id=eq.${who.id}`, { method: "PATCH", headers: sbHeaders(env, { Prefer: "return=representation" }), body: JSON.stringify(patch) });
    if (!r.ok) return json({ ok: false, error: "Could not save." }, 502);
    return json({ ok: true });
  }
  const sort = body.sort != null && !isNaN(parseInt(body.sort, 10)) ? parseInt(body.sort, 10) : 9990;
  const res = await sbInsert(env, "hotholding_items", { client_id: who.id, name, kind, min_temp, sort });
  if (!res.ok) return json({ ok: false, error: "Could not add." }, 502);
  return json({ ok: true, item: res.data || null });
}

async function addHotHolding(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  if (!sbReady(env)) return json({ ok: false, error: "Not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const who = await redbookClientId(env, session, (body.client || "").toString().trim());
  if (!who.id) return json({ ok: false, error: "Pick a client first." }, 400);
  const c = (v) => (v == null ? "" : v.toString().trim());
  const date = c(body.date).slice(0, 10) || new Date().toISOString().slice(0, 10);
  const kind = c(body.kind) === "cooking" ? "cooking" : "holding";
  const item = c(body.item).slice(0, 160), notes = c(body.notes).slice(0, 500);
  if (!item) return json({ ok: false, error: "Enter a food item." }, 400);
  const tp = parseFloat(body.temp); if (isNaN(tp)) return json({ ok: false, error: "Enter a temperature." }, 400);
  const a = authorOf(session);
  const res = await sbInsert(env, "hotholding_logs", { client_id: who.id, log_date: date, kind, item, temp: tp, notes, logged_by: a.author });
  if (!res.ok) return json({ ok: false, error: ("Could not save. " + (res.error || "")).slice(0, 200) }, 502);
  return json({ ok: true });
}

async function deleteHotHolding(request, env, session) {
  return deleteFoodLogRow(request, env, session, "hotholding_logs");
}

// Shared delete for the simple food logs above: client logins may only delete
// their own client's rows.
async function deleteFoodLogRow(request, env, session, table) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const id = (body.id || "").toString().trim();
  if (!id) return json({ ok: false, error: "No id." }, 400);
  const forced = scopeName(session);
  if (forced != null) {
    const rows = await sbSelect(env, `${table}?id=eq.${id}&select=client:clients(name)`);
    const cn = rows && rows[0] && rows[0].client && rows[0].client.name;
    if (cn !== forced) return json({ ok: false, error: "Not found." }, 404);
  }
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, { method: "DELETE", headers: sbHeaders(env) });
  if (!r.ok) return json({ ok: false, error: "Could not delete." }, 502);
  return json({ ok: true });
}

/* ===================== Food Safety today-summary ===================== */
// One call that rolls up the day's state across every food-safety log for a
// client, so the Red Book hub can show live status on each card. The page sends
// ?date= from the browser's local clock (same convention as the log pages).
// Each block reports missing:true if its table isn't set up yet.

// Effective safe range for a cold unit: its own if set, else a generic by name
// (mirrors unitRange() on the Temp Log page — keep the two in sync).
function effTempRange(name, min, max) {
  if (min != null || max != null) return { min, max };
  const n = (name || "").toLowerCase();
  if (/freezer|flash/.test(n)) return { min: -15, max: 0 };
  if (/dipping/.test(n)) return { min: -5, max: 5 };
  return { min: 33, max: 41 };
}

async function foodSafetySummary(url, env, session) {
  if (!can(session, "foodSafety", "view")) return json({ ok: false, error: "Not allowed." }, 403);
  const who = await redbookClientId(env, session, url.searchParams.get("client") || "");
  const date = (url.searchParams.get("date") || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  if (!who.id) return noStore({ ok: true, client: who.name, date });

  const cid = who.id;
  const [units, reads, secs, days, aQs, aDay, recv, hot] = await Promise.all([
    sbSelect(env, `assets?client_id=eq.${cid}&cold_unit=is.true&select=id,name,nickname,temp_min,temp_max`),
    sbSelect(env, `temp_logs?client_id=eq.${cid}&log_date=eq.${date}&select=asset_id,temp`),
    sbSelect(env, `checklist_sections?client_id=eq.${cid}&select=id,mode`),
    sbSelect(env, `checklist_days?client_id=eq.${cid}&log_date=eq.${date}&select=data&limit=1`),
    sbSelect(env, `assessment_questions?client_id=eq.${cid}&select=id`),
    sbSelect(env, `assessment_days?client_id=eq.${cid}&select=log_date,data&order=log_date.desc&limit=1`),
    sbSelect(env, `receiving_logs?client_id=eq.${cid}&log_date=eq.${date}&select=status`),
    sbSelect(env, `hotholding_logs?client_id=eq.${cid}&log_date=eq.${date}&select=kind,temp`),
  ]);

  // Cold storage: units checked today + any reading outside its effective range.
  let temps = { missing: true };
  if (units !== null && reads !== null) {
    const byId = {}; (units || []).forEach((u) => { byId[u.id] = u; });
    const checked = new Set(); let out = 0;
    for (const r of (reads || [])) {
      const u = byId[r.asset_id]; if (!u) continue;
      checked.add(r.asset_id);
      const rg = effTempRange(u.nickname || u.name, u.temp_min, u.temp_max);
      if (r.temp != null && ((rg.min != null && r.temp < rg.min) || (rg.max != null && r.temp > rg.max))) out++;
    }
    temps = { missing: false, units: (units || []).length, checked: checked.size, out };
  }

  // Pre-shift checklist: boxes checked vs expected (shift sections count 3).
  let checklist = { missing: true };
  if (secs !== null && days !== null) {
    const ids = new Set(); let expected = 0;
    (secs || []).forEach((s) => { ids.add(s.id); expected += s.mode === "shift" ? 3 : 1; });
    const data = (days && days[0] && days[0].data) || {};
    const marks = data.marks || {};
    let done = 0;
    for (const k of Object.keys(marks)) { if (marks[k] && ids.has(k.split(":")[0])) done++; }
    const assign = data.assign || {};
    checklist = { missing: false, expected, done, assigned: !!(assign.open || assign.mid || assign.close) };
  }

  // Self-assessment: the most recent one, whenever it was.
  let assessment = { missing: true };
  if (aQs !== null && aDay !== null) {
    const qids = new Set((aQs || []).map((q) => q.id));
    const total = qids.size;
    const last = (aDay || [])[0];
    if (!last) assessment = { missing: false, total, date: "" };
    else {
      const ans = (last.data && last.data.ans) || {};
      let no = 0, answered = 0;
      // Count only answers to questions that still exist, so orphaned answers
      // from edited or removed questions can't push the tally past the total.
      for (const k of Object.keys(ans)) { if (!qids.has(k)) continue; answered++; if (ans[k] === "no") no++; }
      assessment = { missing: false, total, date: last.log_date || "", answered, no };
    }
  }

  // Receiving and hot holding: today's entries.
  let receiving = { missing: true };
  if (recv !== null) receiving = { missing: false, count: (recv || []).length, rejected: (recv || []).filter((r) => r.status === "Rejected").length };
  let hotholding = { missing: true };
  if (hot !== null) {
    let low = 0;
    for (const h of (hot || [])) { const min = h.kind === "cooking" ? 165 : 135; if (h.temp != null && h.temp < min) low++; }
    hotholding = { missing: false, count: (hot || []).length, low };
  }

  return noStore({ ok: true, client: who.name, date, temps, checklist, assessment, receiving, hotholding });
}

async function saveAssessmentDay(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  if (!sbReady(env)) return json({ ok: false, error: "Not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const who = await redbookClientId(env, session, (body.client || "").toString().trim());
  if (!who.id) return json({ ok: false, error: "Pick a client first." }, 400);
  const date = (body.date || "").toString().slice(0, 10) || new Date().toISOString().slice(0, 10);
  const ansIn = (body.ans && typeof body.ans === "object") ? body.ans : {};
  const findIn = (body.find && typeof body.find === "object") ? body.find : {};
  const picsIn = (body.findpics && typeof body.findpics === "object") ? body.findpics : {};
  const ans = {}, find = {}, findpics = {};
  for (const k of Object.keys(ansIn)) { const v = (ansIn[k] || "").toString(); if (v === "yes" || v === "no") ans[k] = v; }
  for (const k of Object.keys(findIn)) { const v = (findIn[k] || "").toString().slice(0, 1000); if (v.trim()) find[k] = v; }
  for (const k of Object.keys(picsIn)) { if (Array.isArray(picsIn[k])) { const arr = picsIn[k].filter((u) => typeof u === "string" && u).slice(0, 8); if (arr.length) findpics[k] = arr; } }
  const data = { ans, find, findpics };
  const a = authorOf(session);
  const existing = await sbSelect(env, `assessment_days?client_id=eq.${who.id}&log_date=eq.${date}&select=id&limit=1`);
  if (existing === null) return json({ ok: false, error: "The assessment table isn't set up yet." }, 400);
  if (existing[0]) {
    const res = await sbUpdate(env, "assessment_days", existing[0].id, { data, updated_by: a.author });
    if (!res.ok) return json({ ok: false, error: "Could not save." }, 502);
  } else {
    const res = await sbInsert(env, "assessment_days", { client_id: who.id, log_date: date, data, updated_by: a.author });
    if (!res.ok) return json({ ok: false, error: "Could not save." }, 502);
  }
  return json({ ok: true });
}

async function saveAssessmentQuestion(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  if (!sbReady(env)) return json({ ok: false, error: "Not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const who = await redbookClientId(env, session, (body.client || "").toString().trim());
  if (!who.id) return json({ ok: false, error: "Pick a client first." }, 400);
  const id = (body.id || "").toString().trim();
  if (body.delete && id) {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/assessment_questions?id=eq.${id}&client_id=eq.${who.id}`, { method: "DELETE", headers: sbHeaders(env) });
    if (!r.ok) return json({ ok: false, error: "Could not delete." }, 502);
    return json({ ok: true });
  }
  const section = (body.section || "").toString().trim().slice(0, 120);
  const code = (body.code || "").toString().trim().slice(0, 40);
  const question = (body.question || "").toString().trim().slice(0, 600);
  if (!section || !question) return json({ ok: false, error: "Section and question are required." }, 400);
  if (id) {
    const patch = { section, code, question };
    if (body.sort != null && !isNaN(parseInt(body.sort, 10))) patch.sort = parseInt(body.sort, 10);
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/assessment_questions?id=eq.${id}&client_id=eq.${who.id}`, { method: "PATCH", headers: sbHeaders(env, { Prefer: "return=representation" }), body: JSON.stringify(patch) });
    if (!r.ok) return json({ ok: false, error: "Could not save." }, 502);
    const d = await r.json();
    return json({ ok: true, question: Array.isArray(d) ? d[0] : d });
  }
  const sort = body.sort != null && !isNaN(parseInt(body.sort, 10)) ? parseInt(body.sort, 10) : 9990;
  const res = await sbInsert(env, "assessment_questions", { client_id: who.id, section, code, question, sort });
  if (!res.ok) return json({ ok: false, error: "Could not add." }, 502);
  return json({ ok: true, question: res.data || null });
}

async function resetAssessment(request, env, session) {
  if (!can(session, "foodSafety", "edit")) return deny("foodSafety");
  if (!sbReady(env)) return json({ ok: false, error: "Not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const who = await redbookClientId(env, session, (body.client || "").toString().trim());
  if (!who.id) return json({ ok: false, error: "Pick a client first." }, 400);
  if ((await sbSelect(env, `assessment_questions?client_id=eq.${who.id}&select=id&limit=1`)) === null) {
    return json({ ok: false, error: "The assessment tables aren't set up yet." }, 400);
  }
  const del = await fetch(`${env.SUPABASE_URL}/rest/v1/assessment_questions?client_id=eq.${who.id}`, { method: "DELETE", headers: sbHeaders(env) });
  if (!del.ok) return json({ ok: false, error: "Could not clear the old questions." }, 502);
  const res = await sbInsert(env, "assessment_questions", seedAssessmentRows(who.id));
  if (!res.ok) return json({ ok: false, error: "Could not load the questions." }, 502);
  return json({ ok: true, count: seedAssessmentRows(who.id).length });
}

/* ===================== Ticket parts / materials ===================== */
// Parts needed to complete a ticket. Admin-only (it's procurement/triage work).
// Lives in the `ticket_parts` table; degrades gracefully until that table exists.
const PART_STATUSES = ["Needed", "Ordered", "Received"];

/* ---- Vendor quotes on a ticket (priced before dispatch). Accepting one
   assigns the vendor, declines the rest, and writes the vendor cost onto the
   ticket's service call. Lives in ticket_quotes (supabase/ticket_quotes.sql),
   degrading gracefully until that table exists. ---- */
async function listTicketQuotes(url, env, session) {
  if (!session || session.role === "client") return json({ ok: true, quotes: [] });
  const id = url.searchParams.get("id") || "";
  if (!id || !sbReady(env)) return json({ ok: true, quotes: [] });
  // Newest schema first, then older shapes, so the page keeps working while
  // migrations catch up. Timestamps on dialog entries are stored but not shown.
  let rows = await sbSelect(env, `ticket_quotes?ticket_id=eq.${id}&select=id,vendor,amount,notes,status,photo_urls,comments,warranty_covered,created_at&order=created_at.asc`);
  if (rows === null) rows = await sbSelect(env, `ticket_quotes?ticket_id=eq.${id}&select=id,vendor,amount,notes,status,photo_urls,comments,created_at&order=created_at.asc`);
  if (rows === null) rows = await sbSelect(env, `ticket_quotes?ticket_id=eq.${id}&select=id,vendor,amount,notes,status,photo_urls,created_at&order=created_at.asc`);
  if (rows === null) rows = await sbSelect(env, `ticket_quotes?ticket_id=eq.${id}&select=id,vendor,amount,notes,status,created_at&order=created_at.asc`);
  if (rows === null) return noStore({ ok: true, quotes: [], missing: true });
  return noStore({ ok: true, quotes: (rows || []).map((q) => ({ id: q.id, vendor: q.vendor || "", amount: q.amount != null ? q.amount : "", notes: q.notes || "", status: q.status || "Pending", covered: !!q.warranty_covered, photos: q.photo_urls || [], comments: Array.isArray(q.comments) ? q.comments.map((c) => ({ by: c.by || "", text: c.text || "" })) : [] })) });
}

async function saveTicketQuote(request, env, session) {
  if (!session || session.role !== "master") return json({ ok: false, error: "Master only." }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const c = (v) => (v == null ? "" : v.toString().trim());
  const qid = c(body.id);
  // Edit an existing quote: fields, attached photos, and the dialog thread.
  if (qid) {
    const cur = await sbSelect(env, `ticket_quotes?id=eq.${qid}&select=id,ticket_id,photo_urls,comments`)
      || await sbSelect(env, `ticket_quotes?id=eq.${qid}&select=id,ticket_id,photo_urls`)
      || await sbSelect(env, `ticket_quotes?id=eq.${qid}&select=id,ticket_id`);
    const row0 = cur && cur[0];
    if (!row0) return json({ ok: false, error: "Quote not found." }, 404);
    const patch = {};
    if (c(body.vendor)) patch.vendor = c(body.vendor);
    if ("notes" in body) patch.notes = c(body.notes) || null;
    if ("amount" in body) { const n = Number(body.amount); patch.amount = body.amount === "" || isNaN(n) ? null : n; }
    if ("covered" in body) patch.warranty_covered = !!body.covered;
    const adds = Array.isArray(body.addPhotos) ? body.addPhotos : [];
    if (adds.length) {
      const urls = (row0.photo_urls || []).slice();
      for (let i = 0; i < adds.length; i++) {
        const u = await uploadToStorage(env, `tickets/${row0.ticket_id}/quotes/${qid}-${Date.now()}-${i}.jpg`, adds[i] && adds[i].base64, adds[i] && adds[i].contentType);
        if (u) urls.push(u);
      }
      patch.photo_urls = urls;
    }
    // Dialog on the quote itself, so the back-and-forth never clutters the
    // ticket's update log. Timestamp kept for the future, not displayed.
    if (c(body.addComment)) {
      const a = authorOf(session);
      const list = Array.isArray(row0.comments) ? row0.comments.slice() : [];
      list.push({ by: a.author || "Ringwood", at: new Date().toISOString(), text: c(body.addComment).slice(0, 2000) });
      patch.comments = list;
    }
    if (!Object.keys(patch).length) return json({ ok: true });
    const res0 = await sbUpdate(env, "ticket_quotes", qid, patch);
    if (!res0.ok) return json({ ok: false, error: "Couldn't save. Run supabase/ticket_attachments.sql (latest) once, then retry." }, 502);
    return json({ ok: true });
  }
  const ticketId = c(body.ticketId);
  const vendor = c(body.vendor);
  if (!ticketId || !vendor) return json({ ok: false, error: "Enter the vendor." }, 400);
  if (!(await ownsRecord(env, session, "tickets", ticketId))) return json({ ok: false, error: "Not found." }, 404);
  const row = { ticket_id: ticketId, vendor: vendor, status: "Pending" };
  const amt = Number(body.amount);
  if (!isNaN(amt) && body.amount !== "" && body.amount != null) row.amount = amt;
  if (c(body.notes)) row.notes = c(body.notes);
  const res = await sbInsert(env, "ticket_quotes", row);
  if (!res.ok) return json({ ok: false, error: "Couldn't save. Run supabase/ticket_quotes.sql once, then retry." }, 502);
  // Photos sent with a new quote (e.g. the emailed quote sheet) ride along.
  const pics = Array.isArray(body.photos) ? body.photos : [];
  if (res.data && pics.length) {
    const urls = [];
    for (let i = 0; i < pics.length; i++) {
      const u = await uploadToStorage(env, `tickets/${ticketId}/quotes/${res.data.id}-${i}.jpg`, pics[i] && pics[i].base64, pics[i] && pics[i].contentType);
      if (u) urls.push(u);
    }
    if (urls.length) { try { await sbUpdate(env, "ticket_quotes", res.data.id, { photo_urls: urls }); } catch { /* needs migration */ } }
  }
  return json({ ok: true, quote: res.data || null });
}

async function deleteTicketQuote(request, env, session) {
  if (!session || session.role !== "master") return json({ ok: false, error: "Master only." }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const id = (body.id || "").toString().trim();
  if (!id) return json({ ok: false, error: "No id." }, 400);
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/ticket_quotes?id=eq.${id}`, { method: "DELETE", headers: sbHeaders(env) });
  if (!r.ok) return json({ ok: false, error: "Couldn't delete." }, 502);
  return json({ ok: true });
}

async function acceptTicketQuote(request, env, session) {
  if (!session || session.role !== "master") return json({ ok: false, error: "Master only." }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const id = (body.id || "").toString().trim();
  if (!id) return json({ ok: false, error: "No id." }, 400);
  const rows = await sbSelect(env, `ticket_quotes?id=eq.${id}&select=id,ticket_id,vendor,amount`);
  const q = rows && rows[0];
  if (!q) return json({ ok: false, error: "Quote not found." }, 404);
  const res = await sbUpdate(env, "ticket_quotes", id, { status: "Accepted" });
  if (!res.ok) return json({ ok: false, error: "Couldn't accept." }, 502);
  // The losers go to Declined: a record of diligence, not a second decision.
  await fetch(`${env.SUPABASE_URL}/rest/v1/ticket_quotes?ticket_id=eq.${q.ticket_id}&id=neq.${id}`, {
    method: "PATCH", headers: sbHeaders(env, { Prefer: "return=minimal" }), body: JSON.stringify({ status: "Declined" }),
  });
  // Winning vendor becomes the assignee; the amount lands on the service call.
  await sbUpdate(env, "tickets", q.ticket_id, { assigned_to: q.vendor });
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/service_records?ticket_id=eq.${q.ticket_id}`, {
      method: "PATCH", headers: sbHeaders(env, { Prefer: "return=minimal" }), body: JSON.stringify({ vendor_cost: q.amount != null ? q.amount : null }),
    });
  } catch { /* service call may not exist yet; assignment still stands */ }
  await logTicketEvent(env, q.ticket_id, session, "Accepted quote: " + q.vendor, q.vendor + (q.amount != null ? (" — $" + q.amount) : "") + ". Other quotes marked Declined; vendor assigned and the cost written to the service call.");
  return json({ ok: true, vendor: q.vendor });
}

// Star-select a quote as the one that feeds the job cost. Unlike Accept, this
// is freely switchable: it never declines the others or locks editing, so you
// can move the star between quotes as the pricing shakes out. "on:false" clears
// the star (job cost then falls back to the first quote).
async function selectTicketQuote(request, env, session) {
  if (!session || session.role !== "master") return json({ ok: false, error: "Master only." }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const id = (body.id || "").toString().trim();
  if (!id) return json({ ok: false, error: "No id." }, 400);
  const rows = await sbSelect(env, `ticket_quotes?id=eq.${id}&select=id,ticket_id`);
  const q = rows && rows[0];
  if (!q) return json({ ok: false, error: "Quote not found." }, 404);
  const on = body.on !== false;
  if (on) {
    // Clear any other selection on this ticket, then star this one.
    await fetch(`${env.SUPABASE_URL}/rest/v1/ticket_quotes?ticket_id=eq.${q.ticket_id}&status=eq.Accepted`, {
      method: "PATCH", headers: sbHeaders(env, { Prefer: "return=minimal" }), body: JSON.stringify({ status: "Pending" }),
    });
    const res = await sbUpdate(env, "ticket_quotes", id, { status: "Accepted" });
    if (!res.ok) return json({ ok: false, error: "Couldn't select." }, 502);
  } else {
    const res = await sbUpdate(env, "ticket_quotes", id, { status: "Pending" });
    if (!res.ok) return json({ ok: false, error: "Couldn't clear." }, 502);
  }
  return json({ ok: true });
}

// Pricing for the money block: the ticket's own markup / service fee / charge,
// plus the client's defaults so the ticket can fall back to them. Isolated from
// updateTicket so the (newer) markup/fee columns can't break core ticket saves.
async function getTicketPricing(url, env, session) {
  if (!session || session.role !== "master") return json({ ok: false }, 403);
  const id = url.searchParams.get("id") || "";
  if (!id || !sbReady(env)) return json({ ok: true });
  let ticketCols = true;
  let tr = await sbSelect(env, `tickets?id=eq.${id}&select=client_price,markup_pct,service_fee,client_id`);
  if (tr === null) { ticketCols = false; tr = await sbSelect(env, `tickets?id=eq.${id}&select=client_price,client_id`); }
  const trow = tr && tr[0];
  let clientMarkup = null, clientFee = null;
  if (trow && trow.client_id) {
    const cr = await sbSelect(env, `clients?id=eq.${trow.client_id}&select=markup_pct,service_fee`);
    const crow = cr && cr[0];
    if (crow) { clientMarkup = crow.markup_pct != null ? crow.markup_pct : null; clientFee = crow.service_fee != null ? crow.service_fee : null; }
  }
  return noStore({
    ok: true,
    clientPrice: trow && trow.client_price != null ? trow.client_price : "",
    markupPct: trow && trow.markup_pct != null ? trow.markup_pct : null,
    serviceFee: trow && trow.service_fee != null ? trow.service_fee : null,
    clientMarkupPct: clientMarkup,
    clientServiceFee: clientFee,
    missing: !ticketCols,
  });
}

async function saveTicketPricing(request, env, session) {
  if (!session || session.role !== "master") return json({ ok: false, error: "Master only." }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const id = (body.id || "").toString().trim();
  if (!id) return json({ ok: false, error: "No ticket." }, 400);
  const base = {};
  if ("clientPrice" in body) { const n = Number(body.clientPrice); base.client_price = body.clientPrice === "" || isNaN(n) ? null : n; }
  const extra = {};
  if ("markupPct" in body) { const n = Number(body.markupPct); extra.markup_pct = body.markupPct === "" || isNaN(n) ? null : n; }
  if ("serviceFee" in body) { const n = Number(body.serviceFee); extra.service_fee = body.serviceFee === "" || isNaN(n) ? null : n; }
  let res = await sbUpdate(env, "tickets", id, Object.assign({}, base, extra));
  let colsMissing = false;
  if (!res.ok && Object.keys(extra).length) { colsMissing = true; res = await sbUpdate(env, "tickets", id, base); }
  if (!res.ok) return json({ ok: false, error: "Couldn't save pricing." }, 502);
  return json({ ok: true, colsMissing });
}

// Everything the bill generator needs in one shot: the job's labor, parts (with
// invoice-backed totals), the selected vendor quote, and the markup/fee that
// build the charge. Computes job cost, charge, and margin so the page just
// renders. Master only — bills are produced by the admin and shown to clients.
async function getTicketBill(url, env, session) {
  if (!session || session.role !== "master") return json({ ok: false, error: "Master only." }, 403);
  const id = url.searchParams.get("id") || "";
  if (!id || !sbReady(env)) return json({ ok: false, error: "Not found." }, 404);
  const trows = await sbSelect(env, `tickets?id=eq.${id}&select=ref,title,description,created_at,client_id,client_price`);
  const t = trows && trows[0];
  if (!t) return json({ ok: false, error: "Ticket not found." }, 404);
  // Pricing columns (ticket + client) are newer; degrade gracefully.
  let tp = await sbSelect(env, `tickets?id=eq.${id}&select=markup_pct,service_fee`);
  const tpr = tp && tp[0] ? tp[0] : {};
  let clientName = "", clientEmail = "", cMarkup = null, cFee = null;
  if (t.client_id) {
    let cr = await sbSelect(env, `clients?id=eq.${t.client_id}&select=name,email,markup_pct,service_fee`);
    if (cr === null) cr = await sbSelect(env, `clients?id=eq.${t.client_id}&select=name,email`);
    const c0 = cr && cr[0];
    if (c0) { clientName = c0.name || ""; clientEmail = c0.email || ""; cMarkup = c0.markup_pct != null ? c0.markup_pct : null; cFee = c0.service_fee != null ? c0.service_fee : null; }
  }
  // Labor
  const lrows = await sbSelect(env, `ticket_labor?ticket_id=eq.${id}&select=person,hours,rate&order=created_at.asc`);
  const labor = (lrows || []).map((l) => { const h = Number(l.hours) || 0, r = Number(l.rate) || 0; return { person: l.person || "", hours: h, rate: r, cost: h * r }; });
  const laborCost = labor.reduce((a, l) => a + l.cost, 0);
  // Parts
  let prows = await sbSelect(env, `ticket_parts?ticket_id=eq.${id}&select=item,quantity,unit,est_cost,warranty_covered&order=created_at.asc`);
  if (prows === null) prows = await sbSelect(env, `ticket_parts?ticket_id=eq.${id}&select=item,quantity,unit,est_cost&order=created_at.asc`);
  const parts = (prows || []).map((p) => ({ item: p.item || "", quantity: p.quantity, unit: p.unit || "", cost: p.est_cost != null ? Number(p.est_cost) : null, covered: !!p.warranty_covered }));
  const partsCost = parts.reduce((a, p) => a + (p.covered || p.cost == null || isNaN(p.cost) ? 0 : p.cost), 0);
  // Vendor quote: the starred (Accepted) one, else the first
  let qrows = await sbSelect(env, `ticket_quotes?ticket_id=eq.${id}&select=vendor,amount,status,warranty_covered&order=created_at.asc`);
  if (qrows === null) qrows = await sbSelect(env, `ticket_quotes?ticket_id=eq.${id}&select=vendor,amount,status&order=created_at.asc`);
  const qlist = qrows || [];
  let quote = qlist.find((q) => q.status === "Accepted") || qlist[0] || null;
  const vendorCost = quote && !quote.warranty_covered && quote.amount != null ? Number(quote.amount) : 0;
  const jobCost = laborCost + partsCost + vendorCost;
  // Effective markup / fee: ticket value, else client default, else 0.
  const markupPct = tpr.markup_pct != null ? Number(tpr.markup_pct) : (cMarkup != null ? Number(cMarkup) : 0);
  const feeRaw = tpr.service_fee != null ? Number(tpr.service_fee) : (cFee != null ? Number(cFee) : 0);
  const fee = feeRaw > 0 ? feeRaw : 0;
  const markupAmt = Math.round(jobCost * markupPct / 100 * 100) / 100;
  const total = Math.round((jobCost + markupAmt + fee) * 100) / 100;
  const margin = Math.round((total - jobCost) * 100) / 100;
  return noStore({
    ok: true,
    ticket: { ref: t.ref || "", title: t.title || "", description: t.description || "", created: t.created_at || "", client: clientName, clientEmail: clientEmail },
    labor, laborCost,
    parts, partsCost,
    quote: quote ? { vendor: quote.vendor || "", amount: quote.amount != null ? Number(quote.amount) : null, covered: !!quote.warranty_covered } : null,
    vendorCost,
    jobCost, markupPct, markupAmt, fee, total, margin,
  });
}

// Everything the RFQ (request for quote) builder needs: the scope, photos, and
// equipment from the ticket, plus the vendor directory (with emails) so the RFQ
// can be sent out. Master only — RFQs are produced by the admin for vendors.
async function getTicketRfq(url, env, session) {
  if (!session || session.role !== "master") return json({ ok: false, error: "Master only." }, 403);
  const id = url.searchParams.get("id") || "";
  if (!id || !sbReady(env)) return json({ ok: false, error: "Not found." }, 404);
  let trows = await sbSelect(env, `tickets?id=eq.${id}&select=ref,title,description,location,created_at,photo_urls,client_id,asset:assets(name,nickname,make,model,serial)`);
  let t = trows && trows[0];
  if (!t) { const t2 = await sbSelect(env, `tickets?id=eq.${id}&select=ref,title,description,location,created_at,photo_urls,client_id`); t = t2 && t2[0]; }
  if (!t) return json({ ok: false, error: "Ticket not found." }, 404);
  let clientName = "";
  if (t.client_id) { const cr = await sbSelect(env, `clients?id=eq.${t.client_id}&select=name`); if (cr && cr[0]) clientName = cr[0].name || ""; }
  const asset = t.asset || null;
  let vrows = await sbSelect(env, "vendors?select=name,email,trade,kind,active&order=name");
  const vendors = (vrows || []).filter((v) => v.active !== false && (v.kind || "") !== "Internal" && v.email).map((v) => ({ name: v.name || "", email: v.email || "", trade: v.trade || "" }));
  return noStore({
    ok: true,
    ticket: {
      ref: t.ref || "", title: t.title || "", description: t.description || "", location: t.location || "", created: t.created_at || "",
      photos: Array.isArray(t.photo_urls) ? t.photo_urls : [], client: clientName,
      asset: asset ? { name: asset.nickname || asset.name || "", make: asset.make || "", model: asset.model || "", serial: asset.serial || "" } : null,
    },
    vendors,
  });
}

async function listTicketParts(url, env, session) {
  if (!session || session.role !== "master") return json([]);
  const id = url.searchParams.get("id") || "";
  if (!id || !sbReady(env)) return json([]);
  let rows = await sbSelect(env, `ticket_parts?ticket_id=eq.${id}&select=id,item,quantity,unit,status,est_cost,source,notes,photo_urls,warranty_covered,created_at&order=created_at.asc`);
  if (rows === null) rows = await sbSelect(env, `ticket_parts?ticket_id=eq.${id}&select=id,item,quantity,unit,status,est_cost,source,notes,photo_urls,created_at&order=created_at.asc`);
  if (rows === null) rows = await sbSelect(env, `ticket_parts?ticket_id=eq.${id}&select=id,item,quantity,unit,status,est_cost,source,notes,created_at&order=created_at.asc`);
  // Table not added yet: say so explicitly (like labor and quotes do) so the
  // page can prompt to run the migration instead of showing a silent empty box
  // that also can't save.
  if (rows === null) return noStore({ missing: true, parts: [] });
  return noStore((rows || []).map((r) => ({ id: r.id, item: r.item || "", quantity: r.quantity, unit: r.unit || "", status: r.status || "Needed", estCost: r.est_cost, source: r.source || "", notes: r.notes || "", photos: r.photo_urls || [], covered: !!r.warranty_covered })));
}

// Labor lines on a ticket: internal Ringwood hours, costed at the person's
// hourly rate (snapshotted when added). Lives in ticket_labor
// (supabase/ticket_labor.sql), degrading gracefully until it exists.
async function listTicketLabor(url, env, session) {
  if (!session || session.role === "client") return json({ ok: true, labor: [] });
  const id = url.searchParams.get("id") || "";
  if (!id || !sbReady(env)) return json({ ok: true, labor: [] });
  const rows = await sbSelect(env, `ticket_labor?ticket_id=eq.${id}&select=id,person,hours,rate,created_at&order=created_at.asc`);
  if (rows === null) return noStore({ ok: true, labor: [], missing: true });
  return noStore({ ok: true, labor: (rows || []).map((l) => ({ id: l.id, person: l.person || "", hours: l.hours != null ? l.hours : "", rate: l.rate != null ? l.rate : "" })) });
}

async function saveTicketLabor(request, env, session) {
  if (!session || session.role !== "master") return json({ ok: false, error: "Master only." }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const c = (v) => (v == null ? "" : v.toString().trim());
  const id = c(body.id);
  const patch = {};
  if ("person" in body) patch.person = c(body.person);
  if ("hours" in body) { const h = Number(body.hours); patch.hours = isNaN(h) || h < 0 ? 0 : h; }
  if ("rate" in body) { const r = Number(body.rate); patch.rate = body.rate === "" || isNaN(r) ? null : r; }
  let res;
  if (id) {
    res = await sbUpdate(env, "ticket_labor", id, patch);
  } else {
    const ticketId = c(body.ticketId);
    if (!ticketId) return json({ ok: false, error: "No ticket." }, 400);
    if (!patch.person) return json({ ok: false, error: "Pick a person." }, 400);
    res = await sbInsert(env, "ticket_labor", Object.assign({ ticket_id: ticketId, hours: 0 }, patch));
  }
  if (!res.ok) return json({ ok: false, error: "Couldn't save. Run supabase/ticket_labor.sql once, then retry." }, 502);
  return json({ ok: true });
}

async function deleteTicketLabor(request, env, session) {
  if (!session || session.role !== "master") return json({ ok: false, error: "Master only." }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const id = (body.id || "").toString().trim();
  if (!id) return json({ ok: false, error: "No id." }, 400);
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/ticket_labor?id=eq.${id}`, { method: "DELETE", headers: sbHeaders(env) });
  if (!r.ok) return json({ ok: false, error: "Couldn't delete." }, 502);
  return json({ ok: true });
}

async function saveTicketPart(request, env, session) {
  if (!session || session.role !== "master") return json({ ok: false, error: "Master only." }, 403);
  if (!sbReady(env)) return json({ ok: false, error: "Not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const c = (v) => (v == null ? "" : v.toString().trim());
  const id = c(body.id);
  const patch = {};
  if ("item" in body) patch.item = c(body.item);
  if ("unit" in body) patch.unit = c(body.unit) || null;
  if ("source" in body) patch.source = c(body.source) || null;
  if ("notes" in body) patch.notes = c(body.notes) || null;
  if ("quantity" in body) { const q = Number(body.quantity); patch.quantity = isNaN(q) || q < 0 ? 1 : q; }
  if ("status" in body) { const s = c(body.status); patch.status = PART_STATUSES.indexOf(s) >= 0 ? s : "Needed"; }
  if ("estCost" in body) { const ec = Number(body.estCost); patch.est_cost = isNaN(ec) ? null : ec; }
  if ("covered" in body) patch.warranty_covered = !!body.covered;
  let res;
  if (id) {
    // A photographed invoice attaches to the part for future pricing.
    if (Array.isArray(body.addPhotos) && body.addPhotos.length) {
      const cur = await sbSelect(env, `ticket_parts?id=eq.${id}&select=ticket_id,photo_urls`);
      const row0 = cur && cur[0];
      if (row0) {
        const urls = (row0.photo_urls || []).slice();
        for (let i = 0; i < body.addPhotos.length; i++) {
          const u = await uploadToStorage(env, `tickets/${row0.ticket_id}/parts/${id}-${Date.now()}-${i}.jpg`, body.addPhotos[i] && body.addPhotos[i].base64, body.addPhotos[i] && body.addPhotos[i].contentType);
          if (u) urls.push(u);
        }
        patch.photo_urls = urls;
      }
    }
    res = await sbUpdate(env, "ticket_parts", id, patch);
  } else {
    const ticketId = c(body.ticketId);
    if (!ticketId) return json({ ok: false, error: "No ticket." }, 400);
    if (!patch.item) return json({ ok: false, error: "Enter an item." }, 400);
    res = await sbInsert(env, "ticket_parts", Object.assign({ ticket_id: ticketId, status: "Needed", quantity: 1 }, patch));
  }
  if (!res.ok) return json({ ok: false, error: ("Could not save. " + (res.error || "")).slice(0, 200) }, 502);
  return json({ ok: true, part: res.data || null });
}

async function deleteTicketPart(request, env, session) {
  if (!session || session.role !== "master") return json({ ok: false, error: "Master only." }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const id = (body.id || "").toString().trim();
  if (!id) return json({ ok: false, error: "No part id." }, 400);
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/ticket_parts?id=eq.${id}`, { method: "DELETE", headers: sbHeaders(env) });
  if (!r.ok) return json({ ok: false, error: "Could not delete." }, 502);
  return json({ ok: true });
}

// AI: from a ticket's title, description, and photos, propose the parts, materials
// and tools a tech would need. The admin reviews and adds the ones they want.
async function suggestTicketParts(request, env, session) {
  if (!session || session.role !== "master") return json({ ok: false, error: "Master only." }, 403);
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: "The assistant is not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const id = (body.id || "").toString().trim();
  if (!id) return json({ ok: false, error: "No ticket id." }, 400);
  const trows = await sbSelect(env, `tickets?id=eq.${id}&select=title,description,photo_urls,asset:assets(name,nickname)`);
  const t = trows && trows[0];
  if (!t) return json({ ok: false, error: "Ticket not found." }, 404);
  const assetName = (t.asset && (t.asset.nickname || t.asset.name)) || "";
  const content = [];
  const urls = Array.isArray(t.photo_urls) ? t.photo_urls.slice(0, 3) : [];
  for (const u of urls) {
    const img = await fetchImageBase64(u);
    if (img) content.push({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.base64 } });
  }
  content.push({ type: "text", text:
    "You are helping a facilities coordinator plan a repair. From the work below (and any photos), list the parts, materials, and tools a technician should bring to complete it. " +
    "Be specific and conservative: only items the work clearly needs. Give each a short item name, a quantity (a number), and a unit (each, pack, box, ft, etc.). " +
    "Do NOT invent brands, exact model numbers, or specs you cannot know from the text/photos. If unsure of a quantity, use 1. Return up to 8 items.\n\n" +
    (assetName ? "Equipment: " + assetName + "\n" : "") +
    "Title: " + (t.title || "") + "\nWork: " + (t.description || "") });
  const schema = { type: "object", properties: { parts: { type: "array", items: { type: "object", properties: { item: { type: "string" }, quantity: { type: "number" }, unit: { type: "string" } }, required: ["item", "quantity", "unit"], additionalProperties: false } } }, required: ["parts"], additionalProperties: false };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 700, messages: [{ role: "user", content }], output_config: { format: { type: "json_schema", schema } } }),
    });
    if (!res.ok) return json({ ok: false, error: "The assistant couldn't respond." }, 502);
    const data = await res.json();
    const block = (data.content || []).find((b) => b.type === "text");
    if (!block) return json({ ok: false, error: "No suggestion." }, 502);
    let out;
    try { out = JSON.parse(block.text); } catch { return json({ ok: false, error: "Couldn't read the suggestion." }, 502); }
    const parts = (out.parts || []).map((p) => ({ item: (p.item || "").toString().trim(), quantity: Number(p.quantity) || 1, unit: (p.unit || "each").toString().trim() })).filter((p) => p.item);
    return json({ ok: true, parts });
  } catch {
    return json({ ok: false, error: "Couldn't reach the assistant." }, 502);
  }
}

// AI: read a supplier invoice / receipt photo and log each purchased material as
// a part on the ticket (item, quantity, line total), with the invoice image
// attached for verification. This is what makes job costing accurate: the real
// money spent at the paint shop lands straight on the job.
async function scanInvoiceParts(request, env, session) {
  if (!session || session.role !== "master") return json({ ok: false, error: "Master only." }, 403);
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: "The assistant is not connected." }, 503);
  if (!sbReady(env)) return json({ ok: false, error: "Not connected." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "Bad request." }, 400); }
  const ticketId = (body.id || "").toString().trim();
  const base64 = (body.base64 || "").toString();
  if (!ticketId) return json({ ok: false, error: "No ticket." }, 400);
  if (!base64) return json({ ok: false, error: "No invoice photo." }, 400);
  const ct = (body.contentType || "image/jpeg").toString();
  const isPdf = ct.indexOf("pdf") >= 0;
  // Keep the invoice itself for human verification (best-effort).
  let invoiceUrl = null;
  try { invoiceUrl = await uploadToStorage(env, `tickets/${ticketId}/invoices/inv-${Date.now()}.${isPdf ? "pdf" : "jpg"}`, base64, isPdf ? "application/pdf" : ct); } catch { /* items still useful */ }
  const source = { type: "base64", media_type: isPdf ? "application/pdf" : ct, data: base64 };
  const block = isPdf ? { type: "document", source } : { type: "image", source };
  const prompt =
    "You are reading a supplier invoice or store receipt for materials bought for a job (for example a paint store receipt). List every purchased line item. For each:\n" +
    "- item: a short clear name (e.g. 'Interior paint, eggshell white' or 'Paint roller 9in' or 'Painter\\'s tape').\n" +
    "- quantity: a number (1 if not shown).\n" +
    "- unit: a short unit like 'gal', 'ea', 'box', 'ft', or empty if none.\n" +
    "- cost: the LINE TOTAL in dollars as a number (quantity times unit price), not the unit price.\n" +
    "Skip tax, subtotal, grand total, store name, discounts, and payment lines. Only actual materials or products purchased. Read only what is printed; do not invent items or prices.";
  const schema = { type: "object", properties: { items: { type: "array", items: { type: "object", properties: { item: { type: "string" }, quantity: { type: "number" }, unit: { type: "string" }, cost: { type: "number" } }, required: ["item", "quantity", "unit", "cost"], additionalProperties: false } } }, required: ["items"], additionalProperties: false };
  let items = [];
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-opus-4-8", max_tokens: 1500, messages: [{ role: "user", content: [block, { type: "text", text: prompt }] }], output_config: { format: { type: "json_schema", schema } } }),
    });
    if (!res.ok) return json({ ok: false, error: "The assistant couldn't read that invoice." }, 502);
    const data = await res.json();
    const tb = (data.content || []).find((b) => b.type === "text");
    if (!tb) return json({ ok: false, error: "The assistant couldn't read that invoice." }, 502);
    let out; try { out = JSON.parse(tb.text); } catch { return json({ ok: false, error: "Couldn't read the invoice." }, 502); }
    items = Array.isArray(out.items) ? out.items : [];
  } catch { return json({ ok: false, error: "Couldn't reach the assistant." }, 502); }
  items = items.slice(0, 60);
  let added = 0;
  const photoArr = invoiceUrl ? [invoiceUrl] : [];
  for (const it of items) {
    const item = (it.item || "").toString().trim().slice(0, 160);
    if (!item) continue;
    const q = Number(it.quantity); const quantity = isNaN(q) || q <= 0 ? 1 : q;
    const unit = (it.unit || "").toString().trim().slice(0, 24) || null;
    const cn = Number(it.cost); const est_cost = isNaN(cn) ? null : cn;
    const row = { ticket_id: ticketId, item, quantity, unit, est_cost, source: "invoice", status: "Received" };
    let r2 = await sbInsert(env, "ticket_parts", photoArr.length ? Object.assign({ photo_urls: photoArr }, row) : row);
    if (!r2.ok && photoArr.length) r2 = await sbInsert(env, "ticket_parts", row);
    if (r2.ok) added++;
  }
  if (!added) return json({ ok: false, error: items.length ? "Couldn't save the items. Run supabase/ticket_parts.sql once." : "No line items found on that invoice." }, items.length ? 502 : 200);
  return json({ ok: true, added, invoiceUrl: invoiceUrl || "" });
}

// Rollup across all tickets for the "Parts to buy" screen.
async function listAllParts(url, env, session) {
  if (!session || session.role !== "master") return json({ ok: false, error: "Master only." }, 403);
  if (!sbReady(env)) return json({ ok: true, parts: [] });
  // Join to tickets manually. The embedded ticket:tickets(...) form depends on
  // PostgREST's schema cache knowing the FK, which is often stale right after
  // the table is created — and that failure used to masquerade as "table not
  // set up." A plain select only fails if the table truly doesn't exist.
  const rows = await sbSelect(env, "ticket_parts?select=id,item,quantity,unit,status,est_cost,source,ticket_id&order=created_at.desc");
  if (rows === null) return noStore({ ok: true, parts: [], missing: true });
  const ids = Array.from(new Set((rows || []).map((r) => r.ticket_id).filter(Boolean)));
  const tmap = {};
  if (ids.length) {
    const trows = await sbSelect(env, `tickets?id=in.(${ids.join(",")})&select=id,ref,title,status,client:clients(name)`);
    (trows || []).forEach((t) => { tmap[t.id] = t; });
  }
  return noStore({
    ok: true,
    parts: (rows || []).map((r) => {
      const t = tmap[r.ticket_id] || {};
      return {
        id: r.id, item: r.item || "", quantity: r.quantity, unit: r.unit || "", status: r.status || "Needed", estCost: r.est_cost, source: r.source || "",
        ticketId: t.id || "", ref: t.ref || "", ticketTitle: t.title || "",
        ticketStatus: t.status || "", client: (t.client && t.client.name) || "",
      };
    }),
  });
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
  const title = (body.title || "").toString().trim();
  const out = await suggestTicketFields({ note, asset, pics, urlPics, title, env });
  if (!out) return json({ ok: false, error: "The assistant couldn't respond." }, 502);
  return json({ ok: true, description: out.description || "", category: out.category || "", title: out.title || "" });
}

// Look at a ticket (its description, title, and photos) against the equipment
// on file for that client, and recommend which asset it should be tagged with.
// Returns { assetId, assetName } for a match, or { newAssetName } when the
// photos clearly show equipment that isn't on file yet, or nothing.
async function suggestTicketAsset(request, env, session) {
  if (!can(session, "tickets", "edit")) return deny("tickets");
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: "The assistant is not connected." }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request." }, 400);
  }
  const id = (body.id || "").toString().trim();
  if (!id) return json({ ok: false, error: "No ticket id." }, 400);
  const trows = await sbSelect(env, `tickets?id=eq.${id}&select=title,description,photo_url,photo_urls,client_id`);
  const t = trows && trows[0];
  if (!t) return json({ ok: false, error: "Ticket not found." }, 404);
  if (!t.client_id) return json({ ok: true, assetId: "", reason: "This ticket has no client yet, so there is nothing to match against." });

  const assets = await sbSelect(env, `assets?client_id=eq.${t.client_id}&select=id,name,nickname,make,model,equipment_type:equipment_types(name),location:locations(name)&order=name`);
  const list = (assets || []).map((a) => ({
    id: a.id,
    label: [a.nickname || a.name, a.equipment_type && a.equipment_type.name, [a.make, a.model].filter(Boolean).join(" "), a.location && a.location.name].filter(Boolean).join(" · "),
  }));

  const urlPics = []
    .concat(Array.isArray(t.photo_urls) ? t.photo_urls : [])
    .concat(t.photo_url ? [t.photo_url] : [])
    .filter(Boolean)
    .slice(0, 4);

  const desc = [t.title, t.description].filter(Boolean).join(". ").trim();
  if (!desc && !urlPics.length) return json({ ok: true, assetId: "", reason: "Add a description or a photo first." });

  const prompt =
    "You are Ringwood's facilities assistant. A work ticket needs to be tagged to the piece of equipment it concerns. " +
    "Below is the ticket and the equipment already on file for this client. Decide which single asset, if any, this ticket is about, using the description and any photos.\n\n" +
    "Rules:\n" +
    "- If one asset clearly matches, return its exact id from the list.\n" +
    "- If the photos or description clearly point to a piece of equipment that is NOT in the list, leave assetId empty and suggest a short newAssetName (Title Case, e.g. 'Lobby TV', 'Walk-in Freezer').\n" +
    "- If you are not reasonably sure, leave both empty.\n" +
    "- reason: one short sentence on why, in plain words.\n\n" +
    "Ticket: \"" + (desc || "(no text, see photos)") + "\"\n\n" +
    "Equipment on file:\n" +
    (list.length ? list.map((a) => "- id " + a.id + ": " + a.label).join("\n") : "(none on file)") +
    "\n\nReturn only equipment that fits. Do not invent an id that is not in the list.";

  const content = [];
  for (const u of urlPics) {
    const img = await fetchImageBase64(u);
    if (img) content.push({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.base64 } });
  }
  content.push({ type: "text", text: prompt });

  const schema = {
    type: "object",
    properties: { assetId: { type: "string" }, newAssetName: { type: "string" }, reason: { type: "string" } },
    required: ["assetId", "newAssetName", "reason"],
    additionalProperties: false,
  };

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 400,
        messages: [{ role: "user", content }],
        output_config: { format: { type: "json_schema", schema } },
      }),
    });
    if (!res.ok) return json({ ok: false, error: "The assistant couldn't respond." }, 502);
    const data = await res.json();
    const block = (data.content || []).find((b) => b.type === "text");
    if (!block) return json({ ok: false, error: "The assistant couldn't respond." }, 502);
    let out;
    try {
      out = JSON.parse(block.text);
    } catch {
      return json({ ok: false, error: "The assistant couldn't respond." }, 502);
    }
    // Only trust an id the assistant was actually given.
    const hit = list.find((a) => a.id === (out.assetId || "").trim());
    const newName = (out.newAssetName || "").toString().trim().slice(0, 80);
    return json({
      ok: true,
      assetId: hit ? hit.id : "",
      assetName: hit ? hit.label : "",
      newAssetName: hit ? "" : newName,
      reason: (out.reason || "").toString().trim().slice(0, 200),
    });
  } catch {
    return json({ ok: false, error: "Couldn't reach the assistant." }, 502);
  }
}

// The shared AI pass behind "Rewrite with AI" and the automatic enrichment on
// submit. Reads the note, the named/linked equipment, and any photos, and
// returns a clean { title, description, category }. Returns null on failure.
async function suggestTicketFields({ note, asset, pics, urlPics, title, env }) {
  note = (note || "").toString().trim();
  asset = (asset || "").toString().trim();
  title = (title || "").toString().trim();
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
    (title ? 'A title is already written: "' + title + '". If it already names the actual thing and the problem, KEEP it and only fix spelling, grammar, and casing. Do not replace a specific title with a different or more generic one.\n' : "") +
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

# Ringwood — setup & "it's not working" guide

Three systems work together:

- **GitHub** holds the code. Pushing to `main` triggers a deploy.
- **Cloudflare Workers** runs the app (one Worker, `ringwood-site`).
- **Supabase** is the database (Postgres) + photo storage.

If something isn't working, it's almost always one of three things:
1. The database tables/accounts weren't created (run the SQL below).
2. The `SUPABASE_SERVICE_KEY` secret isn't set in Cloudflare.
3. The two were done out of order, or a deploy hasn't finished.

The fastest check is the diagnostics URL — see "Step 4".

---

## Step 1 — Create everything in Supabase (one paste)

1. Go to <https://supabase.com> → open your project (`zgxayeuipupdeydbpcul`).
2. Left sidebar → **SQL Editor** → **New query**.
3. Open `supabase/setup_all.sql` from this repo, copy the **whole file**, paste it in, and click **Run**.
   - This creates every table, the login accounts, the magic-link table, and the sample data, in the right order.
   - It's safe to run more than once (it skips what already exists).
   - You should see "Success." If you see an error, copy it and send it to me.

That single file replaces running the individual files. (The separate files are still there if you prefer.)

---

## Step 2 — Get the Supabase keys

In Supabase: **Settings (gear) → API**. You need two values:

- **Project URL** — `https://zgxayeuipupdeydbpcul.supabase.co` (already set in the code, nothing to do).
- **`service_role` key** — the long secret under "Project API keys". Click reveal, copy it.
  - Use the **service_role** key, NOT the `anon` key. The Worker uses it server-side; it never reaches the browser.

---

## Step 3 — Set the secret in Cloudflare

1. Cloudflare dashboard → **Workers & Pages** → open **ringwood-site**.
2. **Settings → Variables and Secrets**.
3. Add these as **Secrets** (type "Secret", not plain text — plain text gets wiped on every deploy):
   - `SUPABASE_SERVICE_KEY` = the service_role key from Step 2.
   - `ANTHROPIC_API_KEY` = your Anthropic key (for AI titles, nameplate reading, Suggest with AI).
4. Save. You do **not** need `SUPABASE_ANON_KEY` anymore (login no longer uses it).
   `SUPABASE_URL` and `LOGIN_REQUIRED` already live in `wrangler.jsonc`, so leave those alone.

> After adding a secret, redeploy so it takes effect: push any change, or in Cloudflare hit "Deploy" / re-run the latest build.

---

## Step 4 — Verify it's wired

Open this in a browser:

```
https://app.ringwood.ai/api/diag
```

You want to see:

```json
{"hasUrl":true,"hasKey":true,"hasAnon":false,
 "counts":{"clients":3,"types":6,"locations":15,"serviceTypes":6},
 "tickets":{"plain":16,"embed":16,"byStatus":{...}}}
```

What it means:
- `hasUrl:true` — SUPABASE_URL is set (it is, via wrangler).
- `hasKey:true` — **SUPABASE_SERVICE_KEY secret is set.** If this is `false`, redo Step 3.
- `counts` with non-zero numbers — the schema ran. If counts are 0 or missing, redo Step 1.
- `hasAnon:false` — fine, not needed.

If `hasKey` is false or `/api/diag` 404s, the secret/deploy is the problem.

---

## Step 5 — Sign in

Go to <https://app.ringwood.ai/login>:

- **Master (sees all clients):** `tbone39@gmail.com` / `Ringwood-Master-7421`
- **Sample client (Moment only):** `moment@ringwood.ai` / `Moment-2026`

Change the passwords from **Account** (footer link in the hub) after first sign-in.

> Note on enforcement: login only becomes mandatory once at least one account
> exists. So before Step 1 runs, the app is open; after, it's locked to logins.

---

## Send to printer (email-to-print)

The hub has a **Send to printer** button: pick any file (PDF, image, document)
and the app emails it straight to your printer's print-by-email address. No
software runs on any local computer — a website can't reach a printer on your
network directly, so this goes through email instead.

To set it up:

1. **Connect Gmail** (one-time): Admin panel → *Gmail connection* → **Connect
   Gmail**. The app sends the print email through that mailbox. (Needs
   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` Worker secrets — the same
   connection used for estimate/RFQ drafts.)
2. **Find your printer's email address.** Most modern printers have one — HP
   ePrint, Epson Email Print, etc. Check the printer's control panel or its web
   page, or enable it in the maker's app.
3. On the **Send to printer** page, paste that address into *Printer address*
   and **Save** (master only). After that, anyone signed in can print to it.

Files are capped at about 10 MB. The printer address lives in the
`app_settings` table (created by `supabase/setup_all.sql`, or run
`supabase/print_settings.sql` on its own).

---

## GitHub / deploys

- The repo auto-deploys: a push to `main` builds and ships the Worker.
- Work happens on the branch `claude/ringwood-ticket-site-link-5ANci`, then merges to `main`.
- A deploy takes ~1–2 minutes after the push. Check progress in Cloudflare →
  ringwood-site → **Deployments** (or **Builds**).
- If a deploy fails, open the build log there; the error is usually a typo in
  `wrangler.jsonc` or a missing secret.

---

## Still stuck? Send me:

1. What you see at `https://app.ringwood.ai/api/diag` (copy the whole line).
2. The exact error text from the Supabase SQL run, if any.
3. What happens when you try to log in (the message under the button).

That tells me exactly which of the three systems to fix.

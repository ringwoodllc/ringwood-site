# CLAUDE.md — ringwood-site

Standing context for every Claude Code session in this repo. Read this before making changes.

## What this repo is
The Ringwood Holdings LLC marketing website. A single static HTML page. The live file is `public/index.html`. There is no build step and no framework. Edit the HTML directly.

## Where it lives (the stack)
- Domain ringwood.ai is registered at NameSilo (registrar). Note: NameSilo and the host HostSilo are often mis-transcribed as "Zillow / Hostzillo." The correct names are NameSilo and HostSilo.
- DNS and nameservers are on Cloudflare, and Cloudflare serves the site.
- This repo (ringwoodllc/ringwood-site) holds the source. Cloudflare deploys from it.
- Do not change DNS, nameservers, or hosting from a code session. Those are managed by hand in Cloudflare and NameSilo.

## How to make changes
- Work on a branch and open a pull request. Do not treat a change as live until the PR is merged and Cloudflare redeploys.
- Keep the page a single self-contained HTML file. Inline the CSS and any JS. Do not add a framework, a bundler, or a package.json unless explicitly asked.
- Preserve the existing structure and styling unless the task says otherwise. Small, surgical edits.

## Brand and copy rules (apply to anything user-facing)
Ringwood is a workplace project management and facilities company. The voice is a seasoned, credentialed builder who tells the truth.
- Plain-spoken, grounded, credible. Vary sentence length.
- No em dashes or en dashes. Use periods, commas, colons, and parentheses instead.
- Avoid AI tells: no "seamless," "elevate," "robust," and no rule-of-three triads.
- Coordinator posture, not general contractor. Never claim Ringwood self-performs work or sells construction or engineering as a service. Say Ringwood handles everything from the smallest fix to a full buildout, partners with the right people, and stands behind the work. Design, construction, and engineering are the credibility Ringwood brings, not a service menu.
- Sell convenience, reliability, and accountability. Not cheapest, not fastest.

## Design tokens (match the existing page)
- Background: warm paper, #f4f1ea
- Ink and primary: evergreen, #1f3d2b
- Fonts: Fraunces for headings, Hanken Grotesk for body
- Logo: concentric tree-ring mark. The brand story is growth rings (a permanent, accumulating record) and a closed loop (one accountable party).

## Known elements
- "Submit a ticket" button links to the Ringwood ticket app. Target is tickets.ringwood.ai. If that custom domain is not yet pointed at the Worker, use the ringwood-ticket-app.e41group.workers.dev address instead.

## What not to do
- Do not commit secrets, tokens, or API keys. Ever.
- Do not wire this static site to Airtable or any backend. It does not need one.
- Do not claim services Ringwood does not offer (see coordinator posture above).

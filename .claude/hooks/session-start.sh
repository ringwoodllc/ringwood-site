#!/bin/bash
# SessionStart hook for Claude Code on the web.
# This repo is a single-file Cloudflare Worker (src/index.js) with no npm
# dependencies of its own, plus a Capacitor mobile shell under mobile/ which
# IS an npm project. We install the mobile deps so Capacitor tooling works in
# a session, and do a fast syntax check of the Worker so obvious breakage is
# caught up front. Safe to run repeatedly.
set -euo pipefail

# Only do work in the remote (web) environment; locally the user manages this.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# Install the mobile (Capacitor) dependencies. npm install (not ci) so the
# cached container layer is reused on later runs.
if [ -f mobile/package.json ]; then
  echo "Installing mobile/ dependencies…"
  (cd mobile && npm install --no-audit --no-fund)
fi

# Fast sanity check of the Worker. Non-fatal: a syntax error in committed code
# should not block the session from starting.
if [ -f src/index.js ]; then
  if node --check src/index.js; then
    echo "Worker syntax OK (src/index.js)."
  else
    echo "WARNING: src/index.js failed node --check." >&2
  fi
fi

# Notes for Claude Code: exam-checkin-kit

This is the professor's exam check-in / check-out kit for UGBA 135. It is a Google Apps Script web app bound to the course roster Google Sheet. It is already installed and deployed. Read `HANDOFF.md` first, then `README.md`.

## Rules
- **The live Apps Script project is the source of truth.** Never assume the files here match what's deployed. Before changing code, ask the user to paste the current live `Code.gs` settings block, or have them run `clasp pull` (see `SYNC-WITH-GOOGLE.md`).
- **Don't change the professor's logic** in `apps-script/Code.gs` / `apps-script/CheckIn.html` unless the user asks. Settings changes go in the `CONFIG` block at the top of `Code.gs`. Typical settings to change: `EXAM_NAME`, `EXTRA_STAFF_EMAILS`, `ACCEPT_ANY_SHEET_CODE`, `ROSTER_TAB` and `ID_HEADER`.
- The HTML file must stay named `CheckIn` (`doGet` loads `createHtmlOutputFromFile('CheckIn')`).
- Any code change only reaches proctors after **Deploy → Manage deployments → ✏️ → New version → Deploy**. Always remind the user.
- You can't sign in to Google from a cloud session. Google-side steps (paste, deploy, share, `clasp login`) are done by the user. Give click-by-click steps; the user isn't a programmer.
- Commit on a feature branch with clear messages and push. Open a PR only when asked. Never commit `.clasprc.json` or any token.

## Quick checks
```bash
# Syntax-check the server code and the page script
node --check <(cat apps-script/Code.gs)
sed -n '/<script>/,/<\/script>/p' apps-script/CheckIn.html | sed '1d;$d' > /tmp/page.js && node --check /tmp/page.js
```

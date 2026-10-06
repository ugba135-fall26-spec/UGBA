# Keeping this repo and the live Google Sheet in sync

The Apps Script project is **bound to the roster spreadsheet** (Extensions → Apps Script), and that copy is what actually runs.
- **The live Apps Script project is the source of truth.**
- This folder is the backup and version history.

## Option A: copy and paste (no setup)
1. Edit the files here, or in Apps Script.
2. Paste the same content into both places, so the repo matches what's live.
3. In Apps Script: **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. This keeps the same `/exec` URL.
4. Commit the change here.

## Option B: `clasp` (Google's command-line tool for Apps Script)
This links this folder to the **same** script project, so you can pull and push.

> Run this on your own Mac. `clasp login` opens a browser to sign in with the berkeley.edu account that owns the script. A cloud Claude Code session can't do that sign-in.

```bash
npm install -g @google/clasp
clasp login                                     # sign in with your berkeley.edu account
```
Also turn on the Apps Script API once, at https://script.google.com/home/usersettings.

```bash
cd exam-checkin-kit
# Script ID: Apps Script → ⚙ Project Settings → IDs
echo '{"scriptId":"PASTE_SCRIPT_ID_HERE","rootDir":"apps-script"}' > .clasp.json

clasp pull        # FIRST pull the live code (captures EXAM_NAME, EXTRA_STAFF_EMAILS, the real manifest)
git add -A && git commit -m "Sync from live Apps Script"
```

After editing files in `apps-script/`:
```bash
clasp push                                      # upload the code (it does not change the /exec page yet)
clasp deployments                               # find the deployment ID of the /exec URL
clasp deploy -i <DEPLOYMENT_ID> -d "describe change"   # same URL, new version
git add -A && git commit -m "describe change" && git push
```

Notes:
- `clasp push` overwrites the live files. **Always `clasp pull` first** if anyone may have edited in the browser.
- `.clasp.json` contains only the Script ID (not a password). Keep the repo private anyway.
- Never commit `~/.clasprc.json`. It holds your login token.

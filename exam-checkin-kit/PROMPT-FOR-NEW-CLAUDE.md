# Prompt to paste into a new Claude Code session

Copy everything inside the box below into the new Claude Code session. If the repo isn't already open there, first attach or upload `exam-checkin-kit.zip`.

---

```
I'm continuing work on our UGBA 135 exam check-in / check-out system. It's the professor's
Google Apps Script kit, already installed in our roster Google Sheet and deployed as a web app.

The files are in the folder `exam-checkin-kit/` (from the repo ugba135-fall26-spec/ugba,
branch claude/practical-noether-dppge2, or from the zip I attached):
  apps-script/Code.gs, apps-script/CheckIn.html, apps-script/appsscript.json,
  README.md (professor's instructions), HANDOFF.md (our current setup + fixes already found),
  SYNC-WITH-GOOGLE.md (how to link to the live script with clasp), CLAUDE.md (rules for you).

Please:
1. Read CLAUDE.md, HANDOFF.md, README.md and SYNC-WITH-GOOGLE.md before doing anything.
2. Put the `exam-checkin-kit/` folder in this repository (if it isn't there already),
   keeping the files exactly as they are. Don't change the professor's code.
3. Fill in the TODO table in HANDOFF.md with these values:
     Spreadsheet URL: <PASTE>
     Script ID:       <PASTE>   (Apps Script > Project Settings)
     Web app URL:     <PASTE>   (Deploy > Manage deployments)
     EXAM_NAME:       <PASTE>
     EXTRA_STAFF_EMAILS: <PASTE>
   Also update Code.gs's CONFIG block so EXAM_NAME and EXTRA_STAFF_EMAILS match the live script.
4. Create exam-checkin-kit/.clasp.json with {"scriptId":"<Script ID>","rootDir":"apps-script"}
   so the folder is linked to the SAME Apps Script project. Then give me the exact clasp commands
   to run on my Mac (clasp pull first, never push before pulling).
5. Syntax-check the files (see CLAUDE.md), then commit with a clear message on a new branch
   and push to GitHub. Don't open a pull request unless I ask.
6. Explain any step I must do in Google (deploy, share, clasp login) click by click; I'm not a programmer.
```

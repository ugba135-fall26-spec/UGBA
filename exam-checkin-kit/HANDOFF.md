# Handoff: UGBA 135 exam check-in / check-out

This folder holds the professor's exam check-in kit, plus notes on how it is set up for **UGBA 135 (Personal Finance), Fall 2026**.

**Workflow:**
- **Check-in:** a proctor scans the student's Berkeley ID card, then the QR code on the answer sheet. The sheet number is written on the student's roster row.
- **Check-out:** the proctor scans the answer sheet's QR code. That student's **Check-out Time** is filled in.

## 1. What's already done (as of Oct 2026)

| Item | Status |
|---|---|
| Roster Google Sheet | Exists. Roster is on the first tab, **`Sheet1`** |
| Student-ID column | **`SID`**, column **B** |
| Name column | **`Name`** |
| `Code.gs` + `CheckIn.html` pasted into Extensions → Apps Script | Done (bound to the sheet) |
| *Exam Check-in → Set up / check roster* | Done. Added the 8 result columns and the **Check-in Log** and **Not on Roster** tabs |
| Web app deployed | Done. *Execute as: Me*, *Who has access: Anyone within UC Berkeley* |
| Test roster | 1 student: Santiago Labarca, SID 41929998 (replace with the full roster before the exam) |
| USB scanner | Working (types like a keyboard) |

## 2. Fill these in (the person setting up fills these, not Claude)

| Value | Where to find it | Value |
|---|---|---|
| Spreadsheet URL | The browser address bar of the roster sheet | `TODO` |
| Script ID | Apps Script → ⚙ **Project Settings** → *IDs* → Script ID | `TODO` |
| Deployment ID | Apps Script → **Deploy → Manage deployments** → active deployment | `TODO` |
| Web app URL (`/exec`) | Same place → *Web app URL* → Copy | `TODO` |
| `EXAM_NAME` in live Code.gs | Top of Code.gs in Apps Script | `TODO` (default `Midterm`) |
| `EXTRA_STAFF_EMAILS` in live Code.gs | Top of Code.gs in Apps Script | `TODO` |
| Proctors shared as **Editor** on the sheet | Sheet → Share | `TODO` |

Two `/exec` URLs have been used so far. The second was read off a screenshot, so letters such as `l`/`I` may be wrong. Confirm the real one in *Manage deployments*.
- `https://script.google.com/a/macros/berkeley.edu/s/AKfycbwamC2Le51Gvhe_b1m6PZUNZq11cwTc1nCCa_m4hjGvb29r-4aF1pacYFM2mu7PxTN0rg/exec` (first deployment)
- `https://script.google.com/a/macros/berkeley.edu/s/AKfycbyyTjptLCj7lnUAm-MJikgjeZeBrZ9cc2xlaIAYos1qs9vQIzyLRgvewY3OB_ksTkOZzg/exec` (newer, unverified spelling)

Station links: append `?station=1`, `?station=2`, … to the URL. For a check-out-only laptop, append `?station=3&mode=out`.

## 3. Files

| File | What it is |
|---|---|
| `apps-script/Code.gs` | Server code: roster lookup, check-in, check-out, undo, log. Settings are at the top |
| `apps-script/CheckIn.html` | The web page proctors use (file name **must** be `CheckIn`) |
| `apps-script/appsscript.json` | Apps Script manifest. Placeholder; replace it with the live one via `clasp pull` |
| `README.md` | The professor's full instructions (install, scanners, dry run, troubleshooting) |
| `SYNC-WITH-GOOGLE.md` | How to keep this repo and the live Apps Script project in sync |
| `CLAUDE.md` | Rules for Claude Code sessions working on this folder |
| `PROMPT-FOR-NEW-CLAUDE.md` | Copy-paste prompt to start a new Claude Code session |

Not in this repo yet: the professor's `stamp_answer_sheets.py` (it prints the AS-0001… QR codes on the answer sheets) and `Proctor station card.pdf`. Add them from the professor's folder if needed.

## 4. Problems we already hit, and the fixes

| Symptom | Cause | Fix |
|---|---|---|
| `/exec` page completely blank | The deployment was a snapshot taken before CheckIn.html was saved | Save the file, then **Deploy → Manage deployments → ✏️ → Version: New version → Deploy** (same URL) |
| Page shows JavaScript as plain text | CheckIn.html was copied from TextEdit's *rendered* view, so the tags were lost | Open the file as plain text (`.txt`, or drag it into Chrome), copy everything from `<!DOCTYPE html>` to `</html>`, paste, save, then deploy a new version |
| "This account can't use check-in" | Account isn't an Editor on the sheet | Share the sheet with that person as **Editor** (by name, not "anyone with link"), or add them to `EXTRA_STAFF_EMAILS` and deploy a new version |
| "Sorry, unable to open the file" | Chrome is signed in to several Google accounts | Use Incognito, or a Chrome profile signed in only to berkeley.edu |
| Scans do nothing | No station chosen yet, or the window isn't focused | Click a **Station** button. If a red "Scanning paused" screen appears, click it |

## 5. Before exam day
- [ ] Paste the full roster into `Sheet1` (headers in row 1, `SID` + `Name`) and run *Set up / check roster*. Check the student count.
- [ ] QR codes on the answer sheets read as `AS-0001`… in TextEdit. If your own QR codes use a different format, set `ACCEPT_ANY_SHEET_CODE: true`.
- [ ] Every proctor is an Editor and can open their station link.
- [ ] Do the README's section 6 dry run on every laptop, then *Exam Check-in → Clear ALL check-in data…* (type `CLEAR`).

## 6. Optional: a 0/1 "Checked Out" column
The kit records a **Check-out Time** rather than 1/0. For a 0/1 flag, put this in row 1 of an empty column on the far right of the roster. Change `B` to the SID column and `M` to the Check-out Time column:
```
={"Checked Out (1/0)"; ARRAYFORMULA(IF(B2:B="","",IF(M2:M="",0,1)))}
```
The script ignores this column.

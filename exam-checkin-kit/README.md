# Exam check-in / check-out kit

| File | What it is |
|---|---|
| `stamp_answer_sheets.py` | Stamps a numbered QR code (AS-0001, AS-0002, ...) on every copy of the answer-sheet PDF |
| `apps-script/Code.gs`, `apps-script/CheckIn.html` | The check-in / check-out web page, which lives inside your roster Google Sheet |
| `Proctor station card.pdf` | Print double-sided, one per station: check-in on the front, check-out on the back |

---

## 1. Roster sheet

* One Google Sheet; the roster on the **first tab**, headings in row 1, one row per student.
* It needs a **student-ID column** (headed `SID`, `Student ID`, or `SIS User ID`) and a **name** column
  (`Name`, or `First Name` + `Last Name`). Other columns are fine and are left alone.
  A Gradescope roster export, a bCourses gradebook export and a CalCentral class roster all work
  (File > Import > Upload).
* Share the sheet as **Editor** with every proctor who will run a laptop. Only editors can open the check-in page.

## 2. Install the check-in page (about 10 minutes)

1. In the sheet: **Extensions > Apps Script**.
2. Select everything in `Code.gs`, delete it, and paste in all of `apps-script/Code.gs`.
   Optionally change `EXAM_NAME` in the SETTINGS block at the top.
3. Click **+** next to *Files* > **HTML**, name it `CheckIn` (exactly), and replace its contents with
   all of `apps-script/CheckIn.html`. Press **Cmd+S**.
4. Go back to the spreadsheet tab and **reload** it. A new menu **Exam Check-in** appears.
   Choose **Exam Check-in > Set up / check roster** and approve the permission prompts. (If you see
   "Google hasn't verified this app", click *Advanced > Go to ... (unsafe)*. It's your own script.)
   The summary shows how many students it found and which columns it is using. It also adds eight columns
   (Answer Sheet #, Check-in Time, Station, ID Method, Checked In By, Replaced Sheet(s), Check-out Time,
   Checked Out By) and two tabs (Check-in Log, Not on Roster).
5. In Apps Script: **Deploy > New deployment**, then click the gear and choose **Web app**.
   *Execute as:* **Me**. *Who has access:* **Anyone within** your university. Click **Deploy** and
   copy the **Web app URL** (it ends in `/exec`).
6. Station links: add `?station=1`, `?station=2`, `?station=3` to the end of the URL. Each link preselects that station.
   Add `&mode=out` for a laptop that only does check-out (e.g. `?station=3&mode=out`).
7. Test it: open the link, choose a station, type a real SID from the roster and press Enter, then type `1` and
   press Enter. That student's row now shows AS-0001. Afterwards use **Exam Check-in > Clear ALL check-in data...**
   (type CLEAR).

**Updating code you already installed** (for example, to add check-out): paste the new `Code.gs` and `CheckIn.html`
over the old ones, re-enter any settings you had changed (such as `EXAM_NAME`), press **Cmd+S**, then
**Deploy > Manage deployments > (pencil) > Version: New version > Deploy**. That keeps the same URL.
The two check-out columns are added automatically the next time the page opens. Existing check-ins are kept.

**On every laptop, use Chrome signed in to only one Google account (the proctor's university account).**
Apps Script pages often fail when a browser is signed in to several Google accounts.
Use a separate Chrome profile if needed.

## 3. Number the answer sheets

Use the final answer-sheet PDF, the same file you use as the Gradescope template. Leave the top-right corner
(about 1.2 in x 1.3 in) empty, or pick another corner with `--corner`. In Terminal:

```bash
cd "/path/to/this/folder"
python3 stamp_answer_sheets.py "Midterm answer sheet.pdf" --copies 1 --preview        # check placement
python3 stamp_answer_sheets.py "Midterm answer sheet.pdf" --copies 330                 # enrollment + ~10%
python3 stamp_answer_sheets.py "Midterm answer sheet.pdf" --copies 6 --start 9001      # practice sheets
```

* It writes one PDF with every copy, numbered in order. It warns you if the stamp would cover anything.
* `--duplex`: the sheet has an odd number of pages and will be printed double-sided.
  `--first-page-only`: stamp only page 1. `--position top-left` etc. moves the stamp.
* **Gradescope bubble sheet:** it has alignment markers in all four corners, so stamp the blank top edge instead
  (this is how the 1000-sheet file in this folder was made):
  `python3 stamp_answer_sheets.py "gradescope bubble template 1 page.pdf" --copies 1000 --position top-center --label right --size 0.4 --margin 0.17`
  Print it **single-sided at actual size (100%)**. With double-sided printing, two students' sheets would end up on one piece of paper.
* Needs PyMuPDF and reportlab (included with Anaconda; otherwise `pip install pymupdf reportlab`).
* Print one test copy and scan its QR code before you send the job to the print shop.
  Tell the shop how many pages are in each set and to staple each set.
* If you change `--prefix` or `--digits`, set `SHEET_PREFIX` / `SHEET_DIGITS` in `Code.gs` to match.

## 4. Scanners

* Plug the scanner in (with a USB-C adapter if the laptop needs one). If the Mac's *Keyboard Setup Assistant* opens, close it.
  If macOS asks whether to allow the accessory to connect, click **Allow**.
* Open TextEdit and scan an ID card. The digits appear as if typed. **Check them against the SID in the roster.**
  The check-in page also accepts a card number that contains the SID plus extra digits. Scan a stamped QR code
  and you should see `AS-0001`.
* The page doesn't need the scanner to press Enter after each scan, but it's slightly faster if it does.
  Scan **"Add an Enter Key"** in the scanner's Quick Start Guide.
* If an ID card won't scan at all, its barcode type is probably turned off. Scan **"Set Factory Defaults"** in the
  Quick Start Guide. If that doesn't fix it, turn on Codabar / Code 39 / Interleaved 2 of 5 with Zebra's free
  123Scan utility or the full Product Reference Guide.

## 5. Check-out (end of the exam)

* Click **Check-out** in the page's top bar. The bar turns purple and the title says "check-out".
  The setting is remembered on that laptop until you switch back.
* Scan the QR code on each answer sheet as it is turned in. The student it was given to is checked out:
  **Check-out Time** and **Checked Out By** fill in on their row. Scanning the same sheet again changes nothing.
* Optional double check: scan the student's ID card first, then the sheet. If the sheet was given to someone else,
  the page says so and records nothing.
* A sheet that wasn't handed out at check-in: the page asks for the student's ID. If that student never checked in,
  it asks before recording the sheet for them (ID Method "At check-out", Check-in Time left blank).
* **Who's still in?** lists everyone who checked in but hasn't turned in a sheet.
* Works offline like check-in: scans are saved on the laptop and uploaded later. Mistakes can be undone.

## 6. Dry run (all three laptops, ideally in the exam room)

- [ ] Each laptop opens its station link, shows "Connected", and shows the right progress count.
- [ ] Card scan > name appears > QR scan > green + chime > the row fills in on the sheet.
- [ ] Typed SID, **Find by name**, a card that isn't on the roster (**Record anyway**), and scanning a used sheet (red).
- [ ] The same student at a second station (orange) and **Give a replacement sheet**.
- [ ] **Undo**.
- [ ] Turn Wi-Fi off, check in two students (amber "Saved on this laptop"), turn it back on, and watch them upload.
- [ ] Click another app, and the red "Scanning paused" screen appears.
- [ ] Switch to **Check-out**: scan two sheets (green), one again (orange), and an unused sheet (red, asks for an ID).
  Then **Who's still in?** and **Undo**.
- [ ] Then **Exam Check-in > Clear ALL check-in data...**

## 7. Troubleshooting

| Problem | Fix |
|---|---|
| "This account can't use check-in" | Share the sheet with that account as Editor, or add it to `EXTRA_STAFF_EMAILS`; reload |
| "Google did not tell the page who you are" | Sign out of other Google accounts, or use a separate Chrome profile |
| Every card says "not on the roster" | The barcode isn't the SID. Type SIDs, and check what a card scan produces in TextEdit |
| A scan went into another window | The check-in window must be in front. Click it and re-scan |
| "Setup problem: Could not find the student-ID column" | Put the column's exact heading in `ID_HEADER` in Code.gs |

## 8. After the exam

* Students with an **Answer Sheet #** but no **Check-out Time**: their sheet was never scanned at check-out.
  Make sure you have it.
* **Not on Roster** tab: students you recorded who weren't on the roster.
  **Check-in Log**: everything, including refusals and anything marked "Check later".
* Reconcile with Gradescope: download the assignment's grades/submissions CSV, paste it into a new tab, and flag
  students who checked in but have no submission, e.g. `=IF(COUNTIF(Gradescope!C:C, C2), "", "NO SUBMISSION")`.
* Unmatched Gradescope submission: read the AS-number on its page, find it in **Answer Sheet #**, and match it
  to that student.

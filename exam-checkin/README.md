# Exam Check-in / Check-out Scanner (Google Sheets)

This script tracks which student has which exam, using a USB barcode/QR scanner and a Google Sheet.

| Step | What you scan | What happens |
|---|---|---|
| **Check-in** | 1. Student's Berkeley ID card barcode<br>2. The exam's QR code | The exam number is written on that student's row. `Checked Out` = 0 |
| **Check-out** | The exam's QR code only | The student holding that exam gets `Checked Out` = 1 and a check-out time |

The script works out which step you're doing on its own:
- If the scan is a student ID on the roster, it's the start of a check-in.
- If the scan is an exam QR right after an ID, it finishes that check-in.
- If the scan is an exam QR with no ID before it, it's a check-out.

## One-time setup

1. Create a Google Sheet and rename the first tab to **`Roster`**.
2. Paste the roster with headers in row 1. You need at least **`SID`** and **`Name`**. `Student ID` also works for the SID column, and `First Name`/`Last Name` work instead of `Name`.
3. Open **Extensions → Apps Script**.
   - Replace the contents of `Code.gs` with [`Code.gs`](Code.gs).
   - Click **+ → HTML** and name the file exactly **`Sidebar`**. Paste in [`Sidebar.html`](Sidebar.html).
   - Save.
4. Reload the spreadsheet. A menu called **Exam Scanner** appears.
5. Click **Exam Scanner → Set up sheets** and approve the permission prompt the first time. This:
   - adds the columns `Exam #`, `Check-in Time`, `Checked Out`, `Check-out Time`;
   - sets `Checked Out` to 0 for every student;
   - creates a `Log` tab that records every scan.

## On exam day

1. Plug in the USB scanner. It types like a keyboard and presses Enter after each scan; most scanners do this by default.
2. Click **Exam Scanner → Open scanner**. A sidebar opens with a scan box that keeps its own focus. Leave it open.
3. **Check-in:** scan the ID card. The sidebar turns yellow and shows "Name — now scan the EXAM QR". Then scan the exam QR. It turns green and shows **CHECKED IN**.
4. **Check-out:** scan the exam QR. It turns green and shows **CHECKED OUT**.
5. Red means a problem. The message explains what went wrong, for example:
   - the exam is already assigned to someone else;
   - the student is already checked in;
   - the exam was never checked in.

To cancel a half-finished check-in, press **Esc** or click **Cancel**. If no exam QR is scanned within 90 seconds of an ID, the check-in is cancelled automatically.

The sidebar also shows live counts: checked in, checked out, exams still out, and students not yet checked in.

### Several tables at once
Each open sidebar keeps track of its own "waiting for exam" student. That means several laptops, each with a scanner, can work on the same sheet at the same time.

## Customizing (top of `Code.gs`)
- `HEADERS`: other column names the script will accept.
- `PENDING_TIMEOUT_SEC`: how long to wait for the exam QR after an ID scan.
- `EXAM_REGEX`: if your QR codes contain more than the exam number (e.g. `UGBA135-MIDTERM-042`), set this to pull out just the number, e.g. `/(\d+)$/`.
  - By default the script uses the QR text as-is.
  - If the QR text is a URL or a sentence, it uses the last group of digits instead.
- `MIN_SID_LENGTH_FOR_PARTIAL_MATCH`: Cal 1 Card barcodes can carry extra digits around the SID. A scan that *contains* a roster SID of at least this length counts as that student.

**Check what your ID barcode contains:** scan a card into any text box. If the result isn't the SID or doesn't contain it, contact the course staff to get the mapping.

## Fixing mistakes
Edit the `Roster` row directly. To undo a check-in, clear `Exam #` and `Check-in Time`. The `Log` tab keeps the full history of scans.

## Tests (optional, for developers)
```
node exam-checkin/test/run-tests.js
```
This runs `Code.gs` against an in-memory mock of Google Sheets.

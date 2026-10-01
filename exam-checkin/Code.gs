/**
 * Exam Check-in / Check-out Scanner
 *
 * Check-in : scan the student's Berkeley ID card barcode, then the exam's QR code.
 *            The exam number is written on the student's roster row.
 * Check-out: scan only the exam's QR code. The student holding that exam is
 *            marked Checked Out = 1.
 *
 * The scanner sidebar (Sidebar.html) remembers which student was just scanned,
 * so several laptops/scanners can work on the same sheet at the same time.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
var CONFIG = {
  ROSTER_SHEET: 'Roster',
  LOG_SHEET: 'Log',

  // Header names the script looks for (case-insensitive). The first alias is
  // the one used when a missing column has to be created.
  HEADERS: {
    SID: ['SID', 'Student ID', 'StudentID', 'Student Id', 'ID'],
    NAME: ['Name', 'Student Name', 'Full Name'],
    FIRST: ['First Name', 'First'],
    LAST: ['Last Name', 'Last'],
    EXAM: ['Exam #', 'Exam', 'Exam Number', 'Exam No'],
    CHECKIN_TIME: ['Check-in Time'],
    CHECKED_OUT: ['Checked Out'],
    CHECKOUT_TIME: ['Check-out Time']
  },

  // Seconds the sidebar waits for the exam QR after an ID scan.
  PENDING_TIMEOUT_SEC: 90,

  // Optional: regular expression whose first capture group is the exam number
  // inside the QR text, e.g. /EXAM[-_ ]?(\d+)/i. Leave null to use the QR text
  // as-is (or its last group of digits if it is a URL / sentence).
  EXAM_REGEX: null,

  // Card barcodes sometimes carry extra digits around the SID. A scan that
  // *contains* a roster SID counts as that student if the SID is at least
  // this many characters long.
  MIN_SID_LENGTH_FOR_PARTIAL_MATCH: 7
};

// ---------------------------------------------------------------------------
// Menu / UI
// ---------------------------------------------------------------------------
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Exam Scanner')
    .addItem('Open scanner', 'openScanner')
    .addItem('Set up sheets', 'setupSheets')
    .addToUi();
}

function openScanner() {
  setupSheets_(false);
  var html = HtmlService.createHtmlOutputFromFile('Sidebar').setTitle('Exam Scanner');
  SpreadsheetApp.getUi().showSidebar(html);
}

function setupSheets() {
  var msg = setupSheets_(true);
  SpreadsheetApp.getUi().alert(msg);
}

/** Called by the sidebar on load. */
function getScannerConfig() {
  return { pendingTimeoutSec: CONFIG.PENDING_TIMEOUT_SEC, stats: getStats_(readRoster_()) };
}

// ---------------------------------------------------------------------------
// Main entry point (called by the sidebar for every scan)
// ---------------------------------------------------------------------------
/**
 * @param {string} rawScan     Text typed by the scanner.
 * @param {string} pendingSid  SID scanned just before (waiting for its exam), or ''.
 * @return {{level:string, message:string, pendingSid:string, pendingName:string, stats:Object}}
 *         level is 'success', 'waiting' or 'error'.
 */
function processScan(rawScan, pendingSid) {
  var lock = LockService.getDocumentLock();
  lock.waitLock(15000);
  try {
    var result = handleScan_(normalize_(rawScan), normalize_(pendingSid));
    result.stats = getStats_(readRoster_());
    return result;
  } finally {
    lock.releaseLock();
  }
}

function handleScan_(scan, pendingSid) {
  if (!scan) return reply_('error', 'Empty scan.', pendingSid);

  var roster = readRoster_();

  // 1) Is it a student ID card?
  var student = findStudentByScan_(roster, scan);
  if (student) {
    var replaced = pendingSid && pendingSid !== student.sid;
    if (student.exam && !student.checkedOut) {
      log_('ID scan', scan, student, student.exam, 'Already checked in');
      return reply_('error', student.name + ' (' + student.sid + ') is already checked in with exam ' +
        student.exam + '. To check out, scan the exam QR.', '');
    }
    if (student.checkedOut) {
      log_('ID scan', scan, student, student.exam, 'Already checked out');
      return reply_('error', student.name + ' (' + student.sid + ') already checked out exam ' +
        student.exam + '.', '');
    }
    log_('ID scan', scan, student, '', 'Waiting for exam QR');
    return reply_('waiting', (replaced ? '(Previous student cancelled.) ' : '') +
      student.name + ' (' + student.sid + ') — now scan the EXAM QR.', student.sid, student.name);
  }

  // 2) Otherwise it is an exam QR.
  var exam = extractExamNumber_(scan);
  if (!exam) {
    log_('Unknown', scan, null, '', 'Could not read exam number');
    return reply_('error', 'Not a roster SID and no exam number found in: ' + scan, pendingSid);
  }
  var holder = findStudentByExam_(roster, exam);

  if (pendingSid) {
    // CHECK-IN
    var pending = findStudentBySid_(roster, pendingSid);
    if (!pending) return reply_('error', 'Pending SID ' + pendingSid + ' is no longer on the roster.', '');
    if (holder && holder.sid !== pending.sid) {
      log_('Check-in', scan, pending, exam, 'Rejected: exam belongs to ' + holder.sid);
      return reply_('error', 'Exam ' + exam + ' is already assigned to ' + holder.name + ' (' + holder.sid +
        '). Check-in cancelled — scan the student ID again with a different exam.', '');
    }
    var now = new Date();
    var sh = getRosterSheet_();
    sh.getRange(pending.row, roster.cols.EXAM).setNumberFormat('@').setValue(exam);
    sh.getRange(pending.row, roster.cols.CHECKIN_TIME).setValue(now);
    sh.getRange(pending.row, roster.cols.CHECKED_OUT).setValue(0);
    sh.getRange(pending.row, roster.cols.CHECKOUT_TIME).setValue('');
    log_('Check-in', scan, pending, exam, 'OK');
    return reply_('success', 'CHECKED IN: ' + pending.name + ' (' + pending.sid + ') → exam ' + exam, '');
  }

  // CHECK-OUT
  if (!holder) {
    log_('Check-out', scan, null, exam, 'Rejected: exam not checked in');
    return reply_('error', 'Exam ' + exam + ' was never checked in. To check in, scan the student ID first.', '');
  }
  if (holder.checkedOut) {
    log_('Check-out', scan, holder, exam, 'Already checked out');
    return reply_('error', 'Exam ' + exam + ' (' + holder.name + ') was already checked out.', '');
  }
  var sheet = getRosterSheet_();
  sheet.getRange(holder.row, roster.cols.CHECKED_OUT).setValue(1);
  sheet.getRange(holder.row, roster.cols.CHECKOUT_TIME).setValue(new Date());
  log_('Check-out', scan, holder, exam, 'OK');
  return reply_('success', 'CHECKED OUT: ' + holder.name + ' (' + holder.sid + ') returned exam ' + exam, '');
}

function reply_(level, message, pendingSid, pendingName) {
  return { level: level, message: message, pendingSid: pendingSid || '', pendingName: pendingName || '' };
}

// ---------------------------------------------------------------------------
// Roster helpers
// ---------------------------------------------------------------------------
function normalize_(s) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001F\u007F]/g, '').trim();
}

function key_(v) {
  return normalize_(v).toUpperCase();
}

function extractExamNumber_(scan) {
  if (CONFIG.EXAM_REGEX) {
    var m = scan.match(CONFIG.EXAM_REGEX);
    return m ? normalize_(m[1] !== undefined ? m[1] : m[0]) : '';
  }
  if (/^[A-Za-z0-9._-]+$/.test(scan)) return scan;
  var digits = scan.match(/\d+/g);
  return digits ? digits[digits.length - 1] : '';
}

function getRosterSheet_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.ROSTER_SHEET);
  if (!sh) throw new Error('No sheet named "' + CONFIG.ROSTER_SHEET + '". Run Exam Scanner → Set up sheets.');
  return sh;
}

function findCol_(headers, aliases) {
  var wanted = aliases.map(function (a) { return a.toLowerCase(); });
  for (var i = 0; i < headers.length; i++) {
    if (wanted.indexOf(String(headers[i]).trim().toLowerCase()) !== -1) return i + 1;
  }
  return 0;
}

/** Reads the roster into plain objects. Column numbers are 1-based. */
function readRoster_() {
  var sh = getRosterSheet_();
  var values = sh.getDataRange().getValues();
  var headers = values[0] || [];
  var cols = {};
  Object.keys(CONFIG.HEADERS).forEach(function (k) { cols[k] = findCol_(headers, CONFIG.HEADERS[k]); });
  ['SID', 'EXAM', 'CHECKIN_TIME', 'CHECKED_OUT', 'CHECKOUT_TIME'].forEach(function (k) {
    if (!cols[k]) throw new Error('Roster is missing the "' + CONFIG.HEADERS[k][0] + '" column. Run Exam Scanner → Set up sheets.');
  });

  var students = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var sid = normalize_(row[cols.SID - 1]);
    if (!sid) continue;
    var name = cols.NAME ? normalize_(row[cols.NAME - 1]) : '';
    if (!name && (cols.FIRST || cols.LAST)) {
      name = [cols.FIRST ? row[cols.FIRST - 1] : '', cols.LAST ? row[cols.LAST - 1] : '']
        .map(normalize_).filter(String).join(' ');
    }
    students.push({
      row: r + 1,
      sid: sid,
      name: name || 'Student',
      exam: normalize_(row[cols.EXAM - 1]),
      checkedOut: String(row[cols.CHECKED_OUT - 1]) === '1' || row[cols.CHECKED_OUT - 1] === true
    });
  }
  return { cols: cols, students: students };
}

function findStudentBySid_(roster, sid) {
  var k = key_(sid);
  for (var i = 0; i < roster.students.length; i++) {
    if (key_(roster.students[i].sid) === k) return roster.students[i];
  }
  return null;
}

/** Exact SID match first, then the longest roster SID contained in the scan. */
function findStudentByScan_(roster, scan) {
  var exact = findStudentBySid_(roster, scan);
  if (exact) return exact;
  var k = key_(scan), best = null;
  roster.students.forEach(function (s) {
    var sk = key_(s.sid);
    if (sk.length >= CONFIG.MIN_SID_LENGTH_FOR_PARTIAL_MATCH && k.indexOf(sk) !== -1 &&
        (!best || sk.length > best.sid.length)) {
      best = s;
    }
  });
  return best;
}

function findStudentByExam_(roster, exam) {
  var k = key_(exam);
  for (var i = 0; i < roster.students.length; i++) {
    if (roster.students[i].exam && key_(roster.students[i].exam) === k) return roster.students[i];
  }
  return null;
}

function getStats_(roster) {
  var total = roster.students.length, inCount = 0, outCount = 0;
  roster.students.forEach(function (s) {
    if (s.exam) inCount++;
    if (s.exam && s.checkedOut) outCount++;
  });
  return { total: total, checkedIn: inCount, checkedOut: outCount, stillOut: inCount - outCount };
}

// ---------------------------------------------------------------------------
// Setup + log
// ---------------------------------------------------------------------------
function setupSheets_(fillZeros) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CONFIG.ROSTER_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.ROSTER_SHEET);
    sh.getRange(1, 1, 1, 2).setValues([[CONFIG.HEADERS.SID[0], CONFIG.HEADERS.NAME[0]]]);
  }
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  if (!findCol_(headers, CONFIG.HEADERS.SID)) {
    throw new Error('The Roster sheet needs a "SID" (or "Student ID") header in row 1.');
  }
  var added = [];
  ['EXAM', 'CHECKIN_TIME', 'CHECKED_OUT', 'CHECKOUT_TIME'].forEach(function (k) {
    if (!findCol_(headers, CONFIG.HEADERS[k])) {
      sh.getRange(1, headers.length + 1).setValue(CONFIG.HEADERS[k][0]);
      headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
      added.push(CONFIG.HEADERS[k][0]);
    }
  });
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold');

  var roster = readRoster_();
  var maxRows = sh.getMaxRows();
  if (maxRows > 1) {
    sh.getRange(2, roster.cols.EXAM, maxRows - 1, 1).setNumberFormat('@');
    sh.getRange(2, roster.cols.CHECKIN_TIME, maxRows - 1, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sh.getRange(2, roster.cols.CHECKOUT_TIME, maxRows - 1, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  }
  var zeros = 0;
  if (fillZeros) {
    roster.students.forEach(function (s) {
      var cell = sh.getRange(s.row, roster.cols.CHECKED_OUT);
      if (cell.getValue() === '') { cell.setValue(0); zeros++; }
    });
  }

  if (!ss.getSheetByName(CONFIG.LOG_SHEET)) {
    var log = ss.insertSheet(CONFIG.LOG_SHEET);
    log.getRange(1, 1, 1, 7).setValues([['Timestamp', 'Scan', 'Action', 'SID', 'Name', 'Exam #', 'Result']])
      .setFontWeight('bold');
    log.setFrozenRows(1);
  }

  return 'Setup complete. ' + roster.students.length + ' students on the roster.' +
    (added.length ? ' Added columns: ' + added.join(', ') + '.' : '') +
    (zeros ? ' Set Checked Out = 0 for ' + zeros + ' students.' : '');
}

function log_(action, scan, student, exam, result) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var log = ss.getSheetByName(CONFIG.LOG_SHEET);
  if (!log) return;
  log.appendRow([new Date(), "'" + scan, action, student ? "'" + student.sid : '',
    student ? student.name : '', exam ? "'" + exam : '', result]);
}

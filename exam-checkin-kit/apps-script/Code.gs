/**
 * EXAM CHECK-IN / CHECK-OUT for a Google Sheets roster.
 *
 * Check-in: at each station a proctor scans the student's ID card and the QR
 * code on the answer sheet handed to that student. The sheet number, time,
 * station and proctor are written into the student's row of the roster.
 * Check-out: with the page switched to Check-out, scanning the QR code on an
 * answer sheet that is turned in records the check-out time for the student
 * who was given that sheet. Every action is also recorded on the
 * "Check-in Log" tab.
 *
 * Install: Extensions > Apps Script in the roster spreadsheet, paste this file
 * into Code.gs, add an HTML file named CheckIn with the page code, then run
 * "Exam Check-in > Set up / check roster" from the spreadsheet menu and
 * deploy as a web app (Execute as: Me; Who has access: anyone in your
 * organization).
 */

// ============================== SETTINGS ==============================
var CONFIG = {
  EXAM_NAME: 'Midterm',          // shown at the top of the check-in page
  ROSTER_TAB: '',                // name of the roster tab; '' = the first tab
  HEADER_ROW: 1,                 // row holding the column headings
  ID_HEADER: '',                 // heading of the student-ID column; '' = detect (SID, Student ID, ...)
  SHEET_PREFIX: 'AS',            // must match --prefix used when stamping the answer sheets
  SHEET_DIGITS: 4,               // must match --digits used when stamping (AS-0137 = 4)
  ACCEPT_ANY_SHEET_CODE: false,  // true only if you use Gradescope's own QR labels instead
  STAFF_ONLY: true,              // only people with edit access to this spreadsheet can use the page
  EXTRA_STAFF_EMAILS: []         // other allowed accounts, e.g. ['gsi@berkeley.edu']
};
// ======================================================================

var OUT = {               // columns added to the right of the roster
  sheet: 'Answer Sheet #',
  time: 'Check-in Time',
  station: 'Station',
  method: 'ID Method',
  by: 'Checked In By',
  replaced: 'Replaced Sheet(s)',
  outTime: 'Check-out Time',
  outBy: 'Checked Out By'
};
var LOG_TAB = 'Check-in Log';
var LOG_HEADERS = ['Time', 'Station', 'Proctor', 'Action', 'Result', 'Scanned / typed ID',
                   'Matched SID', 'Name', 'Answer sheet', 'Details'];
var WALKIN_TAB = 'Not on Roster';
var WALKIN_HEADERS = ['Time', 'Station', 'Proctor', 'Scanned / typed ID', 'Name (as given)',
                      'Answer sheet', 'Status', 'Check-out Time', 'Checked Out By'];
var WALKIN_FIELDS = ['time', 'station', 'by', 'id', 'name', 'sheet', 'status', 'outTime', 'outBy'];
var METHODS = ['Card scan', 'Typed SID', 'Name search'];
var LATE_METHOD = 'At check-out';  // student skipped check-in; sheet recorded when turned in

var ID_KEYS = ['sid', 'studentid', 'studentidnumber', 'sisuserid', 'sisid', 'emplid',
               'studentnumber', 'idnumber', 'id'];
var FULLNAME_KEYS = ['name', 'fullname', 'studentname', 'student'];
var FIRST_KEYS = ['firstname', 'first', 'givenname', 'preferredfirstname'];
var LAST_KEYS = ['lastname', 'last', 'surname', 'familyname'];

// ------------------------------ web app -------------------------------

function doGet() {
  return HtmlService.createHtmlOutputFromFile('CheckIn')
    .setTitle(CONFIG.EXAM_NAME + ' check-in')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** First call from the page: who is this, and how far along are we. */
function apiInit() {
  return api_(function () {
    var ss = ss_();
    var email = assertStaff_(ss);
    var R = withLock_(function () { ensureSetup_(ss); return loadRoster_(ss); });
    return {
      ok: true, exam: CONFIG.EXAM_NAME, email: email, prefix: CONFIG.SHEET_PREFIX,
      digits: CONFIG.SHEET_DIGITS, acceptAnySheetCode: CONFIG.ACCEPT_ANY_SHEET_CODE,
      stats: stats_(ss, R)
    };
  });
}

/** Look up a scanned or typed student ID. */
function apiLookup(raw) {
  return api_(function () {
    var ss = ss_();
    assertStaff_(ss);
    var R = loadRoster_(ss);
    var m = matchId_(R, raw);
    if (m.status === 'found') {
      return { ok: true, status: 'found', match: m.match, student: pub_(m.student),
               existing: m.student.sheet ? existing_(ss, m.student) : null };
    }
    if (m.status === 'ambiguous') {
      return { ok: true, status: 'ambiguous', candidates: m.candidates.slice(0, 5).map(pub_) };
    }
    return { ok: true, status: m.status };
  });
}

/** Find students by (part of) their name or ID, for students without a card. */
function apiSearch(query) {
  return api_(function () {
    var ss = ss_();
    assertStaff_(ss);
    var tokens = fold_(query).split(/[\s,]+/).filter(String);
    if (!tokens.length) return { ok: true, results: [] };
    var R = loadRoster_(ss);
    var hits = R.students.filter(function (s) {
      return tokens.every(function (t) { return s.hay.indexOf(t) >= 0; });
    });
    return {
      ok: true, total: hits.length,
      results: hits.slice(0, 12).map(function (s) {
        var p = pub_(s);
        p.existing = s.sheet ? existing_(ss, s) : null;
        return p;
      })
    };
  });
}

/**
 * Record a check-in. req = {
 *   studentKey, studentRaw, walkIn, walkInName, replace,
 *   sheetRaw, station, method, queued }
 * Safe to repeat: re-sending a check-in that was already saved returns ok.
 */
function apiCheckIn(req) {
  return api_(true, function () {
    var ss = ss_();
    var email = assertStaff_(ss);
    req = req || {};
    var station = clean_(req.station, 30) || '?';
    var method = METHODS.indexOf(req.method) >= 0 ? req.method : 'Typed SID';
    var raw = clean_(req.studentRaw, 60);
    var key = sheetKey_(req.sheetRaw, true);
    if (!key) {
      return { ok: false, error: 'BAD_SHEET',
               message: '"' + clean_(req.sheetRaw, 40) + '" is not an answer-sheet code.' };
    }
    var label = labelOf_(key);
    var note = req.queued ? 'sent after reconnecting' : '';

    return withLock_(function () {
      ensureSetup_(ss);
      var R = loadRoster_(ss), W = walkins_(ss);
      var used = sheetUsage_(R, W)[key];
      var s = null, m = null;
      if (req.studentKey && R.byKey[req.studentKey]) s = R.byKey[req.studentKey];
      else if (raw) {
        m = matchId_(R, raw);
        if (m.status === 'found') s = m.student;
      }

      if (!s) {
        if (m && m.status === 'ambiguous') {
          return { ok: false, error: 'AMBIGUOUS', message: 'That ID matches more than one student. Use Find by name.' };
        }
        // Not on the roster: record on the "Not on Roster" tab if the proctor chose to
        // (or if this was scanned while offline, so the sheet is not lost).
        if (!req.walkIn && !req.queued) {
          return { ok: false, error: 'NOT_FOUND', message: 'ID ' + raw + ' is not on the roster.' };
        }
        var idKey = normId_(raw);
        if (used) {
          if (used.kind === 'walkin' && used.idKey === idKey) {
            return { ok: true, already: true, walkIn: true, sheet: label, stats: stats_(ss, R, W) };
          }
          return sheetUsed_(ss, used, label, raw, '', clean_(req.walkInName, 80), station, email, note);
        }
        var name = clean_(req.walkInName, 80) || '(name not given)';
        tab_(ss, WALKIN_TAB, WALKIN_HEADERS).appendRow(
          [new Date(), station, email, text_(raw), name, label, req.queued ? 'CHECK: scanned while offline' : '']);
        log_(ss, [station, email, 'CHECK-IN', 'NOT ON ROSTER', raw, '', name, label, note]);
        SpreadsheetApp.flush();
        return { ok: true, walkIn: true, attention: req.walkIn ? '' : 'ID ' + raw + ' is not on the roster',
                 student: { name: name, id: raw, key: '' }, sheet: label, stats: stats_(ss, R) };
      }

      if (used) {
        if (used.kind === 'current' && used.idKey === s.idKey) {  // already saved (a retry)
          return { ok: true, already: true, student: pub_(s), sheet: label, stats: stats_(ss, R, W) };
        }
        return sheetUsed_(ss, used, label, raw, s.id, s.name, station, email, note);
      }

      var c = R.cols.out, row = s.row, previous = '';
      if (s.sheet) {
        var ex = existing_(ss, s);
        if (!req.replace || s.outTime) {
          log_(ss, [station, email, 'CHECK-IN', 'REFUSED: already checked in', raw, s.id, s.name, label,
                    'has ' + ex.sheet + (ex.time ? ' since ' + ex.time : '') + ' (' + ex.station + ')' +
                    (ex.out ? ', checked out at ' + ex.out : '') + ' ' + note]);
          return { ok: false, error: 'ALREADY_CHECKED_IN', student: pub_(s), existing: ex,
                   message: s.name + ' is already checked in with ' + ex.sheet +
                            (ex.out ? ' and turned it in at ' + ex.out : '') + '.' };
        }
        previous = s.sheet;
        R.sheet.getRange(row, c.sheet + 1).setValue(text_(label));
        R.sheet.getRange(row, c.replaced + 1).setValue(
          s.replaced.concat([previous]).map(labelOf_).join(', '));
        log_(ss, [station, email, 'REPLACE SHEET', 'OK', raw, s.id, s.name, label,
                  ('took back ' + labelOf_(previous) + ' ' + note).trim()]);
      } else {
        R.sheet.getRange(row, c.sheet + 1).setValue(text_(label));
        R.sheet.getRange(row, c.time + 1).setValue(new Date());
        R.sheet.getRange(row, c.station + 1).setValue(station);
        R.sheet.getRange(row, c.method + 1).setValue(method);
        R.sheet.getRange(row, c.by + 1).setValue(email);
        log_(ss, [station, email, 'CHECK-IN', 'OK', raw, s.id, s.name, label, (method + ' ' + note).trim()]);
      }
      SpreadsheetApp.flush();
      s.sheet = key;
      return { ok: true, student: pub_(s), sheet: label, sheetKey: key,
               previous: previous ? labelOf_(previous) : '', previousKey: previous,
               stats: stats_(ss, R, W) };
    });
  });
}

/**
 * Record that an answer sheet was turned in (check-out). req = {
 *   sheetRaw, station, queued,
 *   studentKey / studentRaw  (optional: the student's ID, to make sure the sheet is theirs),
 *   late  (the student never checked in: record this sheet for them now) }
 * Safe to repeat: checking out the same sheet again returns ok with already = true.
 */
function apiCheckOut(req) {
  return api_(true, function () {
    var ss = ss_();
    var email = assertStaff_(ss);
    req = req || {};
    var station = clean_(req.station, 30) || '?';
    var raw = clean_(req.studentRaw, 60);
    var key = sheetKey_(req.sheetRaw, true);
    if (!key) {
      return { ok: false, error: 'BAD_SHEET',
               message: '"' + clean_(req.sheetRaw, 40) + '" is not an answer-sheet code.' };
    }
    var label = labelOf_(key);
    var note = req.queued ? 'sent after reconnecting' : '';

    return withLock_(function () {
      ensureSetup_(ss);
      var R = loadRoster_(ss), W = walkins_(ss);
      var used = sheetUsage_(R, W)[key];
      var who = null;
      if (req.studentKey && R.byKey[req.studentKey]) who = R.byKey[req.studentKey];
      else if (raw) {
        var m = matchId_(R, raw);
        if (m.status === 'found') who = m.student;
      }
      var whoKey = who ? who.idKey : normId_(raw);
      var whoName = who ? who.name : (raw ? 'ID ' + raw : '');
      var c = R.cols.out, now = new Date();

      function refuse(error, message) {
        log_(ss, [station, email, 'CHECK-OUT', 'REFUSED', raw, who ? who.id : '', whoName, label,
                  (message + ' ' + note).trim()]);
        return { ok: false, error: error, message: message, stats: stats_(ss, R, W) };
      }

      if (used && used.kind === 'replaced') {
        var holder = R.byKey[used.idKey];
        return refuse('REPLACED_SHEET', label + ' was taken back from ' + used.name + ' when it was replaced' +
          (holder && holder.sheet ? ' (their sheet is ' + labelOf_(holder.sheet) + ')' : '') +
          '. Set it aside and tell the instructor.');
      }

      if (used && used.kind === 'current') {
        var s = R.byKey[used.idKey];
        if (whoKey && whoKey !== s.idKey) {
          return refuse('MISMATCH', label + ' was given to ' + s.name + ', not ' + whoName +
            '. Set it aside and tell the instructor.');
        }
        if (s.outTime) {
          return { ok: true, already: true, student: pub_(s), sheet: label, sheetKey: key,
                   outTime: fmtTime_(ss, s.outTime), stats: stats_(ss, R, W) };
        }
        R.sheet.getRange(s.row, c.outTime + 1).setValue(now);
        R.sheet.getRange(s.row, c.outBy + 1).setValue(email);
        log_(ss, [station, email, 'CHECK-OUT', 'OK', raw, s.id, s.name, label, note]);
        SpreadsheetApp.flush();
        s.outTime = now;
        return { ok: true, student: pub_(s), sheet: label, sheetKey: key, stats: stats_(ss, R, W) };
      }

      if (used && used.kind === 'walkin') {
        var w = used.walkin;
        if (whoKey && whoKey !== w.idKey) {
          return refuse('MISMATCH', label + ' was given to ' + w.name + ' (not on roster), not ' + whoName +
            '. Set it aside and tell the instructor.');
        }
        var wpub = { key: '', id: w.id, name: w.name };
        if (w.outTime) {
          return { ok: true, already: true, walkIn: true, student: wpub, sheet: label, sheetKey: key,
                   outTime: fmtTime_(ss, w.outTime), stats: stats_(ss, R, W) };
        }
        var wt = ss.getSheetByName(WALKIN_TAB);
        wt.getRange(w.row, w.cols.outTime + 1).setValue(now);
        wt.getRange(w.row, w.cols.outBy + 1).setValue(email);
        log_(ss, [station, email, 'CHECK-OUT', 'OK (not on roster)', raw || w.id, '', w.name, label, note]);
        SpreadsheetApp.flush();
        w.outTime = now;
        return { ok: true, walkIn: true, student: wpub, sheet: label, sheetKey: key, stats: stats_(ss, R, W) };
      }

      // Nobody was given this sheet at check-in.
      if (!who) {
        return refuse('NOT_ISSUED', label + ' was not handed out at check-in.' + (raw
          ? ' ID ' + raw + ' is not on the roster either. Set the sheet aside and tell the instructor.'
          : ' Scan the student\'s ID card to record who turned it in.'));
      }
      if (who.sheet) {
        return refuse('MISMATCH', who.name + ' was given ' + labelOf_(who.sheet) + ', but turned in ' + label +
          ', which was not handed out at check-in. Set it aside and tell the instructor.');
      }
      if (!req.late) {
        return { ok: false, error: 'NOT_CHECKED_IN', student: pub_(who),
                 message: who.name + ' was not checked in.', stats: stats_(ss, R, W) };
      }
      // The student skipped check-in: record this sheet for them now (check-in time left blank).
      R.sheet.getRange(who.row, c.sheet + 1).setValue(text_(label));
      R.sheet.getRange(who.row, c.station + 1).setValue(station);
      R.sheet.getRange(who.row, c.method + 1).setValue(LATE_METHOD);
      R.sheet.getRange(who.row, c.by + 1).setValue(email);
      R.sheet.getRange(who.row, c.outTime + 1).setValue(now);
      R.sheet.getRange(who.row, c.outBy + 1).setValue(email);
      log_(ss, [station, email, 'CHECK-OUT', 'OK (was not checked in)', raw, who.id, who.name, label,
                ('sheet recorded at check-out ' + note).trim()]);
      SpreadsheetApp.flush();
      who.sheet = key;
      who.outTime = now;
      return { ok: true, late: true, student: pub_(who), sheet: label, sheetKey: key, stats: stats_(ss, R, W) };
    });
  });
}

/** Undo a check-in made at this station: req = {studentKey, sheetKey, previousKey, station}. */
function apiUndo(req) {
  return api_(function () {
    var ss = ss_();
    var email = assertStaff_(ss);
    req = req || {};
    var station = clean_(req.station, 30) || '?';
    return withLock_(function () {
      var R = loadRoster_(ss);
      var s = R.byKey[req.studentKey];
      if (!s) return { ok: false, message: 'Student not found on the roster.' };
      if (s.sheet !== String(req.sheetKey)) {
        return { ok: false, message: 'Nothing to undo: ' + s.name + ' now has ' +
                 (s.sheet ? labelOf_(s.sheet) : 'no answer sheet') + '.' };
      }
      var c = R.cols.out, row = s.row;
      var prev = req.previousKey ? String(req.previousKey) : '';
      if (prev && s.replaced.length && s.replaced[s.replaced.length - 1] === prev) {
        R.sheet.getRange(row, c.sheet + 1).setValue(text_(labelOf_(prev)));
        R.sheet.getRange(row, c.replaced + 1).setValue(s.replaced.slice(0, -1).map(labelOf_).join(', '));
        s.sheet = prev;
        log_(ss, [station, email, 'UNDO', 'OK', '', s.id, s.name, labelOf_(req.sheetKey),
                  'back to ' + labelOf_(prev)]);
      } else {
        [c.sheet, c.time, c.station, c.method, c.by, c.outTime, c.outBy].forEach(function (col) {
          if (col >= 0) R.sheet.getRange(row, col + 1).clearContent();
        });
        s.sheet = '';
        s.outTime = '';
        log_(ss, [station, email, 'UNDO', 'OK', '', s.id, s.name, labelOf_(req.sheetKey), 'check-in removed']);
      }
      SpreadsheetApp.flush();
      return { ok: true, restored: prev ? labelOf_(prev) : '', stats: stats_(ss, R) };
    });
  });
}

/** Undo a check-out made at this station: req = {sheetKey, station}. */
function apiUndoCheckOut(req) {
  return api_(function () {
    var ss = ss_();
    var email = assertStaff_(ss);
    req = req || {};
    var station = clean_(req.station, 30) || '?';
    var key = sheetKey_(req.sheetKey, false);
    var label = labelOf_(key);
    return withLock_(function () {
      var R = loadRoster_(ss), W = walkins_(ss);
      var used = key ? sheetUsage_(R, W)[key] : null;
      if (used && used.kind === 'current' && R.byKey[used.idKey].outTime) {
        var s = R.byKey[used.idKey], c = R.cols.out;
        var late = s.method === LATE_METHOD;  // also remove the sheet that was recorded at check-out
        var cols = late ? [c.outTime, c.outBy, c.sheet, c.time, c.station, c.method, c.by] : [c.outTime, c.outBy];
        cols.forEach(function (col) { if (col >= 0) R.sheet.getRange(s.row, col + 1).clearContent(); });
        log_(ss, [station, email, 'UNDO CHECK-OUT', 'OK', '', s.id, s.name, label, late ? 'sheet record removed too' : '']);
        s.outTime = '';
        if (late) s.sheet = '';
      } else if (used && used.kind === 'walkin' && used.walkin.outTime) {
        var w = used.walkin, wt = ss.getSheetByName(WALKIN_TAB);
        wt.getRange(w.row, w.cols.outTime + 1).clearContent();
        wt.getRange(w.row, w.cols.outBy + 1).clearContent();
        log_(ss, [station, email, 'UNDO CHECK-OUT', 'OK', '', w.id, w.name, label, 'not on roster']);
        w.outTime = '';
      } else {
        return { ok: false, message: 'Nothing to undo: ' + label + ' is not checked out.' };
      }
      SpreadsheetApp.flush();
      return { ok: true, stats: stats_(ss, R, W) };
    });
  });
}

/** Students who were checked in but have not turned in their answer sheet yet. */
function apiStillIn() {
  return api_(function () {
    var ss = ss_();
    assertStaff_(ss);
    var R = loadRoster_(ss), W = walkins_(ss);
    var list = R.students.filter(function (s) { return s.sheet && !s.outTime; }).map(function (s) {
      return { name: s.name, id: s.id, sheet: labelOf_(s.sheet) };
    });
    W.forEach(function (w) {
      if (!w.outTime) list.push({ name: w.name + ' (not on roster)', id: w.id, sheet: labelOf_(w.sheetKey) });
    });
    list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return { ok: true, total: list.length, students: list.slice(0, 500), stats: stats_(ss, R, W) };
  });
}

/** Progress counts (the page polls this; it doubles as a connection check). */
function apiStats() {
  return api_(function () {
    var ss = ss_();
    assertStaff_(ss);
    return { ok: true, stats: stats_(ss, loadRoster_(ss)) };
  });
}

// ------------------------------- menu --------------------------------

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Exam Check-in')
    .addItem('Set up / check roster', 'menuSetup')
    .addSeparator()
    .addItem('Clear ALL check-in data...', 'menuClear')
    .addToUi();
}

function menuSetup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  var R;
  try {
    R = withLock_(function () { ensureSetup_(ss); return loadRoster_(ss); });
  } catch (e) {
    ui.alert('Exam Check-in', e.message, ui.ButtonSet.OK);
    return;
  }
  var cols = R.cols, h = R.headers;
  var name = cols.first >= 0 && cols.last >= 0 ? '"' + h[cols.first] + '" + "' + h[cols.last] + '"'
    : '"' + h[cols.full] + '"';
  var lines = [
    'Roster tab: "' + R.sheet.getName() + '"',
    'Students found: ' + R.students.length,
    'Student ID column: "' + h[cols.id] + '" (column ' + colLetter_(cols.id + 1) + ')',
    'Name column(s): ' + name,
    'Check-in and check-out results go in: "' + OUT.sheet + '" ... "' + OUT.outBy + '"'
  ];
  if (R.blankIds) lines.push('WARNING: ' + R.blankIds + ' row(s) have a name but no student ID.');
  if (R.dupes.length) {
    lines.push('WARNING: duplicate student IDs: ' + R.dupes.slice(0, 5).map(function (s) {
      return s.id + ' (row ' + s.row + ')';
    }).join(', '));
  }
  var sample = R.students.slice(0, 3).map(function (s) { return s.name + ' - ' + s.id; });
  if (sample.length) lines.push('', 'First students: ' + sample.join('; '));
  lines.push('', 'If the ID or name column is wrong, set ID_HEADER / ROSTER_TAB at the top of Code.gs.');
  ui.alert('Exam Check-in is set up', lines.join('\n'), ui.ButtonSet.OK);
}

function menuClear() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Clear ALL check-in data?',
    'This erases every answer-sheet number, check-in and check-out time, and log entry ' +
    '(use it after your practice run).\nType CLEAR to continue.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK || r.getResponseText().trim().toUpperCase() !== 'CLEAR') {
    ui.alert('Nothing was changed.');
    return;
  }
  withLock_(function () {
    var R = loadRoster_(ss);
    var n = R.sheet.getLastRow() - CONFIG.HEADER_ROW;
    if (n > 0) {
      Object.keys(OUT).forEach(function (k) {
        if (R.cols.out[k] >= 0) R.sheet.getRange(CONFIG.HEADER_ROW + 1, R.cols.out[k] + 1, n, 1).clearContent();
      });
    }
    [LOG_TAB, WALKIN_TAB].forEach(function (name) {
      var sh = ss.getSheetByName(name);
      if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
    });
    SpreadsheetApp.flush();
  });
  ui.alert('All check-in data was cleared.');
}

// ------------------------------ roster -------------------------------

function ss_() {
  var ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}
  if (ss) return ss;
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Open the spreadsheet and run Exam Check-in > Set up / check roster first.');
  return SpreadsheetApp.openById(id);
}

function rosterSheet_(ss) {
  var sh = CONFIG.ROSTER_TAB ? ss.getSheetByName(CONFIG.ROSTER_TAB) : ss.getSheets()[0];
  if (!sh) throw new Error('No tab named "' + CONFIG.ROSTER_TAB + '". Fix ROSTER_TAB in Code.gs.');
  return sh;
}

function hkey_(h) { return String(h).toLowerCase().replace(/[^a-z0-9]/g, ''); }

function detectColumns_(headers) {
  var keys = headers.map(hkey_);
  function find(cands) {
    for (var i = 0; i < cands.length; i++) {
      var at = keys.indexOf(cands[i]);
      if (at >= 0) return at;
    }
    return -1;
  }
  var cols = {
    id: CONFIG.ID_HEADER ? keys.indexOf(hkey_(CONFIG.ID_HEADER)) : find(ID_KEYS),
    full: find(FULLNAME_KEYS), first: find(FIRST_KEYS), last: find(LAST_KEYS), out: {}
  };
  Object.keys(OUT).forEach(function (k) { cols.out[k] = keys.indexOf(hkey_(OUT[k])); });
  return cols;
}

function readTable_(sh) {
  var lastRow = Math.max(sh.getLastRow(), CONFIG.HEADER_ROW);
  var lastCol = Math.max(sh.getLastColumn(), 1);
  return sh.getRange(CONFIG.HEADER_ROW, 1, lastRow - CONFIG.HEADER_ROW + 1, lastCol).getValues();
}

/** Add the result columns and log tabs if they are missing (call inside the lock). */
function ensureSetup_(ss) {
  var sh = rosterSheet_(ss);
  var headers = sh.getRange(CONFIG.HEADER_ROW, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
  var cols = detectColumns_(headers);
  if (cols.id < 0) {
    throw new Error('Could not find the student-ID column on tab "' + sh.getName() + '" (looked for SID, ' +
      'Student ID, ...). Put its exact heading in ID_HEADER at the top of Code.gs.');
  }
  if (cols.full < 0 && (cols.first < 0 || cols.last < 0)) {
    throw new Error('Could not find a Name column (or First Name + Last Name) on tab "' + sh.getName() + '".');
  }
  var next = sh.getLastColumn() + 1;
  Object.keys(OUT).forEach(function (k) {
    if (cols.out[k] >= 0) return;
    sh.getRange(CONFIG.HEADER_ROW, next).setValue(OUT[k]).setFontWeight('bold');
    if (k === 'time' || k === 'outTime') {
      sh.getRange(CONFIG.HEADER_ROW + 1, next, Math.max(1, sh.getMaxRows() - CONFIG.HEADER_ROW), 1)
        .setNumberFormat('h:mm:ss am/pm');
    }
    next++;
  });
  ensureTab_(ss, LOG_TAB, LOG_HEADERS);
  ensureTab_(ss, WALKIN_TAB, WALKIN_HEADERS);
}

/** Get a tab, creating it with headings if it doesn't exist. */
function tab_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    headers.forEach(function (h, i) { if (/time$/.test(hkey_(h))) timeFormat_(sh, i + 1); });
  }
  return sh;
}

/** Like tab_, and also add any headings missing from an existing tab (after an update). */
function ensureTab_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) return tab_(ss, name, headers);
  var have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(hkey_);
  var next = sh.getLastColumn() + 1;
  headers.forEach(function (h) {
    if (have.indexOf(hkey_(h)) >= 0) return;
    sh.getRange(1, next).setValue(h).setFontWeight('bold');
    if (/time$/.test(hkey_(h))) timeFormat_(sh, next);
    next++;
  });
  return sh;
}

function timeFormat_(sh, col) {
  sh.getRange(2, col, Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('h:mm:ss am/pm');
}

function loadRoster_(ss) {
  var sh = rosterSheet_(ss);
  var values = readTable_(sh);
  var headers = values[0].map(String);
  var cols = detectColumns_(headers);
  if (cols.id < 0) throw new Error('Could not find the student-ID column. Run Exam Check-in > Set up.');
  var o = cols.out;
  var R = { sheet: sh, headers: headers, cols: cols, students: [], byKey: {}, dupes: [], blankIds: 0 };
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var name = nameOf_(row, cols);
    var idKey = normId_(row[cols.id]);
    if (!idKey) {
      if (name) R.blankIds++;
      continue;
    }
    var s = {
      row: CONFIG.HEADER_ROW + i,
      id: displayId_(row[cols.id]),
      idKey: idKey,
      name: name || '(no name)',
      sheet: o.sheet >= 0 ? sheetKey_(row[o.sheet], false) : '',
      time: o.time >= 0 ? row[o.time] : '',
      station: o.station >= 0 ? String(row[o.station]) : '',
      method: o.method >= 0 ? String(row[o.method]) : '',
      replaced: o.replaced >= 0 ? listKeys_(row[o.replaced]) : [],
      outTime: o.outTime >= 0 ? row[o.outTime] : ''
    };
    s.hay = fold_([name, cols.full >= 0 ? row[cols.full] : '', cols.first >= 0 ? row[cols.first] : '',
                   cols.last >= 0 ? row[cols.last] : '', s.id].join(' | '));
    if (R.byKey[idKey]) R.dupes.push(s); else R.byKey[idKey] = s;
    R.students.push(s);
  }
  return R;
}

/** Students recorded on the "Not on Roster" tab (rows whose Status says undone/void are ignored). */
function walkins_(ss) {
  var sh = ss.getSheetByName(WALKIN_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  var vals = sh.getRange(1, 1, sh.getLastRow(), Math.max(sh.getLastColumn(), WALKIN_HEADERS.length)).getValues();
  var keys = vals[0].map(hkey_), cols = {};
  WALKIN_HEADERS.forEach(function (h, i) {
    var at = keys.indexOf(hkey_(h));
    cols[WALKIN_FIELDS[i]] = at >= 0 ? at : i;
  });
  var list = [];
  for (var r = 1; r < vals.length; r++) {
    var v = vals[r];
    var k = sheetKey_(v[cols.sheet], false);
    if (!k || /undone|void/i.test(String(v[cols.status]))) continue;
    list.push({ row: r + 1, cols: cols, idKey: normId_(v[cols.id]), id: String(v[cols.id]),
                name: String(v[cols.name]), station: String(v[cols.station]), time: v[cols.time],
                sheetKey: k, outTime: v[cols.outTime] || '' });
  }
  return list;
}

function nameOf_(row, cols) {
  var first = cols.first >= 0 ? String(row[cols.first]).trim() : '';
  var last = cols.last >= 0 ? String(row[cols.last]).trim() : '';
  if (first || last) return (first + ' ' + last).trim();
  return cols.full >= 0 ? String(row[cols.full]).trim() : '';
}

/**
 * Canonical form of a student ID for matching: letters/digits only, and for
 * all-digit IDs no leading zeros. Strips Codabar start/stop letters (A1234B).
 */
function normId_(v) {
  if (v === null || v === undefined) return '';
  var s = typeof v === 'number' ? v.toFixed(0) : String(v);
  s = s.trim().toUpperCase().replace(/[^0-9A-Z]/g, '');
  var m = s.match(/^[A-D](\d+)[A-D]$/);
  if (m) s = m[1];
  if (/^\d+$/.test(s)) s = s.replace(/^0+(?=\d)/, '');
  return s === '0' ? '' : s;
}

function displayId_(v) { return typeof v === 'number' ? v.toFixed(0) : String(v).trim(); }

/**
 * Find the student for a scanned/typed ID. Exact match first; otherwise, if the
 * card's barcode holds the ID plus extra digits (e.g. a card-issue number),
 * accept the one roster ID contained in it.
 */
function matchId_(R, raw) {
  var key = normId_(raw);
  if (!key) return { status: 'empty' };
  if (R.byKey[key]) return { status: 'found', student: R.byKey[key], match: 'exact' };
  if (key.length >= 7) {
    var hits = R.students.filter(function (s) { return s.idKey.length >= 6 && key.indexOf(s.idKey) >= 0; });
    if (hits.length === 1) return { status: 'found', student: hits[0], match: 'partial' };
    if (hits.length > 1) return { status: 'ambiguous', candidates: hits };
  }
  return { status: 'notfound' };
}

// --------------------------- answer sheets ---------------------------

/**
 * Canonical key for an answer-sheet code: "137" for AS-0137 / AS137 / 137.
 * Other text is kept (upper-cased) only when ACCEPT_ANY_SHEET_CODE is on.
 */
function sheetKey_(v, strict) {
  if (v === null || v === undefined) return '';
  var s = typeof v === 'number' ? v.toFixed(0) : String(v);
  s = s.trim().toUpperCase().replace(/^'/, '');
  if (!s) return '';
  var pfx = CONFIG.SHEET_PREFIX.toUpperCase().replace(/[^0-9A-Z]/g, '');
  var m = s.match(new RegExp('^' + pfx + '[-_ ]?0*(\\d{1,7})$'));
  if (m) return String(Number(m[1]));
  if (/^\d{1,5}$/.test(s)) return String(Number(s));
  if (strict && !CONFIG.ACCEPT_ANY_SHEET_CODE) return '';
  return s;
}

function labelOf_(key) {
  key = String(key);
  if (!/^\d+$/.test(key)) return key;
  var n = key;
  while (n.length < CONFIG.SHEET_DIGITS) n = '0' + n;
  return CONFIG.SHEET_PREFIX + '-' + n;
}

function listKeys_(v) {
  return String(v || '').split(/[,;]+/).map(function (x) { return sheetKey_(x, false); }).filter(String);
}

/** Every answer sheet already handed out: key -> who has it. */
function sheetUsage_(R, W) {
  var used = {};
  R.students.forEach(function (s) {
    if (s.sheet) used[s.sheet] = { kind: 'current', idKey: s.idKey, id: s.id, name: s.name,
                                   station: s.station, time: s.time };
  });
  R.students.forEach(function (s) {
    s.replaced.forEach(function (k) {
      if (!used[k]) used[k] = { kind: 'replaced', idKey: s.idKey, id: s.id, name: s.name };
    });
  });
  W.forEach(function (w) {
    if (!used[w.sheetKey]) used[w.sheetKey] = { kind: 'walkin', idKey: w.idKey, id: w.id, name: w.name,
                                                station: w.station, time: w.time, walkin: w };
  });
  return used;
}

function sheetUsed_(ss, used, label, raw, sid, name, station, email, note) {
  var who = used.kind === 'replaced' ? 'was taken back from ' + used.name + ' (replaced; do not reuse it)'
    : 'was already given to ' + used.name + (used.time ? ' at ' + fmtTime_(ss, used.time) : '') +
      (used.station ? ' (' + used.station + ')' : '');
  log_(ss, [station, email, 'CHECK-IN', 'REFUSED: sheet already used', raw, sid, name, label, (who + ' ' + note).trim()]);
  return { ok: false, error: 'SHEET_USED', message: label + ' ' + who + '. Set it aside and scan a different sheet.' };
}

// ------------------------------ helpers ------------------------------

function pub_(s) { return { key: s.idKey, id: s.id, name: s.name }; }

function existing_(ss, s) {
  return { sheet: labelOf_(s.sheet), time: fmtTime_(ss, s.time), station: s.station || '?',
           out: s.outTime ? fmtTime_(ss, s.outTime) : '' };
}

function stats_(ss, R, W) {
  if (!W) W = walkins_(ss);
  var inn = 0, out = 0, wOut = 0;
  R.students.forEach(function (s) { if (s.sheet) { inn++; if (s.outTime) out++; } });
  W.forEach(function (w) { if (w.outTime) wOut++; });
  return { checkedIn: inn, total: R.students.length, notOnRoster: W.length,
           checkedOut: out + wOut, stillIn: inn - out + W.length - wOut };
}

function fmtTime_(ss, t) {
  if (!(t instanceof Date)) return String(t || '');
  return Utilities.formatDate(t, ss.getSpreadsheetTimeZone(), 'h:mm a');
}

function log_(ss, cells) {
  tab_(ss, LOG_TAB, LOG_HEADERS).appendRow([new Date()].concat(cells.map(function (c, i) {
    return i === 4 || i === 5 ? text_(c) : c;  // keep IDs as text (no scientific notation)
  })));
}

/** Store as plain text so Sheets doesn't turn IDs/codes into numbers or dates. */
function text_(v) { v = String(v === null || v === undefined ? '' : v); return v ? "'" + v : ''; }

function clean_(v, max) {
  return String(v === null || v === undefined ? '' : v).replace(/[\x00-\x1f]/g, '').trim().slice(0, max);
}

/** Lower-case and strip accents, so "jose" finds "José". */
function fold_(s) {
  return String(s || '').normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase();
}

function colLetter_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    var e = new Error('The spreadsheet is busy. Retrying...');
    e.retry = true;
    throw e;
  }
  try { return fn(); } finally { lock.releaseLock(); }
}

/**
 * Run an API call; turn any exception into {ok:false} so the page can tell errors from lost
 * connections. With retryErrors, unexpected errors are marked retryable (check-ins are safe to resend).
 */
function api_(retryErrors, fn) {
  if (typeof retryErrors === 'function') { fn = retryErrors; retryErrors = false; }
  try {
    return fn();
  } catch (e) {
    var retry = !!e.retry || (retryErrors && !e.code);
    return { ok: false, error: e.code || (retry ? 'BUSY' : 'ERROR'), retry: retry,
             message: String(e && e.message || e) };
  }
}

/** Only people who can edit the spreadsheet (plus EXTRA_STAFF_EMAILS) may use the page. */
function assertStaff_(ss) {
  var email = '';
  try { email = String(Session.getActiveUser().getEmail() || '').toLowerCase(); } catch (e) {}
  if (!CONFIG.STAFF_ONLY) return email;
  if (!email) {
    throw codeErr_('NOT_SIGNED_IN', 'Google did not tell the page who you are. Open it in a Chrome window ' +
      'that is signed in ONLY to your university Google account.');
  }
  var extra = CONFIG.EXTRA_STAFF_EMAILS.map(function (x) { return String(x).toLowerCase(); });
  if (extra.indexOf(email) >= 0 || staff_(ss, false).indexOf(email) >= 0 ||
      staff_(ss, true).indexOf(email) >= 0) {
    return email;
  }
  throw codeErr_('NOT_STAFF', email + ' is not allowed to use this page. Ask the instructor to share the ' +
    'roster spreadsheet with this account as an Editor, then reload.');
}

function staff_(ss, fresh) {
  var cache = CacheService.getScriptCache();
  var hit = fresh ? null : cache.get('staff');
  if (hit) return JSON.parse(hit);
  var list = [];
  try { list = ss.getEditors().map(function (u) { return u.getEmail().toLowerCase(); }); } catch (e) {}
  try { list.push(ss.getOwner().getEmail().toLowerCase()); } catch (e) {}
  try { list.push(Session.getEffectiveUser().getEmail().toLowerCase()); } catch (e) {}
  cache.put('staff', JSON.stringify(list), 300);
  return list;
}

function codeErr_(code, msg) { var e = new Error(msg); e.code = code; return e; }

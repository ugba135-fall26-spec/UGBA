// Runs Code.gs against a tiny in-memory mock of Google Sheets.
// Usage: node exam-checkin/test/run-tests.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

function makeSheet(name, rows) {
  const data = rows.map(r => r.slice());
  const width = () => Math.max(1, ...data.map(r => r.length));
  const cell = (r, c) => { while (data.length < r) data.push([]); return data[r - 1]; };
  const sheet = {
    name, data,
    getLastColumn: () => Math.max(0, ...data.map(r => { let n = r.length; while (n && (r[n - 1] === '' || r[n - 1] == null)) n--; return n; })),
    getMaxRows: () => Math.max(data.length, 2),
    getDataRange: () => ({ getValues: () => data.map(r => { const o = r.slice(); while (o.length < width()) o.push(''); return o; }) }),
    getRange: (r, c, nr = 1, nc = 1) => {
      if (typeof r === 'string') return { setNumberFormat() { return this; } };
      const range = {
        getValue: () => { const row = cell(r, c); return row[c - 1] == null ? '' : row[c - 1]; },
        getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = cell(r + i); const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] == null ? '' : row[c - 1 + j]); out.push(o); } return out; },
        setValue: v => { cell(r, c)[c - 1] = v; return range; },
        setValues: vs => { vs.forEach((row, i) => row.forEach((v, j) => { cell(r + i)[c - 1 + j] = v; })); return range; },
        setNumberFormat: () => range,
        setFontWeight: () => range
      };
      return range;
    },
    setFrozenRows() {},
    appendRow: row => data.push(row.slice())
  };
  return sheet;
}

function load(rosterRows) {
  const sheets = {};
  if (rosterRows) sheets.Roster = makeSheet('Roster', rosterRows);
  const ss = {
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = makeSheet(n, []))
  };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    LockService: { getDocumentLock: () => ({ waitLock() {}, releaseLock() {} }) },
    console
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8'), ctx);
  return { ctx, sheets };
}

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok -', name); }

const roster = [['SID', 'Name'], [3031111111, 'Ada Lovelace'], ['3032222222', 'Alan Turing'], ['3033333333', 'Grace Hopper']];

test('setup adds tracking columns and zeros', () => {
  const { ctx, sheets } = load(roster);
  const msg = ctx.setupSheets_(true);
  assert.match(msg, /3 students/);
  assert.deepStrictEqual(sheets.Roster.data[0], ['SID', 'Name', 'Exam #', 'Check-in Time', 'Checked Out', 'Check-out Time']);
  assert.strictEqual(sheets.Roster.data[1][4], 0);
  assert.ok(sheets.Log);
});

test('full check-in then check-out flow', () => {
  const { ctx, sheets } = load(roster);
  ctx.setupSheets_(true);
  let r = ctx.processScan('3031111111\n', '');
  assert.strictEqual(r.level, 'waiting');
  assert.strictEqual(r.pendingSid, '3031111111');
  r = ctx.processScan('0042', r.pendingSid);
  assert.strictEqual(r.level, 'success', r.message);
  assert.strictEqual(sheets.Roster.data[1][2], '0042');
  assert.strictEqual(sheets.Roster.data[1][4], 0);
  assert.strictEqual(r.stats.checkedIn, 1);
  r = ctx.processScan('0042', '');
  assert.strictEqual(r.level, 'success', r.message);
  assert.match(r.message, /CHECKED OUT: Ada/);
  assert.strictEqual(sheets.Roster.data[1][4], 1);
  assert.strictEqual(r.stats.checkedOut, 1);
  assert.strictEqual(r.stats.stillOut, 0);
});

test('card barcode with extra digits matches SID', () => {
  const { ctx } = load(roster);
  ctx.setupSheets_(true);
  const r = ctx.processScan('00303222222201', '');
  assert.strictEqual(r.pendingSid, '3032222222');
});

test('duplicate exam is rejected', () => {
  const { ctx } = load(roster);
  ctx.setupSheets_(true);
  ctx.processScan('17', ctx.processScan('3031111111', '').pendingSid);
  const r = ctx.processScan('17', ctx.processScan('3032222222', '').pendingSid);
  assert.strictEqual(r.level, 'error');
  assert.match(r.message, /already assigned to Ada/);
});

test('student already checked in cannot check in again', () => {
  const { ctx } = load(roster);
  ctx.setupSheets_(true);
  ctx.processScan('5', ctx.processScan('3031111111', '').pendingSid);
  const r = ctx.processScan('3031111111', '');
  assert.strictEqual(r.level, 'error');
  assert.strictEqual(r.pendingSid, '');
});

test('unknown exam at check-out and double check-out are errors', () => {
  const { ctx } = load(roster);
  ctx.setupSheets_(true);
  assert.strictEqual(ctx.processScan('999', '').level, 'error');
  ctx.processScan('8', ctx.processScan('3033333333', '').pendingSid);
  assert.strictEqual(ctx.processScan('8', '').level, 'success');
  const r = ctx.processScan('8', '');
  assert.strictEqual(r.level, 'error');
  assert.match(r.message, /already checked out/);
});

test('exam number extracted from URL-style QR', () => {
  const { ctx, sheets } = load(roster);
  ctx.setupSheets_(true);
  const p = ctx.processScan('3031111111', '').pendingSid;
  ctx.processScan('https://example.com/exam?id=123', p);
  assert.strictEqual(sheets.Roster.data[1][2], '123');
});

test('every scan is logged', () => {
  const { ctx, sheets } = load(roster);
  ctx.setupSheets_(true);
  ctx.processScan('3031111111', '');
  ctx.processScan('999', '');
  assert.strictEqual(sheets.Log.data.length, 3);
});

console.log(`\n${passed} tests passed`);

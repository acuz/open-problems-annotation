/**
 * Receiver for the expert classification page (analysis/annotation_site/index.html).
 * Lives in a Google Sheet owned by the research team: Extensions > Apps Script, paste this file, deploy as a
 * Web app (Execute as: Me; Who has access: Anyone). The page POSTs each changed answer; every POST is appended
 * to the sheet "answers" (append-only log: the latest row per annotator_id x pid is the current answer).
 *
 * Reading the data back (for analysis/scripts/4.2_fetch_expert_answers.py): set a script property READ_TOKEN
 * (Project Settings > Script properties) to a long random string; GET <web app URL>?token=<READ_TOKEN> returns
 * all rows as JSON. Without the token, GET returns only {"ok": true}.
 */
const SHEET = "answers";
const COLS = ["received", "annotator_id", "expert_name", "expert_field", "expert_career", "pid", "arxiv_id", "poses",
              "how", "where", "statement", "confidence", "comment", "updated", "page_version"];
const MAX_RECORDS = 200, MAX_LEN = 4000;

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET);
  if (!sh) { sh = ss.insertSheet(SHEET); sh.appendRow(COLS); sh.setFrozenRows(1); }
  return sh;
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function clip_(v) {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) v = v.join(";");
  v = String(v).slice(0, MAX_LEN);
  return /^[=+\-@]/.test(v) ? "'" + v : v;  // never let a cell be read as a formula
}

function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: "bad json" }); }
  const id = String(d.annotator_id || "");
  const recs = Array.isArray(d.records) ? d.records.slice(0, MAX_RECORDS) : [];
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id) || !recs.length) return out_({ ok: false, error: "bad payload" });
  const ex = d.expert || {};
  const now = new Date().toISOString();
  const rows = recs.filter(r => /^P\d{3}$/.test(String(r.pid || ""))).map(r => [
    now, id, clip_(ex.name), clip_(ex.field), clip_(ex.career), r.pid, clip_(r.arxiv_id), clip_(r.poses), clip_(r.how),
    clip_(r.where), clip_(r.statement), clip_(r.confidence), clip_(r.comment), clip_(r.updated), clip_(d.page_version)]);
  if (!rows.length) return out_({ ok: false, error: "no valid records" });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_();
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, COLS.length).setValues(rows);
  } finally { lock.releaseLock(); }
  return out_({ ok: true, n: rows.length, pids: rows.map(r => r[5]) });
}

function doGet(e) {
  const token = PropertiesService.getScriptProperties().getProperty("READ_TOKEN");
  if (!token || !e.parameter || e.parameter.token !== token) return out_({ ok: true });
  const v = sheet_().getDataRange().getValues();
  return out_({ ok: true, columns: v[0], rows: v.slice(1) });
}

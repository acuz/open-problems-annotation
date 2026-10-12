/**
 * Receiver for the expert classification page (analysis/annotation_site/index.html) — tamper-evident version (v2).
 *
 * Setup (once): Google Sheet > Extensions > Apps Script, paste this file, save.
 *   Project Settings > Script properties: READ_TOKEN = a long random string (reading the log back, script 4.2).
 *   Run setup() once from the editor (authorises e-mail and external requests, creates the daily anchoring trigger).
 *   Deploy > Manage deployments > edit > Version: New version (Execute as: Me; Who has access: Anyone).
 *
 * What it records
 *   Sheet "log" (append-only, public after the study): one row per received answer, chained:
 *     row_hash = SHA-256(canonical), canonical = JSON array of the public fields in COLS order, including prev_hash
 *     (the row_hash of the previous row). Changing, deleting or inserting any row breaks every later hash.
 *     Names and e-mails are not in the log: identity_commit = SHA-256(salt + name + e-mail), salt kept private.
 *     invite_hash = SHA-256(invitation code) when the expert used one (codes optional).
 *   Sheet "identities" (private): annotator_id, name, e-mail, salt, first/last seen.
 *   Sheet "anchors": once a day the chain head (seq, row_hash) is time-stamped with three independent OpenTimestamps
 *     calendars (free; aggregated into Bitcoin): the stamped content is the 64-character row_hash as text; the
 *     calendars' raw responses (base64) are stored — a proof that the log up to that row existed at that time.
 *   Sheet "receipts_sent": e-mail receipts sent to experts (annotator_id, time, rows covered, head) — no addresses.
 * Receipts: every POST returns, for each stored answer, its seq and row_hash; the page keeps them for the expert.
 *   An expert can ask for an e-mail receipt (sent from the owner's account to the address the expert entered).
 * Public GET (no token) returns only the current chain head {seq, row_hash}; GET ?token=READ_TOKEN returns log
 * and anchors (never identities).
 * Verification: analysis/scripts/4.3_verify_expert_log.py recomputes the chain, checks anchors and receipts.
 */
const COLS = ["seq", "received", "annotator_id", "identity_commit", "invite_hash", "expert_field", "expert_career",
              "pid", "arxiv_id", "poses", "how", "where", "statement", "solves", "solved_problem", "confidence", "comment",
              "updated", "page_version", "prev_hash"];
const C = Object.fromEntries(COLS.map((c, i) => [c, i]));  // column index by name
const LOG_HEAD = COLS.concat(["row_hash", "canonical"]);
const GENESIS = "0".repeat(64);
const MAX_RECORDS = 200, MAX_LEN = 4000, MAX_RECEIPTS_PER_DAY = 60;
const CALENDARS = ["https://alice.btc.calendar.opentimestamps.org", "https://bob.btc.calendar.opentimestamps.org",
                   "https://finney.calendar.eternitywall.com"];

function sheet_(name, head) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, head.length).setValues([head]);
    sh.setFrozenRows(1);
    sh.getRange("A:Z").setNumberFormat("@");  // store everything as plain text (no date/number coercion)
  }
  return sh;
}
const log_ = () => sheet_("log", LOG_HEAD);
const ids_ = () => sheet_("identities", ["annotator_id", "name", "email", "salt", "first_seen", "last_seen"]);
const anchors_ = () => sheet_("anchors", ["time", "seq", "row_hash", "calendar", "status", "response_b64"]);
const sent_ = () => sheet_("receipts_sent", ["time", "annotator_id", "rows", "head_seq", "head_hash"]);

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function hex_(bytes) {
  return bytes.map(b => ((b + 256) % 256).toString(16).padStart(2, "0")).join("");
}
function sha_(s) {
  return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8));
}
function clip_(v) {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) v = v.join(";");
  return String(v).slice(0, MAX_LEN);
}
function head_() {
  const sh = log_(), n = sh.getLastRow();
  if (n < 2) return { seq: 0, hash: GENESIS };
  const v = sh.getRange(n, 1, 1, LOG_HEAD.length).getValues()[0];
  return { seq: Number(v[0]), hash: String(v[COLS.length]) };
}

function identity_(id, ex, now) {
  const sh = ids_(), v = sh.getDataRange().getValues();
  const name = clip_(ex.name).slice(0, 200), email = clip_(ex.email).slice(0, 200).toLowerCase();
  for (let i = 1; i < v.length; i++) {
    if (v[i][0] === id) {
      sh.getRange(i + 1, 2, 1, 5).setValues([[name || v[i][1], email || v[i][2], v[i][3], v[i][4], now]]);
      return sha_(v[i][3] + "|" + (name || v[i][1]) + "|" + (email || v[i][2]));
    }
  }
  const salt = Utilities.getUuid() + Utilities.getUuid();
  sh.appendRow([id, name, email, salt, now, now]);
  return sha_(salt + "|" + name + "|" + email);
}

function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: "bad json" }); }
  const id = String(d.annotator_id || "");
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return out_({ ok: false, error: "bad annotator id" });
  if (d.action === "receipt") return receipt_(id, d);
  const recs = (Array.isArray(d.records) ? d.records.slice(0, MAX_RECORDS) : []).filter(r => /^P\d{3}$/.test(String(r.pid || "")));
  if (!recs.length) return out_({ ok: false, error: "no valid records" });
  const ex = d.expert || {};
  const invite = clip_(ex.invite).trim();
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const now = new Date().toISOString();
    const commit = identity_(id, ex, now);
    let h = head_();
    const rows = [], receipts = [];
    for (const r of recs) {
      const seq = h.seq + 1;
      const fields = [String(seq), now, id, commit, invite ? sha_(invite) : "", clip_(ex.field), clip_(ex.career),
                      r.pid, clip_(r.arxiv_id), clip_(r.poses), clip_(r.how), clip_(r.where), clip_(r.statement),
                      clip_(r.solves), clip_(r.solved_problem), clip_(r.confidence), clip_(r.comment), clip_(r.updated),
                      clip_(d.page_version), h.hash];
      const canonical = JSON.stringify(fields);
      const hash = sha_(canonical);
      // readable cells: a leading = + - @ would be read as a formula even in text format, so prefix an apostrophe
      // (Sheets' quote prefix); the canonical column is authoritative and is never altered
      const readable = fields.map(v => /^[=+\-@]/.test(v) ? "'" + v : v);
      rows.push(readable.concat([hash, canonical]));
      receipts.push({ pid: r.pid, seq: seq, row_hash: hash, received: now, updated: clip_(r.updated) });
      h = { seq: seq, hash: hash };
    }
    const sh = log_();
    const rng = sh.getRange(sh.getLastRow() + 1, 1, rows.length, LOG_HEAD.length);
    rng.setNumberFormat("@");
    rng.setValues(rows);
    return out_({ ok: true, n: rows.length, pids: receipts.map(x => x.pid), receipts: receipts, head: h });
  } finally { lock.releaseLock(); }
}

function receipt_(id, d) {
  const v = log_().getDataRange().getValues().slice(1).filter(r => r[C.annotator_id] === id);
  const idr = ids_().getDataRange().getValues().find(r => r[0] === id);
  const email = idr ? String(idr[2]) : "";
  if (!v.length || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return out_({ ok: false, error: "no answers or no e-mail on record" });
  const props = PropertiesService.getScriptProperties(), day = new Date().toISOString().slice(0, 10);
  const used = Number(props.getProperty("RECEIPTS_" + day) || 0);
  if (used >= MAX_RECEIPTS_PER_DAY) return out_({ ok: false, error: "daily receipt limit reached; try tomorrow" });
  props.setProperty("RECEIPTS_" + day, String(used + 1));
  const h = head_();
  const latest = {};
  v.forEach(r => { latest[r[C.pid]] = r; });
  const lines = Object.keys(latest).sort().map(p => {
    const r = latest[p];
    return `${p}  arXiv:${r[C.arxiv_id]}  poses=${r[C.poses] || "-"}  solves=${r[C.solves] || "-"}  confidence=${r[C.confidence] || "-"}  seq=${r[C.seq]}  row_hash=${r[COLS.length]}`;
  });
  const body = [
    "Receipt for your classifications (open problems in mathematics papers).", "",
    `Annotator id: ${id}`, `Rows recorded for you: ${v.length} (latest answer per paper below)`,
    `Log head when this receipt was issued: seq ${h.seq}, row_hash ${h.hash}`, `Issued: ${new Date().toISOString()}`, "",
    ...lines, "",
    "Each row_hash is a SHA-256 fingerprint of your answer, chained to all earlier rows of the log. When the data are",
    "published you can check that these rows appear unchanged; any later change to them would alter the fingerprints.",
    "Please keep this e-mail. No reply is needed."].join("\n");
  MailApp.sendEmail({ to: email, subject: "Your classification receipt (open problems in mathematics papers)", body: body });
  sent_().appendRow([new Date().toISOString(), id, String(v.length), String(h.seq), h.hash]);
  return out_({ ok: true, sent: true, rows: v.length, head: h });
}

function doGet(e) {
  const token = PropertiesService.getScriptProperties().getProperty("READ_TOKEN");
  const h = head_();
  if (!token || !e.parameter || e.parameter.token !== token) return out_({ ok: true, head: h });
  const L = log_().getDataRange().getValues(), A = anchors_().getDataRange().getValues();
  return out_({ ok: true, head: h, columns: L[0], rows: L.slice(1), anchor_columns: A[0], anchors: A.slice(1) });
}

/** Daily: submit the chain head to the OpenTimestamps calendars and store their responses. */
function anchor() {
  const h = head_();
  if (h.seq === 0) return;
  const last = anchors_().getDataRange().getValues().slice(1).pop();
  if (last && Number(last[1]) === h.seq) return;  // nothing new since the last anchor
  // the stamped "file" is the 64-character head hash as text (head_<seq>.txt in 4.3), so anyone can check the proof
  // at opentimestamps.org by uploading that file and its .ots; the calendars receive SHA-256 of that text
  const digest = Utilities.newBlob(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h.hash, Utilities.Charset.UTF_8),
                                   "application/octet-stream");
  const now = new Date().toISOString();
  for (const cal of CALENDARS) {
    let status = "", b64 = "";
    try {
      const r = UrlFetchApp.fetch(cal + "/digest", { method: "post", payload: digest,
        headers: { Accept: "application/vnd.opentimestamps.v1" }, muteHttpExceptions: true });
      status = String(r.getResponseCode());
      b64 = Utilities.base64Encode(r.getContent());
    } catch (err) { status = "error: " + err; }
    anchors_().appendRow([now, String(h.seq), h.hash, cal, status, b64]);
  }
}

/** Run once from the editor: authorises MailApp/UrlFetchApp and installs the daily anchoring trigger. */
function setup() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === "anchor").forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("anchor").timeBased().everyDays(1).atHour(23).create();
  log_(); ids_(); anchors_(); sent_();
  Logger.log("setup done; quota of e-mails left today: " + MailApp.getRemainingDailyQuota());
}

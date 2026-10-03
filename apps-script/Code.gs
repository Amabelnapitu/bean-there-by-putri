/**
 * Bean There by Putri: votes and feedback backend.
 *
 * Paste this into the Review sheet (Extensions → Apps Script) and deploy it as a
 * web app (Execute as: Me, Who has access: Anyone). See README for the steps.
 *
 * It writes to two tabs, creating them if needed:
 *   Votes    - one row per vote; only the latest vote per phone per café counts.
 *   Feedback - one row per note. Fill in Status / Putri's Rating / Approved yourself.
 * Upvotes on the to-try list go to a third tab, Upvotes.
 */

// Optional: put your email here to get a copy of every new note.
var NOTIFY_EMAIL = '';
// Optional: set to true to also get an email for every vote (needs NOTIFY_EMAIL).
var NOTIFY_VOTES = false;

var VOTE_HEADERS = ['Timestamp', 'Device', 'District', 'Café', 'Verdict', 'Comment'];
var FEEDBACK_HEADERS = ['Timestamp', 'Device', 'Type', 'Café', 'District', 'Message', 'Name', 'Status', "Putri's Rating", 'Approved'];
var UPVOTE_HEADERS = ['Timestamp', 'Device', 'Suggestion', 'Up'];

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'summary') return json_(summary_());
  return json_({ ok: true });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Bad request.' });
  }
  if (body.website) return json_({ ok: true }); // spam trap filled in: pretend it worked

  var device = clean_(body.device, 40);
  if (!device) return json_({ ok: false, error: 'Missing device id.' });

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (body.action === 'vote') return json_(vote_(body, device));
    if (body.action === 'feedback') return json_(feedback_(body, device));
    if (body.action === 'upvote') return json_(upvote_(body, device));
    return json_({ ok: false, error: 'Unknown action.' });
  } finally {
    lock.releaseLock();
  }
}

// ---------- Sheet menu: fill in café locations ----------

// Adds a "Bean There" menu to the sheet.
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Bean There')
    .addItem('Fill in café locations (Lat, Lng)', 'fillCoordinates')
    .addToUi();
}

// Looks up every café in the APP tab that has no Lat, Lng yet and writes "lat, lng".
// Matches that don't look like a café (or fall outside Hong Kong) get a yellow cell and a note to check.
function fillCoordinates() {
  var ui = SpreadsheetApp.getUi();
  var sh = SpreadsheetApp.getActive().getSheetByName('APP');
  if (!sh) { ui.alert('No APP tab found.'); return; }
  var values = sh.getDataRange().getValues();
  var head = values[0].map(function (h) { return String(h).toLowerCase().replace(/[^a-z]/g, ''); });
  var d = head.indexOf('district'), n = head.indexOf('name'), col = head.indexOf('latlng');
  if (d === -1 || n === -1) { ui.alert('The APP tab needs District and Name columns.'); return; }
  if (col === -1) {
    col = values[0].length;
    sh.getRange(1, col + 1).setValue('Lat, Lng').setFontWeight('bold');
  }

  var geocoder = Maps.newGeocoder().setRegion('hk').setLanguage('en');
  var filled = 0, check = [], missing = [];
  for (var i = 1; i < values.length; i++) {
    var name = String(values[i][n]).trim(), district = String(values[i][d]).trim();
    var existing = col < values[i].length ? String(values[i][col]).trim() : '';
    if (!name || existing) continue;

    var cell = sh.getRange(i + 1, col + 1);
    var res = geocoder.geocode(name + ', ' + district + ', Hong Kong');
    var hit = res && res.status === 'OK' ? res.results[0] : null;
    if (!hit) { missing.push(name + ' (' + district + ')'); Utilities.sleep(150); continue; }

    var loc = hit.geometry.location;
    var inHK = loc.lat > 22.15 && loc.lat < 22.57 && loc.lng > 113.82 && loc.lng < 114.45;
    var isPlace = (hit.types || []).some(function (t) { return ['cafe', 'restaurant', 'food', 'establishment', 'point_of_interest', 'store', 'bakery'].indexOf(t) !== -1; });
    if (!inHK) { missing.push(name + ' (' + district + ')'); Utilities.sleep(150); continue; }

    cell.setValue(loc.lat.toFixed(5) + ', ' + loc.lng.toFixed(5));
    if (isPlace) { cell.setBackground(null).clearNote(); }
    else {
      cell.setBackground('#FFF4C2').setNote('Please check: matched "' + hit.formatted_address + '". Replace with the café’s own Lat, Lng if wrong.');
      check.push(name + ' (' + district + ')');
    }
    filled++;
    Utilities.sleep(150);
  }

  var msg = 'Filled in ' + filled + ' café location' + (filled === 1 ? '' : 's') + '.';
  if (check.length) msg += '\n\nPlease double-check these (yellow cells):\n• ' + check.join('\n• ');
  if (missing.length) msg += '\n\nCouldn’t find these, add them by hand:\n• ' + missing.join('\n• ');
  msg += '\n\nTo fix one: in Google Maps, long-press the café, copy the two numbers and paste them into its Lat, Lng cell.';
  ui.alert(msg);
}

// ---------- Actions ----------

function vote_(body, device) {
  var district = clean_(body.district, 80);
  var cafe = clean_(body.name, 80);
  var verdict = body.verdict;
  if (['agree', 'disagree', 'none'].indexOf(verdict) === -1) return { ok: false, error: 'Unknown vote.' };
  if (!cafeExists_(district, cafe)) return { ok: false, error: 'That café isn’t on the list.' };
  if (tooFast_('vote:' + device, 2)) return { ok: false, error: 'Easy there! Try again in a second.' };

  sheet_('Votes', VOTE_HEADERS).appendRow([new Date(), safe_(device), safe_(district), safe_(cafe), verdict, safe_(clean_(body.comment, 300))]);
  var comment = clean_(body.comment, 300);
  if (NOTIFY_EMAIL && NOTIFY_VOTES && verdict !== 'none') {
    var line = (verdict === 'agree' ? '👍 Agrees' : '👎 Disagrees') + ' with you on ' + cafe + ' (' + district + ')';
    try { MailApp.sendEmail(NOTIFY_EMAIL, 'Bean There: ' + line, line + (comment ? '\n\nThey said: ' + comment : '')); } catch (err) { /* email is optional */ }
  }
  var tally = voteTally_()[key_(district, cafe)] || { agree: 0, disagree: 0 };
  return { ok: true, votes: tally };
}

function feedback_(body, device) {
  var type = body.type;
  if (['cafe', 'idea', 'hi'].indexOf(type) === -1) return { ok: false, error: 'Unknown note type.' };
  var cafe = clean_(body.cafe, 80);
  var message = clean_(body.message, 600);
  if (type === 'cafe' && !cafe) return { ok: false, error: 'Add the café’s name so Putri can find it.' };
  if (type !== 'cafe' && !message) return { ok: false, error: 'Write a message first.' };
  if (tooFast_('note:' + device, 60)) return { ok: false, error: 'Thanks! Please wait a minute before sending another note.' };

  var district = clean_(body.district, 80);
  var name = clean_(body.name, 40);
  sheet_('Feedback', FEEDBACK_HEADERS).appendRow([new Date(), safe_(device), type, safe_(cafe), safe_(district), safe_(message), safe_(name), type === 'cafe' ? 'todo' : '', '', '']);

  if (NOTIFY_EMAIL) {
    var label = { cafe: 'café suggestion', idea: 'idea or bug', hi: 'hello' }[type];
    var lines = ['New ' + label + ' on Bean There', ''];
    if (cafe) lines.push('Café: ' + cafe + (district ? ' (' + district + ')' : ''));
    if (message) lines.push('Message: ' + message);
    lines.push('From: ' + (name || 'Anonymous'));
    if (type === 'cafe') lines.push('', 'Set Approved to "yes" in the Feedback tab to show it on the to-try list.');
    try { MailApp.sendEmail(NOTIFY_EMAIL, 'Bean There: new ' + label, lines.join('\n')); } catch (err) { /* email is optional */ }
  }
  return { ok: true };
}

function upvote_(body, device) {
  var id = parseInt(body.id, 10);
  if (!id) return { ok: false, error: 'Unknown suggestion.' };
  if (tooFast_('up:' + device, 1)) return { ok: false, error: 'Easy there! Try again in a second.' };
  sheet_('Upvotes', UPVOTE_HEADERS).appendRow([new Date(), safe_(device), id, body.up ? 1 : 0]);
  return { ok: true };
}

// ---------- Summary (read by the site) ----------

function summary_() {
  return { ok: true, votes: voteTally_(), suggestions: suggestions_(), recent: recentVotes_(15) };
}

function voteTally_() {
  var rows = rows_('Votes');
  var latest = {};
  rows.forEach(function (r) { latest[r[1] + '|' + key_(r[2], r[3])] = { key: key_(r[2], r[3]), verdict: r[4] }; });
  var tally = {};
  Object.keys(latest).forEach(function (k) {
    var v = latest[k];
    if (v.verdict !== 'agree' && v.verdict !== 'disagree') return;
    tally[v.key] = tally[v.key] || { agree: 0, disagree: 0 };
    tally[v.key][v.verdict] += 1;
  });
  return tally;
}

// Latest votes for the activity feed. Comments stay private in the sheet.
function recentVotes_(limit) {
  var rows = rows_('Votes'), out = [], seen = {};
  for (var i = rows.length - 1; i >= 0 && out.length < limit; i--) {
    var r = rows[i], k = r[1] + '|' + key_(r[2], r[3]);
    if (seen[k]) continue; // only each phone's latest vote per café
    seen[k] = 1;
    if (r[4] !== 'agree' && r[4] !== 'disagree') continue;
    out.push({ district: String(r[2]), cafe: String(r[3]), verdict: r[4], time: new Date(r[0]).getTime() });
  }
  return out;
}

function suggestions_() {
  var ups = {};
  var latest = {};
  rows_('Upvotes').forEach(function (r) { latest[r[1] + '|' + r[2]] = { id: r[2], up: Number(r[3]) === 1 }; });
  Object.keys(latest).forEach(function (k) { if (latest[k].up) ups[latest[k].id] = (ups[latest[k].id] || 0) + 1; });

  var out = [];
  rows_('Feedback').forEach(function (r, i) {
    var approved = String(r[9]).trim().toLowerCase();
    if (r[2] !== 'cafe' || ['yes', 'y', 'true', '✓', 'x'].indexOf(approved) === -1) return;
    var id = i + 2; // sheet row number
    var rating = parseFloat(r[8]);
    out.push({
      id: id, cafe: r[3], district: r[4], why: r[5], by: r[6] || 'Anonymous',
      status: String(r[7]).trim().toLowerCase() === 'tried' ? 'tried' : 'todo',
      rating: isNaN(rating) ? null : rating, votes: ups[id] || 0
    });
  });
  return out;
}

// ---------- Helpers ----------

function cafeExists_(district, cafe) {
  var app = SpreadsheetApp.getActive().getSheetByName('APP');
  if (!app) return true;
  var values = app.getDataRange().getValues();
  var head = values[0].map(function (h) { return String(h).toLowerCase().replace(/[^a-z]/g, ''); });
  var d = head.indexOf('district'), n = head.indexOf('name');
  if (d === -1 || n === -1) return true;
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][d]).trim() === district && String(values[i][n]).trim() === cafe) return true;
  }
  return false;
}

function tooFast_(key, seconds) {
  var cache = CacheService.getScriptCache();
  if (cache.get(key)) return true;
  cache.put(key, '1', seconds);
  return false;
}

function sheet_(name, headers) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

function rows_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
}

function key_(district, cafe) {
  return String(district).trim() + '|' + String(cafe).trim();
}

function clean_(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
}

// Stops text like "=IMPORTXML(...)" from being run as a formula when it lands in the sheet.
function safe_(text) {
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

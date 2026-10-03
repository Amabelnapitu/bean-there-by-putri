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

// Emails for new notes go to the Google account that owns this script.
// To send them somewhere else, put that address between the quotes.
var NOTIFY_EMAIL = '';
var NOTIFY_NOTES = true;  // email me every new note
var NOTIFY_VOTES = false; // set to true to also get an email for every vote

var VOTE_HEADERS = ['Timestamp', 'Device', 'District', 'Café', 'Verdict', 'Comment'];
var FEEDBACK_HEADERS = ['Timestamp', 'Device', 'Type', 'Café', 'District', 'Message', 'Status', "Putri's Rating", 'Approved'];
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
    .addItem('Sync APP tab from Cafe tab', 'syncFromCafe')
    .addItem('Turn on auto-sync', 'turnOnAutoSync')
    .addItem('Turn off auto-sync', 'turnOffAutoSync')
    .addSeparator()
    .addItem('Fill in café locations (Lat, Lng)', 'fillCoordinates')
    .addItem('Send me a test email', 'sendTestEmail')
    .addToUi();
}

// Also asks Google for permission to send email the first time you run it.
function sendTestEmail() {
  notify_('Bean There: test email', 'It works! New notes from the site will arrive like this.');
  alert_('Test email sent to ' + (NOTIFY_EMAIL || Session.getEffectiveUser().getEmail()) + '.');
}

// Looks up every café in the APP tab that has no Lat, Lng yet and writes "lat, lng".
// Matches that don't look like a café (or fall outside Hong Kong) get a yellow cell and a note to check.
function fillCoordinates() {
  alert_(fillCoordinates_());
}

function fillCoordinates_() {
  var sh = SpreadsheetApp.getActive().getSheetByName('APP');
  if (!sh) return 'No APP tab found.';
  var values = sh.getDataRange().getValues();
  var head = values[0].map(function (h) { return String(h).toLowerCase().replace(/[^a-z]/g, ''); });
  var d = head.indexOf('district'), n = head.indexOf('name'), col = head.indexOf('latlng');
  if (d === -1 || n === -1) return 'The APP tab needs District and Name columns.';
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
  if (check.length || missing.length) msg += '\n\nTo fix one: in Google Maps, long-press the café, copy the two numbers and paste them into its Lat, Lng cell.';
  return msg;
}

// Shows a pop-up in the sheet, or writes to the Execution log when run from the script editor.
function alert_(msg) {
  console.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (err) { /* run from the editor: see the Execution log */ }
}

// ---------- Sync: Cafe tab → APP tab ----------
//
// Copies your edits in the Cafe tab into the APP tab, without touching what only the APP tab has
// (Rank, Drink, Taste, Tags, Maps Link, Lat, Lng and the reworded notes).
//   • Change a rating, price or order in the Cafe tab → the same café updates in the APP tab.
//   • Change a review → the APP tab's Note gets your new wording, highlighted so you can tidy it.
//   • Add a café → it's added to the APP tab (highlighted) and its location is looked up.
// It remembers what the Cafe tab looked like last time in a hidden "_sync" tab, so only real
// changes are copied over.

var DISTRICT_ALIASES = { tst: 'Tsim Sha Tsui', cwb: 'Causeway Bay', syp: 'Sai Ying Pun', kt: 'Kennedy Town', sw: 'Sheung Wan', wc: 'Wan Chai', mk: 'Mong Kok', np: 'North Point', 'tai koo': 'Taikoo' };
var NAME_STOPWORDS = ['the', 'and', 'a', 's', 'co', 'coffee', 'cafe', 'roasters', 'roastery', 'house'];

function syncFromCafe() {
  alert_(syncFromCafe_(false));
}

// Runs automatically after edits to the Cafe tab once auto-sync is on.
function onCafeEdit(e) {
  if (e && e.range && e.range.getSheet().getName() !== 'Cafe') return;
  syncFromCafe_(true);
}

function turnOnAutoSync() {
  turnOffAutoSync_();
  ScriptApp.newTrigger('onCafeEdit').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  alert_('Auto-sync is on. Edits to the Cafe tab now update the APP tab by themselves (give it a few seconds).');
}

function turnOffAutoSync() {
  turnOffAutoSync_();
  alert_('Auto-sync is off. Use Bean There → Sync APP tab from Cafe tab when you want to update.');
}

function turnOffAutoSync_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onCafeEdit') ScriptApp.deleteTrigger(t);
  });
}

function syncFromCafe_(silent) {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) return 'Another sync is running. Try again in a moment.';
  try {
    var ss = SpreadsheetApp.getActive();
    var cafeSh = ss.getSheetByName('Cafe'), appSh = ss.getSheetByName('APP');
    if (!cafeSh || !appSh) return 'Couldn’t find the Cafe and APP tabs.';

    var items = parseCafeRows_(cafeSh.getDataRange().getValues());
    var appValues = appSh.getDataRange().getValues();
    var head = appValues[0].map(function (h) { return String(h).toLowerCase().replace(/[^a-z]/g, ''); });
    var col = function (k) { return head.indexOf(k); };
    var C = { district: col('district'), name: col('name'), rating: col('rating'), order: col('mustorder'), drink: col('drink'), price: col('price'), note: col('note') };
    if (C.district === -1 || C.name === -1) return 'The APP tab needs District and Name columns.';
    var appRows = appValues.slice(1).map(function (r, i) { return { row: i + 2, district: String(r[C.district]).trim(), name: String(r[C.name]).trim() }; })
      .filter(function (r) { return r.name; });

    var pairs = matchCafes_(items, appRows);
    var snapSheet = ss.getSheetByName('_sync');
    var snap = snapSheet ? readSnapshot_(snapSheet) : SYNC_BASELINE;
    var next = {}, changed = [], added = [], today = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'd MMM yyyy');
    var FIELD_COL = { r: C.rating, p: C.price, o: C.order, v: C.note };
    var FIELD_NAME = { r: 'rating', p: 'price', o: 'order', v: 'review' };

    pairs.matched.forEach(function (m) {
      var key = m.app.district + '|' + m.app.name, cur = cafeFields_(m.cafe), prev = snap[key];
      next[key] = cur;
      if (!prev) return;
      var what = [];
      ['r', 'p', 'o', 'v'].forEach(function (f) {
        if (same_(cur[f], prev[f]) || FIELD_COL[f] === -1) return;
        var cell = appSh.getRange(m.app.row, FIELD_COL[f] + 1);
        cell.setValue(f === 'r' && cur.r !== '' && !isNaN(Number(cur.r)) ? Number(cur.r) : cur[f]);
        if (f === 'v') cell.setBackground('#EFE6FA').setNote('Updated from the Cafe tab on ' + today + '. This is your original wording; tidy it up if you like.');
        what.push(FIELD_NAME[f]);
      });
      if (what.length) changed.push(m.app.name + ' (' + m.app.district + '): ' + what.join(', '));
    });

    pairs.unmatched.forEach(function (it) {
      var cur = cafeFields_(it), row = [];
      for (var i = 0; i < head.length; i++) row.push('');
      row[C.district] = it.district; row[C.name] = it.name;
      if (C.rating !== -1) row[C.rating] = cur.r === '' ? '' : Number(cur.r);
      if (C.order !== -1) row[C.order] = cur.o;
      if (C.drink !== -1) row[C.drink] = guessDrink_(cur.o);
      if (C.price !== -1) row[C.price] = cur.p;
      if (C.note !== -1) row[C.note] = cur.v;
      appSh.appendRow(row.map(function (v) { return typeof v === 'string' ? safe_(v) : v; }));
      var r = appSh.getLastRow();
      appSh.getRange(r, 1, 1, head.length).setBackground('#EFE6FA');
      appSh.getRange(r, C.name + 1).setNote('New from the Cafe tab on ' + today + '. Add Rank, Taste and Tags if you like.');
      next[it.district + '|' + it.name] = cur;
      added.push(it.name + ' (' + it.district + ')');
    });

    writeSnapshot_(snapSheet || ss.insertSheet('_sync').hideSheet(), next);
    var located = added.length ? fillCoordinates_() : '';

    var missing = pairs.unusedApp.map(function (a) { return a.name + ' (' + a.district + ')'; });
    var msg = changed.length || added.length ? 'APP tab updated.' : 'Everything already matches. Nothing to update.';
    if (changed.length) msg += '\n\nUpdated:\n• ' + changed.join('\n• ');
    if (added.length) msg += '\n\nAdded (highlighted in lilac):\n• ' + added.join('\n• ') + '\n\n' + located;
    if (missing.length && !silent) msg += '\n\nIn the APP tab but not found in the Cafe tab (left as they are):\n• ' + missing.join('\n• ');
    if (!silent) msg += '\n\nThe website picks this up within about 5 minutes.';
    return msg;
  } finally {
    lock.releaseLock();
  }
}

// One entry per café. Handles merged cells and cafés that span several rows.
function parseCafeRows_(values) {
  var head = values[0].map(function (h) { return String(h).toLowerCase().replace(/[^a-z]/g, ''); });
  function find(prefix, fallback) {
    for (var i = 0; i < head.length; i++) if (head[i].indexOf(prefix) === 0) return i;
    return fallback;
  }
  var L = find('location', 0), N = find('no', 1), NAME = find('name', 2), O = find('order', 3), P = find('price', 4), R = find('rate', 5), V = find('review', 6);
  var out = [], district = '', cur = null;
  function text(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (text(row[L])) district = canonDistrict_(text(row[L]));
    var no = text(row[N]), name = text(row[NAME]), order = text(row[O]), price = text(row[P]), rate = text(row[R]), review = text(row[V]);
    if (!no && !name && !order && !price && !rate && !review) continue;
    if (no || name || !cur) {
      cur = { district: district, name: name, orders: [], prices: [], rating: '', reviews: [] };
      out.push(cur);
    }
    if (order) cur.orders.push(order);
    if (price && cur.prices.indexOf(price) === -1) cur.prices.push(price);
    if (rate && cur.rating === '') cur.rating = rate;
    if (review) cur.reviews.push(review);
  }
  return out.filter(function (c) { return c.name; });
}

function cafeFields_(c) {
  return {
    r: c.rating,
    p: c.prices.join(' / '),
    o: c.orders.join(' + '),
    v: c.reviews.map(function (s) { return /[.!?)]$/.test(s) ? s : s + '.'; }).join(' ')
  };
}

function canonDistrict_(d) {
  var k = d.toLowerCase().trim();
  return DISTRICT_ALIASES[k] || d.trim();
}

function normName_(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/).filter(function (t) { return t && NAME_STOPWORDS.indexOf(t) === -1; }).join('');
}

function nameScore_(a, b) {
  var x = normName_(a), y = normName_(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  var short = x.length < y.length ? x : y, long = x.length < y.length ? y : x;
  if (short.length >= 3 && long.indexOf(short) !== -1) return 0.9;
  return 1 - levenshtein_(x, y) / Math.max(x.length, y.length);
}

// Edit distance where swapping two neighbouring letters ("Haflway") counts as one typo.
function levenshtein_(a, b) {
  var d = [], i, j;
  for (i = 0; i <= a.length; i++) { d.push([i]); }
  for (j = 1; j <= b.length; j++) d[0].push(j);
  for (i = 1; i <= a.length; i++) {
    for (j = 1; j <= b.length; j++) {
      var cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// Pairs each Cafe-tab café with its APP row (same district, closest name).
function matchCafes_(items, appRows) {
  var pairs = [];
  items.forEach(function (it, i) {
    appRows.forEach(function (a, j) {
      if (a.district.toLowerCase() !== it.district.toLowerCase()) return;
      var s = nameScore_(it.name, a.name);
      if (s >= 0.75) pairs.push({ i: i, j: j, s: s });
    });
  });
  pairs.sort(function (p, q) { return q.s - p.s; });
  var usedI = {}, usedJ = {}, matched = [];
  pairs.forEach(function (p) {
    if (usedI[p.i] || usedJ[p.j]) return;
    usedI[p.i] = usedJ[p.j] = true;
    matched.push({ cafe: items[p.i], app: appRows[p.j] });
  });
  return {
    matched: matched,
    unmatched: items.filter(function (_, i) { return !usedI[i]; }),
    unusedApp: appRows.filter(function (_, j) { return !usedJ[j]; })
  };
}

function same_(a, b) {
  var x = String(a == null ? '' : a).replace(/\s+/g, ' ').trim(), y = String(b == null ? '' : b).replace(/\s+/g, ' ').trim();
  if (x === y) return true;
  return x !== '' && y !== '' && !isNaN(Number(x)) && Number(x) === Number(y);
}

function guessDrink_(order) {
  var s = String(order).toLowerCase();
  if (/flat[ -]white|\boat white|\bice[d]? (oat )?white/.test(s)) return 'Flat White';
  if (s.indexOf('tonic') !== -1) return 'Espresso Tonic';
  if (s.indexOf('matcha') !== -1) return 'Matcha';
  if (s.indexOf('americano') !== -1) return 'Americano';
  if (s.indexOf('latte') !== -1) return 'Latte';
  return 'Other';
}

function readSnapshot_(sh) {
  var snap = {};
  if (sh.getLastRow() < 2) return snap;
  sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues().forEach(function (r) {
    snap[r[0]] = { r: String(r[1]), p: String(r[2]), o: String(r[3]), v: String(r[4]) };
  });
  return snap;
}

function writeSnapshot_(sh, snap) {
  sh.clear();
  var rows = [['Key', 'Rating', 'Price', 'Order', 'Review']];
  Object.keys(snap).forEach(function (k) { rows.push([k, snap[k].r, snap[k].p, snap[k].o, snap[k].v]); });
  sh.getRange(1, 1, rows.length, 5).setNumberFormat('@').setValues(rows);
}

// What the Cafe tab looked like when the APP tab was built, so the first sync only copies newer edits.
var SYNC_BASELINE = {"Kennedy Town|Blend & Grind":{"r":"4.5","p":"154 (Lunch Set)","o":"Acai Bowl and Latte","v":"Would go again."},"Kennedy Town|% Arabica":{"r":"4.5","p":"55","o":"Kyoto Latte","v":"Small sitting place."},"Kennedy Town|Little Cove Espresso":{"r":"5","p":"32 / 40","o":"Almond& Pistachio Croissant + Latte","v":"Would go again."},"Kennedy Town|Creo by Brentwood":{"r":"4","p":"103","o":"Latte (Oat) + Bagel + Egg","v":"Coffe okay. Normal bagel and egg you would expect."},"Kennedy Town|Winstons Coffee":{"r":"3.7","p":"42","o":"Latte","v":"Too milky for my taste."},"Kennedy Town|tgif":{"r":"4","p":"45 / 40","o":"Oat Latte (Nut Blend) + Long Black (Nut Blend)","v":"The latte okay, but the beans not my fav. Really spacious, good to work at."},"Sheung Wan|Cupping Room":{"r":"3.7","p":"42","o":"Flat White","v":"Coffee not my style but ambiance cute, no ports."},"Sheung Wan|The Station":{"r":"3.7","p":"45","o":"Latte","v":"Late quite meh, vibes not g."},"Sheung Wan|Detour":{"r":"3.5","p":"44","o":"Flat White (Oat Milk)","v":"First sip was okay afterwards quite meh."},"Sheung Wan|Gwee":{"r":"3.5","p":"45","o":"Latte","v":"Nothing special both drink and vibes."},"Sheung Wan|Hub Coffee Roasters":{"r":"3.9","p":"42","o":"Flat White","v":"Drink is pretty good and strong, and there is enough space to work."},"Sheung Wan|Meanwhile Coffee":{"r":"3.7","p":"45","o":"Flat White","v":"The flat white is good but a little milky, the space is cozy and small."},"Sheung Wan|Purna":{"r":"3","p":"48","o":"Matcha Latte","v":"Drink is okay, vibes okay, the chair uncomfy for long periods."},"Sheung Wan|Espresso Remedy":{"r":"4.5","p":"55","o":"Espresso Tonic","v":"Really good! No place to seat but great take away option."},"Sheung Wan|Barista Jam":{"r":"4.5","p":"58","o":"Espresso Tonic","v":"Really good! There are space to seat but super small."},"Sheung Wan|Lazy Sunday":{"r":"4.5","p":"50","o":"Espresso Tonic","v":"Love their nutty blend! I can actually taste the hint of chocolate and there's actually decent volume."},"Wan Chai|Elephant Grounds":{"r":"4.2","p":"","o":"Fig Toast + Latte","v":"Place too small. Latte v good."},"Wan Chai|Project C":{"r":"4.5","p":"45","o":"Iced Flat White","v":"Iced Flat White V good but no sitting area."},"Wan Chai|Dimanche":{"r":"4","p":"40","o":"Iced Latte","v":"Iced Flat White V good but no sitting area."},"Wan Chai|Sleepy Head":{"r":"3.5","p":"3","o":"Iced Latte","v":"Too milky and the coffee beans not my taste."},"Wan Chai|Crew Coffee":{"r":"4.5","p":"3","o":"Flat White","v":"Not that good small portion."},"Wan Chai|Sipper Coffee":{"r":"2","p":"55","o":"Coffee Tonic","v":"Place too small, possibly ordered the wrong thing but it's so bad."},"Wan Chai|Artista Prefetto":{"r":"3.7","p":"40","o":"Flat White","v":"Not bad but nothing special."},"Wan Chai|APT":{"r":"3.7","p":"53","o":"Matcha Latte","v":"Very milky matcha latte good vibes tho."},"Wan Chai|Grandma's Coffee":{"r":"4","p":"45","o":"Americano","v":"Pretty solid, but the Nutty beans not my favorite."},"Wan Chai|Kaori":{"r":"4.1","p":"29","o":"Americano","v":"Solid, the beans are good and it's cheap so v good option."},"Wan Chai|Mansons Lot":{"r":"3.7","p":"45","o":"Flat White","v":"Too milky for flat white, also the portions too small."},"Mong Kok|Minamoto":{"r":"4.5","p":"60","o":"Espresso Tonic","v":"Cute place and the espresso tonic hits."},"Mong Kok|Lungo":{"r":"5","p":"55","o":"Espresso Tonic","v":"Love this place, the place is cozy and the espresso tonic slaps."},"Causeway Bay|NOC":{"r":"4.5","p":"51","o":"Ice White (Oat)","v":"Very smooth."},"Causeway Bay|Ninety's Roastery":{"r":"4.7","p":"35","o":"White(Oat)","v":"If pay with cash cheaper, espresso tonic SO GOOD and only 48."},"Causeway Bay|Urban Roasters":{"r":"4","p":"190","o":"Flat White","v":"The coffee is good ( don't come on weekends)"},"Causeway Bay|Pedestrian Coffee":{"r":"3.5","p":"40","o":"Flat White","v":"A little milky but good, small space and only accept octopus/cash."},"Causeway Bay|Hogan Coffee":{"r":"4","p":"40","o":"Flat White","v":"Pretty strong, the space is a little small and hard to find."},"Causeway Bay|Hypebeans":{"r":"5","p":"60","o":"Espresso Tonic","v":"Really nice and refreshing, a bit on the pricier end tho."},"Causeway Bay|SINBAD Coffee Roasters":{"r":"3.7","p":"40","o":"Flat White","v":"It's okay, not too strong but not that milky so good balance, but wouldn't go all the way here."},"Causeway Bay|Caflex":{"r":"3.7","p":"48","o":"Flat White","v":"It's okay, nothing too special (it was +8 dollar for the fruity beans, probably should have gotten the normal one maybe)"},"Causeway Bay|BLTN":{"r":"3.7","p":"48","o":"Spanish Latte","v":"Nothing special, also really pricey for one small cup of coffee."},"Central|Between Coffee":{"r":"4","p":"50","o":"Latte","v":"Good Latte, So hard to find :) [CLOSED]."},"Central|Zero Sense Coffee":{"r":"4.5","p":"42","o":"Flat White","v":"Coffee v good, but so small."},"Central|Hjem":{"r":"4","p":"48","o":"Iced Latte","v":"Coffe good, v strong, cozy space."},"Central|Hazel & Hershey":{"r":"3.75","p":"45","o":"Flat White","v":"Flat White good but nothing special, vibes pretty nice tho."},"Central|Nook":{"r":"3.5","p":"42","o":"Flat White","v":"The initial taste is okay, but afterwards the coffe bean flavor is too roasted for me."},"Central|Haus Coffee Club":{"r":"3.5","p":"60","o":"Haus Coffee","v":"A little oily and too much cream, but the coffee itself is good."},"Central|First Crack Coffee":{"r":"3.7","p":"60","o":"Yuzu Espresso Tonic","v":"It's okay, like normal espresso tonic."},"Central|Moonary":{"r":"4","p":"58","o":"Espresso Tonic","v":"The espresso tonic is good but the volume is so less."},"Admiralty|Sourdough":{"r":"4.5","p":"100","o":"Italian Sandwich + Latte","v":"Good value for the price. Latte okay."},"Admiralty|Bow Coffee":{"r":"4","p":"45","o":"Oat Latte","v":"Latte okay, nice vibes to work at."},"Admiralty|Sleepy Head":{"r":"3","p":"45","o":"Latte","v":"Too milky, the beans not my fav."},"Admiralty|Soft Thunder":{"r":"4","p":"42","o":"Orange Espresso","v":"The place is spacy, the coffe was really yum not too strong tho."},"Tsim Sha Tsui|Ukiyo":{"r":"3.7","p":"168 / 50","o":"Mochi Waffle + Latte","v":"The mochi is good. Too pricy tho, given the quality."},"Tsim Sha Tsui|Elephant Grounds":{"r":"4","p":"","o":"Latte (Oat) + Taco Rice","v":"The place is good. The food portion smaller than expected."},"Tsim Sha Tsui|Crema":{"r":"3","p":"31","o":"Latte","v":"It's like coffee flavored milk tbh..."},"Tsim Sha Tsui|N1 Coffee":{"r":"3.5","p":"45","o":"Mocha","v":"It's good but not like outstanding. Would buy again if I'm in the area but wouldn't go out of my way to get it."},"Sai Ying Pun|Moojoo Café":{"r":"3.7","p":"41","o":"Latte (Oat)","v":"The vibes is nice, but the coffee beans not my taste."},"Sai Ying Pun|Fikafabriken":{"r":"3.7","p":"86","o":"Flat White (Oat) + Chocolate Muffin","v":"The vibes is cozy, the coffe is nice comes with cookie. The choco muffin not so good."},"Sai Ying Pun|NOC":{"r":"4.1","p":"42 / 78","o":"Flat White + Golden Sando","v":"Maybe don't come on holidays. Overall vibe is nice and boost productivity."},"Sai Ying Pun|Coffee by Zion":{"r":"3.8","p":"128","o":"Eggs Benedict + Americano + Oat Creamer","v":"The food is okay, the coffee is okay. There is time limit so probably can't work there."},"Sai Ying Pun|Fine Print (South Lane)":{"r":"4.5","p":"35 / 95","o":"Oat milk flat white + Half Half","v":"Flat white v good, v cheap. No ports tho have to full charge before going."},"Sai Ying Pun|Winstons Coffee":{"r":"4.3","p":"49 / 55","o":"Flat White (Oat) + Espresso Tonic","v":"It's pretty solid. Really good."},"Sai Ying Pun|Books & Co":{"r":"3","p":"90","o":"Latte & Cheese Cake","v":"The cheese cake super good and light but the coffee is not the best."},"Sai Ying Pun|Rootdown":{"r":"4","p":"60","o":"Espresso Tonic","v":"Good Espresso Tonic but nothing special."},"Sai Ying Pun|Two-and-a-Half Street":{"r":"4.2","p":"40","o":"Flat-White","v":"The flat white was nice, a little to milky for my taste but definetly a better flat white in HK The vibes was so nice and the food was sooo good! Def value for money."},"Sai Ying Pun|Coffee and Laundry":{"r":"3","p":"45","o":"Flat-White","v":"Closer to Latte than Flat-white, the bean itself is just okay. Cute concept tho."},"Sai Ying Pun|Wako2ffee House":{"r":"4.5","p":"38","o":"Americano","v":"The americano is pretty nice, the beans are not sour and light."},"Sai Ying Pun|Dear Neighbor Coffee":{"r":"3.5","p":"56","o":"Espresso Tonic","v":"Didn't like the beans and the espresso tonic is very diluted."},"North Point|Dozy":{"r":"4.7","p":"60","o":"Espresso Tonic","v":"Really good really cozy place."},"North Point|Studio Caffeine":{"r":"4","p":"45","o":"Flat White","v":"Good Flate white cozy place."},"North Point|Kindly Tails":{"r":"4.7","p":"55","o":"Strawberry Matcha","v":"Love the matcha, cute place too but not suitable to work in that cafe."},"Fortress Hill|Coffee Obsession":{"r":"4","p":"55","o":"Espresso Tonic","v":"Actually really good but portion v small :(."},"Fortress Hill|Smoko":{"r":"5","p":"50","o":"Espresso Tonic","v":"Super good and worth the money."},"Fortress Hill|Uncle Ben":{"r":"3.7","p":"43","o":"Iced Latte","v":"Didn't really like the bean maybe would be better if I went with other option."},"Taikoo|Blooms Coffee":{"r":"5","p":"54","o":"Epresson Tonic","v":"Super good for value, really good super worth it."},"Taikoo|Coco Espresso":{"r":"4.5","p":"45","o":"Flat White (Oat)","v":"Really good but only takeaway, no additional charge for oat milk."},"Taikoo|Make It Simple":{"r":"3.7","p":"55","o":"Espresso Tonic","v":"The beans are good but I don't like the tonic water they use."},"Tin Hau|First Place Coffee":{"r":"4","p":"43 / 54","o":"Flat White + Pecan Pie","v":"Pretty solid coffee and cozy space."},"Sheung Wan|Elephant Grounds":{"r":"4","p":"","o":"Peach Pancake + Cold Brew","v":"Cozy Vibes. Will go back to do work."},"Repulse Bay|Café Parabolica":{"r":"3.7","p":"50","o":"Oat Milk Latte","v":"Coffe okay. but not worth the trip."},"Wan Chai|KLF Coffee":{"r":"5","p":"28","o":"Flat White","v":"V good V cheap."},"Wan Chai|Noda Coffee":{"r":"3.5","p":"55","o":"Matcha Latte","v":"Nothing special, a little steep price for matcha."},"Causeway Bay|Cloudnine Coffee":{"r":"3.5","p":"40","o":"Flat White","v":"Too bitter for my taste."},"Central|Omotesando Koffee":{"r":"3.5","p":"55","o":"Latte","v":"It's okay, nothing special and a little pricey."},"Admiralty|Crew Coffee":{"r":"2","p":"45","o":"Flat White","v":"Too milky, size too small."},"Central|Barista by Givres":{"r":"3.7","p":"30","o":"Flat White","v":"For the price really solid, would go back if I'm in the area."},"Sheung Wan|Halfway Coffee":{"r":"5","p":"45","o":"Oat milk Latte","v":"Super good coffee and super cute vibes, too small to work at."}};


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
  if (NOTIFY_VOTES && verdict !== 'none') {
    var line = (verdict === 'agree' ? '👍 Someone agrees' : '👎 Someone disagrees') + ' with you on ' + cafe + ' (' + district + ')';
    notify_('Bean There: ' + line, line + (comment ? '\n\nThey said: “' + comment + '”' : ''));
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
  var fb = feedbackSheet_();
  fb.appendRow([new Date(), safe_(device), type, safe_(cafe), safe_(district), safe_(message), type === 'cafe' ? 'todo' : '', '', type === 'cafe' ? 'no' : '']);

  if (NOTIFY_NOTES) {
    var label = { cafe: 'café suggestion', idea: 'idea or bug report', hi: 'hello' }[type];
    var lines = [];
    if (cafe) lines.push('Café: ' + cafe + (district ? ' (' + district + ')' : ''));
    if (message) lines.push((type === 'cafe' ? 'Why: ' : '') + '“' + message + '”');
    if (type === 'cafe') lines.push('', 'To show it on the to-try list, set Approved to "yes" in the Feedback tab.');
    lines.push('', 'Open the Feedback tab: ' + SpreadsheetApp.getActive().getUrl() + '#gid=' + fb.getSheetId());
    notify_('Bean There: new ' + label + (cafe ? ' (' + cafe + ')' : ''), lines.join('\n'));
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
    var approved = String(r[8]).trim().toLowerCase();
    if (r[2] !== 'cafe' || ['yes', 'y', 'true', '✓', 'x'].indexOf(approved) === -1) return;
    var id = i + 2; // sheet row number
    var rating = parseFloat(r[7]);
    out.push({
      id: id, cafe: r[3], district: r[4], why: r[5],
      status: String(r[6]).trim().toLowerCase() === 'tried' ? 'tried' : 'todo',
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

function notify_(subject, body) {
  var to = NOTIFY_EMAIL || Session.getEffectiveUser().getEmail();
  if (!to) return;
  try { MailApp.sendEmail(to, subject, body); } catch (err) { console.warn('Email failed: ' + err); }
}

// The Feedback tab, with Status and Approved dropdowns.
function feedbackSheet_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('Feedback');
  if (sh) return sh;
  sh = sheet_('Feedback', FEEDBACK_HEADERS);
  var rows = sh.getMaxRows() - 1;
  sh.getRange(2, 7, rows, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['todo', 'tried'], true).setAllowInvalid(true).build());
  sh.getRange(2, 9, rows, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['yes', 'no'], true).setAllowInvalid(true).build());
  sh.setColumnWidth(6, 320);
  return sh;
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

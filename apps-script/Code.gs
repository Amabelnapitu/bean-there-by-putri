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
    .addItem('Sync app tabs (Cafe → APP, Restaurant → FOOD)', 'syncFromCafe')
    .addItem('Turn on auto-sync', 'turnOnAutoSync')
    .addItem('Turn off auto-sync', 'turnOffAutoSync')
    .addSeparator()
    .addItem('Fill in locations (Lat, Lng)', 'fillCoordinates')
    .addItem('Re-rank every district', 'rerankAll')
    .addSeparator()
    .addItem('Check for closed places now', 'checkClosedPlaces')
    .addItem('Set up monthly closed-place check', 'setUpClosedCheck')
    .addItem('Turn off monthly closed-place check', 'turnOffClosedCheck')
    .addSeparator()
    .addItem('Send me a test email', 'sendTestEmail')
    .addToUi();
}

// Also asks Google for permission to send email the first time you run it.
function sendTestEmail() {
  notify_('Bean There: test email', 'It works! New notes from the site will arrive like this.');
  alert_('Test email sent to ' + (NOTIFY_EMAIL || Session.getEffectiveUser().getEmail()) + '.');
}

// Looks up every place in the APP and FOOD tabs that has no Lat, Lng yet and writes "lat, lng".
// Matches that don't look like a café or restaurant (or fall outside Hong Kong) get a yellow cell and a note to check.
function fillCoordinates() {
  var msgs = SYNC_SOURCES.map(function (cfg) {
    return sheetByName_(SpreadsheetApp.getActive(), cfg.target) ? cfg.target + ' tab: ' + fillCoordinates_(cfg.target, cfg.what) : '';
  }).filter(String);
  alert_(msgs.join('\n\n'));
}

function fillCoordinates_(tabName, what) {
  tabName = tabName || 'APP'; what = what || 'café';
  var sh = sheetByName_(SpreadsheetApp.getActive(), tabName);
  if (!sh) return 'No ' + tabName + ' tab found.';
  var values = sh.getDataRange().getValues();
  var head = values[0].map(function (h) { return String(h).toLowerCase().replace(/[^a-z]/g, ''); });
  var d = head.indexOf('district'), n = head.indexOf('name'), col = head.indexOf('latlng');
  if (d === -1 || n === -1) return 'The ' + tabName + ' tab needs District and Name columns.';
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
    var isPlace = (hit.types || []).some(function (t) { return ['cafe', 'restaurant', 'food', 'meal_takeaway', 'establishment', 'point_of_interest', 'store', 'bakery'].indexOf(t) !== -1; });
    if (!inHK) { missing.push(name + ' (' + district + ')'); Utilities.sleep(150); continue; }

    cell.setValue(loc.lat.toFixed(5) + ', ' + loc.lng.toFixed(5));
    if (isPlace) { cell.setBackground(null).clearNote(); }
    else {
      cell.setBackground('#FFF4C2').setNote('Please check: matched "' + hit.formatted_address + '". Replace with the ' + what + '’s own Lat, Lng if wrong.');
      check.push(name + ' (' + district + ')');
    }
    filled++;
    Utilities.sleep(150);
  }

  var msg = 'Filled in ' + filled + ' location' + (filled === 1 ? '' : 's') + '.';
  if (check.length) msg += '\n\nPlease double-check these (yellow cells):\n• ' + check.join('\n• ');
  if (missing.length) msg += '\n\nCouldn’t find these, add them by hand:\n• ' + missing.join('\n• ');
  if (check.length || missing.length) msg += '\n\nTo fix one: in Google Maps, long-press the place, copy the two numbers and paste them into its Lat, Lng cell.';
  return msg;
}

// Finds a tab by name, ignoring stray spaces (the Restaurant tab is called "Restaurant ").
function sheetByName_(ss, name) {
  var want = String(name).trim().toLowerCase();
  var hit = ss.getSheets().filter(function (sh) { return sh.getName().trim().toLowerCase() === want; });
  return hit.length ? hit[0] : null;
}

// Shows a pop-up in the sheet, or writes to the Execution log when run from the script editor.
function alert_(msg) {
  console.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (err) { /* run from the editor: see the Execution log */ }
}

// ---------- Sync: Cafe tab → APP tab, Restaurant tab → FOOD tab ----------
//
// Copies your edits in the Cafe tab into the APP tab (and the Restaurant tab into the FOOD tab),
// without touching what only the app tabs have (Rank, Drink, Cuisine, Taste, Tags, Maps Link,
// Lat, Lng and the reworded notes).
//   • Change a rating, price or order in the Cafe tab → the same café updates in the APP tab.
//   • Change a review → the APP tab's Note gets your new wording, highlighted so you can tidy it.
//   • Add a café → it's added to the APP tab (highlighted), its location is looked up, and its
//     Tags (plus Drink or Cuisine) are suggested from your review, order and price.
//   • New places and rating changes re-rank that district: Rank 1–3 go to the highest-rated places
//     rated 4 or more (ties keep the existing order). Closed places never get a rank.
// It remembers what the Cafe and Restaurant tabs looked like last time in hidden "_sync" and
// "_sync_food" tabs, so only real changes are copied over.

var DISTRICT_ALIASES = { tst: 'Tsim Sha Tsui', cwb: 'Causeway Bay', syp: 'Sai Ying Pun', kt: 'Kennedy Town', sw: 'Sheung Wan', wc: 'Wan Chai', mk: 'Mong Kok', np: 'North Point', 'tai koo': 'Taikoo' };
var NAME_STOPWORDS = ['the', 'and', 'a', 's', 'co', 'coffee', 'cafe', 'roasters', 'roastery', 'house'];

// Each source tab and the app tab it feeds. `fill` suggests values for a new row's extra columns.
var SYNC_SOURCES = [
  { id: 'cafe', source: 'Cafe', target: 'APP', snapshot: '_sync', what: 'café', fill: function (cur) { return { drink: guessDrink_(cur.o), tags: guessTags_('cafe', cur) }; } },
  { id: 'food', source: 'Restaurant', target: 'FOOD', snapshot: '_sync_food', what: 'restaurant', fill: function (cur) { return { cuisine: guessCuisine_(cur.o), tags: guessTags_('food', cur) }; } }
];
function baselineFor_(id) { return id === 'food' ? FOOD_BASELINE : SYNC_BASELINE; }

function syncFromCafe() {
  alert_(syncAll_(false));
}

// Runs automatically after edits to the Cafe or Restaurant tab once auto-sync is on.
function onCafeEdit(e) {
  if (e && e.range) {
    var name = e.range.getSheet().getName().trim().toLowerCase();
    if (!SYNC_SOURCES.some(function (cfg) { return cfg.source.toLowerCase() === name; })) return;
  }
  syncAll_(true);
}

function turnOnAutoSync() {
  turnOffAutoSync_();
  ScriptApp.newTrigger('onCafeEdit').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  alert_('Auto-sync is on. Edits to the Cafe and Restaurant tabs now update the APP and FOOD tabs by themselves (give it a few seconds).');
}

function turnOffAutoSync() {
  turnOffAutoSync_();
  alert_('Auto-sync is off. Use Bean There → Sync app tabs when you want to update.');
}

function turnOffAutoSync_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onCafeEdit') ScriptApp.deleteTrigger(t);
  });
}

function syncAll_(silent) {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) return 'Another sync is running. Try again in a moment.';
  try {
    var ss = SpreadsheetApp.getActive();
    var msgs = SYNC_SOURCES.map(function (cfg) {
      if (!sheetByName_(ss, cfg.target)) return silent ? '' : cfg.target + ' tab: not set up yet (skipped).';
      return cfg.target + ' tab: ' + syncTab_(ss, cfg, silent);
    }).filter(String);
    if (!silent) msgs.push('The websites pick this up within about 5 minutes.');
    return msgs.join('\n\n');
  } finally {
    lock.releaseLock();
  }
}

// Kept so older menus and the script editor's Run button still work.
function syncFromCafe_(silent) { return syncAll_(silent); }

function syncTab_(ss, cfg, silent) {
  var srcSh = sheetByName_(ss, cfg.source), appSh = sheetByName_(ss, cfg.target);
  if (!srcSh || !appSh) return 'Couldn’t find the ' + cfg.source + ' and ' + cfg.target + ' tabs.';

  var items = parseCafeRows_(srcSh.getDataRange().getValues());
  var appValues = appSh.getDataRange().getValues();
  var head = appValues[0].map(function (h) { return String(h).toLowerCase().replace(/[^a-z]/g, ''); });
  var col = function (k) { return head.indexOf(k); };
  // "Added" = the date a place first appeared, used for "New this month" on the sites.
  if (col('added') === -1) {
    appSh.getRange(1, head.length + 1).setValue('Added').setFontWeight('bold');
    head.push('added');
  }
  var C = { district: col('district'), name: col('name'), rating: col('rating'), order: col('mustorder'), price: col('price'), note: col('note'), added: col('added') };
  if (C.district === -1 || C.name === -1) return 'The ' + cfg.target + ' tab needs District and Name columns.';
  var appRows = appValues.slice(1).map(function (r, i) { return { row: i + 2, district: String(r[C.district]).trim(), name: String(r[C.name]).trim() }; })
    .filter(function (r) { return r.name; });

  var pairs = matchCafes_(items, appRows);
  var snapSheet = sheetByName_(ss, cfg.snapshot);
  var snap = snapSheet ? readSnapshot_(snapSheet) : baselineFor_(cfg.id);
  var next = {}, changed = [], added = [], today = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'd MMM yyyy');
  var FIELD_COL = { r: C.rating, p: C.price, o: C.order, v: C.note };
  var FIELD_NAME = { r: 'rating', p: 'price', o: 'order', v: 'review' };
  var rerank = {};

  pairs.matched.forEach(function (m) {
    var key = m.app.district + '|' + m.app.name, cur = cafeFields_(m.cafe), prev = snap[key];
    next[key] = cur;
    if (!prev) return;
    var what = [];
    ['r', 'p', 'o', 'v'].forEach(function (f) {
      if (same_(cur[f], prev[f]) || FIELD_COL[f] === -1) return;
      var cell = appSh.getRange(m.app.row, FIELD_COL[f] + 1);
      cell.setValue(f === 'r' && cur.r !== '' && !isNaN(Number(cur.r)) ? Number(cur.r) : cur[f]);
      if (f === 'v') cell.setBackground('#EFE6FA').setNote('Updated from the ' + cfg.source + ' tab on ' + today + '. This is your original wording; tidy it up if you like.');
      what.push(FIELD_NAME[f]);
      if (f === 'r') rerank[m.app.district] = true;
    });
    if (what.length) changed.push(m.app.name + ' (' + m.app.district + '): ' + what.join(', '));
  });

  pairs.unmatched.forEach(function (it) {
    var cur = cafeFields_(it), row = [];
    for (var i = 0; i < head.length; i++) row.push('');
    row[C.district] = it.district; row[C.name] = it.name;
    if (C.rating !== -1) row[C.rating] = cur.r === '' ? '' : Number(cur.r);
    if (C.order !== -1) row[C.order] = cur.o;
    if (C.price !== -1) row[C.price] = cur.p;
    if (C.note !== -1) row[C.note] = cur.v;
    var extra = cfg.fill(cur);
    Object.keys(extra).forEach(function (k) { if (col(k) !== -1) row[col(k)] = extra[k]; });
    row[C.added] = new Date();
    appSh.appendRow(row.map(function (v) { return typeof v === 'string' ? safe_(v) : v; }));
    var r = appSh.getLastRow();
    appSh.getRange(r, C.added + 1).setNumberFormat('yyyy-mm-dd');
    appSh.getRange(r, 1, 1, head.length).setBackground('#EFE6FA');
    appSh.getRange(r, C.name + 1).setNote('New from the ' + cfg.source + ' tab on ' + today + '. ' + (cfg.id === 'food' ? 'Cuisine' : 'Drink') + ', Tags and Rank were filled in automatically: check them' + (cfg.id === 'cafe' ? ', and add Taste' : '') + '.');
    next[it.district + '|' + it.name] = cur;
    rerank[it.district] = true;
    added.push(it.name + ' (' + it.district + ')');
  });

  writeSnapshot_(snapSheet || ss.insertSheet(cfg.snapshot).hideSheet(), next);
  var located = added.length ? fillCoordinates_(cfg.target, cfg.what) : '';
  var ranked = Object.keys(rerank).length ? autoRank_(appSh, rerank) : [];

  var missing = pairs.unusedApp.map(function (a) { return a.name + ' (' + a.district + ')'; });
  var msg = changed.length || added.length ? 'updated.' : 'everything already matches.';
  if (changed.length) msg += '\n\nUpdated:\n• ' + changed.join('\n• ');
  if (added.length) msg += '\n\nAdded (highlighted in lilac):\n• ' + added.join('\n• ') + '\n\n' + located;
  if (ranked.length) msg += '\n\nRanks updated (highlighted):\n• ' + ranked.join('\n• ');
  if (missing.length && !silent) msg += '\n\nIn the ' + cfg.target + ' tab but not found in the ' + cfg.source + ' tab (left as they are):\n• ' + missing.join('\n• ');
  return msg;
}

// ---------- Suggested Tags, Cuisine and Rank ----------
//
// New places get Tags (and Cuisine for restaurants) guessed from the review, order and price,
// using the same tag list as the apps. They're highlighted so you can check them.

function guessTags_(kind, cur) {
  var s = (cur.o + ' ' + cur.v).toLowerCase(), review = String(cur.v).toLowerCase();
  var price = parseInt(String(cur.p).replace(/[^0-9\/ ~\-]/g, ''), 10);
  var tags = [];
  function add(tag, yes) { if (yes && tags.indexOf(tag) === -1) tags.push(tag); }
  var smallPortion = /portion[^.]*small|small portion|size too small|volume is (so )?(less|small)/.test(review);
  var smallSpace = /small (space|place|shop|sitting)|(space|place) is [a-z ]*small|too small|tiny|cramp|so small|super small/.test(review.replace(/(portion|size|volume|cup)[^.,]*small/g, ''));
  var value = /value for money|good value|good for value|super worth|worth (the )?money|good deal|affordable|cheap/.test(review);
  var pricey = /pric(e)?(y|ier)|expensive|steep/.test(review);
  var hasPrice = !isNaN(price) && price >= 10;
  if (kind === 'cafe') {
    add('cheap', value || (hasPrice && price <= 31));
    add('pricey', pricey);
    add('small-space', smallSpace);
    add('small-portion', smallPortion);
    add('work-friendly', /work|productiv|laptop/.test(review) && !/not suitable to work|can'?t work|cannot work|too small to work/.test(review));
    add('cozy', /coz|cosy/.test(review));
    add('cute', /cute/.test(review));
    add('takeaway-only', /take ?away only|only take ?away|no (place|space|where) to s(i|ea)t|no sitting/.test(review));
    add('no-ports', /no (power )?(ports?|sockets?|plugs?|outlets?)/.test(review));
    add('time-limit', /time limit/.test(review));
    add('cash-only', /cash only|octopus only|only (accept|take)s? (cash|octopus)/.test(review));
  } else if (kind === 'food') {
    add('value', value);
    add('cheap', hasPrice && price < 70);
    add('pricey', pricey || (hasPrice && price >= 300));
    add('lunch-set', /lunch (set|deal)|the set\b|\(set\)/.test(s));
    add('buffet', /buffet/.test(s));
    add('big-portion', /huge|big portion|portion (is )?(huge|big)|generous/.test(review));
    add('small-portion', smallPortion);
    add('small-space', smallSpace);
    add('spicy', /spic|heat/.test(review) || /mala|sichuan|szechuan|dried hot ?pot|spicy sour|vindaloo/.test(String(cur.o).toLowerCase()));
    add('veggie-friendly', /vegan|vegetarian|veggie|paneer|tofu/.test(s));
    add('late-night', /late[- ]night|drunk|after midnight/.test(s));
    add('healthy', /healthy/.test(review) || /^(byo |build[- ]your[- ]own )?salad|salad bowl|poke/.test(String(cur.o).toLowerCase()));
    add('cute', /cute/.test(review));
    add('group', /group|sharing|to share|with friends/.test(review));
  }
  return tags.join(';');
}

function guessCuisine_(order) {
  var s = String(order).toLowerCase();
  // The dish that comes first in the order decides (so "Carbonara, Pizza" is Italian).
  var rules = [
    ['Mexican', /taco|burrito|quesad|qused|nacho|birria/], ['Pizza', /pizza|marg(h)?(e|a)rit/], ['Burgers', /burger/], ['Filipino', /chichar|adobo|sisig|lechon/],
    ['Indian', /tikka|naan|paneer|masala|biryani|samosa|kebab|dosa|thali/], ['Thai', /pad thai|tom yum|thai|papaya salad|basil minced|curry noodle|khao soi/],
    ['Vietnamese', /pho|bh?an ?h? ?mi|bun |vermicelli/], ['Japanese', /ramen|sushi|udon|donburi|katsu|teriyaki|izakaya/],
    ['Korean', /kimchi|bibimbap|bulgogi|tteok|yukgaejang|korean/], ['Italian', /pasta|carbonara|rigat|lingu|tagliat|risotto|tiramisu|lasagn/],
    ['Chinese', /dim sum|siu ?m|wonton|dumpling|fried rice|hot ?pot|noodle|char siu|congee|xiao/], ['Healthy', /salad|poke|bowl/],
    ['Dessert', /kakigori|parfait|cake|gelato|ice cream|waffle/]
  ];
  var best = '', at = Infinity;
  for (var i = 0; i < rules.length; i++) { var m = rules[i][1].exec(s); if (m && m.index < at) { at = m.index; best = rules[i][0]; } }
  if (!best && /steak|chicken|fries|salmon|grill|schnitzel/.test(s)) best = 'Western';
  return best;
}

// Rank 1–3 per district: highest rating first, rated 4 or more, never closed.
// Ties keep the order you already had. Only the districts in `districts` (or all, if null) change.
function autoRank_(sh, districts) {
  var values = sh.getDataRange().getValues();
  var head = values[0].map(function (h) { return String(h).toLowerCase().replace(/[^a-z]/g, ''); });
  var D = head.indexOf('district'), N = head.indexOf('name'), R = head.indexOf('rating'), K = head.indexOf('rank'), T = head.indexOf('tags');
  if (D === -1 || N === -1 || R === -1 || K === -1) return [];
  var groups = {};
  for (var i = 1; i < values.length; i++) {
    var d = String(values[i][D]).trim(), name = String(values[i][N]).trim();
    if (!d || !name) continue;
    if (districts && !districts[d]) continue;
    (groups[d] = groups[d] || []).push({
      row: i + 1, name: name, rating: Number(values[i][R]), rank: Number(values[i][K]) || 99,
      closed: T !== -1 && /(^|;)\s*(temp-)?closed\s*(;|$)/i.test(String(values[i][T]))
    });
  }
  var changes = [], today = Utilities.formatDate(new Date(), SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'd MMM yyyy');
  Object.keys(groups).forEach(function (d) {
    var list = groups[d], order = list.filter(function (p) { return !p.closed && p.rating >= 4; })
      .sort(function (a, b) { return b.rating - a.rating || a.rank - b.rank || a.row - b.row; }).slice(0, 3);
    var want = {}; order.forEach(function (p, j) { want[p.row] = j + 1; });
    var moved = [];
    list.forEach(function (p) {
      var now = want[p.row] || '', was = p.rank === 99 ? '' : p.rank;
      if (now === was) return;
      sh.getRange(p.row, K + 1).setValue(now).setBackground('#EFE6FA')
        .setNote('Rank set automatically on ' + today + ' (top 3 in ' + d + ', rated 4+). Change it if you disagree.');
      moved.push(p.name + (now ? ' → #' + now : ' → no rank'));
    });
    if (moved.length) changes.push(d + ': ' + moved.join(', '));
  });
  return changes;
}

function appTabs_() {
  var ss = SpreadsheetApp.getActive();
  return CHECK_TABS.map(function (n) { return sheetByName_(ss, n); }).filter(Boolean);
}

function rerankAll() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (err) {}
  if (ui && ui.alert('Re-rank every district?', 'This sets Rank 1–3 in every app tab to the highest-rated places (rated 4+, not closed). Ties keep your current order. Any rank you set by hand that breaks this rule will change.', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  var msgs = appTabs_().map(function (sh) {
    var c = autoRank_(sh, null);
    return sh.getName() + ' tab: ' + (c.length ? 'updated (highlighted).\n• ' + c.join('\n• ') : 'already follows the rule.');
  });
  alert_(msgs.join('\n\n'));
}

// ---------- Monthly check for closed places ----------
//
// Looks up every place in the app tabs on Google Maps (Places API) and reads its business status.
//   • Permanently closed → adds the "closed" tag, removes its rank, highlights the row.
//   • Temporarily closed → adds "temp-closed" (removed again automatically when it reopens).
// The apps hide both tags from every recommendation. You get an email with what changed.
// Needs a Places API key (see README); it's kept in the script's settings, not in this code.

var CHECK_TABS = ['APP', 'FOOD', 'BAR', 'DESSERT'];
var CLOSED_BG = '#F9D9D9';

function setUpClosedCheck() {
  var ui = SpreadsheetApp.getUi(), props = PropertiesService.getScriptProperties();
  var has = !!props.getProperty('PLACES_API_KEY');
  var res = ui.prompt('Monthly closed-place check', (has ? 'A key is already saved. Paste a new one to replace it, or leave this empty to keep it.\n\n' : '') + 'Paste your Google Places API key (see the README for how to get one):', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var key = res.getResponseText().trim();
  if (key) props.setProperty('PLACES_API_KEY', key);
  else if (!has) { ui.alert('No key entered, so nothing was set up.'); return; }
  turnOffClosedCheck_();
  ScriptApp.newTrigger('checkClosedPlaces').timeBased().onMonthDay(1).atHour(10).create();
  ui.alert('Set up. The check runs on the 1st of every month and emails you what it finds.\n\nIt will now run once so you can see the result.');
  checkClosedPlaces();
}

function turnOffClosedCheck() {
  turnOffClosedCheck_();
  alert_('The monthly closed-place check is off. You can still run "Check for closed places now" any time.');
}

function turnOffClosedCheck_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkClosedPlaces') ScriptApp.deleteTrigger(t);
  });
}

function checkClosedPlaces() {
  var key = PropertiesService.getScriptProperties().getProperty('PLACES_API_KEY');
  if (!key) { alert_('No Places API key yet. Use Bean There → Set up monthly closed-place check first.'); return; }
  var ss = SpreadsheetApp.getActive(), today = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'd MMM yyyy');
  var cache = placeCache_(ss), closed = [], temp = [], reopened = [], unsure = [], ranks = [], checked = 0;

  for (var s = 0; s < CHECK_TABS.length; s++) {
    var sh = sheetByName_(ss, CHECK_TABS[s]);
    if (!sh) continue;
    var tab = CHECK_TABS[s], values = sh.getDataRange().getValues();
    var head = values[0].map(function (h) { return String(h).toLowerCase().replace(/[^a-z]/g, ''); });
    var D = head.indexOf('district'), N = head.indexOf('name'), T = head.indexOf('tags'), L = head.indexOf('latlng');
    if (D === -1 || N === -1 || T === -1) continue;

    var todo = [];
    for (var i = 1; i < values.length; i++) {
      var name = String(values[i][N]).trim(), district = String(values[i][D]).trim();
      var tags = String(values[i][T]).split(';').map(function (x) { return x.trim(); }).filter(String);
      if (!name || tags.indexOf('closed') !== -1) continue; // already closed: nothing to check
      var ll = L === -1 ? null : /(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/.exec(String(values[i][L]));
      todo.push({ row: i + 1, name: name, district: district, tags: tags, ll: ll ? [Number(ll[1]), Number(ll[2])] : null, id: cache.ids[tab + '|' + district + '|' + name] });
    }

    var rerank = {};
    for (var b = 0; b < todo.length; b += 20) {
      var batch = todo.slice(b, b + 20);
      var replies = UrlFetchApp.fetchAll(batch.map(function (p) { return placeRequest_(p, key); }));
      for (var j = 0; j < batch.length; j++) {
        var p = batch[j], code = replies[j].getResponseCode(), body = {};
        try { body = JSON.parse(replies[j].getContentText()); } catch (err) {}
        if (code === 403 || code === 401 || (code === 400 && /API key/i.test(JSON.stringify(body)))) {
          var why = body.error && body.error.message ? body.error.message : 'HTTP ' + code;
          notify_('Out & About: closed-place check could not run', 'Google refused the Places API key: ' + why + '\n\nSee the README section "Monthly closed-place check" to fix it.');
          alert_('Google refused the Places API key:\n\n' + why + '\n\nCheck the README section "Monthly closed-place check".');
          return;
        }
        var place = p.id ? body : (body.places && body.places[0]);
        var label = p.name + ' (' + p.district + ', ' + tab + ')';
        if (code !== 200 || !place || !place.businessStatus) {
          if (p.id && code === 404) delete cache.ids[tab + '|' + p.district + '|' + p.name];
          unsure.push(label); continue;
        }
        var gName = place.displayName && place.displayName.text || '';
        if (!p.id && nameScore_(p.name, gName) < 0.6) { unsure.push(label + ': Google’s closest match was “' + gName + '”'); continue; }
        cache.ids[tab + '|' + p.district + '|' + p.name] = place.id;
        checked++;
        var status = place.businessStatus, hasTemp = p.tags.indexOf('temp-closed') !== -1, nameCell = sh.getRange(p.row, N + 1);
        if (status === 'CLOSED_PERMANENTLY') {
          setTags_(sh, p.row, T, p.tags.filter(function (x) { return x !== 'temp-closed'; }).concat('closed'));
          sh.getRange(p.row, 1, 1, values[0].length).setBackground(CLOSED_BG);
          nameCell.setNote('Google Maps lists this as permanently closed (checked ' + today + '). If that’s wrong, remove “closed” from its Tags and clear the colour.');
          closed.push(label); rerank[p.district] = true;
        } else if (status === 'CLOSED_TEMPORARILY' && !hasTemp) {
          setTags_(sh, p.row, T, p.tags.concat('temp-closed'));
          sh.getRange(p.row, 1, 1, values[0].length).setBackground(CLOSED_BG);
          nameCell.setNote('Google Maps lists this as temporarily closed (checked ' + today + '). The tag is removed automatically when it reopens.');
          temp.push(label); rerank[p.district] = true;
        } else if (status === 'OPERATIONAL' && hasTemp) {
          setTags_(sh, p.row, T, p.tags.filter(function (x) { return x !== 'temp-closed'; }));
          sh.getRange(p.row, 1, 1, values[0].length).setBackground(null);
          nameCell.setNote('Reopened: Google Maps lists this as open again (checked ' + today + ').');
          reopened.push(label); rerank[p.district] = true;
        }
      }
    }
    if (Object.keys(rerank).length) ranks = ranks.concat(autoRank_(sh, rerank).map(function (c) { return tab + ' · ' + c; }));
  }
  savePlaceCache_(cache);

  var lines = ['Checked ' + checked + ' places on Google Maps (' + today + ').'];
  if (closed.length) lines.push('Permanently closed (tagged “closed”, hidden from recommendations):\n• ' + closed.join('\n• '));
  if (temp.length) lines.push('Temporarily closed (tagged “temp-closed”):\n• ' + temp.join('\n• '));
  if (reopened.length) lines.push('Open again (“temp-closed” removed):\n• ' + reopened.join('\n• '));
  if (ranks.length) lines.push('Ranks updated:\n• ' + ranks.join('\n• '));
  if (!closed.length && !temp.length && !reopened.length) lines.push('Nothing has closed. 🎉');
  if (unsure.length) lines.push('Couldn’t check these (no clear match on Google Maps). Fill in their Lat, Lng or check them yourself:\n• ' + unsure.join('\n• '));
  var msg = lines.join('\n\n');
  notify_('Out & About: monthly closed-place check', msg + '\n\nThe sites pick up changes within about 5 minutes.');
  alert_(msg);
}

function placeRequest_(p, key) {
  if (p.id) {
    return { url: 'https://places.googleapis.com/v1/places/' + encodeURIComponent(p.id), method: 'get', muteHttpExceptions: true,
      headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'id,displayName,businessStatus' } };
  }
  var body = { textQuery: p.name + ', ' + p.district + ', Hong Kong', regionCode: 'HK', pageSize: 1 };
  if (p.ll) body.locationBias = { circle: { center: { latitude: p.ll[0], longitude: p.ll[1] }, radius: 500 } };
  return { url: 'https://places.googleapis.com/v1/places:searchText', method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify(body), headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.id,places.displayName,places.businessStatus' } };
}

function setTags_(sh, row, col, tags) {
  sh.getRange(row, col + 1).setValue(tags.filter(function (x, i) { return tags.indexOf(x) === i; }).join(';'));
}

// Remembers each place's Google ID in a hidden "_places" tab, so later checks are exact and cheaper.
function placeCache_(ss) {
  var sh = sheetByName_(ss, '_places'), ids = {};
  if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) { if (r[0]) ids[r[0]] = r[1]; });
  return { sheet: sh, ids: ids };
}

function savePlaceCache_(cache) {
  var sh = cache.sheet || SpreadsheetApp.getActive().insertSheet('_places').hideSheet();
  var rows = [['Key', 'Google Place ID']];
  Object.keys(cache.ids).forEach(function (k) { rows.push([k, cache.ids[k]]); });
  sh.clear();
  sh.getRange(1, 1, rows.length, 2).setNumberFormat('@').setValues(rows);
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
  var latin = String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/).filter(function (t) { return t && NAME_STOPWORDS.indexOf(t) === -1; }).join('');
  // Names in Chinese or Japanese (e.g. 幕多) have no Latin letters: compare them as written.
  return latin || String(s).replace(/\s+/g, '');
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

// Same for the Restaurant tab, as it was when the FOOD tab was built.
var FOOD_BASELINE = {"Kennedy Town|Nom Nom Dumplings":{"r":"4.7","p":"70","o":"Soup Dumpling + Wood Ear mushroom salad + Steamed Dumplings","v":"Very good, worth money."},"Kennedy Town|Pici":{"r":"4","p":"130","o":"Beef Tagliatalle, Tiramisu","v":"Super good value for lunch set."},"Sai Ying Pun|Catch":{"r":"5","p":"150-170","o":"Tacos, Margarita, Angel Hair Crab Pasta","v":"Love the tacos! Best spot for taco tuesday."},"Sai Ying Pun|El Macho":{"r":"4.5","p":"160-180","o":"Qusedilla, Taco (Beef and Shrimp), Nachos","v":"Pretty good! I dream about their Burrito once in a while."},"Sai Ying Pun|Birria Y Birria":{"r":"5","p":"150","o":"Birria Ramen, Beef Taco","v":"The rame is sooo good! Like so so good."},"Sai Ying Pun|Rajdoot":{"r":"5","p":"82","o":"Paneer Tikka and Butter Naan","v":"Always good!"},"Repulse Bay|Dough Bros":{"r":"5","p":"120~150","o":"A lot of different ones LMAO","v":"Go To Pizza Place."},"Sheung Wan|An Choi":{"r":"4.5","p":"75","o":"Chicken Bhan Mi","v":"Really good bahmi good for value."},"Sheung Wan|Samsen":{"r":"4","p":"","o":"Chicken Curry Noodles","v":"Good but too thick and strong coconut flavour."},"Wan Chai|Samsen":{"r":"4","p":"108","o":"Pad Thai","v":"V good but V expensive."},"Wan Chai|27 Kebab House":{"r":"5","p":"200ish","o":"Chicken Kebab + Chicken Tikka","v":"Super good food, super worth the money."},"Wan Chai|Fini's":{"r":"2","p":"238","o":"Fini's Pizza + Meatball app","v":"Super pricey the food is really not great. I cook better then that haha."},"Wan Chai|The Optimist":{"r":"3","p":"250","o":"Salmon Fillet","v":"V meh, too pricey for what it is."},"Wan Chai|Chukfo Taipan":{"r":"4.5","p":"85","o":"The golden smthng ( have all the meats)","v":"Love this siumei place! The place is a little cramp tho."},"Wan Chai|Mum Mum Thai":{"r":"3.7","p":"167","o":"Tom Yum Steam Egg + Papaya Salad + Crab Fried Rice","v":"For the price actually okay, but would only go back for the Tom Yum Steam egg. The other dishes are quite meh."},"Wan Chai|Zaap Thai":{"r":"4.1","p":"78","o":"Pad Thai","v":"Good option for lunch, really heavy tho."},"Wan Chai|Fancy Salad":{"r":"5","p":"79","o":"BYO Salad","v":"Super good option for lunch, huge portion."},"Wan Chai|Woodlands":{"r":"5","p":"250","o":"Oonam Set","v":"Fun experience and good food!"},"Wan Chai|JoJo":{"r":"5","p":"~250","o":"Weekend Lunch Buffet","v":"Great options, value for money."},"Mong Kok|No Money So Lonely":{"r":"3.3","p":"149","o":"Curry Fried Rice","v":"Food okay, a bit sweet."},"Mong Kok|Dim Dim Sum":{"r":"4.5","p":"120~150","o":"Variety of Dim Sum","v":"Love the dumplings, best Siu Mai."},"Mong Kok|Soul Noodles":{"r":"5","p":"86","o":"Yukgaejang Noodles","v":"Love this place."},"Mong Kok|Rosjad":{"r":"4","p":"89","o":"Thai Basil Minced Pork","v":"Super good! Actually spicy so that's nice."},"Mong Kok|HeSheEat":{"r":"3.7","p":"100","o":"Basil Pasta, Kakigori, Parfait","v":"The food is not good, the dessert is okay."},"Causeway Bay|Shang Hai LaoLao":{"r":"4.5","p":"64 / 59","o":"Peanut Noodle + Spicy Wonton","v":"Good for Value very good."},"Causeway Bay|Dalat Vietnamese":{"r":"4.3","p":"70","o":"Beef Pho","v":"Really good pho especially for that price."},"Causeway Bay|Chuan Man Ju":{"r":"5","p":"140","o":"Dried Hot Pot","v":"Sooo good! Better than 12 flavors."},"Causeway Bay|Diliwali":{"r":"4","p":"180","o":"Chicken Tikka, Paneer Masala, Naan","v":"Solid! But portion a little small."},"Causeway Bay|Mother of Pizza":{"r":"5","p":"200","o":"Margarita, Meat Lover, Garlic Bread","v":"Best garlic bread EVER! Pizza also really good."},"Causeway Bay|Milk Cafe":{"r":"5","p":"60-70","o":"Yang Zhou Fried Rice, Siu Mei, Spicy Clambroth Noodles","v":"Love this! Affordable and good."},"Causeway Bay|Pizza Maru":{"r":"4","p":"120","o":"Garlic Cheese Chicken, Halapejo Chicken Pizza","v":"This is good, not like italian pizza and kind of sweet."},"Causeway Bay|Casa Cucina":{"r":"3","p":"~200","o":"Carbonara, Pizza (had grapes and anchovies topping)","v":"Carbonara good but the pizza was so weird, too pricey for what it is imo."},"Central|Motorino":{"r":"5","p":"120","o":"Cheese Pizza + Margeritha","v":"Very good pizza. If book through open rice, get free tiramisu."},"Central|Pizza Project":{"r":"5","p":"150~200","o":"Meat, Veg, Cheese","v":"Very good pizza."},"Central|Holy Eats":{"r":"4","p":"118","o":"Teriyaki Chicken Bowl","v":"Pretty good, solid lunch deal."},"Central|Buchon Francis":{"r":"4","p":"180","o":"Grilled Chicken and Tomato","v":"I would go again only for the set, I think the set is very good value for money."},"Central|Barkada":{"r":"2","p":"210","o":"Shared Platter, Chicharon and Fries","v":"Food was good but I got sick :(."},"Central|Prime Pho":{"r":"3.7","p":"98","o":"Beef Brisket Pho","v":"It's good! The broth is v nice."},"Central|La Vache":{"r":"3","p":"418","o":"Steak and Frites","v":"Not that big fan of steaks but the fries are nice."},"Central|La Camionetta":{"r":"3.7","p":"180","o":"Quatro Cheese, Simply Porscuito","v":"It's okay, wouldn't go back if I have the choice."},"Central|Chaiwala":{"r":"3.5","p":"160","o":"Samosa Chaat, Chicken Tikka, Naan","v":"A little pricy for what it is, had better."},"Central|Circus Burger":{"r":"4","p":"110","o":"Beef Cheese Burger","v":"Feels like the definition of a burger, the fries are okay."},"Central|Papa Gomez":{"r":"5","p":"80-90","o":"Burger, Chicken Tikka Wrap, Chilli Hot Dog","v":"The food slaps! Disclaimer: Only had this drunk, do not know what it taste like sober :)"},"Central|Twist Pasta Bar":{"r":"5","p":"~180","o":"Seafood Liguini, Rigattoni with Cheese and Carbonara","v":"Really yum would be down to try their seasonal menu."},"Central|The Spoon":{"r":"5","p":"196","o":"Daily Special (Chicken Breast with like some cheese pasta) and sea food brown butter rigattoni","v":"Really yum would be down to try again."},"Central|Fiata Pizza":{"r":"4","p":"~200","o":"Margeritha","v":"It's the sourdough pizza, and I really like chewy pizza so this place is right up my alley."},"Admiralty|ChullsChick":{"r":"4","p":"170","o":"1/2 Chicken with Fries","v":"Portion HUGE, feels like a healthy but delicious meal."},"Tsim Sha Tsui|Gaylord":{"r":"5","p":"200","o":"[Forgot hehe]","v":"Super good but kind of pricey, honestly worth the value."},"Tsim Sha Tsui|Yugu Noodles":{"r":"5","p":"68","o":"The cold spicy sour noodles","v":"My absolute go to noodle place."},"Tsim Sha Tsui|幕多":{"r":"5","p":"98","o":"Japanese Shrimp Ramen","v":"Super nice broth and love the noodles texture."},"Tsim Sha Tsui|Ruen":{"r":"4.3","p":"200","o":"Steam Fish, Kung Pai Chicken, and Stir-fried morning glory","v":"Cute vibes and the food very good! Super close to home foods."},"Sha Tin|Le Tat Su":{"r":"4","p":"89","o":"Dinner Set, Hot Pot","v":"Super good value for money!"},"Sha Tin|Greyhound":{"r":"3.3","p":"80","o":"Thai Basil Minced Pork","v":"Very meh, too pricey."},"Sha Tin|DZO DZO":{"r":"4","p":"83","o":"Bun Rieu","v":"Lunch set, pretty solid but l ike wouldn't go back again if have other options."},"Admiralty|Fini's":{"r":"2","p":"200","o":"Margarita Pizza and Meatballs","v":"It's not even good and so pricey."}};


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

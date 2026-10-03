(function () {
  "use strict";

  var CFG = window.BEAN_THERE_CONFIG || {};
  var LOCAL_CSV = "data/cafes.csv";
  var API = (CFG.apiUrl || "").trim();

  // ---------- Content ----------

  // Stations in line order. A district on neither line hangs off a bus route from Central.
  var ISLAND_LINE = ["Kennedy Town", "Sai Ying Pun", "Sheung Wan", "Central", "Admiralty", "Wan Chai", "Causeway Bay", "Tin Hau",
    "Fortress Hill", "North Point", "Quarry Bay", "Taikoo", "Sai Wan Ho", "Shau Kei Wan", "Heng Fa Chuen", "Chai Wan"];
  var TW_LINE = ["Tsim Sha Tsui", "Jordan", "Yau Ma Tei", "Mong Kok", "Prince Edward", "Sham Shui Po", "Cheung Sha Wan", "Lai Chi Kok", "Mei Foo", "Tsuen Wan"];
  var STATION_NAMES = { "Taikoo": "Tai Koo" };
  // Crawl regions, each in walking order (west to east, or south to north in Kowloon).
  var REGIONS = [
    { id: "west", name: "Island West", districts: ["Kennedy Town", "Sai Ying Pun", "Sheung Wan", "Central", "Admiralty", "Mid-Levels"] },
    { id: "east", name: "Island East", districts: ["Wan Chai", "Happy Valley", "Causeway Bay", "Tin Hau", "Fortress Hill", "North Point", "Quarry Bay", "Taikoo", "Sai Wan Ho", "Shau Kei Wan", "Heng Fa Chuen", "Chai Wan"] },
    { id: "south", name: "South side", districts: ["Repulse Bay", "Stanley", "Aberdeen", "Wong Chuk Hang", "Pok Fu Lam"] },
    { id: "kowloon", name: "Kowloon", districts: TW_LINE.concat(["Hung Hom", "Ho Man Tin", "Kowloon City", "To Kwa Wan", "Kowloon Tong", "Kai Tak", "Kwun Tong", "Tai Kok Tsui"]) }
  ];
  var MAX_STOPS = 5;

  var TAGS = { "work-friendly": "💻 Work-friendly", "takeaway-only": "🥡 Takeaway only", "small-space": "🤏 Small space", "cheap": "💸 Great value", "pricey": "💎 Pricey", "cash-only": "💵 Cash/Octopus", "closed": "🚫 Closed", "cozy": "🛋️ Cozy", "cute": "🌸 Cute", "no-ports": "🔌 No ports", "time-limit": "⏱️ Time limit", "small-portion": "🥄 Small portion" };
  var TASTE = { milky: "🥛 Milky", strong: "💪 Strong", smooth: "🫧 Smooth", weak: "💧 Weak", nutty: "🌰 Nutty", chocolatey: "🍫 Chocolatey", fruity: "🍓 Fruity", roasty: "🔥 Roasty" };
  var CAFFEINE = { "Espresso Tonic": 130, "Flat White": 130, "Latte": 130, "Americano": 150, "Matcha": 70, "Other": 110 };
  var DRINKS = ["Espresso Tonic", "Flat White", "Latte", "Matcha", "Americano"];
  var DRINK_VOICE = {
    "Espresso Tonic": "Espresso tonic is my personality at this point.",
    "Flat White": "The flat white is my control group. If a café can’t do this, we’re done.",
    "Latte": "Lattes are comfort, as long as they’re not too milky.",
    "Matcha": "For the rare days I take a break from coffee.",
    "Americano": "Black coffee, for honest days and honest beans."
  };
  var BREW_LINES = ["Grinding through every café", "Steaming your milk just right", "Asking Putri’s taste buds", "Arranging the lilies", "Pouring your matches"];

  var QUIZ = [
    { key: "milk", q: "How do you take your coffee?", sub: "No judgement. Ok, a little judgement.", opts: [
      ["strong", "Strong & punchy", "Wake me up, emotionally and physically", { cup: 0.08 }],
      ["balanced", "Balanced", "Like my life (aspirationally)", { cup: 0.4 }],
      ["milky", "Creamy & milky", "Basically a warm hug in a cup", { cup: 0.75 }]] },
    { key: "beans", q: "Pick a flavour vibe", sub: "What should the beans taste like?", opts: [
      ["nutty", "Nutty & chocolatey", "Dessert, but make it caffeine", { emoji: "🍫" }],
      ["fruity", "Fruity & bright", "Fancy notes of berries, apparently", { emoji: "🍓" }],
      ["any", "I just want caffeine", "No thoughts, only beans", { emoji: "⚡" }]] },
    { key: "drink", q: "What’s your usual order?", sub: "The one you say without looking at the menu.", tiles: true, opts: [
      ["Espresso Tonic", "Espresso tonic", "Fizzy coffee gang", { emoji: "🫧" }],
      ["Flat White", "Flat white", "The classic", { emoji: "☕" }],
      ["Latte", "Latte", "Big and cosy", { emoji: "🥛" }],
      ["Matcha", "Matcha", "Coffee who?", { emoji: "🍵" }],
      ["Americano", "Americano", "Black, like my humour", { emoji: "🖤" }]] },
    { key: "budget", q: "Wallet status?", sub: "Hong Kong coffee prices are a sport.", tiles: true, opts: [
      ["save", "Counting every HK$", "Cheap and good, please", { emoji: "🪙" }],
      ["treat", "Treat-yourself era", "Price is just a number", { emoji: "💅" }]] }
  ];

  var NAV = [["map", "🗺️", "Map"], ["results", "✨", "Match"], ["putri", "🌷", "Putri"], ["crawl", "🚶", "Crawl"], ["votes", "🗳️", "Votes"]];

  // ---------- Storage (per phone, optional) ----------

  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode: fine */ }
  }

  var device = load("bt-device", null);
  if (!device) { device = Math.random().toString(36).slice(2) + Date.now().toString(36); save("bt-device", device); }

  // ---------- State ----------

  var cafes = [], open = [], districts = [];
  var summary = { votes: {}, suggestions: [], recent: [], loaded: false, failed: false };
  var S = {
    profile: load("bt-profile", null), myVotes: load("bt-votes", {}), myUps: load("bt-ups", {}), commented: {},
    step: 0, draft: {}, brewing: false, pin: null, view: "map", query: "", mine: false,
    drink: "Espresso Tonic", crawlRegion: null, crawl: null, crawlCustom: null, tagline: 0, saved: load("bt-saved", []),
    fb: { type: "cafe", sent: false, error: "", busy: false, district: "" }
  };
  var app = document.getElementById("app"), navEl = document.getElementById("nav"), topbar = document.getElementById("topbar");
  var timers = [];

  // ---------- Data ----------

  function parseCSV(text) {
    var rows = [], row = [], field = "", q = false;
    text = text.replace(/^﻿/, "");
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function guessDrink(order) {
    var s = order.toLowerCase();
    if (/flat[ -]white|\boat white|\bice[d]? (oat )?white/.test(s)) return "Flat White";
    if (s.indexOf("tonic") !== -1) return "Espresso Tonic";
    if (s.indexOf("matcha") !== -1) return "Matcha";
    if (s.indexOf("americano") !== -1) return "Americano";
    if (s.indexOf("latte") !== -1) return "Latte";
    return "Other";
  }

  function parseCoords(v) {
    var m = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(v || "");
    return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
  }

  function splitList(v) { return (v || "").toLowerCase().split(/[;,]/).map(function (t) { return t.trim(); }).filter(Boolean); }

  function toCafes(rows) {
    if (!rows.length) return [];
    var keys = rows[0].map(function (h) { return String(h).toLowerCase().replace(/[^a-z]/g, ""); });
    return rows.slice(1).map(function (r, i) {
      var o = {};
      keys.forEach(function (k, j) { o[k] = (r[j] || "").trim(); });
      var rank = parseInt(o.rank, 10), rating = parseFloat(o.rating), tags = splitList(o.tags);
      var order = o.mustorder || o.order || "";
      var drink = o.drink && DRINKS.concat("Other").indexOf(o.drink) !== -1 ? o.drink : guessDrink(order);
      return {
        id: i, district: o.district, name: o.name, rank: isNaN(rank) ? null : rank, rating: isNaN(rating) ? null : rating,
        order: order, drink: drink, price: o.price || "", note: o.note || o.review || "",
        taste: splitList(o.taste), tags: tags, closed: tags.indexOf("closed") !== -1, maps: o.mapslink || "",
        coords: parseCoords(o.latlng || o.coordinates || ((o.lat || o.latitude) && (o.lng || o.lon || o.longitude) ? (o.lat || o.latitude) + "," + (o.lng || o.lon || o.longitude) : ""))
      };
    }).filter(function (c) { return c.district && c.name; });
  }

  function fetchText(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); });
  }

  function loadCafes() {
    var sheet = (CFG.sheetCsvUrl || "").trim();
    return (sheet ? fetchText(sheet) : fetchText(LOCAL_CSV))
      .then(function (t) { var l = toCafes(parseCSV(t)); if (!l.length) throw new Error("No cafés"); return l; })
      .catch(function (err) {
        if (!sheet) throw err;
        console.warn("Couldn't load the Google Sheet, using the saved copy.", err);
        return fetchText(LOCAL_CSV).then(function (t) { return toCafes(parseCSV(t)); });
      });
  }

  // ---------- Votes & feedback API ----------

  function apiGet() {
    if (!API) return Promise.resolve(null);
    return fetch(API + (API.indexOf("?") === -1 ? "?" : "&") + "action=summary").then(function (r) { return r.json(); });
  }
  function apiPost(body) {
    body.device = device;
    return fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); });
  }
  function refreshSummary() {
    apiGet().then(function (s) {
      if (!s || !s.ok) return;
      summary.votes = s.votes || {}; summary.suggestions = s.suggestions || []; summary.recent = s.recent || []; summary.loaded = true;
      route(true);
    }).catch(function (e) { summary.failed = true; console.warn("Couldn't load votes.", e); route(true); });
  }

  // ---------- Helpers ----------

  function esc(s) { return String(s).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function slug(s) { return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  function price(c) { return c.price ? (/^\d/.test(c.price) ? "HK$" + c.price : c.price) : ""; }
  function firstPrice(c) { var m = /^\d+/.exec(c.price || ""); return m ? parseInt(m[0], 10) : 0; }
  function mapsQ(c) { return c.name + ", " + c.district + ", Hong Kong"; }
  function mapsUrl(c) { return /^https?:\/\//i.test(c.maps) ? c.maps : "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(mapsQ(c)); }
  function inD(d) { return cafes.filter(function (c) { return c.district === d; }); }
  function picks(d) { return inD(d).filter(function (c) { return c.rank && !c.closed; }).sort(function (a, b) { return a.rank - b.rank; }).slice(0, 3); }
  function vkey(c) { return c.district + "|" + c.name; }
  function isSaved(c) { return S.saved.indexOf(vkey(c)) !== -1; }
  function saveBtn(c) {
    var on = isSaved(c);
    return '<button class="pill save" data-save="' + esc(vkey(c)) + '" aria-pressed="' + on + '">' + (on ? "♥ Saved" : "♡ Save") + "</button>";
  }
  function savedCafes() {
    return S.saved.map(function (k) { return cafes.filter(function (c) { return vkey(c) === k; })[0]; }).filter(Boolean);
  }
  var PCODE = { milk: { s: "strong", b: "balanced", m: "milky" }, beans: { n: "nutty", f: "fruity", a: "any" }, budget: { s: "save", t: "treat" } };
  function listLink(list, profile) {
    var p = profile ? profile.milk[0] + profile.beans[0] + DRINKS.indexOf(profile.drink) + (profile.budget === "save" ? "s" : "t") : "";
    var items = list.map(function (c) { return slug(c.district) + "~" + slug(c.name); }).join(".");
    return location.href.split("#")[0] + "#saved/" + p + "_" + items;
  }
  function parseListLink(data) {
    var parts = data.split("_"), p = parts[0], profile = null;
    if (p.length === 4 && PCODE.milk[p[0]] && PCODE.beans[p[1]] && DRINKS[+p[2]] && PCODE.budget[p[3]]) {
      profile = { milk: PCODE.milk[p[0]], beans: PCODE.beans[p[1]], drink: DRINKS[+p[2]], budget: PCODE.budget[p[3]] };
    }
    var list = (parts.slice(1).join("_") || "").split(".").map(function (it) {
      var x = it.split("~");
      return cafes.filter(function (c) { return slug(c.district) === x[0] && slug(c.name) === x[1]; })[0];
    }).filter(Boolean);
    return { profile: profile, list: list };
  }
  function cafeHref(c) { return "#c/" + slug(c.district) + "/" + slug(c.name); }
  function timeAgo(t) {
    var m = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (m < 1) return "just now";
    if (m < 60) return m + " min ago";
    var h = Math.round(m / 60); if (h < 24) return h + "h ago";
    var d = Math.round(h / 24); return d === 1 ? "yesterday" : d + " days ago";
  }
  function plural(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }
  function chipsFor(c) {
    return c.taste.map(function (t) { return '<span class="chip">' + esc(TASTE[t] || t) + "</span>"; }).join("") +
      c.tags.map(function (t) { return '<span class="chip' + (t === "closed" ? " closed" : "") + '">' + esc(TAGS[t] || t) + "</span>"; }).join("");
  }
  function searchHits(q) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    return cafes.filter(function (c) { return [c.name, c.district, c.order, c.drink, c.note, c.taste.join(" "), c.tags.join(" ")].join(" ").toLowerCase().indexOf(q) !== -1; })
      .sort(function (a, b) { return (b.rating || 0) - (a.rating || 0); });
  }

  // ---------- Taste Match ----------

  function match(c, p) {
    var base = (c.rating == null ? 3.5 : c.rating) / 5 * 60, adj = 6, why = [];
    function has(t) { return c.taste.indexOf(t) !== -1 || c.tags.indexOf(t) !== -1; }
    var lowish = c.rating != null && c.rating < 4.2;
    if (p.milk === "milky") {
      if (has("milky")) {
        adj += 12; why.push(["plus", "🥛 Creamy, your thing"]);
        if (lowish) { adj += Math.round((4.5 - c.rating) * 8); why.push(["flip", "Putri: “too milky”. You: yes please"]); }
      }
      if (has("strong")) { adj -= 6; why.push(["minus", "💪 Might be too strong"]); }
      if (has("weak")) { adj -= 6; why.push(["minus", "💧 Even milk fans say: weak"]); }
    } else if (p.milk === "strong") {
      if (has("strong")) { adj += 10; why.push(["plus", "💪 Strong, like you asked"]); }
      if (has("roasty")) { adj += 3; if (lowish) { adj += 6; why.push(["flip", "Too roasty for Putri, maybe not for you"]); } }
      if (has("milky")) { adj -= 8; why.push(["minus", "🥛 On the milky side"]); }
      if (has("weak")) { adj -= 8; why.push(["minus", "💧 Weak for you"]); }
    } else {
      if (has("smooth")) { adj += 7; why.push(["plus", "🫧 Smooth & balanced"]); }
      if (has("milky")) adj -= 3;
      if (has("weak")) { adj -= 5; why.push(["minus", "💧 A bit weak"]); }
    }
    if (p.beans === "nutty") {
      if (has("nutty") || has("chocolatey")) {
        adj += 9; why.push(["plus", "🌰 Nutty beans"]);
        if (lowish) { adj += 8; why.push(["flip", "Putri’s not into nutty. You are"]); }
      }
      if (has("fruity")) { adj -= 5; why.push(["minus", "🍓 Fruity beans"]); }
    } else if (p.beans === "fruity") {
      if (has("fruity")) { adj += 9; why.push(["plus", "🍓 Fruity beans"]); if (lowish) { adj += 6; why.push(["flip", "Putri regretted the fruity beans. You won’t"]); } }
      if (has("nutty")) { adj -= 5; why.push(["minus", "🌰 Nutty beans"]); }
    }
    if (p.drink && c.drink === p.drink) { adj += 12; why.push(["plus", "☕ Your usual: " + p.drink]); }
    if (p.budget === "save") {
      if (has("cheap")) { adj += 6; why.push(["plus", "💸 Easy on the wallet"]); }
      if (has("pricey")) { adj -= 6; why.push(["minus", "💎 Pricey"]); }
    } else if (p.budget === "treat" && has("pricey")) adj += 2;
    if (has("small-portion")) adj -= 2;
    return { score: Math.max(5, Math.min(99, Math.round(base + adj))), why: why };
  }

  function persona(p) {
    var a = { strong: "Espresso Gremlin", balanced: "Flat White Diplomat", milky: "Latte Cloud" }[p.milk];
    var b = { nutty: "Chocolatey", fruity: "Fruity", any: "Chaotic" }[p.beans];
    return { emoji: { strong: "⚡", balanced: "🕊️", milky: "☁️" }[p.milk], name: "The " + b + " " + a };
  }

  // ---------- Art ----------

  function lily(cx, cy, r) {
    var p = "";
    for (var i = 0; i < 6; i++) {
      var a = i * 60 + (i % 2 ? 0 : 30);
      p += '<g transform="rotate(' + a + " " + cx + " " + cy + ')"><path class="lily-petal" d="M' + cx + " " + cy + "C" + (cx + r * .32) + " " + (cy - r * .3) + " " + (cx + r * .26) + " " + (cy - r * .82) + " " + cx + " " + (cy - r) +
        "C" + (cx - r * .26) + " " + (cy - r * .82) + " " + (cx - r * .32) + " " + (cy - r * .3) + " " + cx + " " + cy + 'Z"/><path class="lily-in" d="M' + cx + " " + cy + "C" + (cx + r * .1) + " " + (cy - r * .3) + " " + (cx + r * .06) + " " + (cy - r * .5) + " " + cx + " " + (cy - r * .58) +
        "C" + (cx - r * .06) + " " + (cy - r * .5) + " " + (cx - r * .1) + " " + (cy - r * .3) + " " + cx + " " + cy + 'Z"/></g>';
    }
    for (var j = 0; j < 5; j++) {
      var b = (j * 72 + 10) * Math.PI / 180, x2 = (cx + Math.cos(b) * r * .5).toFixed(1), y2 = (cy + Math.sin(b) * r * .5).toFixed(1);
      p += '<line class="lily-stamen" x1="' + cx + '" y1="' + cy + '" x2="' + x2 + '" y2="' + y2 + '"/><circle class="lily-dot" cx="' + x2 + '" cy="' + y2 + '" r="' + (r * .07).toFixed(1) + '"/>';
    }
    return "<g>" + p + "</g>";
  }
  function lilySvg(cls, style) { return '<svg class="' + cls + '" viewBox="0 0 60 60" aria-hidden="true"' + (style ? ' style="' + style + '"' : "") + ">" + lily(30, 30, 26) + "</svg>"; }

  function mascot(cls) {
    return '<svg class="' + cls + '" viewBox="0 0 140 150" aria-hidden="true">' +
      '<g class="steam" opacity=".6"><path d="M44 70c-6-8 6-12 0-20" stroke="var(--lilac-600)" stroke-width="2.5" fill="none" stroke-linecap="round"/><path d="M98 72c-6-8 6-12 0-20" stroke="var(--lilac-600)" stroke-width="2.5" fill="none" stroke-linecap="round"/></g>' +
      '<g class="sway"><path class="lily-stem" d="M70 88C68 72 72 60 70 46"/><path class="lily-leaf" d="M70 74c-12-2-20-10-22-18 10 0 20 6 22 18z"/><path class="lily-leaf" d="M71 66c10-4 17-12 18-19-9 1-17 8-18 19z"/>' + lily(70, 36, 24) + "</g>" +
      '<ellipse cx="70" cy="136" rx="52" ry="8" fill="var(--crema)" stroke="var(--mocha)" stroke-width="2"/>' +
      '<path d="M100 98c14-2 18 18 2 22" stroke="var(--espresso)" stroke-width="6" fill="none" stroke-linecap="round"/>' +
      '<path d="M34 86h72l-8 40c-1 6-6 9-12 9H54c-6 0-11-3-12-9z" fill="var(--espresso)"/>' +
      '<ellipse cx="70" cy="87" rx="36" ry="6" fill="var(--mocha)"/>' +
      '<circle cx="60" cy="106" r="3.5" fill="var(--lilac-50)"/><circle cx="80" cy="106" r="3.5" fill="var(--lilac-50)"/>' +
      '<path d="M63 115q7 6 14 0" stroke="var(--lilac-50)" stroke-width="2.5" fill="none" stroke-linecap="round"/>' +
      '<circle cx="53" cy="113" r="3.5" fill="var(--lilac-300)" opacity=".85"/><circle cx="87" cy="113" r="3.5" fill="var(--lilac-300)" opacity=".85"/></svg>';
  }

  function cupArt(milk) {
    var top = 14, h = 32, id = "cc" + Math.round(milk * 100);
    return '<svg viewBox="0 0 48 52" aria-hidden="true"><defs><clipPath id="' + id + '"><path d="M8 14h28l-3 30c-.4 3-2.6 4-5 4H16c-2.4 0-4.6-1-5-4z"/></clipPath></defs>' +
      '<g clip-path="url(#' + id + ')"><rect x="0" y="' + top + '" width="48" height="' + h + '" fill="var(--espresso)"/><rect x="0" y="' + top + '" width="48" height="' + (h * milk) + '" fill="var(--crema)"/></g>' +
      '<path d="M8 14h28l-3 30c-.4 3-2.6 4-5 4H16c-2.4 0-4.6-1-5-4z" fill="none" stroke="var(--fg)" stroke-width="2"/><path d="M36 20c8 0 8 12 0 12" fill="none" stroke="var(--fg)" stroke-width="2"/></svg>';
  }

  // ---------- Cards & votes ----------

  function votesFor(c) { var v = summary.votes[vkey(c)] || { agree: 0, disagree: 0 }; return { agree: v.agree, disagree: v.disagree }; }

  function voteBlock(c, withComment) {
    if (!API) return "";
    var v = votesFor(c), tot = v.agree + v.disagree, pct = tot ? Math.round(v.agree / tot * 100) : 0, m = S.myVotes[vkey(c)], k = esc(vkey(c));
    return '<div class="vote"><span class="vote-q">Been here? Do you agree with Putri?</span>' +
      '<div class="row-btns"><button class="pill" data-vote="agree" data-key="' + k + '" aria-pressed="' + (m === "agree") + '">👍 Agree</button>' +
      '<button class="pill" data-vote="disagree" data-key="' + k + '" aria-pressed="' + (m === "disagree") + '">👎 Nope</button></div>' +
      (tot ? '<div class="bar" role="img" aria-label="' + pct + '% agree"><i style="width:' + pct + '%"></i></div><small>' + v.agree + " of " + plural(tot, "friend") + " agree" + (m ? " (including you)" : "") + "</small>"
        : "<small>No votes yet. Be the first!</small>") +
      (withComment && m && !S.commented[vkey(c)] ? '<form class="vote-comment" data-commentkey="' + k + '"><label class="field">Want to tell Putri why? <small>optional · only Putri sees this</small><textarea id="vote-comment" maxlength="300" placeholder="' + (m === "agree" ? "Totally, the…" : "Hmm, I thought…") + '"></textarea></label><button class="pill" type="submit">Send</button></form>' : "") +
      (withComment && S.commented[vkey(c)] ? "<small>Thanks, Putri got your note.</small>" : "") + "</div>";
  }

  function card(c, i, opts) {
    opts = opts || {};
    var m = S.profile ? match(c, S.profile) : null;
    return '<article class="card"><div class="card-head"><span class="rank r' + (i + 1) + '">' + (i + 1) + "</span>" +
      "<div><h3><a class=\"cafe-link\" href=\"" + cafeHref(c) + "\">" + esc(c.name) + '</a></h3><span class="meta">Putri ★ ' + (c.rating == null ? "–" : c.rating) + (opts.district ? " · " + esc(c.district) : "") + "</span></div>" +
      (m ? '<span class="match" title="Your Taste Match">' + m.score + "%</span>" : "") + "</div>" +
      (c.order ? '<p class="order">Get: <b>' + esc(c.order) + "</b>" + (price(c) ? ' <span class="meta">· ' + esc(price(c)) + "</span>" : "") + "</p>" : "") +
      (c.note ? '<p class="note">“' + esc(c.note) + "”</p>" : "") +
      (m && m.why.length ? '<div class="chips">' + m.why.map(function (w) { return '<span class="chip ' + w[0] + '">' + esc(w[1]) + "</span>"; }).join("") + "</div>" : (c.taste.length || c.tags.length ? '<div class="chips">' + chipsFor(c) + "</div>" : "")) +
      '<div class="row-btns"><a class="pill solid" href="' + esc(mapsUrl(c)) + '" target="_blank" rel="noopener">📍 Open in Maps</a>' + saveBtn(c) + '<a class="pill" href="' + cafeHref(c) + '">View café →</a></div>' +
      (opts.noVote ? "" : voteBlock(c)) + "</article>";
  }

  function restList(list) {
    return '<ul class="list">' + list.map(function (c) {
      return '<li class="' + (c.closed ? "is-closed" : "") + '"><a class="row" href="' + cafeHref(c) + '"><span class="n">·</span><div><b>' + esc(c.name) + (c.closed ? " (closed)" : "") + "</b><small>" + esc(c.order) + (c.note ? " · “" + esc(c.note) + "”" : "") + '</small></div><span class="score">' +
        (S.profile && !c.closed ? match(c, S.profile).score + "%" : c.rating != null ? "★ " + c.rating : "") + "</span></a></li>";
    }).join("") + "</ul>";
  }

  // ---------- MTR map ----------

  function layoutStations() {
    var island = ISLAND_LINE.filter(function (d) { return districts.indexOf(d) !== -1; });
    var tw = TW_LINE.filter(function (d) { return districts.indexOf(d) !== -1; });
    var other = districts.filter(function (d) { return island.indexOf(d) === -1 && tw.indexOf(d) === -1; });
    var pos = {}, x0 = 22, x1 = 322, y = 236;
    island.forEach(function (d, i) { pos[d] = [island.length === 1 ? 172 : x0 + (x1 - x0) * i / (island.length - 1), y, "island"]; });
    var hub = pos["Admiralty"] || pos["Central"] || [172, y];
    var twX = hub[0];
    tw.forEach(function (d, i) { pos[d] = [twX, tw.length === 1 ? 98 : 98 - (98 - 30) * i / (tw.length - 1), "tw"]; });
    var bus = pos["Central"] || hub;
    other.forEach(function (d, i) { pos[d] = [Math.min(300, bus[0] + 84 + i * 70), 292 + (i % 2) * 18, "bus"]; });
    return { pos: pos, island: island, tw: tw, other: other, twX: twX, bus: bus };
  }

  function mtrMap(hits) {
    var L = layoutStations(), counts = {}, searching = S.query.trim() !== "";
    hits.forEach(function (c) { counts[c.district] = (counts[c.district] || 0) + 1; });
    var svg = '<path class="harbour" d="M-4 128C60 118 120 140 180 128S300 118 364 128L364 150C300 140 240 160 180 150S60 140 -4 152Z"/>' +
      '<text class="map-water" x="190" y="144">VICTORIA HARBOUR</text>';
    if (L.tw.length) svg += '<path class="mtr-line mtr-tw" d="M' + L.twX + " " + L.pos[L.tw[L.tw.length - 1]][1] + "V236\"/>" + '<text class="mtr-key" x="' + (L.twX + 8) + '" y="70">Tsuen Wan line</text>';
    if (L.island.length) svg += '<path class="mtr-line mtr-island" d="M' + L.pos[L.island[0]][0] + " 236H" + L.pos[L.island[L.island.length - 1]][0] + '"/><text class="mtr-key" x="22" y="262">Island line</text>';
    L.other.forEach(function (d) { var p = L.pos[d]; svg += '<path class="mtr-bus" d="M' + L.bus[0] + " 236C" + (L.bus[0] + 4) + " " + (p[1] - 16) + " " + (L.bus[0] + 38) + " " + p[1] + " " + p[0] + " " + p[1] + '"/>'; });
    if (L.other.length) svg += '<text class="mtr-key" x="22" y="306">🚌 off the MTR: bus from Central</text>';
    svg += '<g opacity=".5" transform="translate(290 24) scale(.6)">' + lily(30, 30, 26) + "</g>";
    districts.forEach(function (d) {
      var p = L.pos[d], on = S.pin === d, dim = searching && !counts[d], r = 5 + Math.min(5, inD(d).length / 2.5), name = STATION_NAMES[d] || d, label;
      if (p[2] === "island") label = '<text transform="rotate(-48 ' + (p[0] + 4) + " " + (p[1] - 14) + ')" x="' + (p[0] + 4) + '" y="' + (p[1] - 14) + '">' + esc(name) + "</text>";
      else label = '<text x="' + (p[0] + 14) + '" y="' + (p[1] + 4) + '">' + esc(name) + "</text>";
      svg += '<g class="stn' + (on ? " on" : "") + (dim ? " dim" : "") + '" data-pin="' + esc(d) + '" tabindex="0" role="button" aria-pressed="' + on + '" aria-label="' + esc(d) + ", " + plural(inD(d).length, "café") + '"><title>' + esc(d) + "</title>" +
        '<circle class="hit" cx="' + p[0] + '" cy="' + p[1] + '" r="14"/><circle class="dot" cx="' + p[0] + '" cy="' + p[1] + '" r="' + (on ? r + 2 : r) + '"/>' + label +
        (searching && counts[d] ? '<circle class="badge" cx="' + (p[0] + r + 2) + '" cy="' + (p[1] + r + 2) + '" r="7"/><text class="badge-t" x="' + (p[0] + r + 2) + '" y="' + (p[1] + r + 4.8) + '" text-anchor="middle">' + counts[d] + "</text>" : "") + "</g>";
    });
    return '<div class="mapbox"><svg viewBox="0 0 360 340" role="group" aria-label="MTR-style map of districts">' + svg + '</svg><span class="scale-note">bigger dot = more cafés</span></div>';
  }

  // ---------- Screens ----------

  var TAGLINES = function () {
    return ["I drank all of this so you don’t have to.", cafes.length + " cafés. " + districts.length + " districts. One very jittery Putri.",
      "Powered by oat milk and questionable sleep.", "Rated by a professional over-caffeinator.", "Side effects may include saying “flat white” unprompted."];
  };

  function viewLanding() {
    var floats = [["8%", "12%", 0, "l"], ["84%", "9%", 1.2, "c"], ["10%", "78%", 2.1, "c"], ["86%", "72%", .6, "l"], ["48%", "93%", 3, "l"], ["76%", "36%", 1.8, "c"], ["16%", "44%", 2.6, "l"]];
    return '<section class="landing">' +
      '<svg class="doodle" viewBox="0 0 360 720" preserveAspectRatio="none" aria-hidden="true"><path d="M24 40C90 20 150 34 200 26c30-5 40-30 22-30s-14 30 18 30c40 0 70-6 98 10M340 40c-14 90 6 170-6 250-4 30 22 40 20 20s-30-10-24 20c10 70 4 160 14 240M330 690c-80 14-150-6-210 6-30 6-36 28-18 28s16-26-14-24c-30 2-50 0-66-10M20 690c10-90-8-170 4-250 4-30-20-36-20-18s28 14 22-16C16 330 30 230 18 140c-3-30 0-70 6-100" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>' +
      floats.map(function (f) {
        var st = "left:" + f[0] + ";top:" + f[1] + ";animation-delay:" + f[2] + "s";
        return f[3] === "l" ? lilySvg("floaty", st) : '<span class="floaty cup" aria-hidden="true" style="' + st + '">☕</span>';
      }).join("") +
      '<div class="bubble">Psst. Putri drank a LOT of coffee. Want the good stuff?</div>' + mascot("mascot") +
      '<div><h1 class="l-title">Bean<br>There</h1><span class="stamp">by Putri</span></div>' +
      '<p class="tagline" id="tagline">' + esc(TAGLINES()[S.tagline % 5]) + "</p>" +
      '<a class="cta cta-main" href="#match">Find my perfect cup ✨</a>' +
      '<a class="cta cta-ghost" href="#map">Just show me the map</a>' +
      '<p class="l-stats">' + cafes.length + " cafés · " + districts.length + " districts · 0 regrets (ok, a few)</p>" +
      '<p class="fineprint">No beans were harmed. Some were roasted.</p></section>';
  }

  function viewQuiz() {
    var Q = QUIZ[S.step];
    var cups = QUIZ.map(function (_, i) {
      var f = i < S.step ? 1 : i === S.step ? 0.5 : 0;
      return '<svg viewBox="0 0 26 26" aria-hidden="true"><defs><clipPath id="qc' + i + '"><path d="M4 7h16l-2 14c0 2-1 3-3 3H9c-2 0-3-1-3-3z"/></clipPath></defs><rect clip-path="url(#qc' + i + ')" x="0" y="' + (7 + 17 * (1 - f)) + '" width="26" height="' + (17 * f) + '" fill="var(--accent)"/><path d="M4 7h16l-2 14c0 2-1 3-3 3H9c-2 0-3-1-3-3z" fill="none" stroke="var(--fg)" stroke-width="1.6"/><path d="M20 10c4 0 4 6 0 6" fill="none" stroke="var(--fg)" stroke-width="1.6"/></svg>';
    }).join("");
    return '<section class="quiz">' + lilySvg("corner-lily") +
      (S.step ? '<button class="back" data-qback="1" style="border:0;background:none;padding:0">← Back</button>' : '<a class="back" href="#">← Home</a>') +
      '<div class="cups" role="img" aria-label="Question ' + (S.step + 1) + " of " + QUIZ.length + '">' + cups + "</div>" +
      '<span class="qnum">Taste Match · ' + (S.step + 1) + " of " + QUIZ.length + "</span>" +
      '<h1 class="q">' + esc(Q.q) + '</h1><p class="q-sub">' + esc(Q.sub) + "</p>" +
      '<div class="opts' + (Q.tiles ? " tiles" : "") + '">' + Q.opts.map(function (o) {
        var art = o[3].cup != null ? cupArt(o[3].cup) : o[3].emoji;
        return '<button class="opt" data-answer="' + esc(o[0]) + '"><span class="art" aria-hidden="true">' + art + "</span><span>" + esc(o[1]) + "<small>" + esc(o[2]) + "</small></span></button>";
      }).join("") + "</div></section>";
  }

  function viewBrewing() {
    return '<section class="brew"><svg viewBox="0 0 170 170" aria-hidden="true">' +
      '<g class="steam" opacity=".7"><path d="M62 40c-8-10 8-14 0-26" stroke="var(--lilac-600)" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M108 40c-8-10 8-14 0-26" stroke="var(--lilac-600)" stroke-width="3" fill="none" stroke-linecap="round"/></g>' +
      '<defs><clipPath id="brewcup"><path d="M30 58h110l-12 70c-2 9-9 14-18 14H60c-9 0-16-5-18-14z"/></clipPath></defs>' +
      '<g clip-path="url(#brewcup)"><rect class="liquid" x="0" y="62" width="170" height="80" fill="var(--mocha)"/></g>' +
      '<g class="art-lily"><g transform="translate(55 52)">' + lily(30, 18, 16) + "</g></g>" +
      '<path d="M30 58h110l-12 70c-2 9-9 14-18 14H60c-9 0-16-5-18-14z" fill="none" stroke="var(--espresso)" stroke-width="5" stroke-linejoin="round"/>' +
      '<path d="M138 74c22-2 24 34 0 38" fill="none" stroke="var(--espresso)" stroke-width="5" stroke-linecap="round"/>' +
      '<ellipse cx="85" cy="154" rx="70" ry="9" fill="var(--crema)" stroke="var(--mocha)" stroke-width="2.5"/></svg>' +
      '<h1>Brewing for you</h1><p><span id="brewline">' + esc(BREW_LINES[0]) + '</span><span class="dotdot"></span></p></section>';
  }

  function viewResults() {
    var p = persona(S.profile);
    var ranked = open.map(function (c) { return { c: c, m: match(c, S.profile) }; }).sort(function (a, b) { return b.m.score - a.m.score; });
    var flips = ranked.filter(function (x) { return x.m.why.some(function (w) { return w[0] === "flip"; }); }).slice(0, 3);
    return '<div class="pad"><div class="persona"><span class="big" aria-hidden="true">' + p.emoji + '</span><span class="label">Your coffee personality</span><h1>' + esc(p.name) + "</h1>" +
      '<p class="sub">Your best matches across Hong Kong.</p></div>' +
      ranked.slice(0, 3).map(function (x, i) { return card(x.c, i, { district: true }); }).join("") +
      (flips.length ? '<span class="label">Putri’s loss, your gain</span><ul class="list">' + flips.map(function (x) {
        return '<li><a class="row" href="' + cafeHref(x.c) + '"><span class="n">✦</span><div><b>' + esc(x.c.name) + "</b><small>Putri gave it ★ " + x.c.rating + " · " + esc(x.c.district) + '</small></div><span class="score">' + x.m.score + "%</span></a></li>";
      }).join("") + "</ul>" : "") +
      '<div class="row-btns"><a class="pill solid" href="#map">See my matches on the map →</a><a class="pill" href="#match">Retake the quiz</a></div></div>';
  }

  function viewMap() {
    var hits = searchHits(S.query), searching = S.query.trim() !== "";
    if (!S.pin || districts.indexOf(S.pin) === -1) S.pin = districts.indexOf("Sheung Wan") !== -1 ? "Sheung Wan" : districts[0];
    var html = '<div class="pad"><div class="h-row"><h1 class="app-title">Where to?</h1>' +
      '<div class="seg" role="group" aria-label="View" style="width:130px"><button data-view="map" aria-pressed="' + (S.view === "map") + '">Map</button><button data-view="list" aria-pressed="' + (S.view === "list") + '">List</button></div></div>' +
      '<label class="search"><span aria-hidden="true">🔎</span><input id="q" type="search" placeholder="Search café, drink or vibe…" value="' + esc(S.query) + '" autocomplete="off" aria-label="Search cafés"></label>';
    if (searching) html += '<p class="sub">' + plural(hits.length, "café") + " match “" + esc(S.query.trim()) + "”" + (S.view === "map" && hits.length ? ". Lit-up stations have them." : "") + "</p>";

    if (S.view === "map") {
      var d = S.pin, list = searching ? hits.filter(function (c) { return c.district === d; }) : picks(d);
      var best = S.profile ? inD(d).filter(function (c) { return !c.closed; }).map(function (c) { return { c: c, s: match(c, S.profile).score }; }).sort(function (a, b) { return b.s - a.s; })[0] : null;
      html += mtrMap(hits) +
        '<div class="sheet"><div class="h-row"><div><h2 style="font-size:22px">' + esc(d) + '</h2><span class="meta">' + plural(inD(d).length, "café") + ' tried</span></div><a class="pill solid" href="#d/' + slug(d) + '">Open →</a></div>' +
        '<span class="label">' + (searching ? "Matches here" : "Putri’s top 3") + "</span>" +
        (list.length ? list.slice(0, 3).map(function (c, i) {
          return '<a class="mini" href="' + cafeHref(c) + '"><span class="rank r' + (i + 1) + '">' + (searching ? "·" : i + 1) + "</span><span><b>" + esc(c.name) + '</b><br><small class="meta">' + esc(c.order) + '</small></span><span class="score">' + (S.profile && !c.closed ? match(c, S.profile).score + "%" : c.rating != null ? "★ " + c.rating : "") + "</span></a>";
        }).join("") : '<p class="sub">' + (searching ? "Nothing here for that search." : "No favourite yet. Putri’s still looking.") + "</p>") +
        (best ? '<a class="banner" href="' + cafeHref(best.c) + '"><span class="ico" aria-hidden="true">' + persona(S.profile).emoji + "</span><span><b>Best for you: " + esc(best.c.name) + "</b><small>" + best.s + "% match</small></span></a>" : "") + "</div>";
      if (!S.profile) html += '<a class="banner" href="#match"><span class="ico" aria-hidden="true">✨</span><span><b>Take the 20-second Taste Match</b><small>See which café in each district suits you</small></span></a>';
      html += '<a class="banner" href="#note" data-fbgo="cafe" data-fbdistrict="' + esc(d) + '"><span class="ico" aria-hidden="true">💌</span><span><b>Know a spot Putri hasn’t tried in ' + esc(d) + '?</b><small>Suggest it and she’ll add it to her list</small></span></a>';
      return html + "</div>";
    }

    if (searching) {
      html += hits.length ? '<ul class="list">' + hits.slice(0, 40).map(function (c) {
        return '<li class="' + (c.closed ? "is-closed" : "") + '"><a class="row" href="' + cafeHref(c) + '"><span class="n">' + (c.rank || "·") + "</span><div><b>" + esc(c.name) + (c.closed ? " (closed)" : "") + "</b><small>" + esc(c.district) + " · " + esc(c.order) + '</small></div><span class="score">' +
          (S.profile && !c.closed ? match(c, S.profile).score + "%" : c.rating != null ? "★ " + c.rating : "") + "</span></a></li>";
      }).join("") + "</ul>" : '<p class="sub">Nothing yet. Try “tonic”, “cozy” or “cheap”.</p>';
      return html + "</div>";
    }
    var L = layoutStations();
    [["Hong Kong Island", L.island], ["Kowloon", L.tw], ["Off the MTR", L.other]].forEach(function (g) {
      if (!g[1].length) return;
      html += '<span class="label">' + g[0] + '</span><div class="grid2">' + g[1].map(function (d) {
        var t = picks(d)[0];
        return '<a class="dcard" href="#d/' + slug(d) + '"><b>' + esc(d) + "</b><small>" + plural(inD(d).length, "café") + "</small><em>" + (t ? "1. " + esc(t.name) : "No favourite yet") + "</em></a>";
      }).join("") + "</div>";
    });
    return html + "</div>";
  }

  function viewDistrict(d) {
    var list = S.mine && S.profile
      ? inD(d).filter(function (c) { return !c.closed; }).sort(function (a, b) { return match(b, S.profile).score - match(a, S.profile).score; }).slice(0, 3)
      : picks(d);
    var rest = inD(d).filter(function (c) { return list.indexOf(c) === -1; }).sort(function (a, b) {
      if (a.closed !== b.closed) return a.closed ? 1 : -1;
      return (b.rating || 0) - (a.rating || 0);
    });
    var html = '<div class="pad"><a class="back" href="#map">← Back to map</a>' +
      '<div><h1 class="app-title">' + esc(d) + '</h1><p class="sub">' + plural(inD(d).length, "café") + " tried</p></div>" +
      '<div class="seg" role="group" aria-label="Sort"><button data-mine="0" aria-pressed="' + !S.mine + '">Putri’s top 3</button><button data-mine="1" aria-pressed="' + S.mine + '">Best for me</button></div>';
    if (S.mine && !S.profile) html += '<a class="banner" href="#match"><span class="ico" aria-hidden="true">✨</span><span><b>Take Taste Match first</b><small>4 taps, then this sorts by your taste</small></span></a>';
    else if (list.length) html += list.map(function (c, i) { return card(c, i); }).join("");
    else html += '<p class="sub">Putri hasn’t found a favourite here yet, but here’s everything she’s tried.</p>';
    if (rest.length) html += '<span class="label">Everything else (' + rest.length + ")</span>" + restList(rest);
    return html + "</div>";
  }

  function viewCafe(c) {
    var m = S.profile && !c.closed ? match(c, S.profile) : null;
    var others = inD(c.district).filter(function (x) { return x !== c; }).sort(function (a, b) {
      if (a.closed !== b.closed) return a.closed ? 1 : -1;
      return (a.rank || 9) - (b.rank || 9) || (b.rating || 0) - (a.rating || 0);
    });
    var sameDrink = open.filter(function (x) { return x !== c && x.drink === c.drink && c.drink !== "Other" && x.district !== c.district; })
      .sort(function (a, b) { return (b.rating || 0) - (a.rating || 0); }).slice(0, 3);
    var isTop = c.rank && c.rank <= 3 && !c.closed;
    var html = '<div class="pad"><a class="back" href="#d/' + slug(c.district) + '">← ' + esc(c.district) + "</a>" +
      '<div class="cafe-hero"><div class="h-row" style="align-items:flex-start"><div style="min-width:0">' +
      (isTop ? '<span class="label" style="margin:0">Putri’s #' + c.rank + " in " + esc(c.district) + "</span>" : "") +
      '<h1 class="app-title">' + esc(c.name) + "</h1>" +
      '<p class="sub">' + esc(c.district) + (c.closed ? " · closed" : "") + "</p></div>" +
      (m ? '<span class="match" title="Your Taste Match">' + m.score + "%</span>" : "") + "</div>" +
      '<div class="cafe-facts"><div><small>Putri’s rating</small><b>' + (c.rating != null ? "★ " + c.rating : "–") + "</b></div>" +
      "<div><small>Order</small><b>" + esc(c.order || "–") + "</b></div>" +
      "<div><small>Price</small><b>" + esc(price(c) || "–") + "</b></div></div></div>" +
      (c.note ? '<blockquote class="cafe-note">“' + esc(c.note) + "”<small>Putri</small></blockquote>" : "") +
      (c.taste.length || c.tags.length ? '<div class="chips">' + chipsFor(c) + "</div>" : "") +
      (m && m.why.length ? '<span class="label">Why it’s ' + m.score + "% for you</span>" + '<div class="chips">' + m.why.map(function (w) { return '<span class="chip ' + w[0] + '">' + esc(w[1]) + "</span>"; }).join("") + "</div>"
        : !S.profile ? '<a class="banner" href="#match"><span class="ico" aria-hidden="true">✨</span><span><b>Is this one for you?</b><small>Take the 20-second Taste Match to see your % match</small></span></a>' : "") +
      '<div class="row-btns"><a class="pill solid" href="' + esc(mapsUrl(c)) + '" target="_blank" rel="noopener">📍 Open in Maps</a>' +
      (c.closed ? "" : '<button class="pill" data-crawlfrom="' + c.id + '">🚶 Start a crawl here</button>') +
      saveBtn(c) + '<button class="pill" data-share="1">Share</button></div>' +
      (c.closed ? "" : voteBlock(c, true));
    if (others.length) html += '<span class="label">More in ' + esc(c.district) + "</span>" + restList(others.slice(0, 6));
    if (sameDrink.length) html += '<span class="label">Other ' + esc(c.drink.toLowerCase()) + "s Putri rates</span>" + restList(sameDrink);
    return html + "</div>";
  }

  function viewSaved(data) {
    var html = '<div class="pad">';
    if (data) {
      var shared = parseListLink(data);
      var newOnes = shared.list.filter(function (c) { return !isSaved(c); });
      html += '<a class="back" href="#saved">← My list</a><div><h1 class="app-title">A saved list</h1><p class="sub">' + plural(shared.list.length, "café") + " from a Bean There list" + (shared.profile ? " · " + esc(persona(shared.profile).name) : "") + ".</p></div>" +
        (shared.list.length ? restList(shared.list) : '<p class="sub">This link is empty or out of date.</p>') +
        (newOnes.length || (shared.profile && !S.profile) ? '<button class="pill solid" data-import="' + esc(data) + '" style="justify-self:start;padding:9px 16px">♥ Add ' + (newOnes.length ? plural(newOnes.length, "café") : "this") + " to my list</button>" : '<p class="sub">You already have all of these saved.</p>');
      return html + "</div>";
    }
    var list = savedCafes();
    html += '<div><h1 class="app-title">My list</h1><p class="sub">Your saved cafés and quiz result. No login needed.</p></div>';
    if (S.profile) html += '<a class="banner" href="#results"><span class="ico" aria-hidden="true">' + persona(S.profile).emoji + "</span><span><b>" + esc(persona(S.profile).name) + "</b><small>Your coffee personality · see your matches</small></span></a>";
    else html += '<a class="banner" href="#match"><span class="ico" aria-hidden="true">✨</span><span><b>Take the Taste Match</b><small>Your result is saved here too</small></span></a>';
    if (!list.length) {
      html += '<div class="soon">Nothing saved yet. Tap <b>♡ Save</b> on any café and it will wait for you here.</div><a class="pill solid" href="#map" style="justify-self:start">Browse the map →</a>';
    } else {
      html += '<span class="label">Saved cafés (' + list.length + ")</span>" +
        '<ul class="list">' + list.map(function (c) {
          return '<li class="' + (c.closed ? "is-closed" : "") + '"><a class="row" href="' + cafeHref(c) + '"><span class="n">♥</span><div><b>' + esc(c.name) + (c.closed ? " (closed)" : "") + "</b><small>" + esc(c.district) + " · " + esc(c.order) + '</small></div></a><button class="icon-btn" data-save="' + esc(vkey(c)) + '" aria-label="Remove ' + esc(c.name) + ' from my list">✕</button></li>';
        }).join("") + "</ul>" +
        '<div class="row-btns">' + (list.filter(function (c) { return !c.closed; }).length >= 2 ? '<button class="pill solid" data-crawlsaved="1">🚶 Plan a crawl with these</button>' : "") +
        '<button class="pill" data-copylist="1">🔗 Copy my list link</button></div>';
    }
    html += '<p class="sub" style="font-size:12.5px">Your list is kept on this phone, in this browser. To keep a backup, open it on another device, or share it with a friend, use “Copy my list link”. Clearing your browser data removes the list on this phone.</p>';
    return html + "</div>";
  }

  function viewPutri() {
    function avg(a) { return a.reduce(function (s, x) { return s + x; }, 0) / a.length; }
    function n(f) { return cafes.filter(f).length; }
    var rated = cafes.filter(function (c) { return c.rating != null; });
    var spent = cafes.reduce(function (s, c) { return s + firstPrice(c); }, 0);
    var fives = open.filter(function (c) { return c.rating === 5; });
    var byDrink = {};
    rated.forEach(function (c) { (byDrink[c.drink] = byDrink[c.drink] || []).push(c.rating); });
    var most = Object.keys(byDrink).filter(function (k) { return k !== "Other"; }).sort(function (a, b) { return byDrink[b].length - byDrink[a].length; })[0];
    var happiest = Object.keys(byDrink).filter(function (k) { return k !== "Other" && byDrink[k].length >= 3; }).sort(function (a, b) { return avg(byDrink[b]) - avg(byDrink[a]); })[0];
    var buckets = [["≤2.5", function (r) { return r <= 2.5; }], ["3", function (r) { return r > 2.5 && r < 3.5; }], ["3.5", function (r) { return r >= 3.5 && r < 3.7; }], ["3.7", function (r) { return r >= 3.7 && r < 3.9; }], ["4", function (r) { return r >= 3.9 && r < 4.5; }], ["4.5", function (r) { return r >= 4.5 && r < 5; }], ["5", function (r) { return r === 5; }]];
    var counts = buckets.map(function (b) { return rated.filter(function (c) { return b[1](c.rating); }).length; });
    var max = Math.max.apply(null, counts.concat([1]));
    var mode = buckets[counts.indexOf(Math.max.apply(null, counts))][0];
    var peeves = [
      ["Too milky", n(function (c) { return c.taste.indexOf("milky") !== -1 && c.rating < 4.2; })],
      ["Tiny portions", n(function (c) { return c.tags.indexOf("small-portion") !== -1; })],
      ["Nowhere to sit", n(function (c) { return c.tags.indexOf("small-space") !== -1 || c.tags.indexOf("takeaway-only") !== -1; })],
      ["Nutty beans", n(function (c) { return c.taste.indexOf("nutty") !== -1 && c.rating < 4.2; })],
      ["No ports", n(function (c) { return c.tags.indexOf("no-ports") !== -1; })]
    ].filter(function (p) { return p[1] > 0; }).sort(function (a, b) { return b[1] - a[1]; });
    var list = open.filter(function (c) { return c.drink === S.drink; }).sort(function (a, b) { return (b.rating || 0) - (a.rating || 0) || firstPrice(a) - firstPrice(b); });
    var shame = open.filter(function (c) { return c.rating != null && c.rating <= 2.5; });

    return '<div class="pad">' +
      '<div class="hero-p">' + mascot("hero-cup") + '<div><span class="label" style="margin:0;color:inherit;opacity:.75">Putri’s Palate</span><h1>Professional over-caffeinator</h1><p>Reviewing Hong Kong coffee since Nov 2024</p></div></div>' +
      '<div class="stats4"><div class="stat"><b>' + cafes.length + '</b><small>cafés tried</small></div><div class="stat"><b>HK$' + spent.toLocaleString("en") + "</b><small>spent (roughly…)</small></div>" +
      '<div class="stat"><b>' + fives.length + '</b><small>perfect 5s</small></div>' +
      (most ? '<div class="stat"><b>' + byDrink[most].length + "</b><small>" + esc(most.toLowerCase()) + "s, her most-ordered</small></div>" : "") + "</div>" +
      (happiest ? '<div class="quote">“' + esc(DRINK_VOICE[happiest]) + "”<small>Her happiest drink: " + esc(happiest) + " averages ★ " + avg(byDrink[happiest]).toFixed(1) + ", the highest of anything she orders.</small></div>" : "") +
      '<span class="label">How Putri rates</span><div class="hist" role="img" aria-label="How many cafés got each rating">' + buckets.map(function (b, i) {
        return '<div class="hrow' + (counts[i] === max ? " peak" : "") + '"><span>★ ' + b[0] + '</span><span class="htrack"><i style="width:' + (counts[i] / max * 100) + '%"></i></span><span>' + counts[i] + "</span></div>";
      }).join("") + (mode === "3.7" ? '<p class="hnote">Her most common score is 3.7. Translation: “it’s fine, I guess.”</p>' : "") + "</div>" +
      (fives.length ? '<span class="label">Hall of fame</span><div class="fame">' + fives.map(function (c) {
        return '<a href="' + cafeHref(c) + '"><span class="stars">★★★★★</span><b>' + esc(c.name) + "</b><small>" + esc(c.district) + " · " + esc(c.order) + "</small></a>";
      }).join("") + "</div>" : "") +
      (peeves.length ? '<span class="label">Things that make Putri sigh</span><div class="peeve">' + peeves.map(function (p) { return "<span>" + esc(p[0]) + " <b>×" + p[1] + "</b></span>"; }).join("") + "</div>" : "") +
      '<span class="label">Putri’s power rankings</span><div class="chips" role="group" aria-label="Drink">' + DRINKS.map(function (k) {
        return '<button class="pill" data-drink="' + k + '" aria-pressed="' + (S.drink === k) + '">' + k + "</button>";
      }).join("") + "</div>" +
      '<div class="quote">“' + esc(DRINK_VOICE[S.drink]) + "”<small>" + plural(list.length, "café") + " · ranked by Putri</small></div>" +
      list.slice(0, 3).map(function (c, i) { return card(c, i, { district: true, noVote: true }); }).join("") +
      (list.length > 3 ? '<ul class="list">' + list.slice(3).map(function (c, i) {
        return '<li><a class="row" href="' + cafeHref(c) + '"><span class="n">' + (i + 4) + "</span><div><b>" + esc(c.name) + "</b><small>" + esc(c.district) + (price(c) ? " · " + esc(price(c)) : "") + '</small></div><span class="score">★ ' + c.rating + "</span></a></li>";
      }).join("") + "</ul>" : "") +
      (shame.length ? '<span class="label">Hall of shame (so you don’t repeat my mistakes)</span><ul class="list">' + shame.map(function (c) {
        return '<li><a class="row" href="' + cafeHref(c) + '"><span class="n">✗</span><div><b>' + esc(c.name) + "</b><small>" + esc(c.district) + " · “" + esc(c.note) + '”</small></div><span class="score">★ ' + c.rating + "</span></a></li>";
      }).join("") + "</ul>" : "") +
      '<a class="banner" href="#note" data-fbgo="hi"><span class="ico" aria-hidden="true">💌</span><span><b>Send Putri a note</b><small>Suggest a café, share an idea, report a bug or just say hi</small></span></a></div>';
  }

  function regionOf(d) {
    for (var i = 0; i < REGIONS.length; i++) if (REGIONS[i].districts.indexOf(d) !== -1) return REGIONS[i].id;
    return "elsewhere";
  }
  function crawlRegions() {
    var list = REGIONS.filter(function (r) { return r.districts.some(function (d) { return districts.indexOf(d) !== -1; }); });
    if (districts.some(function (d) { return regionOf(d) === "elsewhere"; })) list.push({ id: "elsewhere", name: "Elsewhere", districts: districts.filter(function (d) { return regionOf(d) === "elsewhere"; }) });
    if (savedCafes().filter(function (c) { return !c.closed; }).length) list.push({ id: "saved", name: "♥ My list", districts: [] });
    return list;
  }
  function walkIndex(d) {
    for (var i = 0; i < REGIONS.length; i++) { var j = REGIONS[i].districts.indexOf(d); if (j !== -1) return i * 100 + j; }
    return 1000 + districts.indexOf(d);
  }
  function km(a, b) {
    var x = (b.coords[1] - a.coords[1]) * Math.cos((a.coords[0] + b.coords[0]) * Math.PI / 360), y = b.coords[0] - a.coords[0];
    return Math.sqrt(x * x + y * y) * 111.2;
  }
  // Suggested order: along the MTR / waterfront, then by Putri's rank. With coordinates, nearest stop next.
  function suggestedOrder(list) {
    var sorted = list.slice().sort(function (a, b) { return walkIndex(a.district) - walkIndex(b.district) || (a.rank || 9) - (b.rank || 9) || (b.rating || 0) - (a.rating || 0); });
    if (list.length < 3 || !list.every(function (c) { return c.coords; })) return sorted;
    var best = null;
    sorted.forEach(function (startC) { // try each start, keep the shortest nearest-neighbour path
      var rest = sorted.filter(function (c) { return c !== startC; }), path = [startC], dist = 0;
      while (rest.length) {
        var last = path[path.length - 1];
        rest.sort(function (a, b) { return km(last, a) - km(last, b); });
        dist += km(last, rest[0]); path.push(rest.shift());
      }
      if (!best || dist < best.dist) best = { path: path, dist: dist };
    });
    return best.path;
  }
  function crawlCandidates(region) {
    if (region === "saved") return savedCafes().filter(function (c) { return !c.closed; });
    var reg = crawlRegions().filter(function (r) { return r.id === region; })[0];
    var ds = reg ? reg.districts.filter(function (d) { return districts.indexOf(d) !== -1; }) : [];
    return open.filter(function (c) { return ds.indexOf(c.district) !== -1; });
  }
  function defaultStops(region) {
    var cand = crawlCandidates(region);
    if (region === "saved") return cand.slice(0, MAX_STOPS).map(function (c) { return c.id; });
    var byD = [];
    cand.slice().sort(function (a, b) { return walkIndex(a.district) - walkIndex(b.district) || (a.rank || 9) - (b.rank || 9) || (b.rating || 0) - (a.rating || 0); })
      .forEach(function (c) { if (byD.every(function (x) { return x.district !== c.district; })) byD.push(c); });
    var pick = byD.slice(0, 3);
    if (pick.length < 3) cand.forEach(function (c) { if (pick.length < 3 && pick.indexOf(c) === -1 && c.rank) pick.push(c); });
    return pick.map(function (c) { return c.id; });
  }
  function dirUrl(stops, mode) {
    var pts = stops.map(mapsQ);
    return "https://www.google.com/maps/dir/?api=1&travelmode=" + mode + "&origin=" + encodeURIComponent(pts[0]) + "&destination=" + encodeURIComponent(pts[pts.length - 1]) +
      (pts.length > 2 ? "&waypoints=" + encodeURIComponent(pts.slice(1, -1).join("|")) : "");
  }

  function viewCrawl() {
    var regions = crawlRegions();
    if (!regions.some(function (r) { return r.id === S.crawlRegion; })) { S.crawlRegion = S.pin ? regionOf(S.pin) : "west"; if (!regions.some(function (r) { return r.id === S.crawlRegion; })) S.crawlRegion = regions[0].id; S.crawl = null; }
    var region = S.crawlRegion, cand = crawlCandidates(region);
    if (!S.crawl) { S.crawl = defaultStops(region); S.crawlCustom = null; }
    var sel = cand.filter(function (c) { return S.crawl.indexOf(c.id) !== -1; });
    var stops = S.crawlCustom ? S.crawlCustom.map(function (id) { return sel.filter(function (c) { return c.id === id; })[0]; }).filter(Boolean) : suggestedOrder(sel);
    var mg = stops.reduce(function (t, c) { return t + (CAFFEINE[c.drink] || 110); }, 0);
    var spend = stops.reduce(function (t, c) { return t + firstPrice(c); }, 0);
    var mood = mg === 0 ? "Pick some stops!" : mg <= 150 ? "A gentle buzz. Very civilised." : mg <= 280 ? "Productive vibrations. Emails will be answered." : mg <= 400 ? "You can now hear colours." : "Putri is legally required to stop you. Make one a matcha?";
    var oneDistrict = stops.every(function (c) { return c.district === (stops[0] || {}).district; });

    var html = '<div class="pad"><h1 class="app-title">Coffee Crawl</h1><p class="sub">Pick an area and up to ' + MAX_STOPS + " stops. Putri suggests the order; rearrange it if you like.</p>" +
      '<div class="chips" role="group" aria-label="Area">' + regions.map(function (r) {
        return '<button class="pill" data-region="' + r.id + '" aria-pressed="' + (r.id === region) + '">' + esc(r.name) + "</button>";
      }).join("") + "</div>";

    // Candidate stops grouped by district, in walking order
    var groups = [];
    cand.slice().sort(function (a, b) { return walkIndex(a.district) - walkIndex(b.district) || (a.rank || 9) - (b.rank || 9) || (b.rating || 0) - (a.rating || 0); })
      .forEach(function (c) { var g = groups[groups.length - 1]; if (!g || g.d !== c.district) groups.push(g = { d: c.district, list: [] }); g.list.push(c); });
    var picker = groups.length ? '<span class="label">Add or change stops</span>' + groups.map(function (g) {
      var n = g.list.filter(function (c) { return S.crawl.indexOf(c.id) !== -1; }).length;
      return '<details class="stops-group"' + (groups.length === 1 || !stops.length ? " open" : "") + '><summary>' + esc(g.d) + ' <span class="meta">' + (n ? n + " picked · " : "") + plural(g.list.length, "café") + '</span></summary><div class="list" role="group" aria-label="' + esc(g.d) + '">' + g.list.map(function (c) {
        var on = S.crawl.indexOf(c.id) !== -1, full = !on && S.crawl.length >= MAX_STOPS;
        return '<label class="stop"><input type="checkbox" data-stop="' + c.id + '"' + (on ? " checked" : "") + (full ? " disabled" : "") + '><span><b style="font-size:14px">' + esc(c.name) + '</b><br><small class="meta">' + esc(c.drink) + (price(c) ? " · " + esc(price(c)) : "") + '</small></span><span class="score">' + (c.rank ? "#" + c.rank : c.rating != null ? "★ " + c.rating : "") + "</span></label>";
      }).join("") + "</div></details>";
    }).join("") : '<p class="sub">No open cafés here yet.</p>';

    var meter = '<div class="meter"><div class="h-row"><b>☕ ' + mg + ' mg caffeine</b><small class="meta">daily limit ~400 mg</small></div>' +
      '<div class="meter-bar' + (mg > 400 ? " over" : "") + '" role="img" aria-label="' + mg + ' of 400 milligrams"><i style="width:' + Math.min(100, mg / 400 * 100) + '%"></i></div><small>' + esc(mood) + "</small></div>";

    if (stops.length) {
      var allCoords = stops.every(function (c) { return c.coords; });
      html += '<div class="h-row"><span class="label" style="margin:0">' + (S.crawlCustom ? "Your order" : "Suggested order") + " · about HK$" + spend + "</span>" +
        (S.crawlCustom ? '<button class="pill" data-resetorder="1">Use suggested order</button>' : "") + "</div>" +
        '<ol class="route-edit">' + stops.map(function (c, i) {
          var leg = "";
          if (i > 0) {
            var prev = stops[i - 1], same = prev.district === c.district;
            leg = '<a class="leg" href="' + esc(dirUrl([prev, c], same ? "walking" : "transit")) + '" target="_blank" rel="noopener">' + (same ? "🚶 Walk from stop " + i : "🚇 MTR or walk from stop " + i) + allCoordsLeg(prev, c) + " →</a>";
          }
          return "<li>" + leg + '<div class="route-row"><span class="num">' + (i + 1) + '</span><span class="who"><a class="cafe-link" href="' + cafeHref(c) + '"><b>' + esc(c.name) + '</b></a><small class="meta">' + esc(c.district) + " · get " + esc(c.order) + "</small></span>" +
            '<span class="moves"><button class="icon-btn" data-move="' + c.id + '" data-dir="-1" aria-label="Move ' + esc(c.name) + ' earlier"' + (i === 0 ? " disabled" : "") + ">↑</button>" +
            '<button class="icon-btn" data-move="' + c.id + '" data-dir="1" aria-label="Move ' + esc(c.name) + ' later"' + (i === stops.length - 1 ? " disabled" : "") + ">↓</button>" +
            '<button class="icon-btn" data-unstop="' + c.id + '" aria-label="Remove ' + esc(c.name) + '">✕</button></span></div></li>';
        }).join("") + "</ol>";
      if (!allCoords && stops.length > 2 && !oneDistrict && !S.crawlCustom) html += '<p class="sub" style="font-size:12.5px">Ordered along the MTR line, one district after the next.</p>';
      if (stops.length >= 2) {
        html += '<a class="pill solid" style="text-align:center;padding:10px" href="' + esc(dirUrl(stops, "walking")) + '" target="_blank" rel="noopener">🗺️ Open the whole route in Google Maps</a>' +
          (oneDistrict ? "" : '<p class="sub" style="font-size:12.5px">The whole route opens as a walk. Google Maps can’t add stops to MTR directions, so use the 🚇 links between stops when it’s too far to walk.</p>');
      } else html += '<p class="sub">Pick at least 2 stops to get a route.</p>';
    } else html += '<p class="sub">Pick some stops below to build your route.</p>';
    return html + meter + picker + "</div>";
  }
  function allCoordsLeg(a, b) {
    if (!a.coords || !b.coords) return "";
    var d = km(a, b);
    return " · " + (d < 1 ? Math.round(d * 1000 / 10) * 10 + " m" : d.toFixed(1) + " km");
  }

  function viewVotes() {
    var html = '<div class="pad"><h1 class="app-title">Putri vs You</h1><p class="sub">Friends vote on whether Putri got it right.</p>';
    if (!API) return html + '<div class="soon">🗳️ Voting opens soon. Putri is still setting up the ballot box.</div></div>';
    if (summary.failed) return html + '<div class="soon">Couldn’t load the votes right now. Try again in a bit.</div></div>';
    if (!summary.loaded) return html + '<p class="sub">Counting votes…</p></div>';
    var rated = open.map(function (c) { var v = votesFor(c); return { c: c, v: v, tot: v.agree + v.disagree, pct: v.agree / Math.max(1, v.agree + v.disagree) }; }).filter(function (x) { return x.tot > 0; });
    var all = rated.reduce(function (s, x) { s.a += x.v.agree; s.t += x.tot; return s; }, { a: 0, t: 0 });
    var recent = summary.recent.map(function (r) {
      var c = cafes.filter(function (x) { return x.district === r.district && x.name === r.cafe; })[0];
      return c ? '<li><a class="row" href="' + cafeHref(c) + '"><span class="n">' + (r.verdict === "agree" ? "👍" : "👎") + "</span><div><b>" + esc(c.name) + "</b><small>" + esc(c.district) + " · " + (r.verdict === "agree" ? "agreed with" : "disagreed with") + " Putri’s ★ " + c.rating + '</small></div><span class="meta">' + timeAgo(r.time) + "</span></a></li>" : "";
    }).join("");
    var feed = recent ? '<span class="label">🕒 Latest votes</span><ul class="list">' + recent + "</ul>" : "";
    if (all.t < 3) return html + '<div class="soon">Not enough votes yet. Open any café and tap 👍 or 👎 to get things started.</div>' + feed + '<a class="pill solid" href="#map">Find a café to vote on →</a></div>';
    var contro = rated.filter(function (x) { return x.tot >= 2; }).sort(function (a, b) { return Math.abs(a.pct - 0.5) - Math.abs(b.pct - 0.5) || b.tot - a.tot; }).slice(0, 4);
    var harsh = rated.filter(function (x) { return x.c.rating != null && x.c.rating <= 3.7 && x.v.disagree > 0; }).sort(function (a, b) { return b.v.disagree - a.v.disagree; }).slice(0, 3);
    var solid = rated.filter(function (x) { return x.tot >= 2 && x.pct >= .75; }).sort(function (a, b) { return b.pct - a.pct || b.tot - a.tot; }).slice(0, 3);
    function li(x, right) { return '<li><a class="row" href="' + cafeHref(x.c) + '"><span class="n">·</span><div><b>' + esc(x.c.name) + "</b><small>" + esc(x.c.district) + " · Putri ★ " + x.c.rating + '</small></div><span class="score">' + right + "</span></a></li>"; }
    html += '<div class="stat big"><b>' + Math.round(all.a / all.t * 100) + "%</b><small>of the time, friends agree with Putri (" + plural(all.t, "vote") + ")</small></div>" + feed;
    if (contro.length) html += '<span class="label">🔥 Most controversial</span><ul class="list">' + contro.map(function (x) { return li(x, x.v.agree + "–" + x.v.disagree); }).join("") + "</ul>";
    if (harsh.length) html += '<span class="label">💎 Friends say Putri was too harsh</span><ul class="list">' + harsh.map(function (x) { return li(x, x.v.disagree + " 👎"); }).join("") + "</ul>";
    if (solid.length) html += '<span class="label">🤝 Everyone agrees</span><ul class="list">' + solid.map(function (x) { return li(x, Math.round(x.pct * 100) + "%"); }).join("") + "</ul>";
    return html + "</div>";
  }

  function viewNote() {
    var f = S.fb, types = [["cafe", "☕ Suggest a café"], ["idea", "💡 Idea or bug"], ["hi", "💜 Say hi"]];
    var html = '<div class="pad"><a class="back" href="#putri">← Back</a>' +
      '<div><h1 class="app-title">Send Putri a note</h1><p class="sub">Suggestions, ideas, bugs or love letters. Putri reads every one.</p></div>';
    if (!API) {
      html += '<div class="soon">💌 The mailbox opens soon. Putri is still building it.</div>';
    } else if (f.sent) {
      html += '<div class="thanks" role="status">' + mascot("thanks-cup") + '<h2 style="font-family:var(--f-title);font-size:26px">Sent!</h2><p class="sub">Putri will read this with a coffee in hand.</p>' +
        '<button class="pill" data-fbnew="1">Send another</button></div>';
    } else {
      html += '<div class="chips" role="group" aria-label="Type of note">' + types.map(function (t) { return '<button class="pill" data-fbtype="' + t[0] + '" aria-pressed="' + (f.type === t[0]) + '">' + t[1] + "</button>"; }).join("") + "</div>" +
        '<form class="form" id="fbform" novalidate>';
      if (f.type === "cafe") {
        html += '<label class="field">Café name<input id="fb-cafe" maxlength="80" placeholder="e.g. the place with the pink door" required></label>' +
          '<label class="field">Where is it?<select id="fb-district">' + districts.concat(["Somewhere else"]).map(function (d) { return "<option" + (d === f.district ? " selected" : "") + ">" + esc(d) + "</option>"; }).join("") + "</select></label>" +
          '<label class="field">Why should Putri go?<textarea id="fb-msg" maxlength="400" placeholder="What to order, what it’s like…"></textarea></label>';
      } else {
        html += '<label class="field">' + (f.type === "idea" ? "Your idea or the bug you found" : "Your message") + '<textarea id="fb-msg" maxlength="600" required placeholder="' + (f.type === "idea" ? "It would be cool if…" : "Hi Putri!") + '"></textarea></label>';
      }
      html += '<label class="field">Your name <small>optional</small><input id="fb-name" maxlength="40" placeholder="So Putri knows who to thank" autocomplete="given-name"></label>' +
        '<label class="hp" aria-hidden="true">Leave this empty<input id="fb-hp" tabindex="-1" autocomplete="off"></label>' +
        (f.error ? '<p class="err" role="alert">' + esc(f.error) + "</p>" : "") +
        '<button class="pill solid" type="submit" style="justify-self:start;padding:9px 18px"' + (f.busy ? " disabled" : "") + ">" + (f.busy ? "Sending…" : "Send to Putri 💌") + "</button></form>";
    }
    var sugg = summary.suggestions.slice().sort(function (a, b) { return (a.status === "tried") - (b.status === "tried") || b.votes - a.votes; });
    if (API) {
      html += '<span class="label">Putri’s to-try list</span>';
      html += sugg.length ? '<p class="sub" style="margin-top:-6px">Cafés friends suggested. Upvote the ones she should try next.</p><ul class="list totry">' + sugg.map(function (x) {
        var up = !!S.myUps[x.id];
        return "<li><div><b>" + esc(x.cafe) + "</b><small>" + (x.district ? esc(x.district) + " · " : "") + "from " + esc(x.by) + (x.why ? " · “" + esc(x.why) + "”" : "") + "</small>" +
          '<div class="row-btns" style="margin-top:6px"><span class="tag-status' + (x.status === "tried" ? " done" : "") + '">' + (x.status === "tried" ? "Tried ✓" + (x.rating != null ? " ★ " + x.rating : "") : "To try") + "</span></div></div>" +
          '<button class="pill upv" data-up="' + x.id + '" aria-pressed="' + up + '" aria-label="Upvote ' + esc(x.cafe) + '">▲ ' + x.votes + "</button></li>";
      }).join("") + "</ul>" : '<p class="sub" style="margin-top:-6px">No suggestions yet. Be the first!</p>';
    }
    return html + "</div>";
  }

  // ---------- Router ----------

  function districtFromSlug(s) { return districts.filter(function (d) { return slug(d) === s; })[0]; }

  function parseHash() {
    var h = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
    if (!h) return { name: "landing" };
    if (h.indexOf("d/") === 0) { var d = districtFromSlug(h.slice(2)); return d ? { name: "district", d: d } : { name: "map" }; }
    if (h.indexOf("c/") === 0) {
      var parts = h.slice(2).split("/"), cd = districtFromSlug(parts[0]);
      var cafe = cd && cafes.filter(function (x) { return x.district === cd && slug(x.name) === parts[1]; })[0];
      return cafe ? { name: "cafe", c: cafe } : { name: "map" };
    }
    if (["map", "match", "results", "putri", "crawl", "votes", "note", "saved"].indexOf(h) !== -1) return { name: h };
    if (h.indexOf("saved/") === 0) return { name: "saved", data: h.slice(6) };
    var legacy = districtFromSlug(h); // old links like #sheung-wan
    return legacy ? { name: "district", d: legacy } : { name: "landing" };
  }

  var lastRoute = "";
  function route(keepScroll) {
    var r = parseHash(), key = r.name + (r.d || "") + (r.c ? r.c.id : "") + (r.data || "");
    if (key !== lastRoute) { keepScroll = false; if (r.name === "match" && !S.brewing) { S.step = 0; S.draft = {}; } }
    lastRoute = key;
    if (r.name === "results" && !S.profile) { location.replace("#match"); return; }
    var y = window.scrollY, html, title = "Bean There by Putri", navKey = r.name;
    if (r.name === "landing") html = viewLanding();
    else if (r.name === "match") html = S.brewing ? viewBrewing() : viewQuiz();
    else if (r.name === "results") { html = viewResults(); title = "My Taste Match · " + title; }
    else if (r.name === "map") { html = viewMap(); title = "Map · " + title; }
    else if (r.name === "district") { S.pin = r.d; html = viewDistrict(r.d); title = r.d + " · " + title; navKey = "map"; }
    else if (r.name === "cafe") { S.pin = r.c.district; html = viewCafe(r.c); title = r.c.name + " · " + title; navKey = "map"; }
    else if (r.name === "putri") { html = viewPutri(); title = "Putri’s Palate · " + title; }
    else if (r.name === "crawl") { html = viewCrawl(); title = "Coffee Crawl · " + title; }
    else if (r.name === "votes") { html = viewVotes(); title = "Putri vs You · " + title; }
    else if (r.name === "saved") { html = viewSaved(r.data); title = "My list · " + title; navKey = ""; }
    else if (r.name === "note") { html = viewNote(); title = "Send Putri a note · " + title; navKey = "putri"; }
    document.title = title;
    app.innerHTML = html;
    var chrome = r.name !== "landing" && !(r.name === "match" && S.brewing);
    var nav = chrome && r.name !== "match";
    topbar.hidden = !chrome;
    navEl.hidden = !nav;
    document.body.classList.toggle("has-nav", nav);
    document.body.classList.toggle("is-landing", !chrome);
    navEl.innerHTML = NAV.map(function (n) {
      return '<a href="#' + n[0] + '"' + (navKey === n[0] || (n[0] === "results" && navKey === "match") ? ' aria-current="page"' : "") + '><span aria-hidden="true">' + n[1] + "</span>" + n[2] + "</a>";
    }).join("");
    var sc = document.getElementById("saved-count");
    if (sc) { sc.textContent = S.saved.length ? S.saved.length : ""; sc.parentNode.setAttribute("aria-current", r.name === "saved" ? "page" : "false"); }
    window.scrollTo(0, keepScroll ? y : 0);
  }

  // ---------- Events ----------

  function currentOrder() {
    var sel = crawlCandidates(S.crawlRegion).filter(function (c) { return S.crawl.indexOf(c.id) !== -1; });
    return S.crawlCustom ? S.crawlCustom.filter(function (id) { return sel.some(function (c) { return c.id === id; }); }) : suggestedOrder(sel).map(function (c) { return c.id; });
  }

  function clearTimers() { timers.forEach(clearTimeout); timers = []; }

  function startBrewing() {
    S.brewing = true; route(); clearTimers();
    BREW_LINES.forEach(function (line, i) {
      if (i) timers.push(setTimeout(function () { var el = document.getElementById("brewline"); if (el) el.textContent = line; }, i * 450));
    });
    timers.push(setTimeout(function () { S.brewing = false; location.hash = "#results"; }, 2300));
  }

  function castVote(key, verdict) {
    var prev = S.myVotes[key], next = prev === verdict ? "none" : verdict;
    var v = summary.votes[key] = summary.votes[key] || { agree: 0, disagree: 0 };
    if (prev) v[prev] = Math.max(0, v[prev] - 1);
    if (next !== "none") v[next] += 1;
    if (next === "none") delete S.myVotes[key]; else S.myVotes[key] = next;
    save("bt-votes", S.myVotes); route(true);
    var parts = key.split("|");
    apiPost({ action: "vote", district: parts[0], name: parts.slice(1).join("|"), verdict: next }).then(function (res) {
      if (res && res.ok && res.votes) { summary.votes[key] = res.votes; route(true); }
      else if (res && res.error) toast(res.error);
    }).catch(function () { toast("Couldn’t save your vote. Check your connection."); });
  }

  document.addEventListener("click", function (e) {
    var pin = e.target.closest && e.target.closest("[data-pin]");
    if (pin) { S.pin = pin.getAttribute("data-pin"); route(true); return; }
    var t = e.target.closest("button, a");
    if (!t) return;
    var d = t.dataset;
    if (d.fbgo) { S.fb = { type: d.fbgo, sent: false, error: "", busy: false, district: d.fbdistrict || "" }; return; } // link continues to #note
    if (d.qback) { S.step = Math.max(0, S.step - 1); route(); return; }
    if (d.answer) {
      if (t.classList.contains("picked")) return;
      t.classList.add("picked");
      S.draft[QUIZ[S.step].key] = d.answer;
      setTimeout(function () {
        if (parseHash().name !== "match") return;
        if (S.step < QUIZ.length - 1) { S.step++; route(); }
        else { S.profile = S.draft; save("bt-profile", S.profile); startBrewing(); }
      }, 260);
      return;
    }
    if (d.view) { S.view = d.view; route(true); return; }
    if (d.mine) { S.mine = d.mine === "1"; route(true); return; }
    if (d.drink) { S.drink = d.drink; route(true); return; }
    if (d.vote) { castVote(d.key, d.vote); return; }
    if (d.share) { document.getElementById("share-btn").click(); return; }
    if (d.crawlfrom) {
      var cf = cafes.filter(function (x) { return x.id === +d.crawlfrom; })[0];
      if (cf) {
        S.crawlRegion = regionOf(cf.district);
        var near = inD(cf.district).filter(function (x) { return !x.closed && x !== cf; }).sort(function (a, b) { return (a.rank || 9) - (b.rank || 9) || (b.rating || 0) - (a.rating || 0); });
        S.crawl = [cf.id].concat(near.slice(0, 2).map(function (x) { return x.id; })); S.crawlCustom = null;
        location.hash = "#crawl";
      }
      return;
    }
    if (d.region) { S.crawlRegion = d.region; S.crawl = null; S.crawlCustom = null; route(true); return; }
    if (d.resetorder) { S.crawlCustom = null; route(true); return; }
    if (d.move || d.unstop) {
      var order = currentOrder(), id2 = +(d.move || d.unstop), at = order.indexOf(id2);
      if (d.unstop) { order.splice(at, 1); S.crawl = S.crawl.filter(function (x) { return x !== id2; }); }
      else { var to = at + (+d.dir); if (to < 0 || to >= order.length) return; order.splice(at, 1); order.splice(to, 0, id2); }
      S.crawlCustom = order; route(true); return;
    }
    if (d.save) {
      var sk = d.save, si = S.saved.indexOf(sk);
      if (si === -1) { S.saved.push(sk); toast("Saved to My list ♥"); } else { S.saved.splice(si, 1); toast("Removed from My list"); }
      save("bt-saved", S.saved); route(true); return;
    }
    if (d.copylist) {
      var url = listLink(savedCafes(), S.profile);
      if (navigator.share) navigator.share({ title: "My Bean There list", url: url }).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { toast("Link copied! Open it anywhere to get your list back."); }, function () { toast(url); });
      else toast(url);
      return;
    }
    if (d.import) {
      var imp = parseListLink(d.import);
      imp.list.forEach(function (c) { if (!isSaved(c)) S.saved.push(vkey(c)); });
      save("bt-saved", S.saved);
      if (imp.profile && !S.profile) { S.profile = imp.profile; save("bt-profile", S.profile); }
      toast("Added to My list ♥"); location.hash = "#saved"; return;
    }
    if (d.crawlsaved) { S.crawlRegion = "saved"; S.crawl = null; S.crawlCustom = null; location.hash = "#crawl"; return; }
    if (d.fbtype) { S.fb.type = d.fbtype; S.fb.error = ""; route(true); return; }
    if (d.fbnew) { S.fb.sent = false; route(true); return; }
    if (d.up) {
      var id = +d.up, s = summary.suggestions.filter(function (x) { return x.id === id; })[0], up = !S.myUps[id];
      if (!s) return;
      s.votes = Math.max(0, s.votes + (up ? 1 : -1));
      if (up) S.myUps[id] = true; else delete S.myUps[id];
      save("bt-ups", S.myUps); route(true);
      apiPost({ action: "upvote", id: id, up: up }).then(function (res) { if (res && res.error) toast(res.error); }).catch(function () { toast("Couldn’t save your upvote."); });
      return;
    }
  });

  document.addEventListener("keydown", function (e) {
    var pin = e.target.closest && e.target.closest("[data-pin]");
    if (pin && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      var name = pin.getAttribute("data-pin"); S.pin = name; route(true);
      var again = app.querySelector('[data-pin="' + name.replace(/"/g, '\\"') + '"]'); if (again) again.focus();
    }
  });

  document.addEventListener("input", function (e) {
    if (e.target.id !== "q") return;
    S.query = e.target.value;
    var hits = searchHits(S.query);
    if (hits.length && !hits.some(function (c) { return c.district === S.pin; })) S.pin = hits[0].district;
    var pos = e.target.selectionStart; route(true);
    var q = document.getElementById("q"); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (err) { /* ignore */ } }
  });

  document.addEventListener("change", function (e) {
    if (e.target.dataset && e.target.dataset.stop) {
      var id = +e.target.dataset.stop, i = S.crawl.indexOf(id);
      if (e.target.checked && i === -1 && S.crawl.length < MAX_STOPS) { S.crawl.push(id); if (S.crawlCustom) S.crawlCustom.push(id); }
      else if (!e.target.checked && i !== -1) { S.crawl.splice(i, 1); if (S.crawlCustom) S.crawlCustom = S.crawlCustom.filter(function (x) { return x !== id; }); }
      route(true);
    }
  });

  document.addEventListener("submit", function (e) {
    var ck = e.target.dataset && e.target.dataset.commentkey;
    if (ck) {
      e.preventDefault();
      var txt = (document.getElementById("vote-comment") || {}).value || "";
      txt = txt.trim();
      if (!txt) return;
      var verdict = S.myVotes[ck], parts = ck.split("|");
      S.commented[ck] = true; route(true);
      apiPost({ action: "vote", district: parts[0], name: parts.slice(1).join("|"), verdict: verdict, comment: txt })
        .then(function (res) { if (res && res.error) toast(res.error); })
        .catch(function () { toast("Couldn’t send your note. Check your connection."); });
      return;
    }
    if (e.target.id !== "fbform") return;
    e.preventDefault();
    var val = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ""; };
    var body = { action: "feedback", type: S.fb.type, cafe: val("fb-cafe"), district: val("fb-district"), message: val("fb-msg"), name: val("fb-name"), website: val("fb-hp") };
    if (body.type === "cafe" && !body.cafe) { S.fb.error = "Add the café’s name so Putri can find it."; route(true); return; }
    if (body.type !== "cafe" && !body.message) { S.fb.error = "Write a message first."; route(true); return; }
    S.fb.busy = true; S.fb.error = ""; route(true);
    apiPost(body).then(function (res) {
      S.fb.busy = false;
      if (res && res.ok) S.fb.sent = true; else S.fb.error = (res && res.error) || "Something went wrong. Try again in a bit.";
      route(true);
    }).catch(function () {
      S.fb.busy = false; S.fb.error = "Couldn’t send. Check your connection and try again."; route(true);
    });
  });

  var toastTimer;
  function toast(msg) {
    var el = document.getElementById("toast");
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
  }

  document.getElementById("share-btn").addEventListener("click", function () {
    var data = { title: document.title, url: location.href };
    if (navigator.share) navigator.share(data).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(function () { toast("Link copied!"); }, function () { toast(location.href); });
    else toast(location.href);
  });

  window.addEventListener("hashchange", function () { clearTimers(); S.brewing = false; route(); });

  setInterval(function () {
    var el = document.getElementById("tagline");
    if (!el) return;
    S.tagline = (S.tagline + 1) % 5;
    el.textContent = TAGLINES()[S.tagline];
  }, 3500);

  // ---------- Start ----------

  document.querySelector(".brand-cup").outerHTML = mascot("brand-cup");
  var savedLink = document.createElement("a");
  savedLink.className = "saved-link"; savedLink.href = "#saved"; savedLink.setAttribute("aria-label", "My list");
  savedLink.innerHTML = '<span aria-hidden="true">♥</span><span id="saved-count"></span>';
  document.getElementById("share-btn").before(savedLink);

  loadCafes().then(function (list) {
    cafes = list;
    open = cafes.filter(function (c) { return !c.closed; });
    var seen = {};
    districts = [];
    ISLAND_LINE.concat(TW_LINE).forEach(function (d) { if (!seen[d] && cafes.some(function (c) { return c.district === d; })) { seen[d] = 1; districts.push(d); } });
    cafes.forEach(function (c) { if (!seen[c.district]) { seen[c.district] = 1; districts.push(c.district); } });
    route();
    refreshSummary();
  }).catch(function (err) {
    console.error(err);
    app.innerHTML = '<p class="status">Couldn’t load the café list. Please try again in a bit.</p>';
  });
})();

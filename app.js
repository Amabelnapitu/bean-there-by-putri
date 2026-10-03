(function () {
  "use strict";

  var LOCAL_CSV = "data/cafes.csv";

  // Districts are grouped and ordered (roughly west to east) using this list.
  // A district that isn't listed still shows up, under "More places".
  var AREAS = [
    {
      name: "Hong Kong Island",
      districts: [
        "Kennedy Town", "Sai Ying Pun", "Sheung Wan", "Central", "Mid-Levels", "Admiralty",
        "Wan Chai", "Happy Valley", "Causeway Bay", "Tin Hau", "Fortress Hill", "North Point",
        "Quarry Bay", "Taikoo", "Sai Wan Ho", "Shau Kei Wan", "Chai Wan", "Pok Fu Lam",
        "Aberdeen", "Wong Chuk Hang", "Repulse Bay", "Stanley"
      ]
    },
    {
      name: "Kowloon",
      districts: [
        "Tsim Sha Tsui", "Jordan", "Yau Ma Tei", "Mong Kok", "Prince Edward", "Tai Kok Tsui",
        "Sham Shui Po", "Cheung Sha Wan", "Lai Chi Kok", "Ho Man Tin", "Hung Hom", "To Kwa Wan",
        "Kowloon City", "Kowloon Tong", "Kai Tak", "Diamond Hill", "Kwun Tong"
      ]
    },
    {
      name: "New Territories & Islands",
      districts: [
        "Tsuen Wan", "Sha Tin", "Tai Wai", "Tai Po", "Sai Kung", "Tseung Kwan O", "Tuen Mun",
        "Yuen Long", "Fanling", "Sheung Shui", "Tung Chung", "Discovery Bay", "Mui Wo",
        "Cheung Chau", "Lamma"
      ]
    }
  ];

  var TAGS = {
    "work-friendly": "💻 Good for working",
    "takeaway-only": "🥡 Takeaway only",
    "small-space": "🤏 Small space",
    "cheap": "💸 Great value",
    "cash-only": "💵 Cash / Octopus only",
    "closed": "🚫 Closed"
  };

  var app = document.getElementById("app");
  var cafes = [];
  var districts = [];

  // ---------- Data ----------

  function parseCSV(text) {
    var rows = [], row = [], field = "", inQuotes = false;
    text = text.replace(/^﻿/, "");
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field); field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row);
        row = []; field = "";
      } else {
        field += c;
      }
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function headerKey(h) {
    return String(h).toLowerCase().replace(/[^a-z]/g, "");
  }

  function toCafes(rows) {
    if (!rows.length) return [];
    var keys = rows[0].map(headerKey);
    return rows.slice(1).map(function (r) {
      var o = {};
      keys.forEach(function (k, i) { o[k] = (r[i] || "").trim(); });
      var tags = (o.tags || "").toLowerCase().split(/[;,]/).map(function (t) { return t.trim(); }).filter(Boolean);
      var rank = parseInt(o.rank, 10);
      var rating = parseFloat(o.rating);
      return {
        district: o.district,
        name: o.name,
        rank: isNaN(rank) ? null : rank,
        rating: isNaN(rating) ? null : rating,
        order: o.mustorder || o.order || "",
        price: o.price || "",
        note: o.note || o.review || "",
        tags: tags,
        closed: tags.indexOf("closed") !== -1,
        maps: o.mapslink || o.maps || ""
      };
    }).filter(function (c) { return c.district && c.name; });
  }

  function fetchText(url) {
    return fetch(url, { cache: "no-cache" }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.text();
    });
  }

  function loadData() {
    var cfg = window.BEAN_THERE_CONFIG || {};
    var sheetUrl = (cfg.sheetCsvUrl || "").trim();
    var primary = sheetUrl ? fetchText(sheetUrl) : fetchText(LOCAL_CSV);
    return primary
      .then(function (text) {
        var list = toCafes(parseCSV(text));
        if (!list.length) throw new Error("No cafés found");
        return list;
      })
      .catch(function (err) {
        if (!sheetUrl) throw err;
        console.warn("Couldn't load the Google Sheet, using the saved copy instead.", err);
        return fetchText(LOCAL_CSV).then(function (text) { return toCafes(parseCSV(text)); });
      });
  }

  function buildDistricts(list) {
    var byName = {};
    list.forEach(function (c) {
      var key = c.district.toLowerCase();
      if (!byName[key]) byName[key] = { name: c.district, slug: slugify(c.district), cafes: [] };
      byName[key].cafes.push(c);
    });
    return Object.keys(byName).map(function (k) {
      var d = byName[k];
      d.picks = d.cafes
        .filter(function (c) { return c.rank !== null && !c.closed; })
        .sort(function (a, b) { return a.rank - b.rank; })
        .slice(0, 3);
      d.rest = d.cafes
        .filter(function (c) { return d.picks.indexOf(c) === -1; })
        .sort(function (a, b) {
          if (a.closed !== b.closed) return a.closed ? 1 : -1;
          return (b.rating || 0) - (a.rating || 0);
        });
      return d;
    });
  }

  // ---------- Helpers ----------

  function slugify(s) {
    return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function formatPrice(p) {
    if (!p) return "";
    return /^\d/.test(p) ? "HK$" + p : p;
  }

  function mapsUrl(c) {
    if (/^https?:\/\//i.test(c.maps)) return c.maps;
    var q = c.name + ", " + c.district + ", Hong Kong";
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
  }

  function ratingHtml(c) {
    return c.rating !== null ? '<span class="rating" aria-label="Rated ' + c.rating + ' out of 5">★ ' + c.rating + "</span>" : "";
  }

  function orderHtml(c) {
    if (!c.order) return "";
    var price = formatPrice(c.price);
    return '<p class="order">Get: <strong>' + esc(c.order) + "</strong>" +
      (price ? ' <span class="price">· ' + esc(price) + "</span>" : "") + "</p>";
  }

  function noteHtml(c) {
    return c.note ? '<p class="note">“' + esc(c.note) + '”</p>' : "";
  }

  function tagsHtml(c) {
    if (!c.tags.length) return "";
    return '<div class="tags">' + c.tags.map(function (t) {
      return '<span class="tag' + (t === "closed" ? " tag-closed" : "") + '">' + esc(TAGS[t] || t) + "</span>";
    }).join("") + "</div>";
  }

  function groupByArea(list) {
    var used = {};
    var groups = AREAS.map(function (area) {
      var items = [];
      area.districts.forEach(function (name) {
        list.forEach(function (d) {
          if (d.name.toLowerCase() === name.toLowerCase()) { items.push(d); used[d.slug] = true; }
        });
      });
      return { name: area.name, items: items };
    });
    var others = list.filter(function (d) { return !used[d.slug]; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    groups.push({ name: "More places", items: others });
    return groups.filter(function (g) { return g.items.length; });
  }

  // ---------- Views ----------

  function renderHome() {
    document.title = "Bean There by Putri";
    var count = cafes.filter(function (c) { return !c.closed; }).length;
    var html = '<section class="hero">' +
      "<h1>Where are you headed?</h1>" +
      "<p>Pick a district and I’ll show you my top 3 cafés there. " + count + " cafés tried so far.</p>" +
      "</section>";

    groupByArea(districts).forEach(function (g) {
      html += '<section class="area"><h2>' + esc(g.name) + '</h2><div class="district-grid">';
      g.items.forEach(function (d) {
        var top = d.picks[0];
        var n = d.cafes.length;
        html += '<a class="district-card" href="#' + d.slug + '">' +
          '<span class="name">' + esc(d.name) + "</span>" +
          '<span class="meta">' + n + (n === 1 ? " café" : " cafés") + "</span>" +
          (top ? '<span class="top">🥇 ' + esc(top.name) + "</span>" : "") +
          "</a>";
      });
      html += "</div></section>";
    });

    app.innerHTML = html;
  }

  function renderDistrict(d) {
    document.title = d.name + " · Bean There by Putri";
    var html = '<a class="back" href="#">← All districts</a>' +
      '<h1 class="district-title">' + esc(d.name) + "</h1>" +
      '<p class="district-sub">' + d.cafes.length + (d.cafes.length === 1 ? " café" : " cafés") + " tried</p>";

    if (d.picks.length) {
      html += '<h2 class="section-label">My top ' + (d.picks.length === 1 ? "pick" : d.picks.length) + "</h2>" +
        '<div class="picks">';
      d.picks.forEach(function (c, i) {
        html += '<article class="pick">' +
          '<span class="rank rank-' + (i + 1) + '" aria-label="Number ' + (i + 1) + '">' + (i + 1) + "</span>" +
          "<h3>" + esc(c.name) + "</h3>" + ratingHtml(c) +
          orderHtml(c) + noteHtml(c) + tagsHtml(c) +
          '<a class="maps-btn" href="' + esc(mapsUrl(c)) + '" target="_blank" rel="noopener">📍 Open in Maps</a>' +
          "</article>";
      });
      html += "</div>";
    } else {
      html += '<p class="empty-picks">I haven’t found a favourite here yet, but here’s everything I’ve tried.</p>';
    }

    if (d.rest.length) {
      html += '<details class="more"' + (d.picks.length ? "" : " open") + ">" +
        "<summary>" + (d.picks.length ? "Everything else I tried" : "Everything I tried") + " (" + d.rest.length + ")</summary>" +
        '<ul class="more-list">';
      d.rest.forEach(function (c) {
        html += '<li class="more-item' + (c.closed ? " is-closed" : "") + '">' +
          '<div class="more-head"><a href="' + esc(mapsUrl(c)) + '" target="_blank" rel="noopener">' + esc(c.name) + "</a>" +
          ratingHtml(c) + "</div>" +
          orderHtml(c) + noteHtml(c) + tagsHtml(c) +
          "</li>";
      });
      html += "</ul></details>";
    }

    app.innerHTML = html;
  }

  function route() {
    var slug = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
    var d = slug && districts.filter(function (x) { return x.slug === slug; })[0];
    if (d) renderDistrict(d); else renderHome();
    window.scrollTo(0, 0);
  }

  // ---------- Share ----------

  var toastTimer;
  function toast(msg) {
    var el = document.getElementById("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2200);
  }

  document.getElementById("share-btn").addEventListener("click", function () {
    var data = { title: document.title, url: location.href };
    if (navigator.share) {
      navigator.share(data).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(location.href).then(function () { toast("Link copied!"); });
    } else {
      toast(location.href);
    }
  });

  // ---------- Start ----------

  loadData()
    .then(function (list) {
      cafes = list;
      districts = buildDistricts(list);
      window.addEventListener("hashchange", route);
      route();
    })
    .catch(function (err) {
      console.error(err);
      app.innerHTML = '<p class="status">Couldn’t load the café list. Please try again in a bit.</p>';
    });
})();

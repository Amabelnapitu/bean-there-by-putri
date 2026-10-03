# ☕🌷 Bean There by Putri

Putri's honest coffee picks around Hong Kong.

- **Taste Match:** a 4-question quiz, a "Brewing for you" moment, then a coffee personality and a % match on every café.
- **MTR map:** districts drawn as stations on the Island and Tsuen Wan lines, with search that lights up matching stations.
- **District pages:** Putri's top 3, or "Best for me" sorted by the visitor's match.
- **Putri's Palate:** stats, rating habits, hall of fame/shame and power rankings per drink, all calculated from the sheet.
- **Coffee Crawl:** pick an area (Island West, Island East, South side, Kowloon or your saved list) and up to 5 stops. The app suggests an order (along the MTR line, or shortest path when coordinates are known); visitors can move stops ↑/↓ or remove them. Opens the whole route in Google Maps, with MTR/walking links between stops.
- **My list:** visitors tap ♡ Save on any café. Saved cafés and their quiz result stay on their phone with no login; "Copy my list link" gives a link that restores the list on any device or shares it with a friend.
- **Café pages:** every café has its own page (`#c/<district>/<café>`), linked from every list, card, search result and the map.
- **Putri vs You:** friends vote 👍/👎 on Putri's verdicts, with an optional private note. The Votes screen shows a live "Latest votes" feed.
- **Send Putri a note:** café suggestions (feeding a to-try list friends can upvote), ideas, bugs, hellos.

A static site (HTML + CSS + JS, no build step) on GitHub Pages. Café data comes from the
Google Sheet; votes and notes go through a small Google Apps Script. Everything is free.

## The café list (APP tab)

One row per café:

| Column | What to put | Example |
|---|---|---|
| District | District name | Sheung Wan |
| Name | Café name | Halfway Coffee |
| Rank | `1`, `2`, `3` for your top picks in that district; blank for the rest | 1 |
| Rating | Out of 5 | 4.5 |
| Must Order | What to get | Oat Milk Latte |
| Drink | `Espresso Tonic`, `Flat White`, `Latte`, `Matcha`, `Americano` or `Other` (guessed from Must Order if blank) | Latte |
| Price | In HK$ | 45 |
| Note | Your one-liner | Super good coffee, cute vibes |
| Taste | `milky`, `strong`, `smooth`, `weak`, `nutty`, `chocolatey`, `fruity`, `roasty` (separate with `;`) | milky;nutty |
| Tags | `work-friendly`, `cozy`, `cute`, `takeaway-only`, `small-space`, `small-portion`, `no-ports`, `time-limit`, `cheap`, `pricey`, `cash-only`, `closed` | cozy;cheap |
| Maps Link | Optional Google Maps link (otherwise the app searches by name + district) | https://maps.app.goo.gl/… |
| Lat, Lng | Optional. In Google Maps, long-press the café and copy the numbers. With these, the crawl picks the shortest walking order and shows distances | 22.2866, 114.1500 |

Taste Match uses Rating, Drink, Taste and the `cheap`/`pricey` tags. Closed cafés never show as a top pick.

New districts appear automatically. Districts on the Island line or Tsuen Wan line become
stations in the right order (see `ISLAND_LINE` and `TW_LINE` in `app.js`); anything else
hangs off a bus route from Central.

`data/cafes.csv` is a saved copy the site falls back to if the sheet can't be reached.

## Setup

### 1. Publish the APP tab (done)
**File → Share → Publish to web**, choose the **APP** tab and **CSV**. The link is in `config.js` as `sheetCsvUrl`.

### 2. Votes and notes: deploy the Apps Script
1. Open the **Review** sheet → **Extensions → Apps Script**.
2. Delete what's there and paste in everything from `apps-script/Code.gs`. Click **Save**.
3. Optional: set `NOTIFY_EMAIL` at the top to your email to get a copy of every note. Also set `NOTIFY_VOTES = true` to get an email for every vote (with the voter's note, if they left one).
4. **Deploy → New deployment** → gear icon → **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Click **Deploy**, then **Authorize access** and allow it. (Google shows a "Google hasn't verified this app" warning because it's your own script: **Advanced → Go to … (unsafe)**.)
6. Copy the **Web app URL** (ends in `/exec`) and paste it into `config.js` as `apiUrl`.

Until `apiUrl` is set, the votes and note screens say "opening soon"; everything else works.

The script creates these tabs in the sheet on first use:

- **Votes:** Timestamp · Device · District · Café · Verdict · Comment. Only each phone's latest vote per café counts. Comments are private: they only appear in this tab.
- **Feedback:** Timestamp · Device · Type · Café · District · Message · Name · Status · Putri's Rating · Approved.
  - Café suggestions only show on the to-try list once you type `yes` in **Approved**.
  - Set **Status** to `tried` (and optionally fill **Putri's Rating**) to show "Tried ✓".
- **Upvotes:** Timestamp · Device · Suggestion · Up.

"Device" is a random ID stored on each phone, used to stop double votes. No personal data is collected.

If you change `Code.gs` later: **Deploy → Manage deployments → ✏️ → Version: New version → Deploy** (the URL stays the same).

### 3. GitHub Pages (done)
Settings → Pages → Deploy from branch `main` / `(root)`. Live at https://amabelnapitu.github.io/bean-there-by-putri/

## Links you can share
- Home: `…/bean-there-by-putri/`
- Straight to the quiz: `…/#match`
- A district: `…/#d/sheung-wan`
- The map: `…/#map` · Putri's Palate: `…/#putri` · Crawl: `…/#crawl` · Send a note: `…/#note`

## Run locally
```sh
python3 -m http.server 8000
# open http://localhost:8000
```

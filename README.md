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
| Added | Date the café was added (filled in automatically by the sync for new cafés). Drives "New in October" on Putri's Palate and the New badge for 31 days | 2026-10-11 |
| Lat, Lng | Optional. Fill it automatically with the sheet menu **Bean There → Fill in café locations**, or in Google Maps long-press the café and copy the numbers. With these, the crawl picks the shortest walking order and shows distances | 22.2866, 114.1500 |

Taste Match uses Rating, Drink, Taste and the `cheap`/`pricey` tags.

Cafés tagged `closed` or `temp-closed` disappear from the app completely: lists, search, the map, Putri's Palate, the crawl and saved lists. An old link to one opens its district with a note that it has closed, and it's quietly removed from anyone's saved list. Remove the tag and it comes back.

New districts appear automatically. Districts on the Island line or Tsuen Wan line become
stations in the right order (see `ISLAND_LINE` and `TW_LINE` in `app.js`); anything else
hangs off a bus route from Central.

`data/cafes.csv` is a saved copy the site falls back to if the sheet can't be reached.

### Keeping the APP tab in sync with the Cafe tab

The same sync also copies the **Restaurant** tab into the **FOOD** tab (for the restaurant app), using a hidden `_sync_food` tab. Both run from **Bean There → Sync app tabs**.
Keep reviewing in the **Cafe** tab as usual, then use the sheet menu **Bean There → Sync APP tab from Cafe tab**
(or **Turn on auto-sync** so it runs after every edit). It only copies what changed:

- A changed rating, price or order updates that café in the APP tab.
- A changed review replaces the APP tab's Note with your new wording, highlighted in lilac so you can tidy it.
- A new café is added to the APP tab (highlighted) and its location is looked up. Add Rank, Taste and Tags yourself.
- Rank, Drink, Taste, Tags, Maps Link, Lat, Lng and reworded notes are never overwritten unless you change that café in the Cafe tab.
- **Rank fills itself in.** When a place is added or its rating changes, that district is re-ranked: Rank 1, 2, 3 go to the highest-rated places rated **4 or more**, and closed places never get a rank. Ties keep the order you already had. Changed ranks are highlighted. Overrule any of them by typing your own; to re-apply the rule everywhere, use **Bean There → Re-rank every district**.
- **New places get suggested Tags** (and Drink for cafés, Cuisine for restaurants) from your review, order and price, highlighted so you can check them. Taste is still yours to add.

Cafés are matched by district and name, and small typos are fine ("Haflway" still finds "Halfway Coffee").
A hidden `_sync` tab remembers what the Cafe tab looked like last time; don't edit or delete it.

### Closed places

Tag a place `closed` (or `temp-closed` while it's shut for a while) and it disappears from the app completely.

**Monthly closed-place check.** Once a month the script looks up every place in the APP and FOOD tabs (and BAR and DESSERT once they exist) on Google Maps and reads whether it's open, temporarily closed or permanently closed. It then:

- tags permanently closed places `closed`, highlights the row in pink and removes their rank;
- tags temporarily closed places `temp-closed`, and removes the tag by itself when they reopen;
- emails you a summary, including any places it couldn't find a clear match for.

It needs a Google Places API key. Setting one up once:

1. Go to [console.cloud.google.com](https://console.cloud.google.com), sign in with the account that owns the sheet, and create a project (any name, e.g. "Out and About").
2. **Billing → Link a billing account** and add a card. Google requires this for Maps APIs; about 170 places once a month stays within Google's free monthly usage, so it should cost nothing. To be safe, set **Billing → Budgets & alerts** to email you at US$1.
3. **APIs & Services → Library**, search for **Places API (New)** and click **Enable**.
4. **APIs & Services → Credentials → Create credentials → API key.** Click the new key, under **API restrictions** choose **Restrict key → Places API (New)**, and save.
5. Optional safety cap: **APIs & Services → Places API (New) → Quotas** and set the daily request limit to 500.
6. In the sheet: **Bean There → Set up monthly closed-place check**, paste the key, and allow the new permissions Google asks for. It runs once straight away, then on the 1st of every month.

The key is stored in the script's own settings (not in the code or the sheet). **Check for closed places now** runs it any time; **Turn off monthly closed-place check** stops the schedule. Place IDs are remembered in a hidden `_places` tab so later checks are exact; don't edit or delete it.

## Setup

### 1. Publish the APP tab (done)
**File → Share → Publish to web**, choose the **APP** tab and **CSV**. The link is in `config.js` as `sheetCsvUrl`.

### 2. Votes and notes: deploy the Apps Script
1. Open the **Review** sheet → **Extensions → Apps Script**.
2. Delete what's there and paste in everything from `apps-script/Code.gs`. Click **Save**.
3. New notes are emailed to the Google account that owns the script (change `NOTIFY_EMAIL` to send them elsewhere). Set `NOTIFY_VOTES = true` to also get an email for every vote. Use the sheet menu **Bean There → Send me a test email** to allow email and check it arrives.
4. **Deploy → New deployment** → gear icon → **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Click **Deploy**, then **Authorize access** and allow it. (Google shows a "Google hasn't verified this app" warning because it's your own script: **Advanced → Go to … (unsafe)**.)
6. Copy the **Web app URL** (ends in `/exec`) and paste it into `config.js` as `apiUrl`.

Until `apiUrl` is set, the votes and note screens say "opening soon"; everything else works.

The script creates these tabs in the sheet on first use:

- **Votes:** Timestamp · Device · District · Café · Verdict · Comment. Only each phone's latest vote per café counts. Comments are private: they only appear in this tab.
- **Feedback:** Timestamp · Device · Type · Café · District · Message · Status · Putri's Rating · Approved. Notes are anonymous. Status and Approved are dropdowns.
  - Café suggestions only show on the to-try list once you type `yes` in **Approved**.
  - Set **Status** to `tried` (and optionally fill **Putri's Rating**) to show "Tried ✓".
- **Upvotes:** Timestamp · Device · Suggestion · Up.

"Device" is a random ID stored on each phone, used to stop double votes. No personal data is collected.

If you change `Code.gs` later: **Deploy → Manage deployments → ✏️ → Version: New version → Deploy** (the URL stays the same).

### 3. GitHub Pages (done)
Settings → Pages → Deploy from branch `main` / `(root)`. Live at https://amabelnapitu.github.io/bean-there-by-putri/

## Offline, returning visitors and link previews
- `sw.js` keeps the app and the latest café list on the phone, so it opens without signal (votes and notes still need a connection). It always tries the network first, so updates show up straight away when online.
- Returning visitors skip the landing page and open on the map. Tapping the logo still shows it.
- `og-image.jpg` is the preview card WhatsApp, iMessage and Instagram show for any link to the site. The Share button adds a line naming the café or page being shared.

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

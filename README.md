# ☕ Bean There by Putri

Putri's honest coffee picks around Hong Kong: pick a district, see her top 3 cafés.

A single static page (HTML + CSS + JS, no build step, no backend). The café list lives in a
Google Sheet, so updating the site is just editing the sheet.

## How the data works

The site reads a CSV with one row per café:

| Column | What to put | Example |
|---|---|---|
| District | District name | Sheung Wan |
| Name | Café name | Halfway Coffee |
| Rank | `1`, `2` or `3` for your top picks in that district. Leave blank for the rest | 1 |
| Rating | Out of 5 | 4.5 |
| Must Order | What to get | Oat Milk Latte |
| Price | In HK$ (numbers get "HK$" added automatically) | 45 |
| Note | Your one-liner | Super good coffee, cute vibes |
| Tags | Optional, separated by `;` | work-friendly;small-space |
| Maps Link | Optional Google Maps link. If blank, the app searches Google Maps by name + district | https://maps.app.goo.gl/… |

Tags with a nice label: `work-friendly`, `takeaway-only`, `small-space`, `cheap`, `cash-only`,
`closed` (closed cafés never show as a top pick). Any other tag is shown as-is.

A new district appears automatically. Known districts are grouped under Hong Kong Island,
Kowloon, or New Territories & Islands (see the `AREAS` list in `app.js`); anything else
shows under "More places".

## One-time setup

### 1. Add the App tab to your Google Sheet
1. Open the **Review** sheet → **File → Import → Upload** → choose `data/cafes.csv` from this repo.
2. Pick **Insert new sheet(s)**, then rename the new tab to `App`.
3. Check the ranks, fix anything I got wrong, and add Maps links whenever you like.

### 2. Publish the App tab as CSV
1. **File → Share → Publish to web**.
2. In the first dropdown pick the **App** tab (not "Entire document"); in the second pick
   **Comma-separated values (.csv)**. Click **Publish** and copy the link.
3. Paste it into `config.js`:
   ```js
   window.BEAN_THERE_CONFIG = {
     sheetCsvUrl: "https://docs.google.com/spreadsheets/d/e/…/pub?gid=…&single=true&output=csv"
   };
   ```
4. Commit. From now on, edits to the App tab show on the site within about 5 minutes.

Only the App tab becomes public; your other tabs stay private.
If the sheet can't be reached, the site falls back to `data/cafes.csv`.

### 3. Turn on GitHub Pages (free)
Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch →
Branch: `main` / `(root)` → Save**. After a minute the site is live at
`https://<your-github-username>.github.io/bean-there-by-putri/`.

## Sharing
- Send a district directly: `…/bean-there-by-putri/#sheung-wan`.
- The **Share** button opens the phone's share sheet (WhatsApp, etc.).
- On a phone: **Share → Add to Home Screen** (iPhone) or **⋮ → Add to Home screen** (Android)
  to get an app icon.

## Run locally
```sh
python3 -m http.server 8000
# open http://localhost:8000
```

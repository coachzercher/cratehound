# Crate Hound on Netlify

This project is the Crate Hound deals website plus a collector that runs on Netlify:

- `public/index.html`: the website.
- `netlify/functions/collect.mjs`: runs every hour. Reads Bluesky, Reddit and RSS, and saves deals and price history.
- `netlify/functions/deals.mjs`: serves the deals, with ratings, to the website at `/api/deals`.
- `netlify/lib/config.mjs`: **the list of sources.** Edit this to add or remove Bluesky accounts, subreddits and RSS feeds.

The collector only runs when Netlify builds the site from GitHub (or the Netlify CLI). Dragging files into Netlify's upload box won't run it.

---

## 1. Put the project on GitHub

1. Unzip this folder.
2. On github.com, click **New** and create a repository (for example `cratehound`). Private is fine.
3. Click **uploading an existing file**, then drag in **everything inside the unzipped folder**: `public`, `netlify`, `netlify.toml`, `package.json` and this README. Keep the folders as they are.
4. Click **Commit changes**.

## 2. Connect it to Netlify

1. In Netlify, open your site (`vinyl-crate-459e5c`).
2. Go to **Site configuration → Build & deploy → Link repository** (or **Add new site → Import an existing project** for a fresh site) and pick the GitHub repository.
3. Leave the build command empty. The publish folder comes from `netlify.toml` (`public`).
4. Deploy. Netlify sets up the hourly collector automatically.

Check it: open `https://<your-site>.netlify.app/api/deals`. You should see a list of deals. The first load takes a few seconds while it collects.

## 3. Add Reddit (optional, about 10 minutes)

1. Sign in to Reddit and go to **reddit.com/prefs/apps** → **create another app** → choose **script**. Any URL works as the redirect URI.
2. Copy the **client ID** (under the app name) and the **secret**.
3. In Netlify: **Site configuration → Environment variables → Add a variable**. Add:
   - `REDDIT_CLIENT_ID`: the client ID
   - `REDDIT_CLIENT_SECRET`: the secret
   - `REDDIT_USER_AGENT`: `web:cratehound:1.0 (by /u/YOUR_REDDIT_NAME)`
4. **Deploys → Trigger deploy → Deploy site.**

Until the keys are added, the r/VinylDeals chip on the page says "Reddit keys are not set yet." Everything else still works.

Reddit's Data API terms restrict commercial use without Reddit's approval. Check them before you earn affiliate money from Reddit-sourced deals.

## How deals are rated

Every hour the collector records each record's price. When a deal comes in, it's compared with that record's earlier prices:

- **Usual price:** the middle (median) price seen in the 90 days before the post. If there's no history yet, the regular price stated in the post.
- **Great deal:** 30% or more below usual, or a new lowest price.
- **Good deal:** 15–29% below. **Fair price:** 5–14% below. **Usual price:** within 5%. **Above usual:** 5% or more above.

On the first run the collector reads about 500 recent Bluesky posts per account to start the history. Ratings get better every day it runs.

## Changing things

- **Sources:** edit `netlify/lib/config.mjs` on GitHub and commit. Netlify redeploys on its own.
- **Affiliate IDs and other page settings:** edit the **SITE SETTINGS** block near the top of the script in `public/index.html`.
- Each commit is a deploy, and each deploy costs Netlify credits, so make several changes in one commit when you can.

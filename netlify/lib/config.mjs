// ============================================================
// Where the collector looks for deals. Edit, commit, and Netlify redeploys.
// ============================================================
export const SOURCES = {
  // Bluesky accounts that post vinyl deals (handles, no @)
  bluesky: ["vinylsale.bsky.social", "recorddrops.bsky.social", "thevinyldeals.bsky.social"],
  // Subreddits (read through Reddit's official API; needs REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET)
  reddit: ["VinylDeals"],
  // RSS or Atom feeds that post priced deals
  rss: ["https://www.vinyl-deals.com/rss"]
};

// Deals older than this are dropped from the list (price history is kept much longer).
export const KEEP_DEALS_DAYS = 7;
// How long price history is kept for each record.
export const KEEP_HISTORY_DAYS = 365;

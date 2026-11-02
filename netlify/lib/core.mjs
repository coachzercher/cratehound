// Shared collector logic: reading sources, parsing deals, keeping price history, rating deals.
import { SOURCES, KEEP_DEALS_DAYS, KEEP_HISTORY_DAYS } from "./config.mjs";

const DAY = 864e5;
const PRICE = /(?:US)?\$\s?(\d{1,4}(?:[.,]\d{2})?)/;
const UA = () => process.env.REDDIT_USER_AGENT || "web:cratehound:1.0";

/* ---------------- Parsing ---------------- */

export function num(s) { return parseFloat(String(s).replace(",", ".")); }

export function storeFromUrl(u) {
  if (!u) return "";
  let h = "";
  try { h = new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; }
  const map = [[/amazon\.|amzn\.|link\.amazon/, "Amazon"], [/walmart/, "Walmart"], [/target\.com/, "Target"],
    [/bestbuy|bby\./, "Best Buy"], [/ebay/, "eBay"], [/discogs/, "Discogs"], [/roughtrade/, "Rough Trade"],
    [/urbanoutfitters/, "Urban Outfitters"], [/barnesandnoble/, "Barnes & Noble"], [/deepdiscount/, "Deep Discount"],
    [/bandcamp/, "Bandcamp"], [/turntablelab/, "Turntable Lab"], [/musicdirect/, "Music Direct"]];
  for (const [re, n] of map) if (re.test(h)) return n;
  return h;
}

function cleanTitle(s) {
  return String(s).replace(/#[\w-]+/g, "").replace(/\b\d{1,2}\s?%\s*off\b/gi, "")
    .replace(/\b(?:now|only|just|for|deal|price drop|on sale)\s*:?\s*$/i, "")
    .replace(/https?:\/\/\S+|\b[\w.-]+\.(?:com|to|net|co|ly|amazon)\/\S*/gi, "")
    .replace(/[\s\-–—:|•,]+$/g, "").replace(/^[\s\-–—:|•]+/g, "").replace(/\s{2,}/g, " ").trim();
}

/** Parse one line of deal text like "[Amazon] Artist - Album (2LP) $19.99 (was $29.99)". */
export function parseDealText(text) {
  if (!text) return null;
  const lines = String(text).split("\n").map(s => s.trim()).filter(Boolean);
  const line = lines.find(l => PRICE.test(l));
  if (!line) return null;
  const pm = line.match(PRICE);
  const price = num(pm[1]);
  if (!(price > 0 && price < 1000)) return null;

  let head = line.slice(0, pm.index);
  if (cleanTitle(head).length < 3) head = lines.find(l => !PRICE.test(l) && !/^#/.test(l)) || line.replace(PRICE, "");
  let store = "";
  const br = head.match(/^\s*[\[(]([^\])]{2,40})[\])]\s*/);
  if (br) { store = br[1].trim(); head = head.slice(br[0].length); }
  const name = cleanTitle(head);
  let artist = "", album = name;
  const sp = name.split(/\s+[-–—]\s+/);
  if (sp.length >= 2) { artist = sp[0].trim(); album = sp.slice(1).join(" - ").trim(); }
  if (!album || album.length < 2) return null;

  const all = String(text);
  let was = null;
  const wm = all.match(/(?:was|reg(?:ular)?|list|orig(?:inal(?:ly)?)?|msrp)\.?\s*:?\s*\$\s?(\d{1,4}(?:[.,]\d{2})?)/i)
    || all.match(/\$\s?(\d{1,4}(?:[.,]\d{2})?)\s*(?:→|->|➡️?|to)\s*\$\s?\d/i);
  if (wm && num(wm[1]) > price) was = num(wm[1]);
  if (!was) {
    const pc = all.match(/(\d{1,2})\s?%\s*off/i);
    if (pc && +pc[1] > 0 && +pc[1] < 95) was = Math.round(price / (1 - pc[1] / 100) * 100) / 100;
  }
  return { artist, album, title: artist ? `${artist} – ${album}` : album, price, was, store };
}

export function keyOf(d) {
  return ((d.artist || "") + " " + d.album).toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, "")
    .replace(/\b(vinyl|lp|2lp|2xlp|3lp|edition|reissue|remaster(?:ed)?|limited)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

/* ---------------- Sources ---------------- */

async function getJson(url, init) {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${new URL(url).hostname} returned ${r.status}`);
  return r.json();
}

export async function readBluesky(handle, pages = 1) {
  const out = [];
  let cursor = "";
  for (let i = 0; i < pages; i++) {
    const j = await getJson("https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=" +
      encodeURIComponent(handle) + "&limit=100&filter=posts_no_replies" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""));
    for (const item of j.feed || []) {
      const p = item.post; if (!p || !p.record) continue;
      const d = parseDealText(p.record.text);
      if (!d) continue;
      const links = (p.record.facets || []).flatMap(f => (f.features || []).filter(x => x.uri).map(x => x.uri));
      const emb = p.embed || {};
      const ext = emb.external || (emb.media && emb.media.external) || null;
      const imgs = emb.images || (emb.media && emb.media.images) || [];
      const link = links[0] || (ext && ext.uri) || "";
      const author = (p.author && p.author.handle) || handle;
      out.push({
        id: p.uri, ...d, store: storeFromUrl(link) || d.store, link,
        image: (imgs[0] && imgs[0].thumb) || (ext && ext.thumb) || "",
        handle: author, postUrl: `https://bsky.app/profile/${author}/post/${String(p.uri).split("/").pop()}`,
        at: p.indexedAt || p.record.createdAt, source: "bluesky"
      });
    }
    cursor = j.cursor;
    if (!cursor) break;
  }
  return out;
}

let token = { v: null, exp: 0 };
async function redditToken() {
  if (token.v && Date.now() < token.exp) return token.v;
  const id = process.env.REDDIT_CLIENT_ID, secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Reddit keys are not set yet");
  const j = await getJson("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA() },
    body: "grant_type=client_credentials"
  });
  token = { v: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  return token.v;
}

export async function readReddit(sub) {
  const t = await redditToken();
  const j = await getJson(`https://oauth.reddit.com/r/${encodeURIComponent(sub)}/new?limit=100&raw_json=1`, {
    headers: { Authorization: `Bearer ${t}`, "User-Agent": UA() }
  });
  const out = [];
  for (const c of (j.data && j.data.children) || []) {
    const p = c.data;
    if (!p || p.stickied || p.over_18) continue;
    const d = parseDealText(p.title);
    if (!d) continue;
    const link = p.is_self ? "" : (p.url_overridden_by_dest || p.url || "");
    const prev = p.preview && p.preview.images && p.preview.images[0];
    out.push({
      id: "reddit:" + p.id, ...d, store: d.store || storeFromUrl(link), link,
      image: (prev && prev.resolutions && prev.resolutions[1] && prev.resolutions[1].url) || (/^https?:/.test(p.thumbnail || "") ? p.thumbnail : ""),
      handle: `r/${sub}`, postUrl: "https://www.reddit.com" + p.permalink,
      at: new Date(p.created_utc * 1000).toISOString(), source: "reddit"
    });
  }
  return out;
}

function tag(s, name) {
  const m = s.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1].replace(/^<!\[CDATA\[|\]\]>$/g, "").trim() : "";
}
function decode(s) {
  return String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
}
export async function readRss(feedUrl) {
  const r = await fetch(feedUrl, { headers: { "User-Agent": "cratehound/1.0 (+feed reader)" } });
  if (!r.ok) throw new Error(`Feed returned ${r.status}`);
  const xml = await r.text();
  const host = new URL(feedUrl).hostname.replace(/^www\./, "");
  const out = [];
  for (const it of xml.split(/<item[\s>]|<entry[\s>]/i).slice(1, 101)) {
    const title = decode(tag(it, "title"));
    const la = it.match(/<link[^>]*href="([^"]+)"/i);
    const link = (la && la[1]) || decode(tag(it, "link")).trim();
    const when = tag(it, "pubDate") || tag(it, "updated") || tag(it, "published");
    if (when && Date.now() - Date.parse(when) > 30 * DAY) continue;
    const desc = decode(tag(it, "description") || tag(it, "summary") || tag(it, "content"));
    let d = parseDealText(title);
    if (!d) {
      const pm = desc.replace(/<[^>]+>/g, " ").match(PRICE);
      if (pm && num(pm[1]) > 0) d = { artist: "", album: title, title, price: num(pm[1]), was: null, store: "" };
    }
    if (!d) continue;
    out.push({
      id: "rss:" + (link || title), ...d, store: d.store || storeFromUrl(link), link,
      image: (desc.match(/<img[^>]+src="([^"]+)"/i) || [])[1] || "",
      handle: host, postUrl: link, at: when ? new Date(when).toISOString() : new Date().toISOString(), source: "rss"
    });
  }
  return out;
}

/* ---------------- Collecting & history ---------------- */

/**
 * Read every source, merge into the stored deals and price history.
 * `state` is { deals: [], history: { key: [[price, isoTime, source, store], ...] } }.
 */
export async function collect(state) {
  const firstRun = !state.history || !Object.keys(state.history).length;
  const errors = [];
  const jobs = [
    ...SOURCES.bluesky.map(h => readBluesky(h, firstRun ? 5 : 1).catch(e => { errors.push(`@${h}: ${e.message}`); return []; })),
    ...SOURCES.reddit.map(s => readReddit(s).catch(e => { errors.push(`r/${s}: ${e.message}`); return []; })),
    ...SOURCES.rss.map(u => readRss(u).catch(e => { errors.push(`${u}: ${e.message}`); return []; }))
  ];
  const fresh = (await Promise.all(jobs)).flat();

  const now = Date.now();
  const byId = new Map((state.deals || []).map(d => [d.id, d]));
  for (const d of fresh) byId.set(d.id, d);
  const deals = [...byId.values()]
    .filter(d => now - Date.parse(d.at) < KEEP_DEALS_DAYS * DAY)
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 1500);

  const history = state.history || {};
  const seenIds = state.seenIds || {};
  for (const d of fresh) {
    if (seenIds[d.id]) continue;
    seenIds[d.id] = d.at;
    const k = keyOf(d); if (!k) continue;
    (history[k] = history[k] || []).push([d.price, d.at, d.handle, d.store || ""]);
  }
  const cutoff = now - KEEP_HISTORY_DAYS * DAY;
  for (const k of Object.keys(history)) {
    const pts = history[k].filter(p => Date.parse(p[1]) > cutoff).sort((a, b) => (a[1] < b[1] ? -1 : 1)).slice(-80);
    if (pts.length) history[k] = pts; else delete history[k];
  }
  for (const id of Object.keys(seenIds)) if (Date.parse(seenIds[id]) < cutoff) delete seenIds[id];

  return { deals, history, seenIds, updated: new Date().toISOString(), errors };
}

/* ---------------- Rating ---------------- */

function median(a) {
  const s = [...a].sort((x, y) => x - y); const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Compare a deal with earlier prices for the same record.
 * typical = median price seen in the 90 days before this post; low = lowest seen before it.
 */
export function rate(d, points) {
  const t = Date.parse(d.at);
  const prior = (points || []).filter(p => Date.parse(p[1]) < t - 6e4);
  const recent = prior.filter(p => t - Date.parse(p[1]) < 90 * DAY).map(p => p[0]);
  const all = prior.map(p => p[0]);
  const r = { n: prior.length, typical: null, low: null, high: null, pct: null, basis: "none", grade: "new" };
  if (all.length) { r.low = Math.min(...all); r.high = Math.max(...all); }
  if (recent.length >= 2) { r.typical = median(recent); r.basis = "history"; }
  else if (d.was) { r.typical = d.was; r.basis = "list"; }
  else if (recent.length === 1) { r.typical = recent[0]; r.basis = "history"; }
  if (r.typical) r.pct = Math.round((r.typical - d.price) / r.typical * 100);
  r.lowest = all.length >= 2 && d.price < r.low;
  if (r.pct === null) r.grade = r.lowest ? "great" : "new";
  else if (r.pct >= 30 || (r.lowest && r.pct >= 10)) r.grade = "great";
  else if (r.pct >= 15) r.grade = "good";
  else if (r.pct >= 5) r.grade = "fair";
  else if (r.pct > -5) r.grade = "typical";
  else r.grade = "high";
  return r;
}

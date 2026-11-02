// Serves the deals list with ratings at /api/deals.
import { getStore } from "@netlify/blobs";
import { collect, keyOf, rate } from "../lib/core.mjs";

export default async (req) => {
  const store = getStore({ name: "cratehound", consistency: "strong" });
  let state = (await store.get("state", { type: "json" })) || {};

  // First visit before the hourly job has run (or it stalled): collect now.
  const stale = !state.updated || Date.now() - Date.parse(state.updated) > 3 * 3600e3;
  if (stale) {
    state = await collect(state);
    await store.setJSON("state", state);
  }

  const history = state.history || {};
  const deals = (state.deals || []).map(d => {
    const pts = history[keyOf(d)] || [];
    return { ...d, rating: rate(d, pts), hist: pts.slice(-40) };
  });

  return new Response(JSON.stringify({ updated: state.updated, errors: state.errors || [], count: deals.length, deals }), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Netlify's CDN reuses this answer for 10 minutes, so visits don't each run the function.
      "Netlify-CDN-Cache-Control": "public, durable, max-age=600, stale-while-revalidate=300",
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*"
    }
  });
};

export const config = { path: "/api/deals" };

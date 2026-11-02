// Runs every hour on Netlify: reads all deal sources and updates stored deals and price history.
import { getStore } from "@netlify/blobs";
import { collect } from "../lib/core.mjs";

export default async () => {
  const store = getStore({ name: "cratehound", consistency: "strong" });
  const state = (await store.get("state", { type: "json" })) || {};
  const next = await collect(state);
  await store.setJSON("state", next);
  console.log(`Collected: ${next.deals.length} deals, ${Object.keys(next.history).length} records with history`, next.errors);
};

export const config = { schedule: "@hourly" };

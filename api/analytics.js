// GET /api/analytics -> the ROI numbers for the dashboard's hero panel.
import { ensureSchema, ensureFirm, getAnalytics } from "../db/index.js";
import { CONFIG } from "../lib/config.js";

let ready = false;
async function boot() {
  if (ready) return;
  await ensureSchema();
  await ensureFirm({ id: CONFIG.firm.id, name: CONFIG.firm.name, vertical: CONFIG.firm.vertical });
  ready = true;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    await boot();
    const a = await getAnalytics(CONFIG.firm.id);
    res.status(200).json(a);
  } catch (err) {
    console.error("Error in /api/analytics:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
}

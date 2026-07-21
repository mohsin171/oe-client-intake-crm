// GET /api/bookings -> upcoming confirmed appointments for the dashboard.
import { ensureSchema, ensureFirm, getUpcomingBookings } from "../db/index.js";
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
    const bookings = await getUpcomingBookings(CONFIG.firm.id);
    res.status(200).json({ bookings });
  } catch (err) {
    console.error("Error in /api/bookings:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
}

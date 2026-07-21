// ============================================================================
// ORCA EDGE - TOOL 1: POST /api/delete-data  (GDPR right to erasure)
// ----------------------------------------------------------------------------
// Lets the firm honour a data-subject deletion request. Erases a person and all
// their messages/bookings, and anonymises their audit events, leaving only a
// record that a deletion occurred. Secured with DELETE_SECRET so only the firm
// (not the public) can call it.
//
//   POST /api/delete-data
//   Authorization: Bearer <DELETE_SECRET>
//   { "email": "person@example.com" }  (or "phone", or "id")
// ============================================================================

import { ensureSchema, ensureFirm, deletePersonData } from "../db/index.js";
import { CONFIG } from "../lib/config.js";

let ready = false;
async function boot() {
  if (ready) return;
  await ensureSchema();
  await ensureFirm({ id: CONFIG.firm.id, name: CONFIG.firm.name, vertical: CONFIG.firm.vertical });
  ready = true;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // require the deletion secret (protects real people's data from public erasure)
  const secret = process.env.DELETE_SECRET;
  if (!secret) return res.status(503).json({ error: "Deletion not configured. Set DELETE_SECRET." });
  const provided = (req.headers?.authorization || "").replace(/^Bearer\s+/i, "") || req.body?.key;
  if (provided !== secret) return res.status(401).json({ error: "unauthorized" });

  try {
    await boot();
    const { id, email, phone, contact } = req.body || {};
    if (!id && !email && !phone && !contact) {
      return res.status(400).json({ error: "Provide an id, email, or phone to identify the record." });
    }
    const removed = await deletePersonData(CONFIG.firm.id, { id, email, phone, contact });
    res.status(200).json({ ok: true, removed });
  } catch (err) {
    console.error("Error in /api/delete-data:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
}

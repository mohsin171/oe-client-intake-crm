// GET /api/leads?stage=...   -> the pipeline list for the dashboard
// GET /api/leads?id=...       -> one lead with its full conversation + events
import { ensureSchema, ensureFirm, listLeads, getPerson, getMessages, query } from "../db/index.js";
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
    const firmId = CONFIG.firm.id;

    // Single lead detail (conversation + events)
    if (req.query?.id) {
      const person = await getPerson(req.query.id);
      if (!person) return res.status(404).json({ error: "Lead not found" });
      const messages = await getMessages(req.query.id);
      const { rows: events } = await query(
        `SELECT type, detail, actor, created_at FROM events WHERE person_id=$1 ORDER BY created_at ASC`,
        [req.query.id]
      );
      return res.status(200).json({ person, messages, events });
    }

    // Pipeline list
    const stage = req.query?.stage || null;
    const leads = await listLeads(firmId, { stage });
    res.status(200).json({ firm: { name: CONFIG.firm.name, vertical: CONFIG.firm.vertical }, leads });
  } catch (err) {
    console.error("Error in /api/leads:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
}

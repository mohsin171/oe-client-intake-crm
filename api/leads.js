// GET /api/leads?stage=...   -> the pipeline list for the dashboard
// GET /api/leads?id=...       -> one lead with its full conversation + events
// POST /api/leads  { id, reply } -> adviser sends a reply on the lead's channel
//                                   (also flags the lead as human-handled so the
//                                   AI stands down)
import { ensureSchema, ensureFirm, listLeads, getPerson, getMessages, addMessage, addEvent, setAgentTakeover, query } from "../db/index.js";
import { CONFIG } from "../lib/config.js";
import { sendToLead } from "../lib/outbound.js";

let ready = false;
async function boot() {
  if (ready) return;
  await ensureSchema();
  await ensureFirm({ id: CONFIG.firm.id, name: CONFIG.firm.name, vertical: CONFIG.firm.vertical });
  ready = true;
}

export default async function handler(req, res) {
  try {
    await boot();
    const firmId = CONFIG.firm.id;

    // ---- Adviser reply from the dashboard ----
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const { id, reply } = body;
      if (!id || !reply || !String(reply).trim()) {
        return res.status(400).json({ error: "Missing lead id or reply text." });
      }
      const person = await getPerson(id);
      if (!person) return res.status(404).json({ error: "Lead not found" });

      // send it out on the lead's own channel
      const sent = await sendToLead(person, String(reply).trim());

      // record the adviser message in the thread + audit, and take over so the
      // AI won't also auto-reply on this lead
      await addMessage({ personId: id, firmId, role: "assistant", channel: person.channel, content: String(reply).trim() });
      await setAgentTakeover(id, true);
      await addEvent({
        firmId, personId: id, type: "agent_reply",
        detail: sent.ok ? `Adviser replied via ${sent.channel} (${sent.detail})` : `Adviser reply not delivered: ${sent.detail}`,
        actor: "agent",
      });

      return res.status(200).json({ ok: sent.ok, channel: sent.channel, detail: sent.detail });
    }

    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

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

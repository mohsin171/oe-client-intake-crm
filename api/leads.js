// GET /api/leads?stage=...   -> the pipeline list for the dashboard
// GET /api/leads?id=...       -> one lead with its full conversation + events
// POST /api/leads  { id, reply } -> adviser sends a reply on the lead's channel
//                                   (also flags the lead as human-handled so the
//                                   AI stands down)
import { ensureSchema, ensureFirm, listLeads, getPerson, getMessages, addMessage, addEvent, setAgentTakeover, setStage, setNotes, deletePerson, query } from "../db/index.js";
import { CONFIG } from "../lib/config.js";
import { sendToLead, reachOptions } from "../lib/outbound.js";

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

    // ---- Adviser actions from the dashboard (POST) ----
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const { id, action } = body;
      if (!id) return res.status(400).json({ error: "Missing lead id." });
      const person = await getPerson(id);
      if (!person) return res.status(404).json({ error: "Lead not found" });

      // DELETE a lead (junk / test data)
      if (action === "delete") {
        await deletePerson(id, firmId);
        return res.status(200).json({ ok: true, deleted: true });
      }

      // MOVE stage / mark won / lost
      if (action === "stage") {
        const stage = String(body.stage || "").trim();
        const allowed = ["new", "qualified", "booked", "handed_off", "won", "lost"];
        if (!allowed.includes(stage)) return res.status(400).json({ error: "Invalid stage." });
        await setStage(id, stage);
        await addEvent({ firmId, personId: id, type: "stage_changed", detail: `Adviser moved lead to '${stage}'`, actor: "agent" });
        return res.status(200).json({ ok: true, stage });
      }

      // ADD / update a private note
      if (action === "notes") {
        await setNotes(id, body.notes);
        await addEvent({ firmId, personId: id, type: "note_saved", detail: "Adviser updated the note", actor: "agent" });
        return res.status(200).json({ ok: true });
      }

      // REPLY (default action) — send on the lead's channel
      const reply = body.reply;
      if (!reply || !String(reply).trim()) return res.status(400).json({ error: "Missing reply text." });
      const sent = await sendToLead(person, String(reply).trim(), body.method || null);
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
      return res.status(200).json({ person, messages, events, reach: reachOptions(person) });
    }

    // Pipeline list (default = active board; ?archived=1 = the archive)
    const stage = req.query?.stage || null;
    const archived = req.query?.archived === "1" || req.query?.archived === "true";
    const leads = await listLeads(firmId, { stage, archived });
    res.status(200).json({
      firm: {
        name: CONFIG.firm.name,
        vertical: CONFIG.firm.vertical,
        timezone: (CONFIG.firm.availability && CONFIG.firm.availability.timezone) || "Europe/London",
      },
      leads,
    });
  } catch (err) {
    console.error("Error in /api/leads:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
}

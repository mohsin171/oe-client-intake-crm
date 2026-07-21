// ============================================================================
// ORCA EDGE - TOOL 1, Phase 4: follow-up nudge (cron)
// ----------------------------------------------------------------------------
// GET /api/nudge  - intended to be called on a schedule (Vercel Cron).
// Finds qualified leads who gave a contact but never booked and have gone
// quiet, and sends exactly ONE gentle re-engagement email via Resend. Marks
// them nudged so it never repeats. Sustained nurture is deliberately Tool 3.
//
// Secured with a simple secret so it can't be triggered by the public:
//   set CRON_SECRET in the environment; Vercel Cron sends it automatically.
// ============================================================================

import { ensureSchema, ensureFirm, getLeadsNeedingNudge, markNudged, addEvent } from "../db/index.js";
import { CONFIG } from "../lib/config.js";
import { sendNudge } from "../lib/actions.js";

let ready = false;
async function boot() {
  if (ready) return;
  await ensureSchema();
  await ensureFirm({ id: CONFIG.firm.id, name: CONFIG.firm.name, vertical: CONFIG.firm.vertical });
  ready = true;
}

export default async function handler(req, res) {
  // simple auth: require the cron secret if one is configured
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers?.authorization || "";
    const provided = auth.replace(/^Bearer\s+/i, "") || req.query?.key;
    if (provided !== secret) return res.status(401).json({ error: "unauthorized" });
  }

  try {
    await boot();
    const firmId = CONFIG.firm.id;
    const leads = await getLeadsNeedingNudge(firmId);
    let sent = 0;
    for (const lead of leads) {
      const ok = await sendNudge(lead).catch(() => false);
      await markNudged(lead.id);
      if (ok) {
        sent++;
        await addEvent({ firmId, personId: lead.id, type: "nudge_sent", detail: "one-time follow-up", actor: "system" });
      }
    }
    res.status(200).json({ checked: leads.length, sent });
  } catch (err) {
    console.error("Error in /api/nudge:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
}

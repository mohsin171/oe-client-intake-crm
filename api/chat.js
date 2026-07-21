// ============================================================================
// ORCA EDGE - TOOL 1: POST /api/chat  (the website widget's door)
// ----------------------------------------------------------------------------
// One conversation turn, fully persisted to the shared database spine:
//   1. ensure the person exists (create on first message)
//   2. store the visitor's message
//   3. run the AI brain over the full history
//   4. persist the extracted lead, handoff, booking
//   5. perform actions (booking link, team notify)
//   6. store the AI reply and return it
// ============================================================================

import { randomUUID } from "node:crypto";
import { runTurn, isDemoMode, CONFIG } from "../lib/brain.js";
import { performActions } from "../lib/actions.js";
import {
  ensureSchema, ensureFirm, createPerson, getPerson, updateLead,
  setHandoff, setBooking, addMessage, getHistoryForAI, addEvent,
} from "../db/index.js";

let ready = false;
async function boot() {
  if (ready) return;
  await ensureSchema();
  await ensureFirm({ id: CONFIG.firm.id, name: CONFIG.firm.name, vertical: CONFIG.firm.vertical });
  ready = true;
}

// CORS so the widget can call this from any client's website. Only /api/chat is
// opened up; the API key and logic stay server-side.
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    await boot();

    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message) return res.status(400).json({ error: "Send a non-empty 'message' string." });
    if (message.length > 2000) return res.status(400).json({ error: "Message too long." });

    const sessionId = req.body?.sessionId || randomUUID();
    const firmId = CONFIG.firm.id;
    const channel = "web";

    // 1. ensure person + 2. store their message
    await createPerson({ id: sessionId, firmId, channel, source: req.body?.source || "" });
    await addMessage({ personId: sessionId, firmId, role: "user", channel, content: message });

    // 3. run the brain over full history
    const history = await getHistoryForAI(sessionId);
    const { reply, lead, actions, handoff } = await runTurn({ history, channel });

    // 4. persist extracted lead (record fills up; earlier data preserved)
    const firstReplyAt = new Date().toISOString();
    const person = await updateLead(sessionId, lead, {
      fields: lead.fields || {},
      firstReplyAt,
    });

    if (handoff?.needed) {
      await setHandoff(sessionId, handoff);
      await addEvent({ firmId, personId: sessionId, type: "handoff", detail: `${handoff.trigger}: ${handoff.summary}`, actor: "ai" });
    }

    // 5. perform actions; ensure notify fires on handoff even if AI forgot
    let finalActions = actions ?? [];
    if (handoff?.needed && !finalActions.some((a) => a.type === "notify_team")) {
      finalActions = [...finalActions, { type: "notify_team", reason: `Handoff (${handoff.trigger}): ${handoff.summary}` }];
    }
    const { bookingLink, done, notified } = await performActions(finalActions, person);

    let replyText = reply;
    if (bookingLink) {
      replyText += `\n\nYou can book your free ${CONFIG.firm.bookingType} here: ${bookingLink}`;
      await setBooking(sessionId, { at: null, type: CONFIG.firm.bookingType }); // link offered; actual time set by booking engine (Step 3)
    }

    // audit
    if (done.includes("save_lead") || lead.qualification === "qualified") {
      await addEvent({ firmId, personId: sessionId, type: "lead_captured", detail: lead.qualification, actor: "ai" });
    }
    if (notified) await addEvent({ firmId, personId: sessionId, type: "notify_sent", detail: "team alerted by email", actor: "system" });

    // 6. store AI reply
    await addMessage({ personId: sessionId, firmId, role: "assistant", channel, content: replyText });

    res.status(200).json({ reply: replyText, sessionId, mode: isDemoMode() ? "demo" : "live" });
  } catch (err) {
    console.error("Error in /api/chat:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
}

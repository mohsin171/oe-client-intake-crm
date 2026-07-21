// ============================================================================
// ORCA EDGE - TOOL 1: booking API
//   GET  /api/book            -> list available slots
//   POST /api/book            -> book a slot { sessionId, slotAt }
// Self-contained slot engine (no external calendar). On booking, confirms to
// the visitor (in the chat reply) and emails both the client and the firm.
// ============================================================================

import {
  ensureSchema, ensureFirm, getAvailableSlots, bookSlot, getPerson,
  addEvent, addMessage,
} from "../db/index.js";
import { CONFIG } from "../lib/config.js";
import { sendBookingConfirmations } from "../lib/actions.js";

let ready = false;
async function boot() {
  if (ready) return;
  await ensureSchema();
  await ensureFirm({ id: CONFIG.firm.id, name: CONFIG.firm.name, vertical: CONFIG.firm.vertical });
  ready = true;
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    await boot();
    const firmId = CONFIG.firm.id;

    if (req.method === "GET") {
      const slots = await getAvailableSlots(firmId, { availability: CONFIG.firm.availability });
      return res.status(200).json({ slots, bookingType: CONFIG.firm.bookingType });
    }

    if (req.method === "POST") {
      const sessionId = req.body?.sessionId;
      const slotAt = req.body?.slotAt;
      if (!sessionId || !slotAt) return res.status(400).json({ error: "Missing sessionId or slotAt." });

      const person = await getPerson(sessionId);
      if (!person) return res.status(404).json({ error: "Session not found." });

      const result = await bookSlot(firmId, sessionId, slotAt, CONFIG.firm.bookingType);
      if (!result.ok) {
        if (result.reason === "slot_taken") {
          return res.status(409).json({ error: "slot_taken", message: "That time was just taken. Please pick another." });
        }
        return res.status(500).json({ error: "Could not book. Please try again." });
      }

      const when = new Date(slotAt);
      await addEvent({ firmId, personId: sessionId, type: "booked", detail: `${CONFIG.firm.bookingType} at ${when.toISOString()}`, actor: "ai" });
      const confirmLine = `Your ${CONFIG.firm.bookingType} is booked for ${formatWhen(when)}. You'll receive a confirmation shortly. We look forward to speaking with you.`;
      await addMessage({ personId: sessionId, firmId, role: "assistant", channel: "web", content: confirmLine });

      // fire confirmations (client + firm) — non-blocking best-effort
      sendBookingConfirmations({ person, when, bookingType: CONFIG.firm.bookingType }).catch(() => {});

      return res.status(200).json({ ok: true, confirm: confirmLine, slotAt });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Error in /api/book:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
}

function formatWhen(d) {
  return d.toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", hour12: true });
}

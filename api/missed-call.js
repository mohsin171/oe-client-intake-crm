// ============================================================================
// ORCA EDGE - TOOL 1: POST /api/missed-call  (missed-call text-back, Twilio)
// ----------------------------------------------------------------------------
// READY TO ACTIVATE (rides the same Twilio account as WhatsApp/SMS). Turns a
// missed phone call into a captured lead instead of a lost one.
//
// Setup: on your Twilio phone number, set the call "status callback" (or the
// voice webhook's action/dial callback) to POST here. When a call ends without
// being answered (no-answer / busy / failed / canceled), we text the caller a
// warm "sorry we missed you" and start an SMS conversation through the same
// brain - so the dashboard shows a real lead from a call nobody picked up.
//
// Twilio posts form fields incl. From (caller), To (your number), CallStatus,
// CallSid. Safe no-op until TWILIO_* env vars exist. De-dupes per CallSid so a
// call only ever triggers one text.
// ============================================================================

import { processTurn } from "../lib/engine.js";
import { sendTwilio, twilioConfigured } from "../lib/twilio.js";
import { CONFIG } from "../lib/config.js";

const SMS_FROM = process.env.TWILIO_SMS_FROM; // the number to text FROM

// remember handled calls so a status callback firing twice can't double-text
const handled = new Set();
const MISSED = new Set(["no-answer", "busy", "failed", "canceled"]);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!twilioConfigured() || !SMS_FROM) {
    return res.status(200).json({ configured: false, note: "Set TWILIO_* + TWILIO_SMS_FROM to activate missed-call text-back." });
  }

  try {
    const b = req.body || {};
    const status = String(b.CallStatus || b.DialCallStatus || "").toLowerCase();
    const caller = String(b.From || "").trim();
    const callSid = String(b.CallSid || "");

    // only act on genuinely missed calls, once per call
    if (!MISSED.has(status) || !caller) return res.status(200).send("");
    if (callSid && handled.has(callSid)) return res.status(200).send("");
    if (callSid) handled.add(callSid);

    // Seed the conversation as if the caller texted first, so the reply is a
    // natural "sorry we missed you" opener and the lead is filed via SMS.
    const sessionId = "sms:" + caller;
    const seed = "[Missed call] The caller just tried to reach us by phone and we could not answer.";
    const result = await processTurn({ message: seed, sessionId, channel: "sms", source: "missed-call" });

    // Craft the outbound text: warm opener + whatever the brain produced.
    const opener = `Hi, this is ${CONFIG.firm.name} - sorry we missed your call! ` +
      `I can help right here by text. What were you hoping to speak to us about?`;
    await sendTwilio({ to: caller, from: SMS_FROM, body: opener })
      .catch((e) => console.error("missed-call text failed:", e.message || e));

    res.status(200).send("");
  } catch (err) {
    console.error("Error in /api/missed-call:", err);
    res.status(200).send(""); // 200 so Twilio doesn't retry-storm
  }
}

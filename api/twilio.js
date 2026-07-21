// ============================================================================
// ORCA EDGE - TOOL 1: POST /api/twilio  (all Twilio webhooks, one function)
// ----------------------------------------------------------------------------
// READY TO ACTIVATE. Handles BOTH:
//   - inbound WhatsApp / SMS messages  (payload has Body)
//   - missed-call status callbacks     (payload has CallStatus, no Body)
// Merged into one function to stay within Vercel Hobby's function limit.
//
// Env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM
//   (whatsapp:+...), TWILIO_SMS_FROM (+...).
// Point the number's inbound message webhook AND its call-status callback both
// at /api/twilio. Safe no-op until env vars are set.
// ============================================================================

import { processTurn } from "../lib/engine.js";
import { sendTwilio, twilioConfigured } from "../lib/twilio.js";
import { CONFIG } from "../lib/config.js";

const WA_FROM = process.env.TWILIO_WHATSAPP_FROM;
const SMS_FROM = process.env.TWILIO_SMS_FROM;

const handledCalls = new Set();
const MISSED = new Set(["no-answer", "busy", "failed", "canceled"]);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!twilioConfigured()) {
    return res.status(200).json({ configured: false, note: "Set TWILIO_* env vars to activate WhatsApp/SMS/missed-call." });
  }

  const b = req.body || {};
  try {
    // ---- Route 1: inbound message (WhatsApp or SMS) ----
    if (b.Body != null && String(b.Body).trim() !== "") {
      const from = String(b.From || "").trim();
      const body = String(b.Body).trim();
      if (!from) return res.status(400).send("Missing From");

      const isWhatsApp = from.startsWith("whatsapp:");
      const channel = isWhatsApp ? "whatsapp" : "sms";
      const sessionId = channel + ":" + from.replace("whatsapp:", "");
      const result = await processTurn({ message: body, sessionId, channel, source: channel });

      await sendTwilio({
        to: from,
        from: isWhatsApp ? WA_FROM : SMS_FROM,
        body: result.reply + formatSlots(result.slots),
      }).catch((e) => console.error("Twilio send failed:", e.message || e));

      return res.status(200).send("");
    }

    // ---- Route 2: call-status callback (missed-call text-back) ----
    const status = String(b.CallStatus || b.DialCallStatus || "").toLowerCase();
    if (status) {
      const caller = String(b.From || "").trim();
      const callSid = String(b.CallSid || "");
      if (!MISSED.has(status) || !caller) return res.status(200).send("");
      if (callSid && handledCalls.has(callSid)) return res.status(200).send("");
      if (callSid) handledCalls.add(callSid);
      if (!SMS_FROM) return res.status(200).send("");

      const sessionId = "sms:" + caller;
      const seed = "[Missed call] The caller just tried to reach us by phone and we could not answer.";
      await processTurn({ message: seed, sessionId, channel: "sms", source: "missed-call" });

      const opener = `Hi, this is ${CONFIG.firm.name} - sorry we missed your call! ` +
        `I can help right here by text. What were you hoping to speak to us about?`;
      await sendTwilio({ to: caller, from: SMS_FROM, body: opener })
        .catch((e) => console.error("missed-call text failed:", e.message || e));

      return res.status(200).send("");
    }

    return res.status(200).send(""); // unknown Twilio event, acknowledge
  } catch (err) {
    console.error("Error in /api/twilio:", err);
    res.status(200).send(""); // 200 so Twilio doesn't retry-storm
  }
}

function formatSlots(slots) {
  if (!slots || !slots.length) return "";
  const tz = (CONFIG.firm.availability && CONFIG.firm.availability.timezone) || "Europe/London";
  const lines = slots.slice(0, 5).map((iso, i) => {
    const d = new Date(iso);
    return `${i + 1}. ${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: tz })} ${d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", timeZone: tz })}`;
  });
  return "\n\n" + lines.join("\n") + "\n\nReply with the number that suits you.";
}

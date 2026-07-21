// ============================================================================
// ORCA EDGE - TOOL 1: POST /api/whatsapp  (WhatsApp + SMS door, via Twilio)
// ----------------------------------------------------------------------------
// READY TO ACTIVATE. This is the full integration; it goes live the moment you
// add a Twilio account and set these env vars:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM (e.g.
//   'whatsapp:+14155238886') or TWILIO_SMS_FROM (e.g. '+1...').
// Point your Twilio WhatsApp/SMS number's inbound webhook at this endpoint.
// Until the env vars exist, it responds 200 with {configured:false} and does
// nothing, so deploying it now is safe.
//
// Twilio posts form-encoded fields: From, To, Body. The sender's number is the
// stable session id, so an ongoing WhatsApp/SMS thread is one person.
// ============================================================================

import { processTurn } from "../lib/engine.js";

const SID = process.env.TWILIO_ACCOUNT_SID;
const TOKEN = process.env.TWILIO_AUTH_TOKEN;
const WA_FROM = process.env.TWILIO_WHATSAPP_FROM;   // 'whatsapp:+1...'
const SMS_FROM = process.env.TWILIO_SMS_FROM;       // '+1...'

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const configured = Boolean(SID && TOKEN && (WA_FROM || SMS_FROM));
  if (!configured) {
    // Safe no-op until Twilio is set up.
    return res.status(200).json({ configured: false, note: "Set TWILIO_* env vars to activate WhatsApp/SMS." });
  }

  try {
    const b = req.body || {};
    const from = String(b.From || "").trim();          // 'whatsapp:+1...' or '+1...'
    const body = String(b.Body || "").trim();
    if (!from || !body) return res.status(400).send("Missing From/Body");

    const isWhatsApp = from.startsWith("whatsapp:");
    const channel = isWhatsApp ? "whatsapp" : "sms";
    const sessionId = channel + ":" + from.replace("whatsapp:", "");

    const result = await processTurn({ message: body, sessionId, channel, source: channel });

    // reply via Twilio
    await sendTwilio({
      to: from,
      from: isWhatsApp ? WA_FROM : SMS_FROM,
      body: result.reply + formatSlots(result.slots),
    }).catch((e) => console.error("Twilio send failed:", e.message || e));

    // Twilio expects TwiML or 200; empty 200 is fine since we send via API.
    res.status(200).send("");
  } catch (err) {
    console.error("Error in /api/whatsapp:", err);
    res.status(500).send("error");
  }
}

// If the AI offered slots, list them as text (WhatsApp/SMS have no buttons on
// the basic API; the visitor replies with a number/time and the AI books).
function formatSlots(slots) {
  if (!slots || !slots.length) return "";
  const lines = slots.slice(0, 5).map((iso, i) => {
    const d = new Date(iso);
    return `${i + 1}. ${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} ${d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" })}`;
  });
  return "\n\n" + lines.join("\n") + "\n\nReply with the number that suits you.";
}

async function sendTwilio({ to, from, body }) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`;
  const form = new URLSearchParams({ To: to, From: from, Body: body });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${SID}:${TOKEN}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  if (!res.ok) throw new Error("Twilio " + res.status + " " + (await res.text()));
  return true;
}

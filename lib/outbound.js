// ============================================================================
// OUTBOUND DISPATCHER
// ----------------------------------------------------------------------------
// One place that knows how to send a message BACK to a lead on whatever channel
// they came in on. Used when a human adviser replies from the dashboard.
//
// How we know where to send: the person's id (session id) encodes the channel
// target. Meta threads are "instagram:PSID" / "messenger:PSID"; WhatsApp/SMS
// use the phone number; email uses the email address. We fall back to the
// stored contact field when needed.
// ============================================================================

import { sendTwilio, twilioConfigured } from "./twilio.js";
import { replyByEmail } from "./actions.js";

const WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || "";
const SMS_FROM = process.env.TWILIO_SMS_FROM || "";
const META_PAGE_TOKEN = process.env.META_PAGE_TOKEN || "";

async function sendMeta(recipientId, text) {
  if (!META_PAGE_TOKEN) throw new Error("Meta not configured");
  const url = `https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(META_PAGE_TOKEN)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
  });
  if (!res.ok) throw new Error("Meta " + res.status + " " + (await res.text()));
  return true;
}

// Returns { ok, channel, detail } — never throws; the caller decides what to
// show. `person` is the DB row (has id, channel, contact, phone).
export async function sendToLead(person, text) {
  const channel = (person.channel || "web").toLowerCase();
  const id = String(person.id || "");

  try {
    if (channel === "email") {
      const to = person.contact || "";
      if (!to) return { ok: false, channel, detail: "No email address on file." };
      await replyByEmail({ to, subject: "Re: your enquiry", text });
      return { ok: true, channel, detail: to };
    }

    if (channel === "whatsapp") {
      if (!twilioConfigured()) return { ok: false, channel, detail: "WhatsApp not connected yet." };
      const num = (person.phone || person.contact || id).replace(/^whatsapp:/, "");
      await sendTwilio({ to: "whatsapp:" + num, from: WHATSAPP_FROM, body: text });
      return { ok: true, channel, detail: num };
    }

    if (channel === "sms") {
      if (!twilioConfigured()) return { ok: false, channel, detail: "SMS not connected yet." };
      const num = person.phone || person.contact || id;
      await sendTwilio({ to: num, from: SMS_FROM, body: text });
      return { ok: true, channel, detail: num };
    }

    if (channel === "instagram" || channel === "messenger" || channel === "facebook") {
      // id looks like "instagram:PSID" — take the part after the colon
      const psid = id.includes(":") ? id.split(":").slice(1).join(":") : id;
      await sendMeta(psid, text);
      return { ok: true, channel, detail: psid };
    }

    // website / web chat: no push channel. The reply is saved to the thread and
    // the visitor sees it if they return; if they left an email, fall back to it.
    if (person.contact && person.contact.includes("@")) {
      await replyByEmail({ to: person.contact, subject: "Re: your enquiry", text });
      return { ok: true, channel: "email", detail: person.contact + " (web visitor, emailed)" };
    }
    return { ok: false, channel, detail: "This was a website chat with no contact on file, so it can't be pushed. The reply is saved to the conversation for when they return." };
  } catch (err) {
    return { ok: false, channel, detail: (err && err.message) || "Send failed." };
  }
}

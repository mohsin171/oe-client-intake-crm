// ============================================================================
// OUTBOUND DISPATCHER
// ----------------------------------------------------------------------------
// Sends a message BACK to a lead when a human adviser replies from the
// dashboard. It picks HOW to reach them based on:
//   1. an explicit method the adviser chose (email | whatsapp | sms), if given
//   2. otherwise their arrival channel (whatsapp/instagram/etc. have a native
//      way back)
//   3. otherwise whatever contact detail they left (a phone -> WhatsApp/SMS,
//      an email -> email) — this covers website visitors who typed a number or
//      email into the chat.
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

// crude but effective: does this string look like an email vs a phone number?
function looksLikeEmail(s) { return /\S+@\S+\.\S+/.test(String(s || "")); }
function looksLikePhone(s) {
  const digits = String(s || "").replace(/[^\d]/g, "");
  return digits.length >= 7; // 7+ digits = treat as a phone number
}
function normalisePhone(s) {
  let t = String(s || "").replace(/^whatsapp:/, "").trim();
  // keep a leading + if present, strip spaces/dashes/parens
  const plus = t.startsWith("+") ? "+" : "";
  return plus + t.replace(/[^\d]/g, "");
}

async function sendEmail(to, text) {
  const sent = await replyByEmail({ to, subject: "Re: your enquiry", text });
  if (!sent) return { ok: false, channel: "email", detail: "Email not sent (email service not configured on this project, or the provider rejected it)." };
  return { ok: true, channel: "email", detail: to };
}
async function sendWhatsApp(num, text) {
  if (!twilioConfigured()) return { ok: false, channel: "whatsapp", detail: "WhatsApp not connected yet." };
  const n = normalisePhone(num);
  await sendTwilio({ to: "whatsapp:" + n, from: WHATSAPP_FROM, body: text });
  return { ok: true, channel: "whatsapp", detail: n };
}
async function sendSMS(num, text) {
  if (!twilioConfigured()) return { ok: false, channel: "sms", detail: "SMS not connected yet." };
  const n = normalisePhone(num);
  await sendTwilio({ to: n, from: SMS_FROM, body: text });
  return { ok: true, channel: "sms", detail: n };
}

// Work out the reachable options for a lead (used by the UI to show buttons).
// Returns e.g. ["email"] or ["whatsapp","sms"] or [] (unreachable).
export function reachOptions(person) {
  const channel = (person.channel || "web").toLowerCase();
  const id = String(person.id || "");
  // native channels first
  if (channel === "whatsapp") return ["whatsapp", "sms"];
  if (channel === "sms") return ["sms", "whatsapp"];
  if (channel === "email") return ["email"];
  if (["instagram", "messenger", "facebook"].includes(channel)) return [channel];
  // website / other: infer from the contact they left
  const c = person.contact || person.phone || "";
  if (looksLikeEmail(c)) return ["email"];
  if (looksLikePhone(c)) return ["whatsapp", "sms"];
  return [];
}

// Send a reply. `method` (optional) forces email | whatsapp | sms; otherwise we
// pick the best option. Returns { ok, channel, detail } and never throws.
export async function sendToLead(person, text, method = null) {
  const channel = (person.channel || "web").toLowerCase();
  const id = String(person.id || "");
  const contact = person.contact || person.phone || "";

  try {
    // Meta channels: always go back via the PSID in the id
    if (["instagram", "messenger", "facebook"].includes(channel) && !method) {
      const psid = id.includes(":") ? id.split(":").slice(1).join(":") : id;
      await sendMeta(psid, text);
      return { ok: true, channel, detail: psid };
    }

    // explicit method chosen by the adviser
    if (method === "email") {
      const to = looksLikeEmail(contact) ? contact : "";
      if (!to) return { ok: false, channel: "email", detail: "No email address on file." };
      return await sendEmail(to, text);
    }
    if (method === "whatsapp") {
      const num = channel === "whatsapp" ? (person.phone || contact || id) : contact;
      if (!looksLikePhone(num)) return { ok: false, channel: "whatsapp", detail: "No phone number on file." };
      return await sendWhatsApp(num, text);
    }
    if (method === "sms") {
      const num = ["sms", "whatsapp"].includes(channel) ? (person.phone || contact || id) : contact;
      if (!looksLikePhone(num)) return { ok: false, channel: "sms", detail: "No phone number on file." };
      return await sendSMS(num, text);
    }

    // no explicit method: use the native channel, else infer from contact
    if (channel === "whatsapp") return await sendWhatsApp(person.phone || contact || id, text);
    if (channel === "sms") return await sendSMS(person.phone || contact || id, text);
    if (channel === "email") {
      if (!looksLikeEmail(contact)) return { ok: false, channel: "email", detail: "No email address on file." };
      return await sendEmail(contact, text);
    }

    // website / other: infer from whatever they left
    if (looksLikeEmail(contact)) return await sendEmail(contact, text);
    if (looksLikePhone(contact)) return await sendWhatsApp(contact, text); // default phone -> WhatsApp
    return { ok: false, channel, detail: "This lead left no contact, so a reply can't be delivered. It's saved to the conversation for if they return." };
  } catch (err) {
    return { ok: false, channel: method || channel, detail: (err && err.message) || "Send failed." };
  }
}

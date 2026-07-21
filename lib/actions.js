// ============================================================================
// ORCA EDGE - TOOL 1: actions the backend performs on the AI's request.
// ----------------------------------------------------------------------------
// The AI never touches the calendar, database, or email itself. It REQUESTS an
// action; this controlled code does it. That separation is the safety story.
//
// - send_booking_link -> returns the firm's booking URL for the reply
// - notify_team        -> sends a real email alert via Resend (falls back to
//                         a console log if email isn't configured)
// - save_lead          -> handled by the DB layer in the API function (the
//                         lead is always persisted), so nothing to do here
// ============================================================================

import { CONFIG } from "./config.js";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM = "Orca Edge Intake <hello@orcaedge.io>";

async function sendEmail({ to, subject, text }) {
  if (!RESEND_API_KEY) {
    console.log(`[notify - email not configured] to=${to} subject="${subject}"\n${text}`);
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], subject, text }),
    });
    if (!res.ok) { console.error("Resend send failed:", res.status, await res.text()); return false; }
    return true;
  } catch (err) {
    console.error("Resend send error:", err.message || err);
    return false;
  }
}

// Perform every action the AI requested this turn.
// Returns { bookingLink, done, notified }.
export async function performActions(actions, person) {
  let bookingLink = null;
  let notified = false;
  const done = [];

  for (const action of actions ?? []) {
    try {
      switch (action.type) {
        case "send_booking_link":
          bookingLink = CONFIG.firm.bookingUrl;
          done.push("send_booking_link");
          break;

        case "save_lead":
          // The DB spine is always the source of truth. Additionally, if the
          // client configured a Google Sheet, mirror the lead there too.
          await exportToSheet(person).catch((e) => console.error("Sheet export failed (non-fatal):", e.message || e));
          done.push("save_lead");
          break;

        case "notify_team": {
          const f = person?.fields || {};
          const fieldLines = Object.keys(f).length
            ? "\n\nCaptured details:\n" + Object.entries(f).map(([k, v]) => `  ${k}: ${v}`).join("\n")
            : "";
          const body =
            `A lead needs attention at ${CONFIG.firm.name}.\n\n` +
            `Reason: ${action.reason}\n\n` +
            `Name: ${person?.name || "(not given yet)"}\n` +
            `Contact: ${person?.contact || "(not given yet)"}\n` +
            `Matter: ${person?.matter || "(not given yet)"}\n` +
            `Urgency: ${person?.urgency || "unknown"}\n` +
            `Qualification: ${person?.qualification || "unclear"}` +
            fieldLines +
            `\n\nOpen the dashboard to see the full conversation.`;
          notified = await sendEmail({
            to: CONFIG.team.notify,
            subject: `New lead alert - ${CONFIG.firm.name}`,
            text: body,
          });
          done.push("notify_team");
          break;
        }

        default:
          console.warn("Unknown action:", action.type);
      }
    } catch (err) {
      console.error(`Action "${action?.type}" failed (non-fatal):`, err.message || err);
    }
  }

  return { bookingLink, done, notified };
}

// Send booking confirmations to both the client and the firm.
export async function sendBookingConfirmations({ person, when, bookingType }) {
  const whenStr = when.toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", hour12: true });

  // 1) confirm to the firm's team inbox
  await sendEmail({
    to: CONFIG.team.notify,
    subject: `New ${bookingType} booked - ${CONFIG.firm.name}`,
    text:
      `A ${bookingType} has been booked via your AI intake.\n\n` +
      `When: ${whenStr}\n` +
      `Name: ${person?.name || "(not given)"}\n` +
      `Contact: ${person?.contact || "(not given)"}\n` +
      `Matter: ${person?.matter || "(not given)"}\n\n` +
      `Open the dashboard for the full conversation.`,
  });

  // 2) confirm to the client, if we captured an email address
  const clientEmail = extractEmail(person);
  if (clientEmail) {
    await sendEmail({
      to: clientEmail,
      subject: `Your ${bookingType} with ${CONFIG.firm.name} is confirmed`,
      text:
        `Hi ${person?.name || "there"},\n\n` +
        `Thank you for getting in touch with ${CONFIG.firm.name}. Your ${bookingType} is confirmed for:\n\n` +
        `  ${whenStr}\n\n` +
        `An adviser will call you at the number you provided. If you need to change the time, just reply to this email.\n\n` +
        `We look forward to speaking with you.\n\n` +
        `${CONFIG.firm.name}`,
    });
  }
}

function extractEmail(person) {
  if (person?.email && /@/.test(person.email)) return person.email;
  if (person?.contact && /@/.test(person.contact)) return person.contact;
  return null;
}

// Phase 4: one gentle follow-up to a qualified lead who never booked.
export async function sendNudge(person) {
  const email = (person?.email && /@/.test(person.email)) ? person.email
    : (person?.contact && /@/.test(person.contact)) ? person.contact : null;
  if (!email) return false; // only email nudges for now (WhatsApp/SMS in Phase 7)
  return await sendEmail({
    to: email,
    subject: `Still here to help with your mortgage - ${CONFIG.firm.name}`,
    text:
      `Hi ${person?.name || "there"},\n\n` +
      `Thanks again for getting in touch with ${CONFIG.firm.name}. I wanted to check ` +
      `whether you'd still like to arrange your free ${CONFIG.firm.bookingType} with an ` +
      `adviser - there's no obligation, and it's the quickest way to see your options.\n\n` +
      `Just reply to this email or head back to our site and an adviser will take it from there.\n\n` +
      `Best wishes,\n${CONFIG.firm.name}`,
  });
}

// Optional: mirror a lead into a client's Google Sheet via an Apps Script
// web-app URL. No-op if not configured. The DB remains the source of truth.
export async function exportToSheet(person) {
  const url = CONFIG.crm && CONFIG.crm.sheetWebhookUrl;
  if (!url) return false;
  const f = person?.fields || {};
  const row = {
    timestamp: new Date().toISOString(),
    name: person?.name || "",
    contact: person?.contact || "",
    email: person?.email || "",
    phone: person?.phone || "",
    matter: person?.matter || "",
    channel: person?.channel || "",
    source: person?.source || "",
    urgency: person?.urgency || "",
    qualification: person?.qualification || "",
    loan_purpose: f.loan_purpose || "",
    loan_amount: f.loan_amount || "",
    property_value: f.property_value || "",
    timeline: f.timeline || "",
    buyer_type: f.buyer_type || "",
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
    });
    return res.ok;
  } catch (err) {
    console.error("exportToSheet error:", err.message || err);
    return false;
  }
}

// General outbound email (used by the email channel to reply to the sender).
export async function replyByEmail({ to, subject, text }) {
  return await sendEmail({ to, subject, text });
}

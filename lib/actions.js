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
          // The API function always persists the lead to the database spine,
          // so this is a no-op marker kept for audit/logging parity.
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

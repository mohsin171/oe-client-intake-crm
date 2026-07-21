// ============================================================================
// ORCA EDGE - TOOL 1: POST /api/email-inbound  (email channel door)
// ----------------------------------------------------------------------------
// Receives an inbound email (via a provider webhook - e.g. Resend Inbound, or
// a forwarder like CloudMailin/SendGrid Parse) and runs it through the same
// brain + database as every other channel, then emails the AI's reply back.
//
// The provider posts JSON with at least: from, subject, text. We use the
// sender's email as the stable session id, so an ongoing email thread maps to
// one person on the spine. Secured with an optional EMAIL_WEBHOOK_SECRET.
// ============================================================================

import { processTurn } from "../lib/engine.js";
import { replyByEmail } from "../lib/actions.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // optional shared-secret check
  const secret = process.env.EMAIL_WEBHOOK_SECRET;
  if (secret) {
    const provided = (req.headers?.authorization || "").replace(/^Bearer\s+/i, "") || req.query?.key;
    if (provided !== secret) return res.status(401).json({ error: "unauthorized" });
  }

  try {
    const b = req.body || {};
    // normalise common provider shapes
    const from = extractEmailAddr(b.from || b.sender || b.envelope?.from || "");
    const subject = String(b.subject || "").trim();
    const text = String(b.text || b.plain || b["body-plain"] || b.html || "").trim();
    if (!from || !text) return res.status(400).json({ error: "Missing from/text." });

    // stable session per sender email so a thread is one person
    const sessionId = "email:" + from.toLowerCase();
    const message = (subject ? subject + "\n\n" : "") + stripQuotedReply(text);

    const result = await processTurn({
      message, sessionId, channel: "email", source: "email",
    });

    // email the reply back to the sender
    await replyByEmail({
      to: from,
      subject: subject ? "Re: " + subject : "Re: your enquiry",
      text: result.reply,
    }).catch((e) => console.error("email reply failed:", e.message || e));

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Error in /api/email-inbound:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
}

function extractEmailAddr(s) {
  const m = String(s).match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return m ? m[0] : "";
}

// Trim the quoted history off a reply so the AI only sees the new text.
function stripQuotedReply(text) {
  const lines = String(text).split("\n");
  const out = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) break;                       // quoted line
    if (/^On .+ wrote:$/.test(line.trim())) break;        // "On ... wrote:"
    if (/^-{2,}\s*Original Message/i.test(line)) break;
    out.push(line);
  }
  return out.join("\n").trim() || text.trim();
}

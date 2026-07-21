// ============================================================================
// ORCA EDGE - TOOL 1: /api/meta  (Facebook Messenger + Instagram DM door)
// ----------------------------------------------------------------------------
// READY TO ACTIVATE. Full Meta Messenger + Instagram Direct integration; goes
// live when you set these env vars and register this URL as the webhook in
// your Meta Developer app:
//   META_VERIFY_TOKEN   - any string you choose; paste the same value into the
//                         Meta webhook "Verify Token" field
//   META_PAGE_TOKEN     - the Page Access Token (Messenger) and/or IG token
// Subscribe the app to the "messages" webhook field for the Page / IG account.
//
// GET  = Meta's one-time webhook verification handshake.
// POST = incoming DM events (Messenger + Instagram share this shape).
// Until the env vars exist it verifies nothing and no-ops safely, so deploying
// now is harmless. The sender's Meta user id is the stable session id, so an
// ongoing DM thread maps to one person on the shared spine.
// ============================================================================

import { processTurn } from "../lib/engine.js";
import { CONFIG } from "../lib/config.js";

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
const PAGE_TOKEN = process.env.META_PAGE_TOKEN;

export default async function handler(req, res) {
  // --- Meta webhook verification handshake (GET) ---
  if (req.method === "GET") {
    const mode = req.query?.["hub.mode"];
    const token = req.query?.["hub.verify_token"];
    const challenge = req.query?.["hub.challenge"];
    if (mode === "subscribe" && VERIFY_TOKEN && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Verification failed");
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Safe no-op until configured.
  if (!PAGE_TOKEN) {
    return res.status(200).json({ configured: false, note: "Set META_VERIFY_TOKEN + META_PAGE_TOKEN to activate Messenger/Instagram." });
  }

  try {
    const body = req.body || {};
    // Messenger: body.object === 'page'; Instagram: 'instagram'. Same shape.
    const platform = body.object === "instagram" ? "instagram" : "messenger";
    const entries = Array.isArray(body.entry) ? body.entry : [];

    for (const entry of entries) {
      const events = entry.messaging || entry.changes || [];
      for (const ev of events) {
        const msg = ev.message || ev.value?.message;
        const senderId = ev.sender?.id || ev.value?.sender?.id || ev.from?.id;
        const text = (msg?.text || "").trim();
        if (!senderId || !text || msg?.is_echo) continue; // ignore echoes/empties

        const channel = platform; // 'messenger' | 'instagram'
        const sessionId = channel + ":" + senderId;
        const result = await processTurn({ message: text, sessionId, channel, source: channel });

        await sendMeta(senderId, result.reply + formatSlots(result.slots))
          .catch((e) => console.error("Meta send failed:", e.message || e));
      }
    }
    // Meta requires a fast 200 to acknowledge receipt.
    res.status(200).send("EVENT_RECEIVED");
  } catch (err) {
    console.error("Error in /api/meta:", err);
    res.status(200).send("EVENT_RECEIVED"); // still 200 so Meta doesn't retry-storm
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

// Send a DM back via the Meta Graph API (Send API). Works for both Messenger
// and Instagram messaging on the Page token.
async function sendMeta(recipientId, text) {
  const url = `https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(PAGE_TOKEN)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
  });
  if (!res.ok) throw new Error("Meta " + res.status + " " + (await res.text()));
  return true;
}

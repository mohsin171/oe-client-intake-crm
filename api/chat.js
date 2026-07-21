// ============================================================================
// ORCA EDGE - TOOL 1: POST /api/chat  (the website widget's door)
// Thin channel adapter over the shared engine (lib/engine.js). Adds web-only
// rate limiting, then delegates the turn to processTurn().
// ============================================================================

import { randomUUID } from "node:crypto";
import { processTurn } from "../lib/engine.js";
import { checkLimits, clientIp } from "../lib/safety.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message) return res.status(400).json({ error: "Send a non-empty 'message' string." });
    if (message.length > 2000) return res.status(400).json({ error: "Message too long." });

    const sessionId = req.body?.sessionId || randomUUID();

    // web-only rate limiting (protects the public demo + AI bill)
    const ip = clientIp(req);
    const limit = checkLimits(sessionId, ip);
    if (limit.limited) {
      const msg = limit.reason === "session_cap"
        ? "Thanks for chatting. To keep things moving, an adviser will follow up with you directly from here."
        : "You're sending messages a little quickly. Please give me a moment and try again.";
      return res.status(429).json({ reply: msg, sessionId, rateLimited: true });
    }

    const result = await processTurn({
      message, sessionId, channel: "web", source: req.body?.source || "",
    });
    res.status(200).json(result);
  } catch (err) {
    console.error("Error in /api/chat:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
}

// ============================================================================
// ORCA EDGE - TOOL 1: POST /api/intake  (website & lead-ad form door)
// ----------------------------------------------------------------------------
// Accepts a form submission (name, email/phone, message) from a firm's own
// contact form or a Meta lead-ad webhook, and runs it through the same brain +
// database as every other channel. The form's fields are folded into a single
// message so the AI qualifies it just like a chat.
// ============================================================================

import { randomUUID } from "node:crypto";
import { processTurn } from "../lib/engine.js";
import { clientIp, checkLimits } from "../lib/safety.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const b = req.body || {};
    const name = String(b.name || "").trim();
    const email = String(b.email || "").trim();
    const phone = String(b.phone || "").trim();
    const enquiry = String(b.message || b.enquiry || "").trim();
    if (!name && !email && !phone && !enquiry) {
      return res.status(400).json({ error: "Empty submission." });
    }

    const ip = clientIp(req);
    const sessionId = b.sessionId || randomUUID();
    const limit = checkLimits(sessionId, ip);
    if (limit.limited) return res.status(429).json({ error: "Too many submissions, please slow down." });

    // Fold the form fields into a single first message the AI can qualify.
    const parts = [];
    if (name) parts.push(`My name is ${name}.`);
    if (email) parts.push(`Email: ${email}.`);
    if (phone) parts.push(`Phone: ${phone}.`);
    if (enquiry) parts.push(enquiry);
    const message = parts.join(" ");

    const result = await processTurn({
      message, sessionId, channel: "web", source: b.source || "web-form",
    });

    // Forms are one-shot: acknowledge, don't return a chat thread.
    res.status(200).json({ ok: true, reply: result.reply, sessionId: result.sessionId });
  } catch (err) {
    console.error("Error in /api/intake:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
}

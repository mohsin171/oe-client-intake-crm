// ============================================================================
// ORCA EDGE - TOOL 1, Phase 4: safety & rate limiting
// ----------------------------------------------------------------------------
// Protects public channels (web/whatsapp) from abuse and keeps the demo (and a
// real client's AI bill) safe:
//   - per-session and per-IP rate limits (sliding window, in-memory)
//   - a per-session message cap (stops a single visitor looping forever)
//   - a lightweight spam floor (obvious junk is caught before it hits the AI)
// In-memory is fine for a single serverless region + low volume; a real
// high-volume client would back this with the shared DB or a KV store.
// ============================================================================

const WINDOW_MS = 60 * 1000;         // 1 minute window
const MAX_PER_SESSION_PER_MIN = 12;  // a fast human types a few/min; 12 is generous
const MAX_PER_IP_PER_MIN = 30;       // across sessions from one IP
const MAX_MESSAGES_PER_SESSION = 60; // hard cap on a single conversation

const sessionHits = new Map(); // sessionId -> [timestamps]
const ipHits = new Map();      // ip -> [timestamps]
const sessionTotals = new Map(); // sessionId -> count

function hit(map, key) {
  const now = Date.now();
  const arr = (map.get(key) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  map.set(key, arr);
  return arr.length;
}

// Returns { limited, reason } — call once per incoming message.
export function checkLimits(sessionId, ip) {
  const total = (sessionTotals.get(sessionId) || 0) + 1;
  sessionTotals.set(sessionId, total);
  if (total > MAX_MESSAGES_PER_SESSION) return { limited: true, reason: "session_cap" };

  if (hit(sessionHits, sessionId) > MAX_PER_SESSION_PER_MIN) return { limited: true, reason: "session_rate" };
  if (ip && hit(ipHits, ip) > MAX_PER_IP_PER_MIN) return { limited: true, reason: "ip_rate" };
  return { limited: false };
}

export function clientIp(req) {
  const xff = req.headers?.["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return req.headers?.["x-real-ip"] || req.socket?.remoteAddress || "unknown";
}

// Lightweight pre-AI spam floor: catch obvious junk cheaply so we don't spend
// an AI call (and don't clutter the dashboard). Conservative on purpose - real
// qualification is still the AI's job; this only nabs blatant cases.
const SPAM_PATTERNS = [
  /\b(seo|backlinks?|guest post|link building|rank(ing)? your (site|website)|web ?traffic)\b/i,
  /\b(crypto|forex|casino|viagra|cialis|loan approval guaranteed)\b/i,
  /(https?:\/\/[^\s]+[\s\S]*){2,}/i,        // 2+ URLs anywhere in the message
  /(.)\1{15,}/,                              // 16+ of the same char (aaaaaa…)
];

export function looksLikeSpam(message) {
  const m = String(message || "").trim();
  if (m.length < 2) return true;               // empty-ish
  if (/^[^a-zA-Z0-9]{6,}$/.test(m)) return true; // all symbols/punctuation
  return SPAM_PATTERNS.some((re) => re.test(m));
}

// Periodic cleanup so the maps don't grow unbounded on a long-lived instance.
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of sessionHits) { const f = arr.filter((t) => now - t < WINDOW_MS); if (f.length) sessionHits.set(k, f); else sessionHits.delete(k); }
  for (const [k, arr] of ipHits) { const f = arr.filter((t) => now - t < WINDOW_MS); if (f.length) ipHits.set(k, f); else ipHits.delete(k); }
}, 5 * 60 * 1000).unref?.();

// ============================================================================
// ORCA EDGE - TOOL 1: the AI brain (shared across all channels)
// ----------------------------------------------------------------------------
// Builds the system prompt from the firm config, defines the strict output
// shape the model must return (reply + lead + actions + handoff), and runs one
// conversation turn. Every channel (web, whatsapp, email, phone) uses this same
// brain: "same brain, same rules, different door."
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { CONFIG } from "./config.js";

const DEMO_MODE = !process.env.ANTHROPIC_API_KEY;
const client = DEMO_MODE ? null : new Anthropic();
const MODEL = CONFIG.ai.model;

// ---- Build the system prompt from the firm's facts -------------------------
export function buildSystemPrompt(firm = CONFIG.firm) {
  const services = firm.services.map((s) => `- ${s.area}: ${s.details}`).join("\n");
  const offices = firm.offices.map((o) => `- ${o.city}: ${o.address} (${o.note})`).join("\n");
  const fees = firm.feesPolicy.map((f) => `- ${f}`).join("\n");
  const faqs = firm.faqs.map((f) => `Q: ${f.q}\nA: ${f.a}`).join("\n\n");
  const captureFields = (firm.captureFields || [])
    .map((f) => `- ${f.label}${f.options ? ` (${f.options.join(", ")})` : ""}`)
    .join("\n");

  return `You are the virtual receptionist for ${firm.name}, ${firm.tagline}.

Your job is to greet visitors, understand what they need, answer questions
ACCURATELY from the firm information below, capture their details, and arrange
for a qualified adviser to help. Make people feel looked after: warm, competent,
like a great front-desk person.

== FIRM INFORMATION (your only source of truth) ==

Services we handle:
${services}

We do NOT handle: ${firm.notHandled.join(", ")}.

Offices:
${offices}

Opening hours: ${firm.hours}

Fees:
${fees}

Getting started: ${firm.nextSteps}

Frequently asked questions:
${faqs}

== HOW TO BEHAVE ==
- Be warm, concise, and professional. Short paragraphs. No jargon.
- Ask one clear question at a time to understand the visitor's situation.
- If someone seems distressed or frustrated, acknowledge it kindly first.
- Answer firm-specific questions using ONLY the information above.
- COLLECT THE ESSENTIALS so the adviser can follow up: (1) name, (2) a contact
  (phone or email), and (3) a clear description of what they need. Ask for
  anything missing, ONE item at a time, woven naturally into the conversation.

== CAPTURE THESE MORTGAGE DETAILS WHEN THEY COME UP (do not interrogate) ==
${captureFields}
Put whatever you learn into the lead.fields object using the keys shown.

== YOUR TWO JOBS EACH MESSAGE ==
1. reply - the warm, natural message the visitor sees.
2. Quietly build the lead record from what they actually said. Base every field
   ONLY on what they have told you. Leave a field empty if not given - NEVER
   invent a name, number, or detail.

== HOW TO JUDGE THE LEAD (qualification) ==
- "qualified": a genuine person needing one of our services.
- "poor_fit": their need is something we do NOT handle, or outside our services.
- "spam": gibberish, advertising, obvious testing, or abusive messages.
- "unclear": not enough information yet - normal early in a chat.
Urgency: "high" if time-sensitive or distressed; "medium" if actively looking;
"low" if just browsing; "unknown" if you cannot tell yet.

== ACTIONS YOU CAN REQUEST (you do NOT perform them; the system does) ==
- "send_booking_link": when a QUALIFIED visitor is ready to speak to an adviser,
  offer to book their free ${firm.bookingType || "consultation"}. The system
  inserts the real link - never write a URL yourself.
- "save_lead": once the record is useful (a name OR contact, plus what they need).
- "notify_team": when a human is needed now - distress, a complaint, a
  high-value case, or the visitor asks for a person. Give the reason.
Use an empty actions array when none apply. NEVER mention actions, tools, links,
or "saving your details" to the visitor - just talk naturally.

== WHEN TO HAND OFF TO A HUMAN (set handoff.needed = true) ==
- "sensitive": distressed or upset, a complaint, or asking for regulated advice.
- "high_value": a clearly large or complex case, too important for automation.
- "low_confidence": you are unsure what they need or unsure you are handling it right.
Gently tell the visitor an adviser will follow up personally. Never bluff. If
none apply, handoff.needed = false and trigger = "none".

== HARD RULES ==
- ACCURACY OVER EVERYTHING: if the answer is not in the firm information above,
  say "I'll have an adviser confirm that for you" - do NOT guess or invent.
- NEVER give regulated mortgage advice or recommend a specific product or lender.
- NEVER quote an exact rate or fee, or promise an outcome. Explain the approach
  and offer the free ${firm.bookingType || "consultation"} for tailored figures.
- If a need is something we do NOT handle, say so kindly and offer to pass their
  details to the team.`;
}

const SYSTEM_PROMPT = buildSystemPrompt();

// ---- The strict output shape (structured outputs) --------------------------
const LEAD_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "The warm message shown to the visitor. The ONLY part they see." },
    lead: {
      type: "object",
      properties: {
        name: { type: "string" },
        contact: { type: "string", description: "phone or email, or empty" },
        matter: { type: "string", description: "short summary of what they need, or empty" },
        urgency: { type: "string", enum: ["high", "medium", "low", "unknown"] },
        qualification: { type: "string", enum: ["qualified", "poor_fit", "spam", "unclear"] },
        qualification_reason: { type: "string" },
        fields: {
          type: "object",
          description: "Mortgage-specific details captured so far (loan_purpose, loan_amount, property_value, timeline, buyer_type). Include only keys you actually learned.",
          additionalProperties: true,
        },
      },
      required: ["name", "contact", "matter", "urgency", "qualification", "qualification_reason", "fields"],
      additionalProperties: false,
    },
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["send_booking_link", "save_lead", "notify_team"] },
          reason: { type: "string" },
        },
        required: ["type", "reason"],
        additionalProperties: false,
      },
    },
    handoff: {
      type: "object",
      properties: {
        needed: { type: "boolean" },
        trigger: { type: "string", enum: ["sensitive", "high_value", "low_confidence", "none"] },
        summary: { type: "string" },
      },
      required: ["needed", "trigger", "summary"],
      additionalProperties: false,
    },
  },
  required: ["reply", "lead", "actions", "handoff"],
  additionalProperties: false,
};

const EMPTY_LEAD = {
  name: "", contact: "", matter: "", urgency: "unknown",
  qualification: "unclear", qualification_reason: "Demo mode - real extraction needs an API key.",
  fields: {},
};

export function isDemoMode() { return DEMO_MODE; }
export function modelName() { return MODEL; }

// Adjust tone per channel (same brain, different door).
function systemForChannel(channel) {
  if (channel === "email") return SYSTEM_PROMPT + `\n\n== THIS CHANNEL: EMAIL ==\nWrite a slightly fuller, more formal reply with a brief greeting and a polite sign-off.`;
  if (channel === "whatsapp") return SYSTEM_PROMPT + `\n\n== THIS CHANNEL: WHATSAPP ==\nKeep replies short, warm, and mobile-friendly.`;
  return SYSTEM_PROMPT;
}

function demoReply(history) {
  const turns = history.filter((m) => m.role === "user").length;
  const banner = "\n\n(demo mode - add ANTHROPIC_API_KEY for real AI replies)";
  if (turns <= 1) return "Hi, thanks for reaching out to Rivergate Mortgages. I'd be glad to help. Are you looking at a purchase, a remortgage, or something else?" + banner;
  return "Thank you. To get you tailored figures, an adviser will follow up. Could I take your name and the best number to reach you on?" + banner;
}

// Run one conversation turn. Pure logic: takes history, returns the reply and
// the structured data. Persistence is the caller's job (the API function).
export async function runTurn({ history, channel = "web" }) {
  if (DEMO_MODE) {
    return {
      reply: demoReply(history),
      lead: { ...EMPTY_LEAD },
      actions: [],
      handoff: { needed: false, trigger: "none", summary: "" },
    };
  }

  try {
    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 1024,
        system: systemForChannel(channel),
        messages: history,
        output_config: { format: { type: "json_schema", schema: LEAD_SCHEMA } },
      },
      { timeout: 30000 }
    );
    const raw = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const parsed = JSON.parse(raw);
    return { reply: parsed.reply, lead: parsed.lead, actions: parsed.actions, handoff: parsed.handoff };
  } catch (err) {
    console.error(`AI turn failed (${channel}):`, err.message || err);
    // Never leave the visitor hanging; capture what they said; alert a human.
    const lastUser = [...history].reverse().find((m) => m.role === "user");
    return {
      reply: "Thanks for your message. I'm having a brief technical issue right now, so I've asked an adviser to follow up with you personally as soon as possible.",
      lead: { ...EMPTY_LEAD, matter: String(lastUser?.content || "").slice(0, 200), qualification_reason: "Captured during an AI outage - needs manual review." },
      actions: [{ type: "notify_team", reason: "AI unavailable - visitor needs manual follow-up." }],
      handoff: { needed: true, trigger: "low_confidence", summary: "AI error; manual follow-up needed." },
    };
  }
}

export { CONFIG };

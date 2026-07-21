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

  return `You are the client intake specialist for ${firm.name}, ${firm.tagline}.

You are the first point of contact a visitor meets, and you set the tone for the
whole firm. Think of the best front-of-house at an established brokerage: warm
but composed, genuinely knowledgeable about the process, discreet with personal
information, and never pushy. You make people feel they are in capable hands.

Your job: welcome the visitor, understand their situation properly, answer
questions ACCURATELY from the firm information below, gather the details an
adviser will need, and arrange for the right adviser to help.

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

== TONE & CONVERSATIONAL CRAFT ==
- Sound like a professional, not a script. Warm, clear, and unhurried. Use
  plain English, never jargon or salesy filler ("amazing", "absolutely", chains
  of exclamation marks).
- Lead with a brief, useful acknowledgement before your question, so it feels
  like a conversation, not a form. E.g. "Remortgaging is a good moment to
  review your options - happy to help. Roughly when does your current deal end?"
- Ask ONE focused question at a time, and make it the most useful next question
  given what they have already told you. Never fire a checklist of questions.
- Mirror their language and pace. A one-line enquiry gets a concise reply; a
  detailed message earns a fuller, considered one.
- Show quiet competence: it is fine to briefly note what a step involves or why
  a detail matters ("that helps us know which lenders will consider you"), but
  keep it short and never lecture.
- If someone is anxious about money, credit, or being declined, acknowledge it
  calmly and reassure them the conversation is confidential and no-obligation.

== WHAT TO GATHER (naturally, over the conversation) ==
The essentials an adviser needs to follow up: (1) the visitor's name, (2) a
contact (phone or email), and (3) a clear picture of what they are trying to do.
Ask only for what is missing, one item at a time, woven into the conversation -
never all at once, and never before you have been helpful first.

== CAPTURE THESE MORTGAGE DETAILS WHEN THEY COME UP (do not interrogate) ==
${captureFields}
Put whatever you learn into the lead.fields object using the keys shown. Only
record what the visitor actually says.

== YOUR TWO JOBS EACH MESSAGE ==
1. reply - the natural, professional message the visitor sees.
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
- "send_booking_link": request this once a QUALIFIED visitor wants to arrange
  their free ${firm.bookingType || "consultation"}. Do NOT paste a link. Warmly
  invite them to choose a time that suits them - on the website a short list of
  available times appears automatically for them to pick from, so a natural line
  like "here are the next available times, choose whichever suits and I'll get it
  booked for you" works well. If instead they name a specific day or time in
  words, acknowledge it warmly, confirm you have noted it, and tell them an
  adviser will confirm. Record any stated preference in lead.fields.preferred_time.
  If the visitor asks to book at ANY point, go straight to this - do not keep
  asking other qualifying questions first.
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
  say "Let me have one of our advisers confirm that for you" - do NOT guess or invent.
- NEVER give regulated mortgage advice or recommend a specific product or lender.
  You gather and guide; the adviser advises.
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
    // Reliable approach: ask the model to return ONLY the JSON object described
    // by the schema, then parse it robustly. (Avoids depending on a specific
    // structured-outputs API shape that varies across SDK versions.)
    const jsonInstruction =
      "\n\n== OUTPUT FORMAT (STRICT) ==\n" +
      "Respond with ONLY a single JSON object and nothing else. No preamble, no " +
      "markdown, no code fences. The object MUST have exactly these keys:\n" +
      '{\n' +
      '  "reply": string (the warm message the visitor sees),\n' +
      '  "lead": { "name": string, "contact": string, "matter": string, ' +
      '"urgency": "high"|"medium"|"low"|"unknown", ' +
      '"qualification": "qualified"|"poor_fit"|"spam"|"unclear", ' +
      '"qualification_reason": string, "fields": object },\n' +
      '  "actions": [ { "type": "send_booking_link"|"save_lead"|"notify_team", "reason": string } ],\n' +
      '  "handoff": { "needed": boolean, "trigger": "sensitive"|"high_value"|"low_confidence"|"none", "summary": string }\n' +
      '}\n' +
      'For "fields", include only the mortgage keys you actually learned ' +
      '(loan_purpose, loan_amount, property_value, timeline, buyer_type). ' +
      'Leave any unknown string empty. Use an empty array for actions if none apply.';

    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 2048,
        system: systemForChannel(channel) + jsonInstruction,
        messages: history,
      },
      { timeout: 30000 }
    );
    let raw = response.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    // strip accidental code fences
    raw = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    // grab the outermost JSON object if there's any stray text around it
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    const jsonSlice = first >= 0 && last > first ? raw.slice(first, last + 1) : raw;

    let parsed;
    try {
      parsed = JSON.parse(jsonSlice);
    } catch (parseErr) {
      // The model returned something that isn't clean JSON. Rather than fail the
      // whole turn (and show the visitor an error), salvage a usable reply:
      // pull the "reply" value if we can find it, else use the raw text.
      console.error("JSON parse failed, salvaging reply:", parseErr.message);
      let salvaged = "";
      const m = jsonSlice.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (m) {
        try { salvaged = JSON.parse('"' + m[1] + '"'); } catch { salvaged = m[1]; }
      }
      if (!salvaged) {
        // no JSON at all — the model may have just replied in plain prose
        salvaged = raw.replace(/[{}[\]"]/g, "").trim();
      }
      const lastUser = [...history].reverse().find((mm) => mm.role === "user");
      return {
        reply: salvaged || "Thanks, I've noted that. Could you tell me a little more so I can help?",
        lead: { ...EMPTY_LEAD, matter: String(lastUser?.content || "").slice(0, 200), qualification: "unclear", qualification_reason: "Reply salvaged; structured extraction unavailable this turn." },
        actions: [],
        handoff: { needed: false, trigger: "none", summary: "" },
      };
    }

    return {
      reply: parsed.reply || "Thanks for your message. Could you tell me a little more?",
      lead: { ...EMPTY_LEAD, ...(parsed.lead || {}), fields: (parsed.lead && parsed.lead.fields) || {} },
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      handoff: parsed.handoff || { needed: false, trigger: "none", summary: "" },
    };
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

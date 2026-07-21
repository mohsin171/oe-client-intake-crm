// ============================================================================
// ORCA EDGE - TOOL 1: the shared conversation engine
// ----------------------------------------------------------------------------
// One persisted turn through the brain + database spine, channel-agnostic.
// Every channel (web widget, email, web form, and later WhatsApp/SMS) calls
// processTurn() with a different `channel` value. "Same brain, same rules,
// different door" - implemented literally as one function behind every door.
// ============================================================================

import { randomUUID } from "node:crypto";
import { runTurn, isDemoMode, CONFIG } from "./brain.js";
import { performActions } from "./actions.js";
import { looksLikeSpam } from "./safety.js";
import {
  ensureSchema, ensureFirm, createPerson, getPerson, updateLead,
  setHandoff, addMessage, getHistoryForAI, addEvent, getAvailableSlots,
  findDuplicate, markDuplicate,
} from "../db/index.js";

let ready = false;
export async function boot() {
  if (ready) return;
  await ensureSchema();
  await ensureFirm({ id: CONFIG.firm.id, name: CONFIG.firm.name, vertical: CONFIG.firm.vertical });
  ready = true;
}

// Process one inbound message on any channel. Returns:
//   { reply, sessionId, slots, spam, mode }
// Persistence, qualification, handoff, dedup, booking-offer, and audit are all
// handled here so every channel behaves identically.
export async function processTurn({ message, sessionId, channel = "web", source = "" }) {
  await boot();
  const firmId = CONFIG.firm.id;
  const id = sessionId || randomUUID();

  // spam floor (pre-AI)
  if (looksLikeSpam(message)) {
    await createPerson({ id, firmId, channel, source });
    await addMessage({ personId: id, firmId, role: "user", channel, content: message });
    await updateLead(id, {
      name: "", contact: "", matter: String(message).slice(0, 120), urgency: "low",
      qualification: "spam", qualification_reason: "Caught by the pre-AI spam floor.",
    }, { fields: {} });
    await addEvent({ firmId, personId: id, type: "spam_filtered", detail: `pre-AI spam floor (${channel})`, actor: "system" });
    const reply = "Thanks for your message. If you have a genuine mortgage enquiry, let me know a little about what you need and I'll be glad to help.";
    await addMessage({ personId: id, firmId, role: "assistant", channel, content: reply });
    return { reply, sessionId: id, slots: null, spam: true, mode: isDemoMode() ? "demo" : "live" };
  }

  // 1. ensure person + 2. store message
  await createPerson({ id, firmId, channel, source });
  await addMessage({ personId: id, firmId, role: "user", channel, content: message });

  // 3. brain over full history (per-channel tone handled inside runTurn)
  const history = await getHistoryForAI(id);
  const { reply, lead, actions, handoff } = await runTurn({ history, channel });

  // 4. persist extracted lead
  const firstReplyAt = new Date().toISOString();
  const person = await updateLead(id, lead, { fields: lead.fields || {}, firstReplyAt });

  if (handoff?.needed) {
    await setHandoff(id, handoff);
    await addEvent({ firmId, personId: id, type: "handoff", detail: `${handoff.trigger}: ${handoff.summary}`, actor: "ai" });
  }

  // dedup
  if ((person?.contact || person?.email || person?.phone) && !(person?.fields?.duplicate_of)) {
    const dup = await findDuplicate(firmId, id, { email: person.email, phone: person.phone, contact: person.contact });
    if (dup) {
      await markDuplicate(id, dup.id);
      await addEvent({ firmId, personId: id, type: "duplicate_detected", detail: `Returning enquirer; first seen as ${dup.id}`, actor: "system" });
    }
  }

  // 5. actions (+ guarantee notify on handoff)
  let finalActions = actions ?? [];
  if (handoff?.needed && !finalActions.some((a) => a.type === "notify_team")) {
    finalActions = [...finalActions, { type: "notify_team", reason: `Handoff (${handoff.trigger}): ${handoff.summary}` }];
  }
  const { bookingLink, done, notified } = await performActions(finalActions, person);

  let replyText = reply;
  let slots = null;
  if (bookingLink) {
    slots = await getAvailableSlots(firmId, { availability: CONFIG.firm.availability });
    replyText += slots.length > 0
      ? `\n\nHere are the next available times for your free ${CONFIG.firm.bookingType}. Tap one that suits you:`
      : `\n\nAn adviser will be in touch shortly to arrange your free ${CONFIG.firm.bookingType}.`;
  }

  // audit
  if (done.includes("save_lead") || lead.qualification === "qualified") {
    await addEvent({ firmId, personId: id, type: "lead_captured", detail: `${lead.qualification} (${channel})`, actor: "ai" });
  }
  if (notified) await addEvent({ firmId, personId: id, type: "notify_sent", detail: "team alerted by email", actor: "system" });

  // 6. store reply
  await addMessage({ personId: id, firmId, role: "assistant", channel, content: replyText });

  return { reply: replyText, sessionId: id, slots, bookingType: CONFIG.firm.bookingType, spam: false, mode: isDemoMode() ? "demo" : "live" };
}

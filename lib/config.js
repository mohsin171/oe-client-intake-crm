// ============================================================================
// ORCA EDGE - TOOL 1: the SINGLE per-client config file.
// ----------------------------------------------------------------------------
// Everything that changes from one client to the next lives here. To onboard a
// new firm you copy this file, edit the values, and deploy. No other file
// changes. That is what makes fast client onboarding real.
//
// DEMO TENANT: Rivergate Mortgages (fictional UK mortgage brokerage).
// Tool 1 demos the mortgage vertical - the Orca Edge beachhead.
// ============================================================================

export const CONFIG = {
  firm: {
    id: "demo-mortgage",
    vertical: "mortgage",
    name: "Rivergate Mortgages",
    tagline: "a UK mortgage brokerage helping buyers and homeowners find the right mortgage",

    services: [
      { area: "First-Time Buyers", details: "Guiding first-time buyers through the whole process, from agreement in principle to completion, and finding lenders suited to smaller deposits and first purchases." },
      { area: "Remortgaging", details: "Reviewing your current deal and searching the market for a better rate when your fixed term ends, or to release equity." },
      { area: "Home Movers", details: "Arranging the mortgage for your next home, including porting an existing mortgage or arranging a new one." },
      { area: "Buy-to-Let", details: "Mortgages for landlords and investors, including portfolio and limited-company buy-to-let." },
      { area: "Self-Employed & Complex Income", details: "Specialist help for self-employed applicants, contractors, and those with complex income who high-street lenders often struggle with." },
    ],

    notHandled: ["commercial property finance over 5 million pounds", "overseas property mortgages", "conveyancing (we refer you to trusted solicitors)"],

    offices: [
      { city: "Reading", address: "14 Kings Walk, Reading RG1 2HG", note: "Head office; appointments in person or by video." },
    ],

    hours: "Monday to Friday 9:00am to 6:00pm, and Saturday mornings 9:00am to 1:00pm by appointment. The AI intake answers 24/7.",

    feesPolicy: [
      "Free initial consultation (a fact-find call) for all new enquiries.",
      "Rivergate is a whole-of-market broker; many mortgages are arranged with no broker fee, as the lender pays commission.",
      "Where a fee applies it is explained clearly and in writing before you commit, never as a surprise.",
      "The assistant never quotes an exact rate or fee. It explains the approach and arranges a fact-find call for tailored figures.",
    ],

    nextSteps: "The best next step is a free, no-obligation fact-find call: about 20 minutes, by phone or video, to understand your situation and outline the options.",

    bookingUrl: "https://cal.com/rivergate/fact-find",
    bookingType: "fact-find call",

    faqs: [
      { q: "How much can I borrow?", a: "It depends on your income, deposit, and outgoings. The adviser works this out properly on a short fact-find call rather than giving a rough guess that could mislead you." },
      { q: "Do you charge a fee?", a: "Often there is no fee to you, as the lender pays Rivergate a commission. Where a fee does apply it is always explained clearly and in writing before you commit." },
      { q: "I'm self-employed, can you still help?", a: "Yes. Rivergate specialises in self-employed and complex-income cases and works with lenders who understand them, not just high-street tick-box criteria." },
      { q: "How soon can I get an agreement in principle?", a: "Often within a day or two of the fact-find call, once the adviser has your details and has matched you to a suitable lender." },
      { q: "Can the assistant give me mortgage advice?", a: "No. The assistant gathers your details and arranges for a qualified adviser to give regulated advice. It cannot advise on specific products itself." },
    ],

    // Vertical-specific fields the intake should try to capture for a mortgage
    // enquiry. These map into the `fields` JSON on the person record.
    captureFields: [
      { key: "loan_purpose", label: "Loan purpose", options: ["purchase", "remortgage", "buy-to-let", "product transfer"] },
      { key: "loan_amount", label: "Approximate loan amount" },
      { key: "property_value", label: "Approximate property value" },
      { key: "timeline", label: "Timeline", options: ["ready now", "within 3 months", "just exploring"] },
      { key: "buyer_type", label: "Buyer type", options: ["first-time buyer", "home mover", "landlord", "self-employed"] },
    ],
  },

  widget: {
    accent: "#4592DC", // Orca Edge bright blue; harmonises with the case-studies tab
    greeting: "Hello, and welcome to Rivergate Mortgages. I can help with questions about buying, remortgaging, or buy-to-let, and arrange a free, no-obligation call with one of our advisers. What brings you in today?",
  },

  ai: {
    // Haiku 4.5: fast + cheap for a public demo. Full dated ID for reliability.
    // Swap to a larger model (e.g. claude-sonnet-4-6) per client if desired.
    model: "claude-haiku-4-5-20251001",
  },

  team: {
    notify: "hello@orcaedge.io", // where handoff/lead alerts go (demo: Orca Edge inbox)
  },

  // Optional CRM export. If a client wants their leads mirrored into a Google
  // Sheet (a familiar window they can open), paste the Apps Script web-app URL
  // here. Empty = disabled. The database stays the source of truth; the Sheet
  // is a nice-to-have export, not the foundation.
  crm: {
    sheetWebhookUrl: process.env.SHEET_WEBHOOK_URL || "",
  },
};

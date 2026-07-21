// ============================================================================
// ORCA EDGE — DATABASE ACCESS LAYER (the spine's API)
// ----------------------------------------------------------------------------
// Every tool talks to the shared database through functions in this file, never
// with raw SQL scattered around. That keeps the data model in one place and
// makes the four-tool integration clean.
//
// Connection: reads DATABASE_URL from the environment. Locally that points at
// a local Postgres; on Vercel it's the Postgres/Neon connection string that
// Vercel injects automatically. Same code, both places.
// ============================================================================

import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

// The connection string. Different hosts name this variable differently, so
// accept any of the common ones. Vercel + Neon inject POSTGRES_URL (and
// friends); local dev uses DATABASE_URL. First non-empty wins.
const CONNECTION_STRING =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL_UNPOOLED;

const isLocal = CONNECTION_STRING?.includes("localhost") || CONNECTION_STRING?.includes("/tmp");

// A single shared connection pool. On serverless this is created per cold
// start and reused across warm invocations.
const pool = new Pool({
  connectionString: CONNECTION_STRING,
  // Vercel/Neon require SSL; local dev does not.
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 5,
});

export async function query(text, params) {
  return pool.query(text, params);
}

// Run the schema (idempotent — safe to call on every boot).
export async function ensureSchema() {
  const sql = readFileSync(join(__dirname, "schema.sql"), "utf8");
  await pool.query(sql);
}

// Make sure a firm row exists (called once at startup for the configured firm).
export async function ensureFirm({ id, name, vertical }) {
  await pool.query(
    `INSERT INTO firms (id, name, vertical) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, vertical = EXCLUDED.vertical`,
    [id, name, vertical]
  );
}

// ---- People (the spine) ----------------------------------------------------

// Fetch a person by id, or null.
export async function getPerson(id) {
  const { rows } = await pool.query(`SELECT * FROM people WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

// Create a person the first time we see them (on first message of a session).
export async function createPerson({ id, firmId, channel, source }) {
  const { rows } = await pool.query(
    `INSERT INTO people (id, firm_id, channel, source, stage, first_seen_at)
     VALUES ($1, $2, $3, $4, 'new', now())
     ON CONFLICT (id) DO NOTHING
     RETURNING *`,
    [id, firmId, channel, source ?? ""]
  );
  return rows[0] ?? (await getPerson(id));
}

function digits(s) { return String(s || "").replace(/\D/g, ""); }

// Dedup: find an EARLIER person (different session) in the same firm who shares
// this email or phone, so we recognise a returning enquirer instead of
// double-counting them. Matches normalised email or last-9-digits of phone.
export async function findDuplicate(firmId, currentId, { email, phone, contact }) {
  const em = (email || (contact && /@/.test(contact) ? contact : "") || "").trim().toLowerCase();
  const phRaw = digits(phone || (contact && !/@/.test(contact) ? contact : "") || "");
  const ph = phRaw.length >= 7 ? phRaw.slice(-9) : "";
  if (!em && !ph) return null; // nothing reliable to match on

  const { rows } = await pool.query(
    `SELECT id, name, contact, email, phone, created_at, stage
     FROM people
     WHERE firm_id = $1 AND id <> $2
       AND ( ($3 <> '' AND lower(email) = $3)
          OR ($3 <> '' AND lower(contact) = $3)
          OR ($4 <> '' AND right(regexp_replace(phone, '\D', '', 'g'), 9) = $4)
          OR ($4 <> '' AND right(regexp_replace(contact, '\D', '', 'g'), 9) = $4) )
     ORDER BY created_at ASC
     LIMIT 1`,
    [firmId, currentId, em, ph]
  );
  return rows[0] || null;
}

// Mark the current person as a duplicate of an earlier one (stored in fields).
export async function markDuplicate(currentId, originalId) {
  await pool.query(
    `UPDATE people SET fields = jsonb_set(COALESCE(fields,'{}'::jsonb), '{duplicate_of}', to_jsonb($2::text)), updated_at = now() WHERE id = $1`,
    [currentId, originalId]
  );
}

// Update a person's captured lead fields after an AI turn. Only overwrites a
// field when the new value is non-empty, so later turns never blank out data
// an earlier turn captured (this is the "record fills up over the conversation"
// behaviour).
export async function updateLead(id, lead, extra = {}) {
  const p = await getPerson(id);
  if (!p) return null;

  const merged = {
    name: lead.name || p.name,
    contact: lead.contact || p.contact,
    email: extra.email || p.email,
    phone: extra.phone || p.phone,
    matter: lead.matter || p.matter,
    urgency: lead.urgency && lead.urgency !== "unknown" ? lead.urgency : p.urgency,
    qualification: lead.qualification && lead.qualification !== "unclear" ? lead.qualification : p.qualification,
    qualification_reason: lead.qualification_reason || p.qualification_reason,
    fields: { ...(p.fields || {}), ...(extra.fields || {}) },
    first_reply_at: p.first_reply_at || extra.firstReplyAt || null,
  };

  // Advance stage sensibly: a qualified lead moves from 'new' to 'qualified'
  // (but never downgrade a lead that's already further along).
  let stage = p.stage;
  if (stage === "new" && merged.qualification === "qualified") stage = "qualified";

  const { rows } = await pool.query(
    `UPDATE people SET
       name=$2, contact=$3, email=$4, phone=$5, matter=$6, urgency=$7,
       qualification=$8, qualification_reason=$9, fields=$10, stage=$11,
       first_reply_at=COALESCE(first_reply_at, $12), updated_at=now()
     WHERE id=$1 RETURNING *`,
    [id, merged.name, merged.contact, merged.email, merged.phone, merged.matter,
     merged.urgency, merged.qualification, merged.qualification_reason,
     JSON.stringify(merged.fields), stage, merged.first_reply_at]
  );
  return rows[0];
}

// Record a handoff on the person.
export async function setHandoff(id, { needed, trigger, summary }) {
  await pool.query(
    `UPDATE people SET handoff_needed=$2, handoff_trigger=$3, handoff_summary=$4,
       stage = CASE WHEN $2 THEN 'handed_off' ELSE stage END, updated_at=now()
     WHERE id=$1`,
    [id, !!needed, trigger ?? "none", summary ?? ""]
  );
}

// Record a booking on the person.
export async function setBooking(id, { at, type }) {
  await pool.query(
    `UPDATE people SET booking_at=$2, booking_type=$3,
       stage = CASE WHEN stage IN ('new','qualified') THEN 'booked' ELSE stage END,
       updated_at=now()
     WHERE id=$1`,
    [id, at, type ?? "consultation"]
  );
}

// ---- Messages --------------------------------------------------------------

export async function addMessage({ personId, firmId, role, channel, content }) {
  await pool.query(
    `INSERT INTO messages (person_id, firm_id, role, channel, content)
     VALUES ($1, $2, $3, $4, $5)`,
    [personId, firmId, role, channel ?? "web", content]
  );
}

export async function getMessages(personId) {
  const { rows } = await pool.query(
    `SELECT role, channel, content, created_at FROM messages
     WHERE person_id=$1 ORDER BY created_at ASC`,
    [personId]
  );
  return rows;
}

// The conversation history in the shape the AI SDK wants.
export async function getHistoryForAI(personId) {
  const rows = await getMessages(personId);
  return rows.map((m) => ({ role: m.role, content: m.content }));
}

// ---- Events (audit trail) --------------------------------------------------

export async function addEvent({ firmId, personId, type, detail, actor }) {
  await pool.query(
    `INSERT INTO events (firm_id, person_id, type, detail, actor)
     VALUES ($1, $2, $3, $4, $5)`,
    [firmId, personId ?? null, type, detail ?? "", actor ?? "ai"]
  );
}

// ---- Dashboard reads -------------------------------------------------------

// All leads for a firm, newest first, with a couple of derived fields.
export async function listLeads(firmId, { stage, limit = 200 } = {}) {
  const params = [firmId];
  let where = `firm_id = $1`;
  if (stage) { params.push(stage); where += ` AND stage = $${params.length}`; }
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT * FROM people WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}

// The analytics numbers for the dashboard's ROI panel.
export async function getAnalytics(firmId) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*)::int AS total_leads,
       COUNT(*) FILTER (WHERE qualification = 'qualified')::int AS qualified,
       COUNT(*) FILTER (WHERE qualification = 'spam')::int AS spam,
       COUNT(*) FILTER (WHERE qualification = 'poor_fit')::int AS poor_fit,
       COUNT(*) FILTER (WHERE booking_at IS NOT NULL)::int AS meetings_booked,
       COUNT(*) FILTER (WHERE handoff_needed)::int AS handoffs,
       COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM first_seen_at) >= 18
                          OR EXTRACT(HOUR FROM first_seen_at) < 8)::int AS after_hours,
       COUNT(*) FILTER (WHERE channel = 'web')::int AS ch_web,
       COUNT(*) FILTER (WHERE channel = 'whatsapp')::int AS ch_whatsapp,
       COUNT(*) FILTER (WHERE channel = 'email')::int AS ch_email,
       COUNT(*) FILTER (WHERE channel = 'phone')::int AS ch_phone,
       COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (first_reply_at - first_seen_at)))
                 FILTER (WHERE first_reply_at IS NOT NULL))::int, 0) AS avg_response_seconds,
       COALESCE(SUM((fields->>'loan_amount')::numeric)
                 FILTER (WHERE qualification = 'qualified'
                   AND fields->>'loan_amount' ~ '^[0-9]+(\\.[0-9]+)?$'), 0) AS qualified_loan_value
     FROM people WHERE firm_id = $1`,
    [firmId]
  );
  const a = rows[0];

  // 7-day trend: leads per day for the last 7 days (oldest first)
  const { rows: trend } = await pool.query(
    `SELECT to_char(d.day, 'Dy') AS label, COALESCE(c.n, 0)::int AS n
     FROM generate_series(current_date - interval '6 days', current_date, interval '1 day') AS d(day)
     LEFT JOIN (
       SELECT date_trunc('day', created_at) AS day, COUNT(*) AS n
       FROM people WHERE firm_id = $1 AND created_at > current_date - interval '7 days'
       GROUP BY 1
     ) c ON c.day = d.day
     ORDER BY d.day ASC`,
    [firmId]
  );
  a.trend = trend;

  // derived rates
  a.qualify_rate = a.total_leads ? Math.round((a.qualified / a.total_leads) * 100) : 0;
  a.book_rate = a.qualified ? Math.round((a.meetings_booked / a.qualified) * 100) : 0;
  return a;
}

export async function closePool() { await pool.end(); }

// ---- Booking engine --------------------------------------------------------

// Generate the next N available appointment slots for a firm.
// Business hours, weekdays only, on the hour, skipping already-booked slots
// and anything less than ~2 hours away. Self-contained (no external calendar);
// real Google/Outlook sync attaches at client onboarding.
export async function getAvailableSlots(firmId, { count = 6, hours = [10, 12, 14, 16] } = {}) {
  // pull already-booked slot times so we can exclude them
  const { rows: taken } = await pool.query(
    `SELECT slot_at FROM bookings WHERE firm_id = $1 AND status = 'confirmed' AND slot_at > now()`,
    [firmId]
  );
  const takenSet = new Set(taken.map((r) => new Date(r.slot_at).getTime()));

  const slots = [];
  const now = new Date();
  const earliest = now.getTime() + 2 * 3600 * 1000; // at least 2h from now
  let day = new Date(now);
  day.setHours(0, 0, 0, 0);

  for (let d = 0; d < 14 && slots.length < count; d++) {
    day.setDate(day.getDate() + (d === 0 ? 0 : 1));
    const dow = day.getDay();
    if (dow === 0 || dow === 6) continue; // skip weekends
    for (const h of hours) {
      if (slots.length >= count) break;
      const slot = new Date(day);
      slot.setHours(h, 0, 0, 0);
      if (slot.getTime() < earliest) continue;
      if (takenSet.has(slot.getTime())) continue;
      slots.push(slot.toISOString());
    }
  }
  return slots;
}

// Book a slot for a person, atomically (the UNIQUE constraint prevents
// double-booking). Returns { ok, booking } or { ok:false, reason }.
export async function bookSlot(firmId, personId, slotAt, slotType = 'consultation') {
  try {
    const { rows } = await pool.query(
      `INSERT INTO bookings (firm_id, person_id, slot_at, slot_type)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (firm_id, slot_at) DO NOTHING
       RETURNING *`,
      [firmId, personId, slotAt, slotType]
    );
    if (rows.length === 0) return { ok: false, reason: 'slot_taken' };
    // reflect on the person + advance stage
    await pool.query(
      `UPDATE people SET booking_at = $2, booking_type = $3,
         stage = CASE WHEN stage IN ('new','qualified') THEN 'booked' ELSE stage END,
         updated_at = now()
       WHERE id = $1`,
      [personId, slotAt, slotType]
    );
    return { ok: true, booking: rows[0] };
  } catch (err) {
    console.error('bookSlot failed:', err.message || err);
    return { ok: false, reason: 'error' };
  }
}

export async function getUpcomingBookings(firmId) {
  const { rows } = await pool.query(
    `SELECT b.*, p.name, p.contact FROM bookings b
     LEFT JOIN people p ON p.id = b.person_id
     WHERE b.firm_id = $1 AND b.status = 'confirmed' AND b.slot_at > now()
     ORDER BY b.slot_at ASC`,
    [firmId]
  );
  return rows;
}

// ---- Phase 4: follow-up nudge ---------------------------------------------
// Qualified leads who gave a contact, never booked, and have been quiet for a
// while get exactly ONE gentle nudge. (Sustained nurture is Tool 3's job.)
export async function getLeadsNeedingNudge(firmId, { quietMinutes = 30, maxAgeHours = 48 } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM people
     WHERE firm_id = $1
       AND qualification = 'qualified'
       AND booking_at IS NULL
       AND stage NOT IN ('handed_off','won','lost')
       AND contact <> ''
       AND (fields->>'nudged') IS NULL
       AND updated_at < now() - ($2 || ' minutes')::interval
       AND created_at > now() - ($3 || ' hours')::interval`,
    [firmId, String(quietMinutes), String(maxAgeHours)]
  );
  return rows;
}

// Mark a person as nudged (so they never get a second one).
export async function markNudged(id) {
  await pool.query(
    `UPDATE people SET fields = jsonb_set(COALESCE(fields,'{}'::jsonb), '{nudged}', to_jsonb(now()::text)), updated_at = now() WHERE id = $1`,
    [id]
  );
}

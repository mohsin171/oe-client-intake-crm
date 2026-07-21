-- ============================================================================
-- ORCA EDGE — SHARED DATABASE SPINE
-- ----------------------------------------------------------------------------
-- This schema is the single source of truth for the WHOLE four-tool suite,
-- not just Tool 1. One person = one row in `people`, carried through their
-- entire journey: captured (Tool 1) -> scored (Tool 3) -> documents (Tool 2)
-- -> client communication (Tool 4).
--
-- Tool 1 writes and reads the lead/intake parts now. The columns the later
-- tools need already exist (left null for now) so Tools 2, 3, and 4 snap on
-- with zero rework. That foresight is the entire point of the "spine".
-- ============================================================================

-- Every firm we run this for. One row per client (one-clone-per-client model,
-- but multi-tenant-ready so a single deployment could serve several).
CREATE TABLE IF NOT EXISTS firms (
  id            TEXT PRIMARY KEY,              -- e.g. 'ashworth-crane' or 'demo-mortgage'
  name          TEXT NOT NULL,
  vertical      TEXT NOT NULL,                 -- 'mortgage' | 'law' | 'financial' | 'tax'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- THE SPINE. One row per human, spanning the entire lifecycle across all tools.
CREATE TABLE IF NOT EXISTS people (
  id                   TEXT PRIMARY KEY,        -- stable ID that follows them through all 4 tools
  firm_id              TEXT NOT NULL REFERENCES firms(id),

  -- Identity (filled by Tool 1 intake)
  name                 TEXT NOT NULL DEFAULT '',
  contact              TEXT NOT NULL DEFAULT '', -- phone or email
  email                TEXT NOT NULL DEFAULT '',
  phone                TEXT NOT NULL DEFAULT '',

  -- The enquiry (Tool 1)
  matter               TEXT NOT NULL DEFAULT '', -- short summary of what they need
  channel              TEXT NOT NULL DEFAULT 'web', -- web | whatsapp | email | phone
  source               TEXT NOT NULL DEFAULT '', -- campaign / referrer if known
  urgency              TEXT NOT NULL DEFAULT 'unknown', -- high | medium | low | unknown

  -- Qualification (Tool 1)
  qualification        TEXT NOT NULL DEFAULT 'unclear', -- qualified | poor_fit | spam | unclear
  qualification_reason TEXT NOT NULL DEFAULT '',

  -- Vertical-specific captured fields live in flexible JSON so each vertical
  -- (mortgage: loan_purpose/amount/property_value/timeline/buyer_type;
  --  law: matter_type/value; tax: return_type/deadline; etc.) fits one column.
  fields               JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- THE JOURNEY. One stage column the whole suite advances.
  --   new -> qualified -> scored -> booked -> handed_off -> won ->
  --   in_delivery -> complete -> retained -> lost
  stage                TEXT NOT NULL DEFAULT 'new',

  -- Tool 3 (Lead scoring & pipeline) — present now, filled later.
  score                INTEGER,                 -- 0..100
  score_reason         TEXT,
  pipeline_value       NUMERIC,                 -- weighted expected value

  -- Tool 2 (Documents) — present now, filled later.
  document_status      TEXT,                    -- e.g. drafting | awaiting_signoff | sent

  -- Tool 4 (Client communication) — present now, filled later.
  comms_status         TEXT,                    -- e.g. last_update_sent | awaiting_reply

  -- Handoff (Tool 1)
  handoff_needed       BOOLEAN NOT NULL DEFAULT false,
  handoff_trigger      TEXT,                    -- sensitive | high_value | low_confidence | none
  handoff_summary      TEXT,
  agent_takeover       BOOLEAN NOT NULL DEFAULT false, -- a human replied; AI stands down

  -- Booking (Tool 1)
  booking_at           TIMESTAMPTZ,             -- the booked meeting time, if any
  booking_type         TEXT,                    -- e.g. 'fact-find call'

  -- Timing (for the response-time hero metric)
  first_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_reply_at       TIMESTAMPTZ,             -- when the AI first responded
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_people_firm       ON people(firm_id);
CREATE INDEX IF NOT EXISTS idx_people_stage      ON people(firm_id, stage);
CREATE INDEX IF NOT EXISTS idx_people_created    ON people(firm_id, created_at DESC);

-- Every message in every conversation, any channel. Tool 1 writes these; the
-- dashboard reads them to show the full conversation behind a lead.
CREATE TABLE IF NOT EXISTS messages (
  id            BIGSERIAL PRIMARY KEY,
  person_id     TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  firm_id       TEXT NOT NULL REFERENCES firms(id),
  role          TEXT NOT NULL,                 -- 'user' | 'assistant'
  channel       TEXT NOT NULL DEFAULT 'web',
  content       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_person ON messages(person_id, created_at);

-- The audit trail: who/what/when, and what the AI decided. Compliance-minded
-- law and finance firms expect this; it also powers "what happened" on a lead.
CREATE TABLE IF NOT EXISTS events (
  id            BIGSERIAL PRIMARY KEY,
  firm_id       TEXT NOT NULL REFERENCES firms(id),
  person_id     TEXT REFERENCES people(id) ON DELETE SET NULL,
  type          TEXT NOT NULL,                 -- lead_captured | qualified | booked | handoff | notify_sent | stage_changed | ...
  detail        TEXT NOT NULL DEFAULT '',
  actor         TEXT NOT NULL DEFAULT 'ai',    -- 'ai' | 'system' | a human's name
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_firm   ON events(firm_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_person ON events(person_id, created_at);

-- Confirmed appointment bookings. One row per booked slot, so the same slot
-- can't be double-booked. Tool 1 books a fact-find call here; the dashboard
-- reads it. Real calendar sync (Google/Outlook) attaches at client onboarding.
CREATE TABLE IF NOT EXISTS bookings (
  id            BIGSERIAL PRIMARY KEY,
  firm_id       TEXT NOT NULL REFERENCES firms(id),
  person_id     TEXT REFERENCES people(id) ON DELETE SET NULL,
  slot_at       TIMESTAMPTZ NOT NULL,
  slot_type     TEXT NOT NULL DEFAULT 'consultation',
  status        TEXT NOT NULL DEFAULT 'confirmed',  -- confirmed | cancelled
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (firm_id, slot_at)
);

CREATE INDEX IF NOT EXISTS idx_bookings_firm ON bookings(firm_id, slot_at);

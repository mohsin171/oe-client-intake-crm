import { useEffect, useState, useCallback, useRef } from 'react'

// ============================================================================
// TOOL 1 - OPERATIONS DASHBOARD (the command center)
// The firm logs in here and sees its whole intake operation in one screen:
// live analytics, the pipeline, and every lead's full conversation + the AI's
// qualification reasoning. Auto-refreshes so new leads appear on their own.
// ============================================================================

const STAGES = [
  { key: 'new', label: 'New' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'booked', label: 'Booked' },
  { key: 'handed_off', label: 'Needs a human' },
  { key: 'won', label: 'Won' },
]

const REFRESH_MS = 8000 // "live" feel: poll every 8s

// Safely parse a loan/property amount that may arrive as "220000", "220,000",
// "£220k", etc. Returns a number or null (so we never render "£NaN").
function money(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number') return isFinite(v) ? v : null
  let s = String(v).toLowerCase().replace(/[£$,\s]/g, '')
  let mult = 1
  if (s.endsWith('k')) { mult = 1e3; s = s.slice(0, -1) }
  else if (s.endsWith('m')) { mult = 1e6; s = s.slice(0, -1) }
  const n = parseFloat(s)
  return isFinite(n) ? Math.round(n * mult) : null
}
function fmtGBP(v) {
  const n = money(v)
  return n == null ? null : '£' + n.toLocaleString()
}

export default function Dashboard() {
  const [firm, setFirm] = useState('')
  const [leads, setLeads] = useState([])
  const [stats, setStats] = useState(null)
  const [bookings, setBookings] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const prevCount = useRef(0)
  const [flash, setFlash] = useState(false)

  const load = useCallback(async () => {
    try {
      const [l, a, bk] = await Promise.all([
        fetch('/api/leads').then((r) => r.json()),
        fetch('/api/analytics').then((r) => r.json()),
        fetch('/api/bookings').then((r) => r.json()),
      ])
      const newLeads = l.leads || []
      if (prevCount.current && newLeads.length > prevCount.current) {
        setFlash(true)
        setTimeout(() => setFlash(false), 2000)
      }
      prevCount.current = newLeads.length
      setLeads(newLeads)
      setFirm(l.firm?.name || '')
      setStats(a)
      setBookings(bk.bookings || [])
      setLastUpdated(new Date())
    } catch (e) {
      /* keep last good data on transient error */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, REFRESH_MS)
    return () => clearInterval(t)
  }, [load])

  const needsAttention = leads.filter((l) => l.handoff_needed && l.stage === 'handed_off')
  const stageCounts = STAGES.reduce((acc, s) => { acc[s.key] = leads.filter((l) => l.stage === s.key).length; return acc }, {})

  return (
    <div className="shell">
      <Sidebar firm={firm} stageCounts={stageCounts} needsAttention={needsAttention.length} total={leads.length} />
      <div className="workspace">
        <TopNav lastUpdated={lastUpdated} flash={flash} />
        <main className="main">
          {stats && <Stats stats={stats} />}
          {needsAttention.length > 0 && (
            <div className="attention">
              <span className="attention-dot" />
              {needsAttention.length} lead{needsAttention.length > 1 ? 's' : ''} need{needsAttention.length > 1 ? '' : 's'} a human, listed under "Needs a human" below.
            </div>
          )}
          {bookings.length > 0 && <Appointments bookings={bookings} />}
          <Pipeline leads={leads} loading={loading} selectedId={selectedId} onSelect={setSelectedId} />
        </main>
        {selectedId && <LeadPanel id={selectedId} onClose={() => setSelectedId(null)} />}
      </div>
    </div>
  )
}

function Sidebar({ firm, stageCounts, needsAttention, total }) {
  const items = [
    { key: 'new', label: 'New', dot: 'new' },
    { key: 'qualified', label: 'Qualified', dot: 'qualified' },
    { key: 'booked', label: 'Booked', dot: 'booked' },
    { key: 'handed_off', label: 'Needs a human', dot: 'handed_off' },
    { key: 'won', label: 'Won', dot: 'won' },
  ]
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">◆</div>
        <div className="brand-text">
          <div className="brand-name">{firm || 'Rivergate'}</div>
          <div className="brand-sub">Intake OS</div>
        </div>
      </div>

      <div className="side-section">
        <div className="side-label">Pipeline</div>
        {items.map((it) => (
          <div key={it.key} className="side-item">
            <span className={'side-dot ' + it.dot} />
            <span className="side-item-label">{it.label}</span>
            <span className="side-count">{stageCounts[it.key] || 0}</span>
          </div>
        ))}
      </div>

      <div className="side-section">
        <div className="side-label">At a glance</div>
        <div className="side-item"><span className="side-item-label">Total leads</span><span className="side-count">{total}</span></div>
        {needsAttention > 0 && (
          <div className="side-item attention-item"><span className="side-item-label">Needs a human</span><span className="side-count urgent">{needsAttention}</span></div>
        )}
      </div>

      <div className="side-foot">Powered by Orca Edge</div>
    </aside>
  )
}

function TopNav({ lastUpdated, flash }) {
  return (
    <header className="topnav">
      <div className="topnav-tabs">
        <span className="tab active">Overview</span>
        <span className="tab">Pipeline</span>
        <span className="tab">Appointments</span>
        <span className="tab">Analytics</span>
      </div>
      <div className={'live-badge' + (flash ? ' flash' : '')}>
        <span className="live-dot" />
        Live{lastUpdated && <span className="updated"> · {timeAgo(lastUpdated)}</span>}
      </div>
    </header>
  )
}

function Stats({ stats }) {
  const rt = stats.avg_response_seconds
  const rtLabel = rt === 0 ? '—' : rt < 60 ? `${rt}s` : `${Math.round(rt / 60)}m`
  const pipelineValue = Number(stats.qualified_loan_value || 0)
  const fmtMoney = (n) => n >= 1e6 ? `£${(n / 1e6).toFixed(1)}m` : n >= 1e3 ? `£${Math.round(n / 1e3)}k` : `£${n}`

  return (
    <>
      <section className="stats">
        <div className="stat hero">
          <div className="stat-value">{rtLabel}</div>
          <div className="stat-label">Avg response time</div>
          <div className="stat-note">vs hours by hand</div>
        </div>
        <div className="stat">
          <div className="stat-value">{stats.total_leads}</div>
          <div className="stat-label">Leads captured</div>
        </div>
        <div className="stat">
          <div className="stat-value">{stats.qualified}</div>
          <div className="stat-label">Qualified</div>
          {stats.total_leads > 0 && <div className="stat-note">{stats.qualify_rate}% of all leads</div>}
        </div>
        <div className="stat">
          <div className="stat-value">{stats.after_hours}</div>
          <div className="stat-label">After hours</div>
          <div className="stat-note">would've been missed</div>
        </div>
        <div className="stat value">
          <div className="stat-value">{fmtMoney(pipelineValue)}</div>
          <div className="stat-label">Qualified pipeline</div>
          <div className="stat-note">illustrative, from loan sizes</div>
        </div>
      </section>

      <div className="analytics-row">
        <Funnel stats={stats} />
        <Channels stats={stats} />
        <Trend trend={stats.trend || []} />
      </div>
    </>
  )
}

function Funnel({ stats }) {
  const total = stats.total_leads || 0
  const steps = [
    { label: 'Captured', n: total, pct: 100 },
    { label: 'Qualified', n: stats.qualified, pct: total ? Math.round((stats.qualified / total) * 100) : 0 },
    { label: 'Booked', n: stats.meetings_booked, pct: total ? Math.round((stats.meetings_booked / total) * 100) : 0 },
  ]
  return (
    <div className="panel-box">
      <h3 className="box-title">Conversion funnel</h3>
      <div className="funnel">
        {steps.map((s) => (
          <div key={s.label} className="funnel-row">
            <div className="funnel-head"><span>{s.label}</span><strong>{s.n}</strong></div>
            <div className="funnel-bar"><div className="funnel-fill" style={{ width: Math.max(s.pct, 3) + '%' }} /></div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Channels({ stats }) {
  const rows = [
    { label: 'Website', n: stats.ch_web || 0, cls: 'web' },
    { label: 'WhatsApp', n: stats.ch_whatsapp || 0, cls: 'whatsapp' },
    { label: 'Email', n: stats.ch_email || 0, cls: 'email' },
    { label: 'Phone', n: stats.ch_phone || 0, cls: 'phone' },
  ].filter((r) => r.n > 0)
  const max = Math.max(1, ...rows.map((r) => r.n))
  return (
    <div className="panel-box">
      <h3 className="box-title">Leads by channel</h3>
      {rows.length === 0 && <p className="box-empty">No leads yet.</p>}
      <div className="channels">
        {rows.map((r) => (
          <div key={r.label} className="chan-row">
            <span className="chan-label">{r.label}</span>
            <div className="chan-bar"><div className={'chan-fill ' + r.cls} style={{ width: (r.n / max) * 100 + '%' }} /></div>
            <span className="chan-n">{r.n}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Trend({ trend }) {
  const max = Math.max(1, ...trend.map((d) => d.n))
  return (
    <div className="panel-box">
      <h3 className="box-title">Last 7 days</h3>
      <div className="trend">
        {trend.map((d, i) => (
          <div key={i} className="trend-col">
            <div className="trend-bar-wrap"><div className="trend-bar" style={{ height: Math.max((d.n / max) * 100, 4) + '%' }} title={d.n + ' leads'} /></div>
            <div className="trend-label">{d.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Appointments({ bookings }) {
  return (
    <section className="appts">
      <div className="appts-head">
        <span className="appts-icon">📅</span>
        Upcoming appointments
        <span className="count">{bookings.length}</span>
      </div>
      <div className="appts-list">
        {bookings.map((b) => {
          const d = new Date(b.slot_at)
          return (
            <div key={b.id} className="appt">
              <div className="appt-when">
                <div className="appt-day">{d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
                <div className="appt-time">{d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })}</div>
              </div>
              <div className="appt-who">
                <strong>{b.name || 'Unknown'}</strong>
                <span>{b.slot_type}{b.contact ? ' · ' + b.contact : ''}</span>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function Pipeline({ leads, loading, selectedId, onSelect }) {
  if (loading && leads.length === 0) return <div className="pipeline-empty">Loading your pipeline…</div>
  if (leads.length === 0) {
    return (
      <div className="pipeline-empty">
        <strong>No leads yet.</strong> Your intake is live and watching, 24/7.
      </div>
    )
  }
  return (
    <div className="pipeline">
      {STAGES.map((stage) => {
        const inStage = leads.filter((l) => l.stage === stage.key)
        if (inStage.length === 0) return null
        return (
          <div key={stage.key} className="column">
            <div className="column-head">
              <span className={'stage-dot ' + stage.key} />
              {stage.label}
              <span className="count">{inStage.length}</span>
            </div>
            {inStage.map((l) => (
              <LeadCard key={l.id} lead={l} selected={l.id === selectedId} onClick={() => onSelect(l.id)} />
            ))}
          </div>
        )
      })}
    </div>
  )
}

function LeadCard({ lead, selected, onClick }) {
  const f = lead.fields || {}
  return (
    <button className={'card' + (selected ? ' selected' : '')} onClick={onClick}>
      <div className="card-top">
        <strong>{lead.name || 'Unknown visitor'}</strong>
        <QualBadge q={lead.qualification} />
      </div>
      <div className="card-matter">{lead.matter || 'No matter captured yet'}</div>
      {f.loan_purpose && (
        <div className="card-fields">
          <span className="chip">{f.loan_purpose}</span>
          {fmtGBP(f.loan_amount) && <span className="chip">{fmtGBP(f.loan_amount)}</span>}
          {f.buyer_type && <span className="chip">{f.buyer_type}</span>}
        </div>
      )}
      <div className="card-meta">
        <span className={'channel ' + lead.channel}>{lead.channel}</span>
        {lead.urgency !== 'unknown' && <span className={'urgency ' + lead.urgency}>{lead.urgency}</span>}
        <span className="ago">{timeAgo(new Date(lead.created_at))}</span>
      </div>
    </button>
  )
}

function QualBadge({ q }) {
  const label = { qualified: 'Qualified', poor_fit: 'Poor fit', spam: 'Spam', unclear: 'Unclear' }[q] || q
  return <span className={'badge ' + q}>{label}</span>
}

function LeadPanel({ id, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/leads?id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <aside className="panel"><div className="panel-loading">Loading…</div></aside>
  if (!data || data.error) return <aside className="panel"><div className="panel-loading">Not found.</div></aside>

  const p = data.person
  const f = p.fields || {}

  return (
    <aside className="panel">
      <div className="panel-head">
        <div>
          <h2>{p.name || 'Unknown visitor'}</h2>
          <QualBadge q={p.qualification} />
        </div>
        <button className="close" onClick={onClose}>✕</button>
      </div>

      {p.handoff_needed && (
        <div className="panel-handoff">
          <strong>Needs a human</strong> · {p.handoff_trigger?.replace('_', ' ')}
          <div>{p.handoff_summary}</div>
        </div>
      )}

      <div className="panel-section">
        <h3>Contact</h3>
        <div className="kv"><span>Name</span><span>{p.name || '—'}</span></div>
        <div className="kv"><span>Contact</span><span>{p.contact || '—'}</span></div>
        <div className="kv"><span>Channel</span><span>{p.channel}</span></div>
        <div className="kv"><span>Source</span><span>{p.source || '—'}</span></div>
      </div>

      {(f.loan_purpose || f.loan_amount) && (
        <div className="panel-section">
          <h3>Mortgage details captured</h3>
          {f.loan_purpose && <div className="kv"><span>Purpose</span><span>{f.loan_purpose}</span></div>}
          {fmtGBP(f.loan_amount) && <div className="kv"><span>Loan amount</span><span>{fmtGBP(f.loan_amount)}</span></div>}
          {fmtGBP(f.property_value) && <div className="kv"><span>Property value</span><span>{fmtGBP(f.property_value)}</span></div>}
          {f.timeline && <div className="kv"><span>Timeline</span><span>{f.timeline}</span></div>}
          {f.buyer_type && <div className="kv"><span>Buyer type</span><span>{f.buyer_type}</span></div>}
        </div>
      )}

      <div className="panel-section reasoning">
        <h3>Why the AI judged this "{p.qualification}"</h3>
        <p>{p.qualification_reason || '—'}</p>
      </div>

      {p.booking_at && (
        <div className="panel-section">
          <h3>Booking</h3>
          <div className="kv"><span>{p.booking_type || 'Meeting'}</span><span>{new Date(p.booking_at).toLocaleString()}</span></div>
        </div>
      )}

      <div className="panel-section">
        <h3>Conversation</h3>
        <div className="convo">
          {data.messages.length === 0 && <p className="muted">No messages recorded.</p>}
          {data.messages.map((m, i) => (
            <div key={i} className={'msg ' + m.role}>
              <div className="msg-role">{m.role === 'user' ? 'Visitor' : 'AI receptionist'}</div>
              <div className="msg-content">{m.content}</div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}

function timeAgo(date) {
  const s = Math.floor((Date.now() - date.getTime()) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

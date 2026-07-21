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

export default function Dashboard() {
  const [firm, setFirm] = useState('')
  const [leads, setLeads] = useState([])
  const [stats, setStats] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const prevCount = useRef(0)
  const [flash, setFlash] = useState(false)

  const load = useCallback(async () => {
    try {
      const [l, a] = await Promise.all([
        fetch('/api/leads').then((r) => r.json()),
        fetch('/api/analytics').then((r) => r.json()),
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

  return (
    <div className="app">
      <Header firm={firm} lastUpdated={lastUpdated} flash={flash} />
      <div className="body">
        <main className="main">
          {stats && <Stats stats={stats} />}
          {needsAttention.length > 0 && (
            <div className="attention">
              <span className="attention-dot" />
              {needsAttention.length} lead{needsAttention.length > 1 ? 's' : ''} need{needsAttention.length > 1 ? '' : 's'} a human. See "Needs a human" below.
            </div>
          )}
          <Pipeline leads={leads} loading={loading} selectedId={selectedId} onSelect={setSelectedId} />
        </main>
        {selectedId && <LeadPanel id={selectedId} onClose={() => setSelectedId(null)} />}
      </div>
    </div>
  )
}

function Header({ firm, lastUpdated, flash }) {
  return (
    <header className="header">
      <div>
        <h1>{firm || 'Intake'} <span className="header-sub">Operations</span></h1>
        <p className="tagline">Your live intake command center</p>
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
  return (
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
      </div>
      <div className="stat">
        <div className="stat-value">{stats.after_hours}</div>
        <div className="stat-label">After hours</div>
        <div className="stat-note">would've been missed</div>
      </div>
      <div className="stat">
        <div className="stat-value">{stats.meetings_booked}</div>
        <div className="stat-label">Meetings booked</div>
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
          {f.loan_amount && <span className="chip">£{Number(f.loan_amount).toLocaleString()}</span>}
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
          {f.loan_amount && <div className="kv"><span>Loan amount</span><span>£{Number(f.loan_amount).toLocaleString()}</span></div>}
          {f.property_value && <div className="kv"><span>Property value</span><span>£{Number(f.property_value).toLocaleString()}</span></div>}
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

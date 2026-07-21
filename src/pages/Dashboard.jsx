import { useEffect, useState } from 'react'

// Step 2 placeholder: a minimal but LIVE dashboard that reads the real API
// (leads + analytics from the database spine). The full command-center UI
// (real-time updates, lead detail, conversation view, pipeline stages) is the
// next build step. This proves the frontend-to-spine wiring works.
export default function Dashboard() {
  const [leads, setLeads] = useState([])
  const [stats, setStats] = useState(null)
  const [firm, setFirm] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/leads').then((r) => r.json()),
      fetch('/api/analytics').then((r) => r.json()),
    ])
      .then(([l, a]) => {
        setLeads(l.leads || [])
        setFirm(l.firm?.name || '')
        setStats(a)
      })
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="wrap">
      <header>
        <h1>{firm || 'Intake'} - Operations</h1>
        <p className="sub">Live command center - reading from the shared database spine</p>
      </header>

      {loading && <p>Loading...</p>}

      {stats && (
        <section className="stats">
          <Stat label="Avg response" value={stats.avg_response_seconds + 's'} hero />
          <Stat label="Total leads" value={stats.total_leads} />
          <Stat label="Qualified" value={stats.qualified} />
          <Stat label="After hours" value={stats.after_hours} />
          <Stat label="Meetings booked" value={stats.meetings_booked} />
        </section>
      )}

      <section>
        <h2>Pipeline</h2>
        {leads.length === 0 && !loading && (
          <p className="empty">No leads yet. Your intake is live and watching.</p>
        )}
        <div className="leads">
          {leads.map((l) => (
            <div key={l.id} className="lead">
              <div className="lead-top">
                <strong>{l.name || 'Unknown visitor'}</strong>
                <span className={'badge ' + l.qualification}>{l.qualification}</span>
              </div>
              <div className="lead-matter">{l.matter || '(no matter yet)'}</div>
              <div className="lead-meta">
                <span>{l.channel}</span>
                <span>stage: {l.stage}</span>
                {l.contact && <span>{l.contact}</span>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function Stat({ label, value, hero }) {
  return (
    <div className={'stat' + (hero ? ' hero' : '')}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

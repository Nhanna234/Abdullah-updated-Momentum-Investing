import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity, ArrowDownToLine, ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3,
  BriefcaseBusiness, CalendarDays, ChevronDown, CircleHelp, Database, FileSpreadsheet,
  Layers3, LineChart, Menu, Play, Settings2, TrendingUp, Upload, X,
} from 'lucide-react'
import { CartesianGrid, Line, LineChart as Chart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import './style.css'
import { streamlitRequest } from './streamlit.js'

const INDEXES = ['Nifty 50', 'Nifty 100', 'Nifty LargeMidcap 250', 'Nifty Smallcap 250', 'Nifty 500',
  'Nifty Microcap 250', 'Nifty Total Market', 'Quality Stocks']
const PARAMS = { lookback: 10, skip: 2, top_n: 10, threshold: 20, ema_span: 12, f1: true,
  f2: false, max_ext: .4, f3: true, min_cr: .5, low_cr_action: 'pending', exit_ema: true,
  exit_sl: false, sl_pct: .2, exit_ts: false, ts_pct: .25, capital: 1000000, cash_ret: 0 }
const PALETTE = { Strategy: '#087d61', 'Nifty 50': '#8d9d96', 'Nifty 500': '#c49549', 'Equal-weight universe': '#788ab8' }
const DEMO_SERIES = [100, 102, 98, 105, 110, 109, 117, 114, 124, 128, 123, 134, 139, 136, 143, 151, 147, 155, 159, 153, 166, 172, 178]
const DEMO_GROWTH = DEMO_SERIES.map((value, i) => ({
  Month: new Date(Date.UTC(2024, 11 + i, 1)).toISOString().slice(0, 7),
  Strategy: value,
  'Nifty 50': [100, 101, 99, 103, 106, 104, 107, 109, 110, 111, 109, 113, 118, 116, 119, 121, 118, 123, 124, 125, 129, 128, 131][i],
  'Nifty 500': [100, 103, 101, 105, 108, 107, 112, 110, 113, 115, 112, 117, 120, 119, 124, 126, 123, 128, 130, 128, 134, 137, 139][i],
}))
const DEMO = {
  growth: DEMO_GROWTH,
  drawdown: DEMO_GROWTH.map((r, i) => ({ Month: r.Month, ...Object.fromEntries(
    Object.keys(PALETTE).filter(key => key in r).map(key => [key, r[key] / Math.max(...DEMO_GROWTH.slice(0, i + 1).map(p => p[key])) - 1]),
  ) })),
  metrics: [{ Metric: 'Total return', Strategy: .78, 'Nifty 50': .31, 'Nifty 500': .39 },
    { Metric: 'CAGR', Strategy: .3702, 'Nifty 50': .1587, 'Nifty 500': .1967 },
    { Metric: 'Max drawdown', Strategy: -.0394, 'Nifty 50': -.0248, 'Nifty 500': -.0261 }],
}
const pct = (n, signed = false) => Number.isFinite(n) ? (signed && n > 0 ? '+' : '') + (n * 100).toFixed(1) + '%' : '—'
const num = (n, digits = 2) => Number.isFinite(n) ? n.toLocaleString('en-IN', { maximumFractionDigits: digits }) : '—'
const inr = n => Number.isFinite(n) ? '₹' + num(n, 0) : '—'
const month = value => value ? new Date(value + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—'
const isPercent = /return|drawdown|volatility|cash|exposure|expectancy|extension|weight|win rate|avg win|avg loss|positive months|months beating|alpha/i
const format = (value, key) => value == null ? '—' : typeof value === 'number' ? (key === 'Cash' ? inr(value) : isPercent.test(key) ? pct(value) : num(value)) : String(value).replace(/T00:00:00\.000$/, '')

async function request(path, body, signal) {
  if (streamlitRequest) return streamlitRequest(path, body, signal)
  const response = await fetch('/api/' + path, { signal, ...(body && {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'The request failed.')
  return data
}

function Field({ label, children, wide = false }) {
  return <label className={wide ? 'field wide' : 'field'}><span>{label}</span>{children}</label>
}
function Select({ value, onChange, children }) {
  return <span className="select"><select value={value} onChange={e => onChange(e.target.value)}>{children}</select><ChevronDown size={14}/></span>
}
function Table({ rows, columns }) {
  if (!rows?.length) return <div className="empty">No rows to display.</div>
  const keys = columns || Object.keys(rows[0])
  return <div className="table-scroll"><table><thead><tr>{keys.map(key => <th key={key}>{key}</th>)}</tr></thead>
    <tbody>{rows.map((row, i) => <tr key={i}>{keys.map(key => <td key={key}>{format(row[key], key === 'Metric' ? key : row.Metric || key)}</td>)}</tr>)}</tbody>
  </table></div>
}
function Card({ icon: Icon, label, value, note, tone = '' }) {
  return <article className="metric"><div className="metric-top"><span>{label}</span><div className={'metric-icon ' + tone}><Icon size={17}/></div></div>
    <strong>{value}</strong><small>{note || ' '}</small></article>
}
function Panel({ title, hint, children }) {
  return <section className="panel"><div className="panel-head"><div><h2>{title}</h2>{hint && <p>{hint}</p>}</div></div>{children}</section>
}

function PerformanceChart({ report, demo }) {
  const [kind, setKind] = useState('growth')
  const [hidden, setHidden] = useState([])
  const rows = report[kind] || []
  const keys = Object.keys(PALETTE).filter(key => key in (rows[0] || {}))
  const label = kind === 'growth' ? 'Growth of ₹100' : 'Drawdown'
  return <section className="panel chart-panel">
    <div className="panel-head"><div><h2>{label}</h2><p>{demo ? 'Illustrative data · run a backtest to see your results' : 'Month-end portfolio performance and benchmarks'}</p></div>
      <div className="segmented">{['growth', 'drawdown'].map(key => <button type="button" key={key} className={kind === key ? 'active' : ''} onClick={() => setKind(key)}>{key === 'growth' ? 'Growth' : 'Drawdown'}</button>)}</div></div>
    <div className="legend">{keys.map(key => <button type="button" key={key} aria-pressed={!hidden.includes(key)} className={hidden.includes(key) ? 'muted' : ''} onClick={() => setHidden(old => old.includes(key) ? old.filter(k => k !== key) : [...old, key])}><i style={{ background: PALETTE[key] }}/>{key}</button>)}</div>
    <div className="plot"><ResponsiveContainer width="100%" height="100%">
      <Chart data={rows} margin={{ left: -12, top: 14, right: 20, bottom: 4 }}>
        <CartesianGrid stroke="#e4ebe7" vertical={false} strokeDasharray="4 4"/>
        <XAxis dataKey="Month" tickFormatter={month} tickLine={false} axisLine={false} minTickGap={34} tick={{fill:'#677972',fontSize:11}} tickMargin={12}/>
        <YAxis tickFormatter={kind === 'drawdown' ? pct : v => '₹' + num(v, 0)} tickLine={false} axisLine={false} tick={{fill:'#677972',fontSize:11}} width={64} domain={kind === 'drawdown' ? ['auto', 0] : ['auto','auto']}/>
        <Tooltip labelFormatter={month} formatter={value => kind === 'growth' ? '₹' + num(value) : pct(value)} contentStyle={{border:'1px solid #e1e8e4',borderRadius:12}}/>
        {keys.filter(key => !hidden.includes(key)).map(key => <Line key={key} type="linear" dataKey={key} stroke={PALETTE[key]} strokeWidth={key === 'Strategy' ? 3 : 2} dot={false} activeDot={{r:4}} isAnimationActive={false}/>)}
      </Chart>
    </ResponsiveContainer></div>
  </section>
}

function Settings({ open, close, draft, update, params, setParams, config }) {
  if (!open) return null
  const number = (key, label, min, max, step = 1) => <Field label={label}><input type="number" min={min} max={max} step={step} value={params[key]} onChange={e => setParams({ ...params, [key]: +e.target.value })}/></Field>
  const toggle = (key, label) => <label className="check"><input type="checkbox" checked={params[key]} onChange={e => setParams({ ...params, [key]: e.target.checked })}/>{label}</label>
  const file = (key, label, hint) => <label className="file"><Upload size={18}/><div><strong>{draft[key + 'Name'] || label}</strong><small>{hint}</small></div>
    <input type="file" accept=".csv,text/csv" onChange={async event => {
      const selected = event.target.files[0]
      if (selected) update({ [key]: await selected.text(), [key + 'Name']: selected.name })
    }}/></label>
  return <div className="overlay" onClick={close}><aside className="drawer" role="dialog" aria-modal="true" aria-label="Strategy settings" onClick={event => event.stopPropagation()}>
    <div className="drawer-head"><div><h2>Strategy settings</h2><p>Applied the next time you run the strategy.</p></div><button type="button" className="icon-button" aria-label="Close settings" onClick={close}><X size={20}/></button></div>
    <h3>Universe & data</h3>
    {file('history','Upload constituent history','CSV with YYYY-MM-DD effective-date headers')}
    {draft.history && <button type="button" className="link-button" onClick={() => update({ history: '', historyName: '' })}>Remove history upload</button>}
    {file('constituents','Override constituent list','CSV with a Symbol column')}
    {draft.constituents && <button type="button" className="link-button" onClick={() => update({ constituents: '', constituentsName: '' })}>Remove override</button>}
    <div className="setting-grid">
      <Field label="Exclude industries" wide><input placeholder="Default: financial industries" value={draft.industriesText ?? ''} onChange={e => update({ industriesText: e.target.value })}/></Field>
      <Field label="Keep anyway (comma-separated tickers)" wide><textarea value={draft.keep ?? config.keep ?? ''} onChange={e => update({ keep: e.target.value })}/></Field>
      <Field label="Also exclude (comma-separated tickers)" wide><input value={draft.omit || ''} onChange={e => update({ omit: e.target.value })}/></Field>
    </div>
    <h3>Monthly ranking</h3><div className="setting-grid">{number('lookback','Lookback (months)',1,24)}{number('skip','Skip (months)',0,6)}{number('top_n','Max holdings',1,50)}{number('threshold','Hold-zone rank',params.top_n,200)}</div>
    <h3>Entry & exit</h3><div className="setting-grid">{number('ema_span','EMA span (months)',2,36)}{number('max_ext','Max extension (decimal)',.05,1.5,.05)}{number('min_cr','Min closing range',0,1,.05)}
      <Field label="Below min closing range"><Select value={params.low_cr_action} onChange={v => setParams({...params,low_cr_action:v})}><option value="pending">Next-month buy-stop</option><option value="skip">Skip stock</option></Select></Field>
      {toggle('f1','Require close above EMA')}{toggle('f2','Cap extension above EMA')}{toggle('f3','Use closing range filter')}{toggle('exit_ema','Exit below EMA')}
      {toggle('exit_sl','Use stop-loss')}{toggle('exit_ts','Use trailing stop')}{number('sl_pct','Stop-loss (decimal)',.05,.5,.05)}{number('ts_pct','Trailing stop (decimal)',.05,.6,.05)}
    </div>
    <h3>Portfolio & costs</h3><div className="setting-grid">{number('capital','Starting capital (₹)',10000,1e9)}
      <Field label="Trading cost per side (%)"><input type="number" value={draft.cost} min="0" max="2" step=".05" onChange={e => update({ cost: +e.target.value })}/></Field>
      <Field label="Risk-free rate (% p.a.)"><input type="number" min="0" max="12" step=".25" value={draft.rf} onChange={e => update({ rf: +e.target.value })}/></Field>
      <Field label="Idle cash return (% p.a.)"><input type="number" min="0" max="12" step=".5" value={params.cash_ret * 100} onChange={e => setParams({...params,cash_ret:+e.target.value/100})}/></Field>
      <label className="check wide"><input type="checkbox" checked={!!draft.adjusted} onChange={e => update({ adjusted: e.target.checked })}/>Use dividend-adjusted prices</label>
    </div>
    <button type="button" className="primary drawer-done" onClick={close}>Apply settings <ArrowRight size={16}/></button>
  </aside></div>
}

function App() {
  const [config, setConfig] = useState({ indices: INDEXES, latest: '2026-10' })
  const [mode, setMode] = useState('backtest')
  const [draft, setDraft] = useState({ index: 'Quality Stocks', first: '2025-01', last: '2026-10', cost: .4, rf: 6.5 })
  const [params, setParams] = useState(PARAMS)
  const [settings, setSettings] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [basis, setBasis] = useState('net')
  const [results, setResults] = useState({})
  const [loading, setLoading] = useState('')
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [section, setSection] = useState('Performance')
  const update = patch => setDraft(old => ({ ...old, ...patch }))
  useEffect(() => {
    const controller = new AbortController()
    request('config', null, controller.signal).then(data => {
      setConfig(data)
      update({ last: data.latest })
    }).catch(() => {})
    return () => controller.abort()
  }, [])
  useEffect(() => {
    const close = e => { if (e.key === 'Escape') { setSettings(false); setMobileNav(false) } }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [])

  const result = results[mode]
  const demo = !result
  const report = result?.[basis] || DEMO
  const strategyMetric = name => report.metrics.find(row => row.Metric === name)?.Strategy
  const submit = async event => {
    event.preventDefault()
    setError('')
    if (params.threshold < params.top_n) {
      setError('Hold-zone rank must be at least the maximum number of holdings.')
      setSettings(true)
      return
    }
    setLoading(mode)
    try {
      const inputs = { ...draft, mode, params, cost: draft.cost / 100, rf: draft.rf / 100,
        ...(draft.industriesText !== undefined && { industries: draft.industriesText.split(',').map(s => s.trim()).filter(Boolean) }) }
      const data = await request('run', inputs)
      setResults(old => ({ ...old, [mode]: { ...data, range: [draft.first, mode === 'backtest' ? draft.last : config.latest] } }))
      setSection('Performance')
    } catch (failure) {
      setError(failure.message)
    } finally {
      setLoading('')
    }
  }
  const download = async () => {
    setExporting(true)
    try {
      const data = await request('export', { report, decisions: result.decisions, settings: result.settings })
      const bytes = Uint8Array.from(atob(data.xlsx), character => character.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'Momentum Lab Backtest.xlsx'
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (failure) {
      setError(failure.message)
    } finally {
      setExporting(false)
    }
  }
  const switchMode = next => { setMode(next); setError(''); setMobileNav(false) }
  const renderAnalysis = () => {
    if (section === 'Trades') return <Panel title="Trade log" hint={report.trades && report.trades.length + ' entries'}><Table rows={report.trades}/></Panel>
    if (section === 'Monthly') return <Panel title="Monthly results"><Table rows={report.monthly}/></Panel>
    if (section === 'Decisions') return <Panel title="Candidate decisions"><Table rows={result?.decisions}/></Panel>
    return <Panel title="Performance comparison" hint="Strategy and benchmark returns, risk, and relative statistics"><Table rows={report.metrics}/></Panel>
  }

  return <div className="shell">
    {mobileNav && <button type="button" className="nav-shade" aria-label="Close navigation" onClick={() => setMobileNav(false)}/>}
    <aside className={'sidebar ' + (mobileNav ? 'shown' : '')}>
      <div className="brand"><div className="brand-icon"><TrendingUp size={23} strokeWidth={2.4}/></div><div><strong>Momentum Lab</strong><small>RESEARCH TERMINAL</small></div></div>
      <div className="nav-label">WORKSPACE</div>
      <nav>
        <button type="button" className={mode === 'backtest' ? 'selected' : ''} onClick={() => switchMode('backtest')}><BarChart3 size={19}/>Backtest<ArrowRight className="nav-arrow" size={15}/></button>
        <button type="button" className={mode === 'present' ? 'selected' : ''} onClick={() => switchMode('present')}><BriefcaseBusiness size={19}/>Present holdings<ArrowRight className="nav-arrow" size={15}/></button>
      </nav>
      <div className="nav-label secondary">CONFIGURATION</div>
      <nav><button type="button" onClick={() => { setSettings(true); setMobileNav(false) }}><Settings2 size={19}/>Strategy settings</button></nav>
      <div className="sidebar-foot"><div className="exchange-icon"><Activity size={17}/></div><div><strong>NSE equities</strong><small>Monthly rebalance</small></div></div>
    </aside>

    <main>
      <header className="topbar"><div className="breadcrumb"><button type="button" className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={20}/></button>
        <span>Workspace</span><span className="slash">/</span><strong>{mode === 'backtest' ? 'Backtest' : 'Present holdings'}</strong></div>
        <button type="button" className="secondary-button small" onClick={() => setSettings(true)}><Settings2 size={16}/> Settings</button></header>
      <div className="content">
        <section className="hero">
          <div className="hero-copy"><div className="hero-label"><span/> RELATIVE MOMENTUM</div>
            <h1>{mode === 'backtest' ? 'Strategy backtest' : 'Present holdings'}</h1>
            <p>{mode === 'backtest' ? 'Test monthly momentum rules against your stock universe and NSE benchmarks.' : 'Review your portfolio, current ranks, and pending orders.'}</p>
          </div>
          <div className="hero-mark" aria-hidden="true"><LineChart size={136} strokeWidth={.65}/></div>
          <div className="hero-badge"><CalendarDays size={15}/><span>Latest completed month<strong>{month(config.latest)}</strong></span></div>
        </section>

        <form className="controls" onSubmit={submit}>
          <Field label="Stock universe"><Select value={draft.index} onChange={index => update({ index })}>{config.indices.map(index => <option key={index}>{index}</option>)}</Select></Field>
          <Field label="First month held"><input aria-label="First month held" required type="month" value={draft.first} onChange={e => update({ first: e.target.value })}/></Field>
          {mode === 'backtest' && <Field label="Last month"><input aria-label="Last month" required type="month" value={draft.last} max={config.latest} onChange={e => update({ last: e.target.value })}/></Field>}
          <button className="primary run" disabled={!!loading} type="submit"><Play size={16} fill="currentColor"/>{loading === mode ? 'Running…' : mode === 'backtest' ? 'Run backtest' : 'Show holdings'}</button>
          {draft.history && <div className="attached"><FileSpreadsheet size={15}/> Constituent history · {draft.historyName}</div>}
        </form>
        {loading && <div className="notice" role="status"><Activity size={17}/> Calculating strategy results. The first data download may take a few minutes.</div>}
        {error && <div className="notice error" role="alert">{error}</div>}
        {result?.notices?.map(message => <div className="notice" key={message}><CircleHelp size={16}/>{message}</div>)}

        {mode === 'backtest' ? <>
          <div className="section-header">
            <div><h2>Performance overview</h2><p>{demo ? 'Illustrative preview' : [result.index, month(result.range[0]) + ' – ' + month(result.range[1])].join(' · ')}</p></div>
            {!demo && <div className="overview-actions">
              <div className="segmented">{['net','gross'].map(key => <button type="button" className={basis === key ? 'active' : ''} key={key} onClick={() => setBasis(key)}>{key === 'net' ? 'Net' : 'Gross'}</button>)}</div>
              <button type="button" className="secondary-button" disabled={exporting} onClick={download}><ArrowDownToLine size={16}/>{exporting ? 'Exporting…' : 'Export'}</button>
            </div>}
          </div>
          <div className="metrics">
            <Card icon={TrendingUp} label="Total return" value={pct(strategyMetric('Total return'), true)} note={demo ? 'Illustrative return' : basis === 'net' ? 'After trading costs' : 'Before trading costs'}/>
            <Card icon={ArrowUpRight} label="CAGR" value={pct(strategyMetric('CAGR'))} note="Annualized growth"/>
            <Card icon={ArrowDownRight} label="Max drawdown" value={pct(strategyMetric('Max drawdown'))} note="Peak-to-trough decline" tone="amber"/>
            <Card icon={Layers3} label={demo ? 'Nifty 50 return' : 'Trade entries'} value={demo ? '+31.0%' : num(report.trades?.length, 0)} note={demo ? 'Illustrative benchmark' : 'Over the selected period'} tone="slate"/>
          </div>
          <PerformanceChart report={report} demo={demo}/>
          {!demo && <div className="analysis">
            <div className="analysis-nav" aria-label="Report view">{['Performance', 'Monthly', 'Trades', 'Decisions'].map(key => <button type="button" key={key} className={key === section ? 'active' : ''} onClick={() => setSection(key)}>{key}</button>)}</div>
            {renderAnalysis()}
            <details className="panel details"><summary>Trade statistics</summary><Table rows={report.tradeMetrics}/></details>
          </div>}
        </> : result ? <>
          <div className="section-header"><div><h2>Portfolio overview</h2><p>{result.index} · Prices as of {result.asOf}</p></div></div>
          <div className="metrics"><Card icon={TrendingUp} label="Portfolio value" value={inr(result.value)} note="Marked to market"/><Card icon={Database} label="Cash" value={inr(result.cash)} note="Includes cash reserved for pending orders"/><Card icon={BriefcaseBusiness} label="Stocks held" value={result.holdings.length}/><Card icon={Activity} label="Pending buy-stops" value={result.pending.length} tone="amber"/></div>
          <Panel title="Current holdings"><Table rows={result.holdings}/></Panel>
          <div className="two-panels"><Panel title="Pending orders"><Table rows={result.pending}/></Panel><Panel title="Current rankings"><Table rows={result.ranks}/></Panel></div>
          <Panel title="Latest exits"><Table rows={result.exits}/></Panel>
          <Panel title="Latest candidate decisions"><Table rows={result.decisions}/></Panel>
        </> : <Panel title="Portfolio overview" hint="Run present holdings to populate your portfolio and pending orders."><div className="empty"><BriefcaseBusiness size={26}/><span>No holdings run yet</span></div></Panel>}
        <footer><span>Momentum Lab</span><span>NSE equities · Research and backtesting</span></footer>
      </div>
    </main>
    <Settings open={settings} close={() => setSettings(false)} draft={draft} update={update} params={params} setParams={setParams} config={config}/>
  </div>
}

createRoot(document.getElementById('root')).render(<App/>)

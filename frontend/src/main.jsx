import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity, ArrowDownToLine, ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3,
  BookOpen, BriefcaseBusiness, CalendarDays, ChevronDown, ChevronLeft, ChevronRight,
  CircleHelp, Database, FileSpreadsheet,
  Layers3, LineChart, Menu, Play, Settings2, TrendingUp, Upload, X,
} from 'lucide-react'
import { CartesianGrid, Line, LineChart as Chart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import './style.css'
import { streamlitRequest } from './streamlit.js'
import Manual from './manual.jsx'

const INDEXES = ['Nifty 50', 'Nifty 100', 'Nifty LargeMidcap 250', 'Nifty Smallcap 250', 'Nifty 500',
  'Nifty Microcap 250', 'Nifty Total Market', 'Quality Stocks']
const PARAMS = { lookback: 10, skip: 2, top_n: 10, threshold: 20, ema_span: 12, f1: true,
  f2: false, max_ext: .4, f3: true, min_cr: .5, low_cr_action: 'pending', exit_ema: true,
  exit_sl: false, sl_pct: .2, exit_ts: false, ts_pct: .25, capital: 1000000, cash_ret: 0 }
const VIEWS = { backtest: 'Backtest', present: 'Present holdings', rules: 'Rules' }
const HERO = {
  backtest: ['Strategy backtest', 'Test monthly momentum rules against your stock universe and NSE benchmarks.'],
  present: ['Present holdings', 'Review your portfolio, current ranks, and pending orders.'],
  rules: ['Strategy rules', 'Every rule the screener applies, and the reasoning behind each one.'],
}
const PALETTE = { Strategy: '#16191B', 'Nifty 50': '#9AA09B', 'Nifty 500': '#24405E', 'Equal-weight universe': '#8A7B4F' }
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
  rolling: DEMO_GROWTH.slice(12).map((r, i) => ({ Month: r.Month, ...Object.fromEntries(
    Object.keys(PALETTE).filter(key => key in r).map(key => [key, r[key] / DEMO_GROWTH[i][key] - 1]),
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
function Card({ label, value, note }) {
  const dir = typeof value === 'string' && (value.startsWith('+') ? 'up' : /^[-\u2212]/.test(value) ? 'down' : '')
  return <article className="metric"><span className="metric-label">{label}</span>
    <strong className={dir}>{value}</strong>{note && <small>{note}</small>}</article>
}

// Ranks 1..threshold with the two zones drawn as bands. Position on the ladder is the
// information: which leaders you own, which you do not, and what is near the edge.
function RankLadder({ ranks, holdings, topN, threshold }) {
  const held = new Map((holdings || []).map(row => [row.Symbol, row]))
  const rows = (ranks || []).filter(row => row.Rank <= threshold)
  if (!rows.length) return null
  const widest = Math.max(...[...held.values()].map(row => row.Weight || 0), .01)
  return <section className="panel">
    <div className="panel-head"><div><h2>Rank ladder</h2>
      <p>Every stock the rules can act on this month, in rank order.</p></div></div>
    <ol className="ladder">
      {rows.map(row => {
        const own = held.get(row.Symbol)
        return <React.Fragment key={row.Symbol}>
          {row.Rank === topN + 1 && <li className="zonedivider">
            <span>Buy zone ends. Ranks below are kept if already held, never bought.</span></li>}
          <li className={(own ? 'own ' : '') + (row.Rank <= topN ? 'buy' : 'hold')}>
            <span className="rk">{row.Rank}</span>
            <span className="tk">{row.Symbol}</span>
            <span className="sc">{pct(row.Score, true)}</span>
            <span className={own ? 'rt ' + (own.Return >= 0 ? 'up' : 'down') : 'rt none'}>
              {own ? pct(own.Return, true) : '—'}</span>
            <span className="wt">{own && <i style={{ width: Math.max(5, own.Weight / widest * 100) + '%' }}/>}</span>
          </li>
        </React.Fragment>
      })}
    </ol>
    <div className="ladder-key"><span><b>{held.size}</b> of {topN} slots filled</span>
      <span>Third column is the momentum score</span><span>Bar shows position size</span></div>
  </section>
}

function Panel({ title, hint, children }) {
  return <section className="panel"><div className="panel-head"><div><h2>{title}</h2>{hint && <p>{hint}</p>}</div></div>{children}</section>
}

const CHART_TABS = { growth: 'Growth', drawdown: 'Drawdown', rolling: 'Rolling 12M' }
const CHART_TITLES = { growth: 'Growth of ₹100', drawdown: 'Drawdown', rolling: 'Rolling 12-month return' }
const CHART_HINTS = {
  growth: 'Month-end portfolio performance and benchmarks',
  drawdown: 'Decline from each series own running peak',
  rolling: 'Return over the trailing twelve months, so every point is one full year of holding',
}

function PerformanceChart({ report, demo }) {
  const [kind, setKind] = useState('growth')
  const [hidden, setHidden] = useState([])
  const rows = report[kind] || []
  const keys = Object.keys(PALETTE).filter(key => key in (rows[0] || {}))
  const money = kind === 'growth'
  return <section className="panel chart-panel">
    <div className="panel-head"><div><h2>{CHART_TITLES[kind]}</h2><p>{demo ? 'Illustrative data, run a backtest to see your results' : CHART_HINTS[kind]}</p></div>
      <div className="segmented">{Object.entries(CHART_TABS).map(([key, text]) => <button type="button" key={key} className={kind === key ? 'active' : ''} onClick={() => setKind(key)}>{text}</button>)}</div></div>
    <div className="legend">{keys.map(key => <button type="button" key={key} aria-pressed={!hidden.includes(key)} className={hidden.includes(key) ? 'muted' : ''} onClick={() => setHidden(old => old.includes(key) ? old.filter(k => k !== key) : [...old, key])}><i style={{ background: PALETTE[key] }}/>{key}</button>)}</div>
    <div className="plot"><ResponsiveContainer width="100%" height="100%">
      <Chart data={rows} margin={{ left: -12, top: 14, right: 20, bottom: 4 }}>
        <CartesianGrid stroke="#E6E8E2" vertical={false} strokeDasharray="3 4"/>
        <XAxis dataKey="Month" tickFormatter={month} tickLine={false} axisLine={false} minTickGap={34} tick={{fill:'#636A6D',fontSize:11,fontFamily:'IBM Plex Mono'}} tickMargin={12}/>
        <YAxis tickFormatter={money ? v => '₹' + num(v, 0) : v => pct(v)} tickLine={false} axisLine={false} tick={{fill:'#636A6D',fontSize:11,fontFamily:'IBM Plex Mono'}} width={64} domain={kind === 'drawdown' ? ['auto', 0] : ['auto','auto']}/>
        <Tooltip labelFormatter={month} formatter={value => money ? '₹' + num(value) : pct(value, true)} contentStyle={{border:'1px solid #D3D6CF',borderRadius:3,fontFamily:'IBM Plex Mono',fontSize:12}}/>
        {kind === 'rolling' && <ReferenceLine y={0} stroke="#16191B" strokeWidth={1}/>}
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

const MONTH_LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const shortMonth = value => value
  ? MONTH_NAMES[Number(value.slice(5, 7)) - 1] + '-' + value.slice(2, 4)
  : '—'

/** Month-on-month change of every series in the growth curve. */
function monthlyReturns(growth) {
  const out = []
  for (let i = 1; i < growth.length; i++) {
    const row = { Month: growth[i].Month }
    for (const key of Object.keys(growth[i])) {
      if (key === 'Month') continue
      const before = growth[i - 1][key], after = growth[i][key]
      row[key] = Number.isFinite(before) && Number.isFinite(after) && before !== 0 ? after / before - 1 : null
    }
    out.push(row)
  }
  return out
}

const compound = values => values.reduce((acc, r) => Number.isFinite(r) ? acc * (1 + r) : acc, 1) - 1

/** Background tint for a return cell, scaled against the largest move on screen. */
function tint(value, peak) {
  if (!Number.isFinite(value) || !peak) return undefined
  const weight = Math.min(1, Math.abs(value) / peak)
  const alpha = (0.07 + 0.3 * weight).toFixed(3)
  return { background: value >= 0 ? `rgba(11,107,69,${alpha})` : `rgba(163,43,28,${alpha})` }
}

function MonthlyGrid({ rows, benchmark, picked, onPick }) {
  const byMonth = Object.fromEntries(rows.map(r => [r.Month, r]))
  const years = [...new Set(rows.map(r => r.Month.slice(0, 4)))]
  const peak = Math.max(...rows.map(r => Math.abs(r.Strategy || 0)), 0.01)
  return <div className="calendar">
    <table>
      <thead><tr><th>Year</th>
        {MONTH_LETTERS.map((letter, i) => <th key={i} className="num">{letter}</th>)}
        <th className="num">Year</th><th className="num">{benchmark}</th></tr></thead>
      <tbody>{years.map(year => {
        const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
        const present = months.filter(m => byMonth[m])
        return <tr key={year}>
          <th>{year}{present.length < 12 && <span className="part">*</span>}</th>
          {months.map(key => {
            const row = byMonth[key]
            if (!row) return <td key={key} className="num blank"/>
            return <td key={key} className="num">
              <button type="button" style={tint(row.Strategy, peak)}
                className={'cell' + (picked === key ? ' picked' : '')}
                onClick={() => onPick(key)} aria-label={`${shortMonth(key)} holdings`}>
                {Number.isFinite(row.Strategy) ? (row.Strategy * 100).toFixed(1) : '—'}
              </button></td>
          })}
          <td className="num"><strong className={compound(present.map(m => byMonth[m].Strategy)) >= 0 ? 'up' : 'down'}>
            {pct(compound(present.map(m => byMonth[m].Strategy)), true)}</strong></td>
          <td className="num bench">{pct(compound(present.map(m => byMonth[m][benchmark])), true)}</td>
        </tr>
      })}</tbody>
    </table>
    <p className="calendar-note">Percent return each month, after costs. Click a month to see what was held. Years marked <span className="part">*</span> are part-years.</p>
  </div>
}

function MonthHoldings({ month: key, rows, slots, months, onPick }) {
  const held = [...rows].sort((a, b) => (b.Weight || 0) - (a.Weight || 0))
  const invested = held.reduce((sum, r) => sum + (r.Weight || 0), 0)
  const widest = Math.max(...held.map(r => r.Weight || 0), 0.01)
  const at = months.indexOf(key)
  const previous = months[at - 1], next = months[at + 1]
  return <section className="panel holdings-month">
    <div className="panel-head">
      <div><h2>Held through {shortMonth(key)}</h2>
        <p>{held.length} of {slots} slots, {pct(1 - invested)} in cash. Positions were set at the{' '}
        {shortMonth(months[at - 1] || key)} close; a buy-stop could also fill during the month.</p></div>
      <div className="stepper">
        <button type="button" disabled={!previous} onClick={() => onPick(previous)} aria-label="Previous month"><ChevronLeft size={16}/></button>
        <button type="button" disabled={!next} onClick={() => onPick(next)} aria-label="Next month"><ChevronRight size={16}/></button>
      </div>
    </div>
    {held.length ? <table className="held">
      <thead><tr><th>Stock</th><th>Weight at month-end</th><th className="num">Return in month</th></tr></thead>
      <tbody>{held.map(row => <tr key={row.Symbol}>
        <td><strong>{row.Symbol}</strong>{row.Industry && <small>{row.Industry}</small>}</td>
        <td><div className="weight"><span style={{ width: `${(row.Weight / widest) * 100}%` }}/></div>
          <em>{pct(row.Weight)}</em></td>
        <td className={'num ' + (row.Return >= 0 ? 'up' : 'down')}>{pct(row.Return, true)}</td>
      </tr>)}</tbody>
    </table> : <div className="empty"><BriefcaseBusiness size={24}/><span>Nothing held in this month</span></div>}
  </section>
}

function MonthlyResults({ report, held, slots }) {
  const rows = useMemo(() => monthlyReturns(report.growth || []), [report])
  const months = rows.map(r => r.Month)
  const [picked, setPicked] = useState(null)
  const current = picked && months.includes(picked) ? picked : months[months.length - 1]
  const benchmark = ['Nifty 50', 'Nifty 500'].find(name => rows[0] && name in rows[0]) || 'Nifty 50'
  const forMonth = (held || []).filter(r => r.Month === current)
  if (!rows.length) return <Panel title="Monthly results"><Table rows={report.monthly}/></Panel>
  return <div className="monthly-split">
    <div className="monthly-left">
      <section className="panel">
        <div className="panel-head"><div><h2>Monthly returns</h2>
          <p>Every month of the backtest, with the calendar-year total beside it.</p></div></div>
        <MonthlyGrid rows={rows} benchmark={benchmark} picked={current} onPick={setPicked}/>
      </section>
      <details className="panel details"><summary>Monthly values</summary><Table rows={report.monthly}/></details>
    </div>
    <MonthHoldings month={current} rows={forMonth} slots={slots} months={months} onPick={setPicked}/>
  </div>
}

function App() {
  const [config, setConfig] = useState({ indices: INDEXES, latest: '2026-10' })
  const [mode, setMode] = useState('present')
  const [draft, setDraft] = useState({ index: 'Nifty Total Market', first: '2025-01', last: '2026-10', cost: .4, rf: 6.5 })
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
    if (section === 'Monthly') return <MonthlyResults report={report} held={result?.held} slots={params.top_n}/>
    if (section === 'Decisions') return <Panel title="Candidate decisions"><Table rows={result?.decisions}/></Panel>
    return <Panel title="Performance comparison" hint="Strategy and benchmark returns, risk, and relative statistics"><Table rows={report.metrics}/></Panel>
  }

  return <div className="shell">
    {mobileNav && <button type="button" className="nav-shade" aria-label="Close navigation" onClick={() => setMobileNav(false)}/>}
    <aside className={'sidebar ' + (mobileNav ? 'shown' : '')}>
      <div className="brand"><div className="brand-icon"><TrendingUp size={23} strokeWidth={2.4}/></div><div><strong>Momentum Lab</strong><small>Research terminal</small></div></div>
      <div className="nav-label">Workspace</div>
      <nav>
        <button type="button" className={mode === 'backtest' ? 'selected' : ''} onClick={() => switchMode('backtest')}><BarChart3 size={19}/>Backtest<ArrowRight className="nav-arrow" size={15}/></button>
        <button type="button" className={mode === 'present' ? 'selected' : ''} onClick={() => switchMode('present')}><BriefcaseBusiness size={19}/>Present holdings<ArrowRight className="nav-arrow" size={15}/></button>
        <button type="button" className={mode === 'rules' ? 'selected' : ''} onClick={() => switchMode('rules')}><BookOpen size={19}/>Rules<ArrowRight className="nav-arrow" size={15}/></button>
      </nav>
      <div className="nav-label secondary">Configuration</div>
      <nav><button type="button" onClick={() => { setSettings(true); setMobileNav(false) }}><Settings2 size={19}/>Strategy settings</button></nav>
      <div className="sidebar-foot"><div className="exchange-icon"><Activity size={17}/></div><div><strong>NSE equities</strong><small>Monthly rebalance</small></div></div>
    </aside>

    <main>
      <header className="topbar"><div className="breadcrumb"><button type="button" className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={20}/></button>
        <span>Workspace</span><span className="slash">/</span><strong>{VIEWS[mode]}</strong></div>
        <button type="button" className="secondary-button small" onClick={() => setSettings(true)}><Settings2 size={16}/> Settings</button></header>
      <div className="content">
        <section className="statusband">
          <div><h1>{HERO[mode][0]}</h1><p>{HERO[mode][1]}</p></div>
          <div className="sb-month"><span>Signal month</span><strong>{month(config.latest)}</strong>
            <small>Last completed monthly bar</small></div>
        </section>

        {mode !== 'rules' && <form className="controls" onSubmit={submit}>
          <Field label="Stock universe"><Select value={draft.index} onChange={index => update({ index })}>{config.indices.map(index => <option key={index}>{index}</option>)}</Select></Field>
          <Field label="First month held"><input aria-label="First month held" required type="month" value={draft.first} onChange={e => update({ first: e.target.value })}/></Field>
          {mode === 'backtest' && <Field label="Last month"><input aria-label="Last month" required type="month" value={draft.last} max={config.latest} onChange={e => update({ last: e.target.value })}/></Field>}
          <button className="primary run" disabled={!!loading} type="submit"><Play size={16} fill="currentColor"/>{loading === mode ? 'Running…' : mode === 'backtest' ? 'Run backtest' : 'Show holdings'}</button>
          {draft.history && <div className="attached"><FileSpreadsheet size={15}/> Constituent history · {draft.historyName}</div>}
        </form>}
        {loading && <div className="notice" role="status"><Activity size={17}/> Calculating strategy results. The first data download may take a few minutes.</div>}
        {error && <div className="notice error" role="alert">{error}</div>}
        {result?.notices?.map(message => <div className="notice" key={message}><CircleHelp size={16}/>{message}</div>)}

        {mode === 'rules' ? <Manual params={params} draft={draft}/> : mode === 'backtest' ? <>
          <div className="section-header">
            <div><h2>Performance overview</h2><p>{demo ? 'Illustrative preview' : result.index + ', ' + month(result.range[0]) + ' to ' + month(result.range[1])}</p></div>
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
          <div className="section-header"><div><h2>Portfolio overview</h2><p>{result.index}, priced {result.asOf}</p></div></div>
          <div className="metrics"><Card icon={TrendingUp} label="Portfolio value" value={inr(result.value)} note="Marked to market"/><Card icon={Database} label="Cash" value={inr(result.cash)} note="Includes cash reserved for pending orders"/><Card icon={BriefcaseBusiness} label="Stocks held" value={result.holdings.length}/><Card icon={Activity} label="Pending buy-stops" value={result.pending.length} tone="amber"/></div>
          <RankLadder ranks={result.ranks} holdings={result.holdings} topN={params.top_n} threshold={params.threshold}/>
          <Panel title="Position detail"><Table rows={result.holdings}/></Panel>
          <div className="two-panels"><Panel title="Pending orders"><Table rows={result.pending}/></Panel><Panel title="Latest exits"><Table rows={result.exits}/></Panel></div>
          <details className="panel details"><summary>Full ranking</summary><Table rows={result.ranks}/></details>
          <Panel title="Latest candidate decisions"><Table rows={result.decisions}/></Panel>
        </> : <Panel title="Portfolio overview" hint="Run present holdings to populate your portfolio and pending orders."><div className="empty"><BriefcaseBusiness size={26}/><span>No holdings run yet</span></div></Panel>}
        <footer><span>Momentum Lab</span><span>Research and backtesting on NSE equities</span></footer>
      </div>
    </main>
    <Settings open={settings} close={() => setSettings(false)} draft={draft} update={update} params={params} setParams={setParams} config={config}/>
  </div>
}

createRoot(document.getElementById('root')).render(<App/>)

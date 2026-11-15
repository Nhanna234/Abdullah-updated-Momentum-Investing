from __future__ import annotations

import io
import json
import time
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd
import requests
import streamlit as st
import yfinance as yf


LOGIC_VERSION = "1.4.0"

DEFAULT_KEEP = ("360ONE, ABCAPITAL, ABSLAMC, ANANDRATHI, ANGELONE, BSE, BAJAJHLDNG, GROWW, CRISIL, CRAMC, "
                "CDSL, CHOICEIN, CAMS, GICRE, HDFCAMC, HDFCLIFE, ICICILIFE, ICICIGI, ICICIAMC, IIFLCAPS, IEX, "
                "KFINTECH, LICI, MOTILALOFS, MCX, NAM-INDIA, NIVABUPA, NUVAMA, POLICYBZR, PINELABS, SBILIFE, "
                "SHAREINDIA, STARHEALTH, SBIN, SUNDARMFIN, TATACAP, NIACL, UTIAMC")

INDEX_FILES = {
    "Nifty 50": "ind_nifty50list.csv",
    "Nifty 100": "ind_nifty100list.csv",
    "Nifty LargeMidcap 250": "ind_niftylargemidcap250list.csv",
    "Nifty Smallcap 250": "ind_niftysmallcap250list.csv",
    "Nifty 500": "ind_nifty500list.csv",
    "Nifty Microcap 250": "ind_niftymicrocap250_list.csv",
    "Nifty Total Market": "ind_niftytotalmarket_list.csv",
}

CONSTITUENT_MIRRORS = ["https://niftyindices.com/IndexConstituent/{f}",
                       "https://www.niftyindices.com/IndexConstituent/{f}",
                       "https://nsearchives.nseindia.com/content/indices/{f}"]

BENCH = {"Nifty 50": ("NIFTY 50", "^NSEI"), "Nifty 500": ("NIFTY 500", "^CRSLDX")}

NI_BASE = "https://www.niftyindices.com"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

IST = timezone(timedelta(hours=5, minutes=30))

FIELDS = ("Open", "High", "Low", "Close")

def last_completed_month() -> pd.Period:
    """The latest month whose monthly bar is final.

    Normally the previous month; additionally, from 17:00 IST on the last calendar
    day of a month, that month itself (the last session has closed by then)."""
    now = datetime.now(IST)
    p = pd.Period(now.date(), "M")
    if now.day == p.days_in_month and now.hour >= 17:
        return p
    return p - 1

def _clean(s) -> str:
    return str(s).strip().upper().replace(".NS", "")

def _parse_constituents(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = [str(c).strip() for c in df.columns]
    if "Symbol" not in df.columns:
        raise ValueError(f"No 'Symbol' column (columns: {list(df.columns)})")
    if "Series" in df.columns:
        df = df[df["Series"].astype(str).str.strip() == "EQ"]
    df["Symbol"] = df["Symbol"].map(_clean)
    for c in ("Company Name", "Industry"):
        if c not in df.columns:
            df[c] = ""
    return df.drop_duplicates("Symbol")[["Symbol", "Company Name", "Industry"]].reset_index(drop=True)

@st.cache_data(ttl=24 * 3600, show_spinner="Fetching index constituents…")
def load_constituents(index_name: str) -> tuple[pd.DataFrame, str]:
    fname, errors = INDEX_FILES[index_name], []
    for m in CONSTITUENT_MIRRORS:
        url = m.format(f=fname)
        try:
            r = requests.get(url, headers={"User-Agent": UA, "Accept": "text/csv,*/*"}, timeout=25)
            r.raise_for_status()
            return _parse_constituents(pd.read_csv(io.StringIO(r.text))), url
        except Exception as e:  # noqa: BLE001
            errors.append(f"{url}: {e}")
    raise RuntimeError("Could not download the constituent list. Upload it from the sidebar.\n"
                       + "\n".join(errors))

def parse_history(file) -> tuple[dict, list[str]]:
    """Report format: each column header is an effective date, values are symbols."""
    h = pd.read_csv(file)
    h.columns = pd.to_datetime(h.columns)
    lists = {d: [_clean(x) for x in h[d].dropna()] for d in sorted(h.columns)}
    return lists, sorted(set().union(*lists.values()))

@st.cache_data(ttl=6 * 3600, show_spinner=False)
def load_ohlc(symbols: tuple[str, ...], start: str, end: str, adjusted: bool) -> dict:
    tickers = [f"{s}.NS" for s in symbols]
    parts = {f: [] for f in FIELDS}
    for i in range(0, len(tickers), 100):          # batches keep Yahoo from throttling
        chunk, df = tickers[i:i + 100], None
        for _ in range(2):
            try:
                df = yf.download(chunk, start=start, end=end, auto_adjust=adjusted,
                                 progress=False, threads=True, group_by="column")
                break
            except Exception:  # noqa: BLE001
                time.sleep(2)
        if df is None or df.empty:
            continue
        for f in FIELDS:
            x = df[f]
            if isinstance(x, pd.Series):
                x = x.to_frame(chunk[0])
            parts[f].append(x)
        time.sleep(0.5)
    if not parts["Close"]:
        raise RuntimeError("Yahoo Finance returned no price data.")
    out = {}
    for f in FIELDS:
        x = pd.concat(parts[f], axis=1)
        x.columns = [_clean(c) for c in x.columns]
        x = x.loc[:, ~x.columns.duplicated()]
        x.index = pd.to_datetime(x.index).tz_localize(None).normalize()
        out[f] = x.sort_index()
    return out

def _ni_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
    try:
        s.get(f"{NI_BASE}/reports/historical-data", timeout=15)
    except requests.RequestException:
        pass
    return s

def _ni_index(api_name: str, start: date, end: date) -> pd.Series:
    s, rows, cur = _ni_session(), [], start
    while cur <= end:
        nxt = min(cur + timedelta(days=180), end)
        cinfo = (f"{{'name':'{api_name}','startDate':'{cur:%d-%b-%Y}',"
                 f"'endDate':'{nxt:%d-%b-%Y}','indexName':'{api_name}'}}")
        r = s.post(f"{NI_BASE}/BackPage/getHistoricaldatatabletoString",
                   data=json.dumps({"cinfo": cinfo}), timeout=30,
                   headers={"Content-Type": "application/json; charset=utf-8",
                            "X-Requested-With": "XMLHttpRequest", "Origin": NI_BASE,
                            "Referer": f"{NI_BASE}/reports/historical-data"})
        r.raise_for_status()
        data = json.loads(r.text)
        if isinstance(data, dict):
            data = data.get("d", [])
            data = json.loads(data) if isinstance(data, str) else data
        rows += data
        cur = nxt + timedelta(days=1)
        time.sleep(0.3)
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["HistoricalDate"], format="%d %b %Y")
    ser = pd.to_numeric(df["CLOSE"], errors="coerce").set_axis(df["date"]).sort_index()
    return ser[~ser.index.duplicated(keep="last")].dropna()

def _resample(df, how: str):
    try:
        r = df.resample("ME")
    except ValueError:                             # pandas < 2.2
        r = df.resample("M")
    m = getattr(r, how)()
    m.index = m.index.to_period("M")
    return m

@st.cache_data(ttl=6 * 3600, show_spinner="Fetching Nifty 50 / Nifty 500 index closes…")
def load_benchmarks(start: str, end: str) -> tuple[pd.DataFrame, dict]:
    out, src = {}, {}
    s, e = pd.Timestamp(start).date(), pd.Timestamp(end).date()
    for name, (api, yh) in BENCH.items():
        try:
            ser = _ni_index(api, s, e)
            src[name] = "niftyindices.com"
        except Exception:  # noqa: BLE001
            try:
                df = yf.download(yh, start=start, end=end, auto_adjust=False, progress=False)
                ser = df["Close"]
                ser = ser.iloc[:, 0] if isinstance(ser, pd.DataFrame) else ser
                ser.index = pd.to_datetime(ser.index).tz_localize(None)
                src[name] = f"Yahoo ({yh})"
            except Exception as ex:  # noqa: BLE001
                src[name] = f"unavailable ({ex})"
                continue
        out[name] = _resample(ser.to_frame(name), "last")[name]
    return (pd.concat(out, axis=1) if out else pd.DataFrame()), src

def build_monthly(D: dict, P: dict) -> dict:
    C, H, L = _resample(D["Close"], "last"), _resample(D["High"], "max"), _resample(D["Low"], "min")
    Cf = C.ffill()
    ema = Cf.ewm(span=P["ema_span"], adjust=False).mean()
    score = C.shift(P["skip"]) / C.shift(P["skip"] + P["lookback"]) - 1
    rng = H - L
    cr = ((C - L) / rng).where(rng > 0, 1.0)
    return {"C": C, "Cf": Cf, "H": H, "L": L, "ema": ema, "score": score, "cr": cr,
            "ext": Cf / ema - 1}

def rank_month(M: dict, t, universe: list[str]):
    uni = [s for s in universe if s in M["C"].columns]
    sc = M["score"].loc[t, uni].dropna().sort_values(ascending=False)
    return sc, pd.Series(np.arange(1, len(sc) + 1), index=sc.index)

def evaluate_candidates(M, t, sc, held, open_slots, P) -> list[dict]:
    decisions, filled = [], 0
    for r, s in enumerate(sc.index[:P["threshold"]], start=1):
        if s in held:
            continue
        c, e, em = M["Cf"].loc[t, s], M["ext"].loc[t, s], M["ema"].loc[t, s]
        crv, hi = M["cr"].loc[t, s], M["H"].loc[t, s]
        row = {"Symbol": s, "Rank": r, "Score": sc[s], "Close": c, "EMA": em,
               "Extension": e, "CR": crv, "Month high": hi}
        if filled >= open_slots:
            row["Decision"] = "not needed (slots full)"
        elif P["f1"] and not c > em:
            row["Decision"] = "SKIP F1: close <= EMA"
        elif P["f2"] and e > P["max_ext"]:
            row["Decision"] = f"SKIP F2: extended {e:.0%} > {P['max_ext']:.0%}"
        elif not P["f3"] or pd.isna(crv) or crv >= P["min_cr"]:
            row["Decision"] = "BUY at close"
            filled += 1
        elif P["low_cr_action"] == "pending":
            row["Decision"] = f"BUY-STOP above {hi:,.2f} (CR {crv:.2f})"
            filled += 1
        else:
            row["Decision"] = f"SKIP F3: CR {crv:.2f} < {P['min_cr']}"
        decisions.append(row)
    return decisions

def exit_reason(M, t, s, rank, hold_zone, P, h: dict | None = None) -> str:
    px, reasons = M["Cf"].loc[t, s], []
    if s not in hold_zone:
        reasons.append(f"rank {rank.get(s)} > {P['threshold']}" if s in rank.index
                       else "not ranked / not in universe")
    if P["exit_ema"] and px < M["ema"].loc[t, s]:
        reasons.append("close < EMA")
    if h is not None and h.get("entry"):
        if P["exit_sl"] and px <= h["entry"] * (1 - P["sl_pct"]):
            reasons.append(f"stop-loss {P['sl_pct']:.0%}")
        if P["exit_ts"] and px <= h["peak"] * (1 - P["ts_pct"]):
            reasons.append(f"trailing stop {P['ts_pct']:.0%}")
    return "; ".join(reasons)

def run_strategy(D, M, universe_at, months, P, cost, trade_last=False):
    """months[0] = first rebalance (portfolio formed at its close)."""
    Cf = M["Cf"]
    cash_r = (1 + P["cash_ret"]) ** (1 / 12) - 1
    cash, reserved = float(P["capital"]), 0.0
    holdings, pending = {}, []
    positions, decisions_log, values, buys_value = [], [], [], []
    day_p = D["Close"].index.to_period("M")

    for i, t in enumerate(months):
        bought = 0.0
        if i > 0:
            cash *= 1 + cash_r
            days = D["Close"].index[day_p == t]
            for p in pending:                         # buy-stops live during month t
                s = p["Symbol"]
                hi = D["High"].loc[days, s]
                hit = hi[hi >= p["Trigger"]]
                if len(hit):
                    day = hit.index[0]
                    op = D["Open"].loc[day, s]
                    gap = pd.notna(op) and op > p["Trigger"]
                    fill = op if gap else p["Trigger"]
                    holdings[s] = {"qty": p["Alloc"] * (1 - cost) / fill, "pos": len(positions),
                                   "entry": fill, "peak": fill}
                    positions.append({**p["info"], "Entry date": day, "Entry price": fill,
                                      "Entry type": "buy-stop (gap open)" if gap else "buy-stop",
                                      "Invested": p["Alloc"]})
                    bought += p["Alloc"]
                else:
                    cash += p["Alloc"]
                    decisions_log.append({"Month": str(t), "Symbol": s, "Rank": p["info"]["Signal rank"],
                                          "Decision": f"EXPIRED: buy-stop {p['Trigger']:,.2f} not hit"})
                reserved -= p["Alloc"]
            pending = []

        px = Cf.loc[t]
        for s, h in holdings.items():
            h["peak"] = max(h["peak"], px[s])

        if i == len(months) - 1 and not trade_last:
            values.append((t, cash + reserved + sum(h["qty"] * px[s] for s, h in holdings.items()),
                           cash + reserved, len(holdings)))
            buys_value.append(bought)
            break

        sc, rank = rank_month(M, t, universe_at(t))
        hold_zone = set(sc.index[:P["threshold"]])
        for s in list(holdings):                      # exits
            why = exit_reason(M, t, s, rank, hold_zone, P, holdings[s])
            if why:
                h = holdings.pop(s)
                gross = h["qty"] * px[s]
                cash += gross * (1 - cost)
                positions[h["pos"]].update({"Exit month": str(t), "Exit date": t.to_timestamp(how="end").normalize(),
                                            "Exit price": px[s], "Exit reason": why})
        open_slots = P["top_n"] - len(holdings)       # entries
        if open_slots > 0:
            per_slot = cash / open_slots
            for d in evaluate_candidates(M, t, sc, set(holdings), open_slots, P):
                decisions_log.append({"Month": str(t), **d})
                s = d["Symbol"]
                info = {"Signal month": str(t), "Symbol": s, "Signal rank": d["Rank"],
                        "Signal ext": d["Extension"], "Signal CR": d["CR"]}
                if d["Decision"] == "BUY at close":
                    cash -= per_slot
                    holdings[s] = {"qty": per_slot * (1 - cost) / px[s], "pos": len(positions),
                                   "entry": px[s], "peak": px[s]}
                    positions.append({**info, "Entry date": t.to_timestamp(how="end").normalize(),
                                      "Entry price": px[s], "Entry type": "close", "Invested": per_slot})
                    bought += per_slot
                elif d["Decision"].startswith("BUY-STOP"):
                    cash -= per_slot
                    reserved += per_slot
                    pending.append({"Symbol": s, "Trigger": d["Month high"], "Alloc": per_slot,
                                    "info": info})
        values.append((t, cash + reserved + sum(h["qty"] * px[s] for s, h in holdings.items()),
                       cash + reserved, len(holdings)))
        buys_value.append(bought)

    last = months[-1]
    for s, h in holdings.items():
        positions[h["pos"]].update({"Exit month": "open", "Exit date": last.to_timestamp(how="end").normalize(),
                                    "Exit price": Cf.loc[last, s], "Exit reason": "still held"})
    pos = pd.DataFrame(positions)
    if len(pos):
        pos["Return"] = pos["Exit price"] / pos["Entry price"] - 1
        pos["P&L"] = pos["Invested"] * pos["Return"]
        pos["Months held"] = ((pd.to_datetime(pos["Exit date"]) - pd.to_datetime(pos["Entry date"])).dt.days / 30.44).round(1)
    vals = pd.DataFrame(values, columns=["Month", "Value", "Cash", "Holdings"]).set_index("Month")
    vals["Bought"] = buys_value
    state = {"holdings": holdings, "pending": pending}
    return vals, pos, pd.DataFrame(decisions_log), state

def ew_universe_returns(M, universe_at, months) -> pd.Series:
    """Monthly-rebalanced equal-weight return of the universe (same constituents as the strategy)."""
    out = {}
    for a, b in zip(months[:-1], months[1:]):
        uni = [s for s in universe_at(a) if s in M["Cf"].columns]
        r = (M["Cf"].loc[b, uni] / M["Cf"].loc[a, uni] - 1).dropna()
        out[b] = r.mean() if len(r) else np.nan
    return pd.Series(out)

def perf_stats(v: pd.Series, rf: float) -> dict:
    v = v.dropna()
    r = v.pct_change().dropna()
    if len(r) < 1:
        return {}
    yrs = len(r) / 12
    dd = v / v.cummax() - 1
    under = (dd < 0).astype(int)
    longest = under.groupby((under == 0).cumsum()).sum().max()
    vol = r.std() * np.sqrt(12) if len(r) > 1 else np.nan
    downside = r[r < 0].std() * np.sqrt(12) if (r < 0).sum() > 1 else np.nan
    cagr = (v.iloc[-1] / v.iloc[0]) ** (1 / yrs) - 1 if yrs > 0 else np.nan
    ex = r.mean() * 12 - rf
    return {"Total return": v.iloc[-1] / v.iloc[0] - 1,
            "CAGR": cagr if yrs >= 1 else np.nan,
            "Volatility (ann.)": vol,
            "Sharpe": ex / vol if vol else np.nan,
            "Sortino": ex / downside if downside else np.nan,
            "Max drawdown": dd.min(),
            "Longest DD (months)": int(longest),
            "Calmar": cagr / abs(dd.min()) if dd.min() < 0 and yrs >= 1 else np.nan,
            "Best month": r.max(), "Worst month": r.min(),
            "Positive months": (r > 0).mean()}

def relative_stats(strat: pd.Series, bench: pd.Series) -> dict:
    a = pd.concat([strat.pct_change(), bench.pct_change()], axis=1).dropna()
    if len(a) < 6:
        return {}
    s, b = a.iloc[:, 0], a.iloc[:, 1]
    beta = np.cov(s, b)[0, 1] / b.var()
    up, dn = b > 0, b < 0
    return {"Beta": beta,
            "Alpha (ann.)": (s.mean() - beta * b.mean()) * 12,
            "Correlation": s.corr(b),
            "Up capture": s[up].mean() / b[up].mean() if up.any() else np.nan,
            "Down capture": s[dn].mean() / b[dn].mean() if dn.any() else np.nan,
            "Months beating": (s > b).mean()}

def trade_stats(pos: pd.DataFrame, vals: pd.DataFrame) -> dict:
    if pos is None or not len(pos):
        return {}
    closed = pos[pos["Exit month"] != "open"]
    wins, losses = closed[closed["Return"] > 0], closed[closed["Return"] <= 0]
    gross_loss = -losses["P&L"].sum()
    yrs = max((len(vals) - 1) / 12, 1 / 12)
    return {"Entries": len(pos), "Closed trades": len(closed), "Open positions": len(pos) - len(closed),
            "Win rate": len(wins) / len(closed) if len(closed) else np.nan,
            "Avg win": wins["Return"].mean(), "Avg loss": losses["Return"].mean(),
            "Profit factor": wins["P&L"].sum() / gross_loss if gross_loss > 0 else np.nan,
            "Expectancy / trade": closed["Return"].mean(),
            "Avg months held": closed["Months held"].mean(),
            "Turnover (x / yr)": vals["Bought"].sum() / vals["Value"].mean() / yrs,
            "Avg cash %": (vals["Cash"] / vals["Value"]).iloc[:-1].mean() if len(vals) > 1 else np.nan}

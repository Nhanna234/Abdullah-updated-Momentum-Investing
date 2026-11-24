"""Local JSON interface for the Momentum Lab React dashboard."""
import base64
import io
import json
import os
from datetime import datetime, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

import pandas as pd

import engine as e
import lender_filter as lf
from quality_stocks import (QUALITY_CSV, load_quality_history, load_quality_sectors,
                            quality_symbols_for, refresh_if_due)

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "frontend" / "dist"
# NSE basic-industry labels, kept between runs so NSE is asked only about new symbols.
INDUSTRY_CACHE = ROOT / ".basic-industry.json"
INDEXES = [*e.INDEX_FILES, "Quality Stocks"]
# The sidebar's universe filters, kept apart from the strategy parameters above.
FILTERS = dict(exclude_lenders=True, exclude_financials=False, omit="", keep="")
DEFAULTS = dict(lookback=10, skip=2, top_n=10, threshold=20, ema_span=12, f1=True,
                f2=False, max_ext=.4, f3=True, min_cr=.5, low_cr_action="pending",
                exit_ema=True, exit_sl=False, sl_pct=.2, exit_ts=False, ts_pct=.25,
                capital=1_000_000, cash_ret=0)


def records(frame):
    return json.loads(frame.to_json(orient="records", date_format="iso"))


def input_csv(text):
    return io.StringIO(text.lstrip("\ufeff"))


def exclusions(body, const, quality_sectors, notices):
    """Which symbols the universe leaves out, and why.

    Three independent controls, matching the sidebar:
      exclude_lenders    banks, NBFCs, housing finance and financial institutions, decided by
                         lender_filter from NSE's basic industry with name rules as a fallback
      exclude_financials every remaining financial company as well (exchanges, AMCs, insurers)
      omit / keep        the user's own always-exclude and never-exclude symbols, which win
    """
    always, never = lf.parse_symbols(body.get("omit", "")), lf.parse_symbols(body.get("keep", ""))
    symbols = const["Symbol"].tolist()
    pooled = e.load_symbol_names()
    names = {s: n or pooled.get(s, "") for s, n in zip(const["Symbol"], const["Company Name"])}
    sectors = dict(zip(const["Symbol"], const["Industry"]))
    if quality_sectors:                       # Quality Stocks carries no industry of its own
        sectors = {s: sectors.get(s) or quality_sectors.get(s, "") for s in symbols}

    excluded, report = set(always), None
    if body.get("exclude_lenders", True):
        nbfc, nbfc_source = e.load_nbfc_index()
        if not nbfc:
            notices.append("NSE's Nifty NBFC index was unavailable, so lenders whose names carry no "
                           "lending word may be missed. Add them under Always exclude.")
        report = lf.classify(symbols, names, sectors, lf.BasicIndustryCache(str(INDUSTRY_CACHE)),
                             set(nbfc), always, never)
        report["nbfcSource"] = nbfc_source
        excluded |= {row["symbol"] for row in report["excluded"]}
        if report["nseStatus"] == "blocked" and report["checked"]:
            notices.append("NSE did not answer, so lending was decided from company names and the "
                           "NBFC index rather than its basic-industry labels.")
    if body.get("exclude_financials", False):
        rest = {s for s in symbols if lf.is_financial_sector(sectors.get(s))} - never
        excluded |= rest
        if report is not None:                # keep the panel honest about what actually went
            moved = [row for row in report["kept"] if row["symbol"] in rest]
            report["kept"] = [row for row in report["kept"] if row["symbol"] not in rest]
            report["excluded"] += [{**row, "source": "all financial companies"} for row in moved]
            report["excluded"].sort(key=lambda row: row["symbol"])
    return excluded - never, report


def load_universe(body, index):
    quality, history, uploaded_symbols, notices = None, None, [], []
    if body.get("constituents"):
        const = e._parse_constituents(pd.read_csv(input_csv(body["constituents"])))
    elif index == "Quality Stocks":
        try:
            if os.environ.get("QUALITY_STOCKS_AUTO_REFRESH", "1") == "1":
                refresh_if_due()
        except Exception as error:
            notices.append(f"Quality Stocks refresh failed: {error}")
        quality = load_quality_history()
        const = e._parse_constituents(pd.read_csv(QUALITY_CSV))
    else:
        const, source = e.load_constituents(index)
        if source.startswith("bundled NSE snapshot"):
            notices.append(f"{index} is using the {source}.")
    if body.get("history"):
        source = input_csv(body["history"])
        headers = pd.read_csv(source, nrows=0).columns
        if not headers.str.fullmatch(r"\d{4}-\d{2}-\d{2}").all():
            raise ValueError("Use YYYY-MM-DD for every effective-date header.")
        source.seek(0)
        history, uploaded_symbols = e.parse_history(source)
    elif quality is None:
        notices.append("The current constituent list is used for every month. Historical results may include look-ahead bias.")
    else:
        notices.append("Imported Chartink snapshots can repaint. Saved live captures apply from the next quarter.")

    excluded, report = exclusions(body, const, load_quality_sectors() if quality else None, notices)

    def universe_at(t):
        if history is not None:
            day = max((d for d in history if d <= t.end_time), default=min(history))
            base = history[day]
        elif quality is not None:
            base = quality_symbols_for((t + 1).start_time.date(), quality)
        else:
            base = const["Symbol"].tolist()
        return [s for s in base if s not in excluded]

    return const, universe_at, quality is not None and history is None, uploaded_symbols, notices, report


def growth_report(vals, pos, bench, ew, rate):
    curves = pd.DataFrame({"Strategy": vals["Value"]})
    for name in bench:
        curves[name] = bench[name].reindex(curves.index)
    curves["Equal-weight universe"] = (1 + ew.reindex(curves.index).fillna(0)).cumprod()
    curves = curves.dropna(axis=1, how="any")
    curves = curves / curves.iloc[0] * 100
    dd = curves / curves.cummax() - 1
    # Trailing 12-month return. The first 12 months have no prior year to compare
    # against, so they are dropped rather than reported as zero.
    rolling = (curves / curves.shift(12) - 1).dropna(how="all")
    stats = pd.DataFrame({name: e.perf_stats(curves[name], rate) for name in curves})
    relative = pd.DataFrame({name: e.relative_stats(curves["Strategy"], curves[name])
                             for name in curves if name != "Strategy"})
    performance = pd.concat([stats, relative]).rename_axis("Metric")
    monthly = vals.assign(Return=vals.Value.pct_change(), Exposure=1-vals.Cash/vals.Value)
    monthly.index = monthly.index.astype(str)
    curves.index = dd.index = curves.index.astype(str)
    rolling.index = rolling.index.astype(str)
    return {
        "growth": records(curves.rename_axis("Month").reset_index()),
        "drawdown": records(dd.rename_axis("Month").reset_index()),
        "rolling": records(rolling.rename_axis("Month").reset_index()),
        "monthly": records(monthly.rename_axis("Month").reset_index()),
        "metrics": records(performance.reset_index()),
        "tradeMetrics": records(pd.Series(e.trade_stats(pos, vals), name="Value").rename_axis("Metric").reset_index()),
        "trades": records(pos),
    }


def present_report(D, M, vals, pos, decisions, state, t, universe, const, cost):
    cmp = D["Close"].ffill().iloc[-1]
    days = D["Close"].index[D["Close"].index.to_period("M") == t + 1]
    names = const.set_index("Symbol")["Company Name"].to_dict()
    cash = vals["Cash"].iloc[-1]
    pending = []
    for order in state["pending"]:
        s = order["Symbol"]
        highs = D["High"].loc[days, s]
        hits = highs[highs >= order["Trigger"]]
        if hits.empty:
            pending.append({"Symbol": s, "Trigger": order["Trigger"], "Allocation": order["Alloc"]})
            continue
        day = hits.index[0]
        op = D["Open"].loc[day, s]
        fill = op if pd.notna(op) and op > order["Trigger"] else order["Trigger"]
        state["holdings"][s] = {"qty": order["Alloc"] * (1 - cost) / fill, "entry": fill}
        cash -= order["Alloc"]
    score, rank = e.rank_month(M, t, universe)
    holdings = []
    for s, h in state["holdings"].items():
        px = cmp.get(s)
        if pd.isna(px):
            px = M["Cf"].loc[t, s]
        holdings.append({"Symbol": s, "Company": names.get(s, ""), "Rank": rank.get(s),
                         "Entry price": h["entry"], "CMP": px, "Return": px / h["entry"] - 1,
                         "Value": px * h["qty"]})
    value = cash + sum(row["Value"] for row in holdings)
    for row in holdings:
        row["Weight"] = row["Value"] / value
    ranks = pd.DataFrame({"Symbol": rank.index, "Rank": rank.values, "Score": score.values})
    exits = pos[pos["Exit month"] == str(t)] if len(pos) else pos
    latest = decisions[decisions["Month"] == str(t)] if len(decisions) else decisions
    return {"value": value, "cash": cash, "asOf": str(D["Close"].index[-1].date()),
            "holdings": records(pd.DataFrame(holdings)), "pending": records(pd.DataFrame(pending)),
            "ranks": records(ranks.head(100)), "exits": records(exits), "decisions": records(latest)}


def run(body):
    index = body.get("index", INDEXES[-1])
    if index not in INDEXES:
        raise ValueError("Select a supported universe.")
    p = {key: body.get("params", {}).get(key, value) for key, value in DEFAULTS.items()}
    cost, rate = float(body.get("cost", .004)), float(body.get("rf", .065))
    latest = e.last_completed_month()
    present = body.get("mode") == "present"
    first = pd.Period(body["first"], "M")
    last = latest if present else pd.Period(body["last"], "M")
    months = list(pd.period_range(first - 1, last, freq="M"))
    if last > latest or len(months) < (1 if present else 3):
        raise ValueError("Choose a valid date range ending in a completed month. Backtests require two holding months.")
    const, universe, quality, uploaded, notices, lenders = load_universe(body, index)
    rebalances = months if present else months[:-1]
    symbols = ({symbol for t in rebalances for symbol in universe(t)} if quality else
               set(const["Symbol"]) | set(uploaded))
    if not symbols:
        raise ValueError("The selected universe has no eligible stocks.")
    warm = max(36, p["lookback"] + p["skip"] + 2)
    start = f"{(months[0] - warm).year}-01-01"
    end = str(((last+1).start_time.date() if last < latest else datetime.now(e.IST).date()) + timedelta(days=1))
    D = e.load_ohlc(tuple(sorted(symbols)), start, end, bool(body.get("adjusted")))
    M = e.build_monthly(D, p)
    if present:
        vals, pos, dec, state = e.run_strategy(D, M, universe, months, p, cost, trade_last=True)
        return {"index": index, "notices": notices, "lenders": lenders, **present_report(
            D, M, vals, pos, dec, state, months[-1], universe(months[-1]), const, cost)}
    gross, gross_pos, decisions, _ = e.run_strategy(D, M, universe, months, p, 0.0)
    net, net_pos, _, net_state = e.run_strategy(D, M, universe, months, p, cost)
    benchmark, sources = e.load_benchmarks(start, end)
    ew = e.ew_universe_returns(M, universe, months)
    industry = dict(zip(const["Symbol"], const["Industry"])) if "Industry" in const else {}
    # Through records() like every other payload: Streamlit marshals component
    # arguments with a bare json.dumps, which rejects numpy scalars.
    held = records(pd.DataFrame([{**row, "Industry": industry.get(row["Symbol"]) or ""}
                                 for row in net_state.get("holds_log", [])]))
    return {"index": index, "notices": notices, "sources": sources, "settings": p,
            "lenders": lenders,
            "net": growth_report(net, net_pos, benchmark, ew, rate),
            "gross": growth_report(gross, gross_pos, benchmark, ew, rate),
            "held": held, "decisions": records(decisions)}


def export_report(body):
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        for sheet, key in [("Performance","metrics"), ("Growth of 100","growth"),
                           ("Monthly values","monthly"), ("Trades","trades")]:
            pd.DataFrame(body["report"][key]).to_excel(writer, sheet_name=sheet, index=False)
        pd.DataFrame(body["decisions"]).to_excel(writer, sheet_name="Candidate decisions", index=False)
        pd.DataFrame(body["settings"].items(), columns=["Setting","Value"]).to_excel(
            writer, sheet_name="Settings", index=False)
    return {"xlsx": base64.b64encode(output.getvalue()).decode("ascii")}


def dashboard_config():
    return {"indices": INDEXES, "latest": str(e.last_completed_month()),
            "params": DEFAULTS, "filters": FILTERS,
            "lendingLabels": list(lf.LENDING_LABELS)}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST), **kwargs)

    def reply(self, result, status=200):
        payload = json.dumps(result, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/health":
            self.reply({"status": "ok"})
        elif path == "/api/config":
            self.reply(dashboard_config())
        else:
            super().do_GET()

    def do_POST(self):
        handlers = {"/api/run": run, "/api/export": export_report}
        handler = handlers.get(urlsplit(self.path).path)
        if handler is None:
            self.send_error(404)
            return
        try:
            if self.headers.get_content_type() != "application/json":
                raise ValueError("Expected application/json.")
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 20_000_000:
                raise ValueError("Request size exceeds the supported limit.")
            result = handler(json.loads(self.rfile.read(size)))
        except Exception as error:
            self.reply({"error": str(error)}, 400)
        else:
            self.reply(result)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8765"))
    host = "0.0.0.0" if os.environ.get("PORT") else "127.0.0.1"
    print(f"Momentum Lab is listening on {host}:{port}", flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()

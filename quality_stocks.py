"""Refresh the live Chartink shortlist on the NSE quarter refresh date."""
import calendar
import csv
import html
import io
import json
import os
import re
import sqlite3
from contextlib import closing
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent
QUALITY_CSV = ROOT / "Quality Stocks.csv"
CHARTINK_HISTORY = ROOT / "Quality Stocks Chartink History.csv"
IST = timezone(timedelta(hours=5, minutes=30))
CHARTINK = "https://chartink.com"
SCAN_URL = CHARTINK + "/screener/improving-roce-and-growth"
NSE = "https://www.nseindia.com"
# NSE equity holidays, including the January election closure.
HOLIDAYS_2026 = {
    date.fromisoformat("2026-" + day)
    for day in ("01-15", "01-26", "03-03", "03-26", "03-31", "04-03",
                "04-14", "05-01", "05-28", "06-26", "09-14", "10-02",
                "10-20", "11-10", "11-24", "12-25")
}


def trading_holidays(year):
    if year == 2026:
        return HOLIDAYS_2026
    with requests.Session() as session:
        session.headers["User-Agent"] = "Mozilla/5.0"
        session.get(NSE + "/", timeout=15).raise_for_status()
        response = session.get(NSE + "/api/holiday-master", params={"type": "trading"}, timeout=15)
        response.raise_for_status()
        holidays = {
            datetime.strptime(row["tradingDate"], "%d-%b-%Y").date()
            for row in response.json()["CM"]
        }
    holidays = {day for day in holidays if day.year == year}
    if not holidays:
        raise ValueError(f"NSE did not return an equity holiday calendar for {year}.")
    return holidays


def refresh_date(day, holidays):
    quarter_month = ((day.month - 1) // 3 + 1) * 3
    end = date(day.year, quarter_month, calendar.monthrange(day.year, quarter_month)[1])
    sessions = 0
    while True:
        if end.weekday() < 5 and end not in holidays:
            sessions += 1
            if sessions == 2:
                return end
        end -= timedelta(days=1)


def download_symbols():
    with requests.Session() as session:
        session.headers["User-Agent"] = "Mozilla/5.0"
        page = session.get(SCAN_URL, timeout=25)
        page.raise_for_status()
        scan = re.search(r':scan-json="([^"]+)"', page.text)
        token = re.search(r'<meta name="csrf-token" content="([^"]+)"', page.text)
        if not scan or not token:
            raise ValueError("Chartink did not expose the saved scan configuration.")
        config = json.loads(html.unescape(scan[1]))
        response = session.post(
            CHARTINK + "/screener/process",
            data={"scan_clause": config["atlas_query"]},
            headers={"X-CSRF-TOKEN": token[1], "X-Requested-With": "XMLHttpRequest",
                     "Referer": SCAN_URL, "Origin": CHARTINK},
            timeout=50,
        )
        response.raise_for_status()
        rows = response.json()["data"]
    symbols = sorted({row["nsecode"].strip().upper() for row in rows})
    if not symbols or any(not re.fullmatch(r"[A-Z0-9&.-]+", symbol) for symbol in symbols):
        raise ValueError("Chartink returned an empty or invalid shortlist.")
    return symbols


def quarter_start(day):
    return date(day.year, ((day.month - 1) // 3) * 3 + 1, 1)


def next_quarter_start(captured):
    start = quarter_start(captured)
    if start.month == 10:
        return date(start.year + 1, 1, 1)
    return date(start.year, start.month + 3, 1)


def load_quality_history():
    """Map holding quarters to their Chartink shortlist, preferring live captures."""
    by_quarter = {}
    with CHARTINK_HISTORY.open(encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source):
            day = datetime.strptime(row["Date"], "%d-%m-%Y").date()
            # Chartink labels the source quarter by its opening bar.
            by_quarter.setdefault(next_quarter_start(day), set()).add(row["Symbol"])

    for snapshot in sorted(ROOT.glob(".quality-stocks-????-??-??.csv")):
        captured = date.fromisoformat(snapshot.stem.removeprefix(".quality-stocks-"))
        with snapshot.open(encoding="utf-8-sig", newline="") as source:
            by_quarter[next_quarter_start(captured)] = {
                row["Symbol"] for row in csv.DictReader(source)
            }

    return {quarter: sorted(symbols) for quarter, symbols in by_quarter.items()}


def load_quality_sectors():
    """Broad sector per symbol from the Chartink history, latest capture winning.

    Quality Stocks.csv carries symbols only, so without this the lending filter has no
    sector to work from and would never look at a Quality Stocks name."""
    sectors = {}
    with CHARTINK_HISTORY.open(encoding="utf-8-sig", newline="") as source:
        rows = sorted(csv.DictReader(source),
                      key=lambda row: datetime.strptime(row["Date"], "%d-%m-%Y"))
    for row in rows:
        if row.get("Sector"):
            sectors[row["Symbol"].strip().upper()] = row["Sector"].strip()
    return sectors


def quality_symbols_for(holding_date, history):
    quarter = quarter_start(holding_date)
    if quarter not in history:
        raise ValueError(f"No Quality Stocks shortlist for the quarter starting {quarter:%d %b %Y}.")
    return history[quarter]


def replace_file(path, payload):
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_bytes(payload)
    os.replace(temp, path)


def refresh_if_due(now=None):
    now = now or datetime.now(IST)
    today = now.date()
    # A quarter refresh cannot fall before the 20th under the NSE calendar.
    if today.month % 3 or today.day < 20 or now.hour < 17:
        return None
    if today != refresh_date(today, trading_holidays(today.year)):
        return None
    snapshot = ROOT / f".quality-stocks-{today.isoformat()}.csv"
    with closing(sqlite3.connect(ROOT / ".quality-stocks-lock.sqlite", timeout=90)) as lock:
        lock.execute("BEGIN EXCLUSIVE")
        if snapshot.exists():
            # Recover publication if a previous run stopped after saving the download.
            if not QUALITY_CSV.exists() or QUALITY_CSV.read_bytes() != snapshot.read_bytes():
                replace_file(QUALITY_CSV, snapshot.read_bytes())
            return None
        output = io.StringIO(newline="")
        writer = csv.writer(output)
        writer.writerow(["Symbol"])
        writer.writerows((symbol,) for symbol in download_symbols())
        payload = output.getvalue().encode("utf-8")
        replace_file(snapshot, payload)
        replace_file(QUALITY_CSV, payload)
        return today


if __name__ == "__main__":
    updated = refresh_if_due()
    if updated:
        print(f"Updated {QUALITY_CSV.name} on {updated} IST.")

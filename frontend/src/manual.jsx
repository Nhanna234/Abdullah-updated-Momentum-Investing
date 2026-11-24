import React from 'react'

// A plain-language manual of every rule the screener applies. Values marked as
// "current setting" read live from the strategy settings drawer.
const pct = n => (n * 100).toFixed(n * 100 % 1 ? 1 : 0) + '%'

function Section({ title, hint, children }) {
  return <section className="panel"><div className="panel-head"><div><h2>{title}</h2>{hint && <p>{hint}</p>}</div></div>{children}</section>
}

function Rule({ id, name, on, children }) {
  return <div className="rule"><span className="rule-id">{id}</span><div>
    <strong>{name}{on !== undefined && <em className={on ? 'on' : 'off'}>{on ? 'ON' : 'OFF'}</em>}</strong>
    <p>{children}</p></div></div>
}

export default function Manual({ params, draft }) {
  const window = params.lookback + params.skip
  return <div className="manual">
    <Section title="What this screener does" hint="Relative momentum on NSE equities, rebalanced monthly">
      <p>Each month the screener ranks every stock in a chosen universe by how far it has risen over a past
        window, buys the leaders that pass the entry filters, and keeps them until they break an exit rule.
        Nothing is discretionary. The same rules run every month, and every buy, hold and sell below follows
        from them.</p>
      <h3>The monthly cycle</h3>
      <ol>
        <li>Settle any buy-stop orders placed last month, then update trailing-stop peaks.</li>
        <li>Rank the whole universe by the momentum score.</li>
        <li>Sell holdings that break an exit rule, releasing their cash first.</li>
        <li>Fill the empty slots from the ranking, applying the entry filters in order.</li>
        <li>Record the portfolio value and the cash left over.</li>
      </ol>
      <p>Every decision is taken on <strong>month-end closing prices</strong>. There are no intraday signals,
        with one exception: a buy-stop placed at the end of one month can fill on any day of the next.</p>
    </Section>

    <Section title="1. Universe" hint="Which stocks are eligible in the first place">
      <p>Pick one universe in the <strong>Stock universe</strong> box. Seven are NSE index lists (Nifty 50,
        Nifty 100, LargeMidcap 250, Smallcap 250, Nifty 500, Microcap 250, Total Market). The eighth,
        <strong> Quality Stocks</strong>, is a Chartink screen for improving ROCE and growth, refreshed every
        quarter. A Chartink scan is applied only to the <em>following</em> quarter, so the screener never
        trades on fundamentals that were not yet public.</p>
      <p>For the index lists the current membership is used for every past month unless you upload a
        constituent history file under Settings (one column per effective date, header
        <code> YYYY-MM-DD</code>, one ticker per cell). Without that file, past backtests carry look-ahead
        bias, because a stock that joined the index after rallying is treated as if it had always been there.</p>
      <h3>Exclusions</h3>
      <Rule id="U1" name="Exclude lending companies" on={draft.excludeLenders !== false}>
        A company counts as a lender when NSE's <em>basic industry</em> — the most detailed level of its
        classification — is a public sector bank, private sector bank, other bank, NBFC, housing finance
        company or financial institution. Insurers, asset managers, brokers, exchanges, depositories, rating
        agencies, fintechs and holding companies are <em>not</em> lenders and stay in. The label is read from
        NSE and cached for 30 days; if NSE does not answer, the fall-back is &ldquo;Bank&rdquo; in the company
        name, membership of NSE's Nifty NBFC index, housing-finance or lending words in the name, and a short
        list of government financial institutions.
      </Rule>
      <Rule id="U2" name="and all other financial companies" on={draft.excludeFinancials === true}>
        Off by default. Switched on, it also removes every remaining company in the Financial Services
        sector — the insurers, AMCs, exchanges and the rest that U1 deliberately keeps.
      </Rule>
      <Rule id="U3" name="Always exclude / Never exclude">
        Your own symbol lists, and they beat everything above. <strong>Always exclude</strong>{' '}
        drops a stock whatever its industry; <strong>Never exclude</strong> keeps one even if it was
        classified as a lender. Both are remembered in your browser and apply to the holdings tab and the
        backtest alike. An excluded stock is never ranked, so a holding that becomes excluded is sold at the
        next month-end by rule X1.
      </Rule>
      <div className="callout">The <strong>Companies left out</strong> panel after each run lists every symbol
        that was excluded and every financial company that was kept, with the reason and the source for each.
        If a lender slips through — which happens when both NSE and the NBFC index are unreachable and the
        company name carries no lending word, as with Tata Capital or Aditya Birla Capital — it will appear in
        the kept list, and adding it to <strong>Always exclude</strong> settles it permanently.</div>
    </Section>

    <Section title="2. Momentum score and ranking" hint="How the leaders are identified">
      <p>Each stock's score is its price return over the look-back window, ending a few months before today:</p>
      <div className="formula">Score(t) = Close(t − {params.skip}) ÷ Close(t − {window}) − 1</div>
      <p>With the current settings that is the <strong className="setting">{params.lookback}-month</strong> return
        ending <strong className="setting">{params.skip}</strong> month{params.skip === 1 ? '' : 's'} ago. For a
        November signal it compares the September close with the November close of the previous year.</p>
      <p>The most recent months are skipped on purpose: stocks that have just run hard tend to give some of it
        back over the following weeks, so including them would buy at the worst moment. A stock without enough
        price history to fill the window is left out of the ranking entirely.</p>
      <h3>Buy zone and hold zone</h3>
      <ul>
        <li><strong>Buy zone</strong> — ranks 1 to <span className="setting">{params.top_n}</span>. New purchases
          are drawn from here, and the portfolio holds at most {params.top_n} stocks.</li>
        <li><strong>Hold zone</strong> — ranks 1 to <span className="setting">{params.threshold}</span>. A stock
          already held stays while it remains inside this wider band.</li>
      </ul>
      <p>The gap between the two bands exists to cut needless trading. Without it a stock drifting between rank
        {' '}{params.top_n} and {params.top_n + 1} would be bought and sold again and again.</p>
    </Section>

    <Section title="3. The three indicators" hint="Everything the filters are built from">
      <p><strong>EMA</strong> — an exponential moving average of the monthly closes over
        {' '}<span className="setting">{params.ema_span} months</span>. It is the trend reference: above it the
        stock is in an uptrend, below it the trend has broken.</p>
      <div className="formula">Extension = Close ÷ EMA − 1</div>
      <p>How far the price has stretched above its own trend line. A stock 60% above its 12-month EMA has run a
        long way very fast and is more likely to pull back.</p>
      <div className="formula">Closing range (CR) = (Close − Low) ÷ (High − Low)</div>
      <p>Where in the month's range the stock finished. CR near 1 means it closed at the top of the month, which
        shows buyers in control; CR near 0 means it closed at the bottom, which shows sellers finished on top.
        If a month has no range at all, CR is treated as 1.</p>
    </Section>

    <Section title="4. Entry rules" hint="How an empty slot gets filled">
      <p>After the sells, the screener walks the ranking from rank 1 downwards, skipping stocks already held, and
        tests each candidate against the filters below. The first failure moves it to the next candidate. The
        walk stops when every slot is filled or rank {params.threshold} is reached.</p>
      <Rule id="E1" name="Candidate pool">Rank {params.threshold} or better, and not already held.</Rule>
      <Rule id="F1" name="Trend filter" on={params.f1}>
        The close must be above the {params.ema_span}-month EMA. This blocks buying a stock whose own trend has
        already broken, however well it ranks.
      </Rule>
      <Rule id="F2" name="Extension cap" on={params.f2}>
        Extension must not exceed <span className="setting">{pct(params.max_ext)}</span>. It keeps the screener
        from buying a stock that has already run far above its trend. Switched off, the strongest and most
        stretched names are allowed in.
      </Rule>
      <Rule id="F3" name="Closing-range filter" on={params.f3}>
        CR of the signal month must be at least <span className="setting">{params.min_cr}</span>. A weak close
        means the month ended on selling, so the screener does not pay up for it at that price.
      </Rule>
      <Rule id="E2" name="Buy at the close">A candidate that passes every active filter is bought at the
        month-end close and takes one slot.</Rule>
      <Rule id="E3" name="Weak close: wait for confirmation">
        {params.low_cr_action === 'pending'
          ? 'If CR is below the minimum, no purchase is made at the close. Instead a buy-stop is placed at the high of the signal month, valid for the next month only. The slot and its cash are reserved immediately, so no other stock can take them.'
          : 'If CR is below the minimum, the candidate is skipped and the walk moves to the next stock. No buy-stop is placed.'}
      </Rule>
      <Rule id="E4" name="How a buy-stop fills">On the first day the stock's high reaches the trigger, it is
        bought at the trigger price — or at that day's opening price if the stock gapped above the trigger.</Rule>
      <Rule id="E5" name="Expiry">If the trigger is never reached, the order lapses at the end of the month and
        its cash returns to the pool. The stock gets no special treatment next month; it must qualify again from
        scratch.</Rule>
      <Rule id="E6" name="Unfilled slots">If the walk reaches rank {params.threshold} with slots still open, they
        stay in cash until a later month.</Rule>
    </Section>

    <Section title="5. Exit rules" hint="When a holding is sold">
      <p>At each month-end every holding is checked against the rules below. If any one is true, the stock is
        sold at that month's close. All reasons that apply are recorded in the trade log.</p>
      <Rule id="X1" name="Rank exit" on={true}>Sold when the stock falls outside the hold zone (rank worse than
        {' '}{params.threshold}), or can no longer be ranked at all, which includes leaving the universe or being
        newly excluded.</Rule>
      <Rule id="X2" name="Trend exit" on={params.exit_ema}>
        Sold when the close falls below the {params.ema_span}-month EMA, even if the rank is still good. This is
        what takes the portfolio out of a stock whose trend has genuinely turned.
      </Rule>
      <Rule id="X3" name="Stop-loss" on={params.exit_sl}>
        Sold when the close is <span className="setting">{pct(params.sl_pct)}</span> or more below the entry
        price.
      </Rule>
      <Rule id="X4" name="Trailing stop" on={params.exit_ts}>
        Sold when the close falls <span className="setting">{pct(params.ts_pct)}</span> below the highest
        month-end close recorded since entry.
      </Rule>
      <div className="callout">The entry filters are never re-applied to a stock you already own. A holding that
        becomes extended, or closes weakly, is kept — only the exit rules above can sell it. That is deliberate:
        the biggest winners spend most of their life looking expensive.</div>
    </Section>

    <Section title="6. Money, costs and sizing" hint="How much goes into each position">
      <Rule id="A1" name="Equal share of available cash">Cash available after the sells is divided equally among
        the slots being filled that month. On the very first month that is the starting capital divided by
        {' '}{params.top_n}.</Rule>
      <Rule id="A2" name="No rebalancing of winners">Holdings that are kept are never topped up or trimmed. A
        stock that doubles becomes a larger share of the portfolio and stays that way until it is sold.</Rule>
      <Rule id="A3" name="Reserved cash">Cash behind a pending buy-stop is set aside and cannot be spent on
        another stock. It returns to the pool only if the order expires.</Rule>
      <Rule id="A4" name="Costs">A flat <span className="setting">{draft.cost}%</span> is charged on every buy and
        every sell, covering brokerage, STT and slippage. Backtests are shown both gross and net; the Net view is
        the honest one. Taxes are not modelled.</Rule>
      <Rule id="A5" name="Idle cash">Uninvested cash earns
        {' '}<span className="setting">{(params.cash_ret * 100).toFixed(2)}% a year</span>, applied monthly.</Rule>
      <Rule id="A6" name="Portfolio value">Cash plus reserved cash plus the market value of every holding.
        Quantities are fractional, so no rounding to whole shares is applied.</Rule>
    </Section>

    <Section title="7. The two views" hint="What Present holdings and Backtest each do">
      <p><strong>Present holdings</strong> runs the strategy from the month you choose up to the last completed
        month and shows the portfolio as it stands today. Holdings are priced at CMP, the most recent daily close
        available, so returns and weights are current rather than month-end. A buy-stop whose trigger has already
        been hit this month appears under current holdings at its actual fill price; only orders still waiting
        remain in the pending list.</p>
      <p><strong>Backtest</strong> simulates the same rules between two months. The portfolio is formed at the
        close of the month before the first holding month, rebalanced at every month-end, and valued at the final
        close without trading. Results are compared with the Nifty 50, the Nifty 500, and an equal-weight
        portfolio of the same universe. That last line is the fairest benchmark, because it shares the universe
        and any bias in it, so the gap between it and the strategy is what the stock selection actually added.</p>
      <div className="callout">A month counts as complete from 5 pm IST on its last calendar day, so the signal
        can be generated on the evening of the month's final session. In live trading the closing price is known
        only after the close, so orders go in NSE's post-close session or at the next day's open.</div>
    </Section>

    <Section title="8. Where the data comes from">
      <ul>
        <li><strong>Index membership</strong> — niftyindices.com, falling back to the NSE archives and then to a
          snapshot bundled with the app. The app tells you when a bundled snapshot was used.</li>
        <li><strong>Quality Stocks</strong> — a saved Chartink screen, captured near the end of each quarter and
          applied to the quarter that follows.</li>
        <li><strong>Prices</strong> — Yahoo Finance daily open, high, low and close, adjusted for splits and
          bonuses but not dividends unless you switch that on in Settings.</li>
        <li><strong>Benchmarks</strong> — Nifty 50 and Nifty 500 closes from niftyindices.com, with Yahoo as a
          fallback. Both are price indices and exclude dividends.</li>
      </ul>
    </Section>

    <Section title="9. What the results do not account for" hint="Read every backtest with these in mind">
      <ol>
        <li><strong>Look-ahead bias</strong> on index universes without an uploaded constituent history: stocks
          promoted into an index after rallying are available from the start.</li>
        <li><strong>Survivorship</strong>: delisted and merged companies are usually missing from the price data,
          so their collapse never appears in the results.</li>
        <li><strong>Repainting</strong>: a historical screener list built from today's fundamentals flatters a
          backtest. The one-quarter lag reduces this but does not remove it.</li>
        <li><strong>Fills at the close</strong>: the exact closing price is rarely obtainable in practice, and a
          real stop order can fill worse than its trigger.</li>
        <li><strong>Taxes</strong>: short-term capital gains on a strategy that turns over several times a year
          are a material cost and are not modelled anywhere.</li>
        <li><strong>Liquidity</strong>: on the broader universes the ranking can surface thinly traded small and
          micro caps where the real cost of trading is far above the assumed figure.</li>
        <li><strong>Month-end checks only</strong>: a stock can fall well past a stop level inside the month
          before any exit rule looks at it.</li>
        <li><strong>Data quality</strong>: an unadjusted split or bonus shows up as a false crash or rally.
          Verify any surprising single-month move before trading on it.</li>
      </ol>
      <p>The output is the result of a fixed set of rules applied to historical prices. It is research, not
        investment advice.</p>
    </Section>
  </div>
}

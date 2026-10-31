# Telegram signal bot

Cloudflare Worker (5 crons, UTC) that scans the top 125 Bybit USDT perps on the 1H, 4H and 1D timeframes in the first minutes after each candle closes. It posts signals from the latest closed candle to Telegram with a chart (entry, SL, TP1-3, EMAs) and the reasons for the trade.

Strategies: EMA 50/200 retest and fresh FVG entry fills. A signal is posted only if it passes at least `MIN_CONF` (default 6) of the same 8 confirmations as the website Signals tab: Trend 5/5 (incl. open interest), EMA stack, ADX>=20, Vol>=1x, Funding ok, FVG entry, VWAP flip, Value area reclaim. The message lists every check with a tick or cross.

## Setup
1. Telegram: create a bot with @BotFather, copy the token. Create a channel/group and add the bot as admin. Get the chat id (e.g. `@mychannel` or `-100...`).
2. Secrets (never commit these):
   ```
   npx wrangler secret put TG_TOKEN
   npx wrangler secret put TG_CHAT
   npx wrangler secret put RUN_KEY   # optional, enables /__run?key=... for a manual test
   ```
3. Deploy (Cloudflare git build does this on push). The scan crons `1-5 * * * *` (1H), `1-5 */4 * * *` (4H) and `1-5 0 * * *` (1D) pick the timeframe. 15M was dropped after the backtest (negative after fees); to bring it back add the cron `1-5,16-20,31-35,46-50 * * * *`.

Notes: Check data access with `/__run`. The free Workers plan allows 50 subrequests per run, so `TOP` stays at 30.

## Symbols and data
Data comes from the Bybit public API (`bot/data.js`), because Binance returns HTTP 403 to Cloudflare Workers. Coins are ranked by 24h turnover (commodities and stock perps skipped) and split into 5 batches of `BATCH` (25) = top 125 coins. Each scan cron fires at minute 1-5 after a candle close and scans one batch per minute, because the free Workers plan allows 50 subrequests per run. Set `SYMBOLS` in `wrangler.jsonc` to scan a fixed list instead.

Manual test: `/__run?key=<RUN_KEY>&batch=0` (batch 0-4).

## Trade tracking and weekly report
Needs the KV namespace bound as `TRADES` (see `wrangler.jsonc`). Every posted signal is stored; a cron every 15 min checks closed 15m candles and replies to the original message with a chart:
- TP1 hit: move SL to breakeven. TP2 hit: move SL to TP1. TP3 hit: trade complete.
- SL hit: loss (-1R); after TP1 it is a breakeven exit (0R); after TP2 it is a TP1 exit (+1R).
- If one candle touches both stop and target, the stop is counted first.
- Open trades older than 7 days are dropped as EXPIRED.
- Monday 04:00 UTC (09:30 IST) a weekly report is posted. Results are R-multiples with each trade exiting at its final stop/target.

Manual checks (add `?key=RUN_KEY`): `/__track`, `/__weekly`, `/__ping`, `/__run?batch=0..4&min=N`.

## Backtest
`node bot/backtest.mjs 1h 40 4000` replays the rules on Bybit history (coins, bars). Findings (40 coins, ~166 days of 1H, net of ~0.13% fees, OI/funding assumed ok so slightly optimistic, in-sample): CHoCH and BOS entries with >=7/8 were positive (+0.23R and +0.46R per trade), EMA retest and Fibonacci pullback were negative, 15M was negative at every confidence level. So live signals are only FVG entries (CHoCH/BOS) on 1H; `findSignals` has opt-in flags `ema` and `fib`.

Fibonacci variants (`FIBV=1 node bot/backtest.mjs 4h 40 3000`): on 1H every variant was negative after fees. On 4H (~500 days) all were positive, best was a leg of at least 4 ATR (97 trades, +0.45R, 41% wins). 4H FVG entries (CHoCH/BOS, >=7/8) were +0.7R per trade. Live: 1H = FVG entries; 4H = FVG entries plus the Fibonacci pullback with `minLeg: 4` (`STRAT` in `bot/worker.js`). Small samples, in-sample, OI/funding assumed: treat as a hint, not proof.

## Round 2 backtest (real open-interest and funding history)
`node bot/backtest.mjs <tf> <coins> <bars>` now uses Bybit OI and funding history and prints filter/exit variants (>=7/8, net of fees, 40 coins):
- 4H (3000 bars): 336 trades, 63% wins, +0.74R/trade. 1H (4000 bars): 418 trades, 51%, +0.44R. 1D (1500 bars): 96 trades, 78%, +0.9R.
- Both halves of the period were positive on every timeframe.
- Higher-timeframe trend or BTC-trend filters cut the trade count but did not raise R per trade, so they are not used. Taking 50% off at TP1 lowered R (+0.56 vs +0.74 on 4H), so exits stay as they are. One open trade per coin changes little and is enforced live.
- Caveats: the coin list is today's top-volume coins (survivorship bias), one market regime, no slippage on stops, trades are correlated. Treat results as an upper estimate.

## Extras
- `RISK_USD` adds a position-size line to each signal. `MAX_DAY` caps signals per UTC day. `INCLUDE` adds extra symbols (e.g. `XAUUSDT,XAGUSDT,CLUSDT,BZUSDT`) to the last batch.
- A trade already open on a coin blocks a new signal on it.
- The cron at 18:30 UTC (00:00 IST) posts a daily summary, plus the weekly report on Sundays.
- `/api/trades` serves open and recent closed trades as JSON for `smc-screener/live.html`.

## Robustness checks (end of `backtest.mjs` output)
Fees x2/x3, four time chunks, results without the best trades, share of coins with positive average R, and a bootstrap 95% range.
- 4H: stays +0.58R at 3x fees, all 4 chunks positive (+0.58 to +0.97), 32/39 coins positive, bootstrap range +0.57..+0.97.
- 1D: +0.85R at 3x fees, 18/24 coins positive, range +0.56..+1.33 (only ~90 trades).
- 1H: weakest. +0.22R at 2x fees and about 0 at 3x, about 0 without the top 10% of trades, last chunk +0.19. Bootstrap range +0.25..+0.64. Keep fees low (limit entries) and watch it live.

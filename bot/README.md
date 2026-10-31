# Telegram signal bot

Cloudflare Worker (4 crons, UTC) that scans the top 125 Bybit USDT perps on the 1H and 4H timeframes in the first minutes after each candle closes. It posts signals from the latest closed candle to Telegram with a chart (entry, SL, TP1-3, EMAs) and the reasons for the trade.

Strategies: EMA 50/200 retest and fresh FVG entry fills. A signal is posted only if it passes at least `MIN_CONF` (default 6) of the same 8 confirmations as the website Signals tab: Trend 5/5 (incl. open interest), EMA stack, ADX>=20, Vol>=1x, Funding ok, FVG entry, VWAP flip, Value area reclaim. The message lists every check with a tick or cross.

## Setup
1. Telegram: create a bot with @BotFather, copy the token. Create a channel/group and add the bot as admin. Get the chat id (e.g. `@mychannel` or `-100...`).
2. Secrets (never commit these):
   ```
   npx wrangler secret put TG_TOKEN
   npx wrangler secret put TG_CHAT
   npx wrangler secret put RUN_KEY   # optional, enables /__run?key=... for a manual test
   ```
3. Deploy (Cloudflare git build does this on push). The scan crons `1-5 * * * *` (1H) and `1-5 */4 * * *` (4H) pick the timeframe. 15M was dropped after the backtest (negative after fees); to bring it back add the cron `1-5,16-20,31-35,46-50 * * * *`.

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

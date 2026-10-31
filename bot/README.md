# Telegram signal bot

Cloudflare Worker (5 crons, UTC) that scans the top 125 Bybit USDT perps on the 4H timeframe in the first minutes after each candle closes. It posts signals from the latest closed candle to Telegram with a chart (entry, SL, TP1-3, EMAs) and the reasons for the trade.

Strategies: EMA 50/200 retest and fresh FVG entry fills. A signal is posted only if it passes at least `MIN_CONF` (default 6) of the same 8 confirmations as the website Signals tab: Trend 5/5 (incl. open interest), EMA stack, ADX>=20, Vol>=1x, Funding ok, FVG entry, VWAP flip, Value area reclaim. The message lists every check with a tick or cross.

## Setup
1. Telegram: create a bot with @BotFather, copy the token. Create a channel/group and add the bot as admin. Get the chat id (e.g. `@mychannel` or `-100...`).
2. Secrets (never commit these):
   ```
   npx wrangler secret put TG_TOKEN
   npx wrangler secret put TG_CHAT
   npx wrangler secret put RUN_KEY   # optional, enables /__run?key=... for a manual test
   ```
3. Deploy (Cloudflare git build does this on push). Change `TF` in `wrangler.jsonc` (`1h`/`4h`/`1d`) together with the cron.

Notes: Check data access with `/__run`. The free Workers plan allows 50 subrequests per run, so `TOP` stays at 30.

## Symbols and data
Data comes from the Bybit public API (`bot/data.js`), because Binance returns HTTP 403 to Cloudflare Workers. Coins are ranked by 24h turnover (commodities and stock perps skipped) and split into 5 batches of `BATCH` (25) = top 125 coins. Five cron triggers (minute 1-5 of every 4th hour) scan one batch each, because the free Workers plan allows 50 subrequests per run. Set `SYMBOLS` in `wrangler.jsonc` to scan a fixed list instead.

Manual test: `/__run?key=<RUN_KEY>&batch=0` (batch 0-4).

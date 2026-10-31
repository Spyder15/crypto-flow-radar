# Telegram signal bot

Cloudflare Worker (cron `1 */4 * * *`, UTC) that scans the top Bybit USDT perps on the 4H timeframe one minute after each candle closes. It posts signals from the latest closed candle to Telegram with a chart (entry, SL, TP1-3, EMAs) and the reasons for the trade.

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
Data comes from the Bybit public API (`bot/data.js`), because Binance returns HTTP 403 to Cloudflare Workers. By default the top `TOP` (25) USDT perps by 24h turnover are scanned, with commodities and stock perps skipped. Set `SYMBOLS` in `wrangler.jsonc` (e.g. `"BTCUSDT,ETHUSDT"`) to scan a fixed list instead. The free Workers plan allows 50 subrequests per run, so keep `TOP` at or below 25.

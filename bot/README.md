# Telegram signal bot

Cloudflare Worker (cron `1 */4 * * *`, UTC) that scans the top Binance USDT perps on the 4H timeframe one minute after each candle closes. It posts signals from the latest closed candle to Telegram with a chart (entry, SL, TP1-3, EMAs) and the reasons for the trade.

Strategies: EMA 50/200 retest, and FVG entry fills (trend score >= 3/4).

## Setup
1. Telegram: create a bot with @BotFather, copy the token. Create a channel/group and add the bot as admin. Get the chat id (e.g. `@mychannel` or `-100...`).
2. Secrets (never commit these):
   ```
   npx wrangler secret put TG_TOKEN
   npx wrangler secret put TG_CHAT
   npx wrangler secret put RUN_KEY   # optional, enables /__run?key=... for a manual test
   ```
3. Deploy (Cloudflare git build does this on push). Change `TF` in `wrangler.jsonc` (`1h`/`4h`/`1d`) together with the cron.

Notes: Binance may block some Cloudflare regions (HTTP 451); check with `/__run`. The free Workers plan allows 50 subrequests per run, so `TOP` stays at 30.

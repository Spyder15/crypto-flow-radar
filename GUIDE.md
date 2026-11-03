# Crypto Flow Radar: A to Z Guide

Ye guide naye developer ke liye hai. Isse repo samajh kar chalana, deploy karna aur debug karna aa jaayega.
(Folder ka naam "HOTEL OFFER ORCHESTER" purana hai. Project asal mein **crypto-flow-radar** hai: ek crypto trading-signal bot + website.)

> Not financial advice. Backtest results in-sample hain. Signals ko hint samjho, guarantee nahi.

---

## 1. Ye project kya karta hai

- **Telegram bot**: Bybit ke top 125 USDT perpetual coins ko 1H, 4H aur 1D timeframe par scan karta hai. Jab setup (CHoCH/BOS + FVG entry) 8 mein se kam se kam `MIN_CONF` confirmations pass karta hai, toh chart ke saath signal bhejta hai: Entry, SL, TP1, TP2, TP3.
- **Trade tracking**: har signal ko 15-min candles se track karta hai aur Telegram par update bhejta hai (TP1 hit, SL breakeven par, TP2 hit, SL TP1 par, SL hit, TP3 hit).
- **Radar**: whale wallets (Hyperliquid), funding aur volume bursts se "trade ideas" banata hai.
- **Website**: dashboard, live results, radar page (static site).
- **Reports**: daily aur weekly summary.

## 2. Teen hisse (3 parts)

| # | Part | Folder / file | Kahan chalta hai |
|---|------|---------------|------------------|
| 1 | **Bot (Cloudflare Worker)** | `bot/`, `wrangler.jsonc` | Cloudflare Workers (cron se) |
| 2 | **Website** | `smc-screener/` | Cloudflare Worker "assets" aur GitHub Pages |
| 3 | **Automation (GitHub Actions)** | `.github/workflows/` | GitHub |

Saath mein ye services use hoti hain:
- **Bybit public API**: candles, open interest (OI), funding, tickers. (Binance Cloudflare Workers ko 403 deta hai, isliye Bybit.)
- **Telegram Bot API**: messages aur photos bhejne ke liye.
- **Cloudflare KV (`TRADES`)**: saari state yahin save hoti hai.
- **QuickChart**: chart image banane ke liye (sirf public candles aur price levels jaate hain).
- **Hyperliquid API aur leaderboard**: whale wallets ke liye.

## 3. Folder structure

```
wrangler.jsonc        Worker config: crons, vars, KV binding, assets
bot/
  worker.js           Entry point: cron routing, run() scanner, Telegram send, HTTP endpoints
  signals.js          Signal logic: swings, CHoCH/BOS, FVG, 8 confirmations, TP/SL levels
  data.js             Bybit API wrapper (6 hosts fallback)
  chart.js            QuickChart image builder
  track.js            Open trades tracking, TP/SL events, watchdog, daily/weekly report
  radar.js            Hourly radar: funding extremes + volume bursts -> ideas
  ideas.js            Radar trade ideas ka track record (SL -1R, TP1 +1.5R)
  whalewatch.js       Hyperliquid whale wallets ke open/close/flip alerts
  whales-list.mjs     whales.json refresh script (daily Action chalata hai)
  backtest.mjs        Strategy backtest (node se chalao)
smc-screener/         Static website (index, dashboard, live, radar) + lib.js (shared logic)
.github/workflows/    pages.yml (site deploy), whales.yml (whale list refresh + worker deploy)
```

`smc-screener/lib.js` bot aur website dono use karte hain, isliye rules dono jagah same rehte hain.

## 4. Signal kaise banta hai (run flow)

1. Cron candle close ke 1 se 5 minute baad chalta hai.
   - `1-5 * * * *` = 1H, `1-5 */4 * * *` = 4H, `1-5 0 * * *` = 1D.
   - Minute 1 se 5 = batch 0 se 4. Har batch 25 coins ka hota hai (top 125 coins turnover ke hisaab se). Free plan mein ek run mein max 50 subrequests allowed hain, isliye batches mein baanta hai.
2. `data.js` se tickers aur 400 candles aate hain. Aakhri (forming) candle drop hota hai.
3. `signals.js` swings, CHoCH/BOS aur FVG entry dhoondhta hai (4H par Fibonacci pullback bhi).
4. **8 confirmations**: Trend 5/5 (OI ke saath), EMA stack, ADX>=20, Volume>=1x, Funding ok, FVG entry, VWAP flip, Value-area reclaim. Kam se kam `MIN_CONF` pass hone chahiye.
5. Filters: us candle ka signal pehle post na hua ho, us coin ka trade already open na ho, aur roz ka cap `MAX_DAY` (12) na ho.
6. Chart banta hai, Telegram par jaata hai, aur trade KV mein save hota hai (`o:SYMBOL:tf:t0`).

Levels: SL structure se, TP1 = 1R, TP2 aur TP3 uske multiples (`RR = 2.5` ke aas-paas). `RISK_USD` se position size line message mein aati hai.

## 5. Trade tracking (`track.js`)

- Har 15 minute (minute `%15 == 0`) par open trades ke 15m candles check hote hain.
- Stages: 0 = original SL, 1 = TP1 hit (SL = entry), 2 = TP2 hit (SL = TP1), 3 = TP3 (trade complete).
- Agar ek candle stop aur target dono touch kare, toh **stop pehle** gina jaata hai (conservative).
- Outcomes: `SL` (-1R), `BE` (0R), `TP1STOP` (+1R), `TP3`. Purane trades `EXPIRED` hote hain (1H 7 din, 4H 14 din, 1D 30 din).
- Har event original message par reply banke jaata hai, chart ke saath.
- Closed trades `closed` key mein save hote hain (aakhri 300), aur weekly/daily report inhi se banta hai.
- `isLive`: sirf 1H/4H/1D aur `passed >= 6` wale trades stats aur website mein ginte hain.

## 6. Reliability (alert kabhi lost na ho)

Ye sab history mein bugs fix karke jodha gaya:
- **`pending` retry**: alert bhejna fail ho toh event trade ke `pending` mein jaata hai aur har 15 min mein text-only dobara bheja jaata hai.
- **Telegram 429**: `tgFetch` retry_after ke hisaab se ruk kar ek baar dobara try karta hai. Photo fail ho toh text par fallback.
- **Entry send fail**: sirf wo signal skip hota hai, batch nahi rukta.
- **Watchdog** (`watchdog()`, har 15 min par minute :07): agar tracker 45+ min se fail hai ya alerts atke hain, toh Telegram par "⚠️ Radar health warning" aata hai (3 ghante mein ek baar).
- **Health keys** KV mein: `health:track`, `health:track:ok`, `health:warned`.
- **Message ID**: closed trades mein `msg` save hota hai, taaki check ho sake ki Telegram ne message accept kiya tha.

## 7. Radar, ideas aur whales

- `radar.js` (har ghante, minute 5): volume bursts aur crowded funding dhoondhta hai. Wallet net position aur burst milkar "idea" banate hain (`ideas.js`).
- `ideas.js` (minute %15 == 10): ideas ko score karta hai (SL = -1R, TP1 = +1.5R, 48 ghante mein expire).
- `whalewatch.js` (har 5 min): `smc-screener/whales.json` ke wallets ki Hyperliquid positions dekhta hai aur open/close/flip alert deta hai.
- GitHub Action `whales.yml` roz 03:00 UTC par whales list refresh karke commit aur deploy karta hai.

## 8. Cron schedule (UTC)

| Cron | Kaam |
|------|------|
| `1-5 * * * *` | 1H scan (5 batches) |
| `1-5 */4 * * *` | 4H scan |
| `1-5 0 * * *` | 1D scan |
| `*/5 * * * *` | Har 5 min: whale alerts. Minute %15==0 par tracker, %15==7 par watchdog, %15==10 par ideas, minute 5 par radar |
| `30 18 * * *` | 00:00 IST: daily summary (Sunday ko weekly bhi) |

Tracker wale run mein `whaleWatch` nahi chalta, kyunki ek invocation ki subrequest limit (50) tracker ko chahiye.

## 9. Config (`wrangler.jsonc` vars)

| Var | Matlab | Abhi |
|-----|--------|------|
| `MIN_CONF` | Kam se kam kitne confirmations (8 mein se) | 6 |
| `MAX_DAY` | Roz ke max signals (UTC din) | 12 |
| `BATCH` | Ek batch mein coins | 25 |
| `RISK_USD` | Position size line ke liye | 100 |
| `SYMBOLS` | Fixed list, khaali = top coins | "" |
| `INCLUDE` | Extra symbols (gold, silver, oil) last batch mein | XAUUSDT, XAGUSDT, CLUSDT, BZUSDT |
| `TF` | Default timeframe | 1h |

**Secrets** (kabhi commit mat karo):
```
npx wrangler secret put TG_TOKEN   # BotFather se token
npx wrangler secret put TG_CHAT    # chat/channel id (@name ya -100...)
npx wrangler secret put RUN_KEY    # manual endpoints ki key
```
GitHub secret: `CLOUDFLARE_API_TOKEN` (whales Action se auto-deploy ke liye).

## 10. Setup aur deploy

1. Telegram: @BotFather se bot banao, channel/group mein bot ko admin banao, chat id nikalo.
2. Cloudflare: KV namespace banao aur `wrangler.jsonc` mein `TRADES` binding ki `id` badlo.
3. Secrets set karo (upar).
4. Deploy: `npx wrangler deploy` (ya Cloudflare git build push par karta hai).
5. Test: `/__ping?key=RUN_KEY` se Telegram connection check karo.

## 11. Manual endpoints

Saare `?key=RUN_KEY` maangte hain (ya `Authorization` header):

| Endpoint | Kaam |
|----------|------|
| `/__ping` | Telegram test message |
| `/__run?tf=1h&batch=0..4&min=N` | Abhi scan chalao |
| `/__run?...&test=1` | Max 2 sample signals (min conf 4, track nahi hote) |
| `/__track` | Open trades abhi check karo |
| `/__weekly?days=7` | Report abhi post karo |
| `/__whales`, `/__radar`, `/__ideas` | Whale, radar, ideas run karo |

Public (bina key): `/api/trades` aur `/api/ideas` (JSON, website use karti hai).

## 12. Debugging cheat sheet

```
npx wrangler tail --format pretty                       # live logs
npx wrangler kv key list --namespace-id <ID> --remote --prefix "o:"   # open trades
npx wrangler kv key get closed --namespace-id <ID> --remote           # closed trades
npx wrangler kv key get health:track --namespace-id <ID> --remote     # tracker health
```

KV keys: `o:SYM:tf:t0` (open trade), `s:SYM:tf:t0` (is candle ka signal post ho chuka, 6 ghante), `d:YYYY-MM-DD` (din ka counter), `closed`, `ideas_open`, `health:*`.

Common problems:
- **Signal nahi aa raha**: `MIN_CONF` bahut strict ho sakta hai, `MAX_DAY` poora ho gaya ho, ya us coin ka trade already open ho.
- **Bybit 403**: kabhi-kabhi aata hai. Tracker agle run mein catch-up karta hai (cursor save rehta hai), alert late aata hai lekin lost nahi hota.
- **"Too many subrequests"**: free plan limit 50. Retry loops ya extra fetches mat badhao.
- **Alert nahi aaya**: `health:track` ke errors dekho, trade ka `pending` check karo.

## 13. Ab tak jo kiya aur seekha (changelog ka saar)

- Radar trade ideas, whale wallet alerts, feed persistence aur daily whale list refresh banaye.
- `MIN_CONF` 7 se 6 kiya (zyada signals); `isLive` threshold bhi 6 kiya taaki 6/8 trades stats mein aayein.
- **Bada bug mila aur fix hua**: `eventText` mein saare message variants ek saath banate the, aur TP3 wale variant mein `R(t.r)` open trade par `undefined` par crash karta tha. Is wajah se **har TP1 aur TP2 message fail** hota tha, sirf close hone wale messages jaate the. Ab `R()` safe hai.
- Telegram failure par alert kho jaata tha. Ab `pending` retry, 429 handling aur watchdog hain.
- Bybit par retry round try kiya, lekin subrequest limit khaa gaya, isliye hata diya.
- Tracker wale run se `whaleWatch` alag kiya.
- Closed trades mein Telegram `msg` ID save hone lagi.

## 14. Backtest (`node bot/backtest.mjs 4h 40 3000`)

Bybit history, OI aur funding history ke saath, fees ke baad (~0.13%). Approx (40 coins, in-sample): 4H ~ +0.7R/trade, 1D ~ +0.9R, 1H sabse kamzor (~ +0.4R, 3x fees par ~0). Isliye live strategy: 1H = FVG entries, 4H = FVG + Fibonacci pullback (`minLeg: 4`), 1D = FVG. Limits: survivorship bias, ek market regime, slippage nahi, trades correlated. Details `bot/README.md` mein hain.

## 15. Safe tarike se kaam karne ke rules

- Secrets commit mat karo; `RUN_KEY` ke bina `/__*` endpoints kaam nahi karte.
- `signals.js` ya `lib.js` badlo toh backtest dobara chalao, aur website tathaa bot dono par asar dekho.
- Cron ya batch badlo toh subrequest budget (50 per run) ka dhyan rakho.
- Deploy ke baad `wrangler tail` se agla cron run dekho.
- Pehle `?test=1` se format check karo, phir live jaao.

## 16. Pata hone wali baatein

- Root `README.md` sirf placeholder hai; asli docs `bot/README.md` aur ye guide hain.
- `bot/README.md` mein weekly report ka time "Monday 04:00 UTC" likha hai, lekin code mein daily summary 18:30 UTC par hai aur weekly Sunday ko saath mein jaata hai.
- Telegram mein entry message gayab hone ka ek case (TAO) tha jiski wajah confirm nahi hui. Ab `msg` ID save hone se agli baar check ho sakta hai.

## 17. Spyder Strategy (experimental, paper-tracked)

Ek alag experimental strategy `bot/spyder-strategy.js` mein hai aur `bot/spyder.js` main worker ke andar chalti hai (free plan par account mein sirf 5 crons allowed hain, isliye alag worker nahi).

- **Rules**: 1H par pichli candle ki body (>=80% of range) bearish/bullish, uska body edge usse pehli candle se align (tol 0.3%), phir current candle dono bodies ko sweep karke wapas andar close kare. Entry usi close par, SL sweep wick ke bahar, fixed TP 2R (1:2), chart ke saath.
- **Kahan chalti hai**: 1H scan mein jo candles main bot pehle se fetch karta hai unhi par check hota hai (extra data call nahi). Tracking `*/5` cron par minute :20, :35, :50 par.
- **KV keys**: `sp:o:*` (open), `sp:s:*` (dedupe), `sp:d:*` (daily count), `sp:closed`. Max 8 signals/din, 12 open.
- **Warning**: `node bot/backtest-spyder.mjs 1h 40 3000` ka result fees ke baad negative ya ~0 tha. Ye sirf live result naapne ke liye hai. `/__spyder?key=RUN_KEY` se stats (win rate, net R) dekho.
- **Bot 2 (markets, Spyder-only)**: `wrangler.markets.jsonc` alag Cloudflare account par deploy hota hai (`npx wrangler deploy -c wrangler.markets.jsonc`). `ONLY_SPYDER=1` se sirf Spyder chalti hai, `CRYPTO_EXTRAS=0` se whale/ideas/radar band, aur `SYMBOLS` mein gold, silver, oil, forex aur stocks ke 24 Bybit symbols hain. Preview: `/__spydersample?key=RUN_KEY`.

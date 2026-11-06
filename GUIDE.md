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

- **Rules**: 1H par pichli candle ki body (>=70% of range) bearish/bullish, uska body edge usse pehli candle se align (tol 0.5%), phir current candle dono bodies ko sweep karke wapas andar close kare. Entry usi close par, SL sweep wick ke bahar, fixed TP 2R (1:2), chart ke saath.
- **Kahan chalti hai**: 1H scan mein jo candles main bot pehle se fetch karta hai unhi par check hota hai (extra data call nahi). Tracking `*/5` cron par minute :20, :35, :50 par.
- **KV keys**: `sp:o:*` (open), `sp:s:*` (dedupe), `sp:d:*` (daily count), `sp:closed`. Max 8 signals/din, 12 open.
- **Warning**: `node bot/backtest-spyder.mjs 1h 40 3000` ka result fees ke baad negative ya ~0 tha. Ye sirf live result naapne ke liye hai. `/__spyder?key=RUN_KEY` se stats (win rate, net R) dekho.
- **Bot 2 (markets, Spyder-only)**: `wrangler.markets.jsonc` alag Cloudflare account par deploy hota hai (`npx wrangler deploy -c wrangler.markets.jsonc`). `ONLY_SPYDER=1` se sirf Spyder chalti hai, `CRYPTO_EXTRAS=0` se whale/ideas/radar band, aur `SYMBOLS` mein gold, silver, oil, forex aur stocks ke 24 Bybit symbols hain. Preview: `/__spydersample?key=RUN_KEY`.

## 18. Paper bot (`paper-bot/`), alag bot

Bybit ke liye fake-money ($100) trading bot, upar ke Cloudflare bots se bilkul alag (GitHub Actions pe har 15 min chalta hai). Risk 1% per trade, max drawdown 3% par auto HALT. Details `paper-bot/README.md` me, settings `paper-bot/config.json` me, state `paper-bot/state.json` me.

## 19. Meme token website "SPYDER TRENCH" (`meme-token/`), alag project

TrenchWatch jaisi live website: kaun se meme tokens me bade buys aa rahe hain aur **paisa kahan aa/ja raha hai**. Ye tracker hai, kuch khareedta nahi. **Live URL: https://meme-trench.spyder-radar.workers.dev**

### 19.1 Site me kya dikhta hai
**Do views (header me toggle):** **MARKET FLOW** (default, poora crypto market) aur **MEME TRENCH** (neeche wala, on-chain memecoins).
- **MARKET FLOW**: verdict (RISK-ON/OFF), Total mcap, 24h vol, BTC dominance, Altcoins mcap, Fear & Greed, Stablecoin supply (24h/7d). **Sector heatmap**: Layer 1/2, DeFi, AI, Memecoins, NFT, Gaming, RWA, DePIN, Privacy, Stablecoins, ecosystems... har sector ka 24h mcap change = paisa IN/OUT. Tile click = us sector ke top coins. Niche top-100 coins table (1h/24h/7d, mcap, volume; gainers/losers/volume sort) aur Binance WebSocket se price ~1s me live. Data: CoinGecko, DefiLlama, alternative.me (sab open CORS, key nahi chahiye).
- **Token money flow**: top 10 coins jisme sabse zyada paisa IN / OUT (24h mcap change $); sector tile click karo to usi sector ke tokens. **Whale radar**: Binance aggTrade WebSocket se **saare Binance USDT coins** (~400+) ke bade trades. Coin table me Show 250 button aur search box (top 250 coins ki list me koi bhi coin). Filter chips: All / Majors (BTC, ETH, top-10) / Altcoins / Memes. Threshold: BTC/ETH $500k+, baaki liquidity ke hisaab se $50k-$200k+. Summary: last 30 min me kis coin me whales BUY/SELL kar rahe hain. Plus 17 chains ke DEX memecoins ke on-chain whale wallets. NOTE: NFT collections aur Binance pe listed na hone wale tokens ka whale data nahi hai. Coin table me "Live net buying" = taker buy minus sell (page khula hone ke baad se). Exchange whales anonymous hote hain, wallet naam sirf on-chain memes me.
- **MEME TRENCH** details:
- **Ticker tape** (sabse upar): chains ka net flow scroll hota rehta hai.
- **Search box** (header): symbol / address se token dhundo.
- **KPI strip** (5 box): Net flow 1h, Top inflow chain, Top outflow chain, Big buys 1h, Whale buys 24h (>= $10k).
- **Chain heatmap**: har chain ek tile (green = inflow, red = outflow); click karo to us chain ka filter lag jata hai. Chain chips bhi hain.
- **Left panel (tabs)**: *Tokens* sortable table (MC, Liq, Vol24, 24h%, Flow 1h + 5m B/S, Buys 1h, Bought, Safe, Chart/Swap), *Heating up* (1h/6h/24h), *Inflow/Outflow* tables. Header click = sort.
- **Right: Live buys tape**: naye buys green flash ke saath, WHALE badge (>= $10k). Filters: Min buy, Safety (Hide risky).
- **Refresh**: DexScreener loop ~1s (MC/liq/vol/5m B-S), GeckoTerminal trades ~2-10s late, har 1s tick se redraw, static data har 60s.
- **Theme**: radar site jaisi (kala bg, orange accent, monospace, sharp corners).

### 19.2 Data ka flow (A to Z)
Do layer hain: **(1) server-side snapshot** aur **(2) browser live scan**.

**Layer 1: snapshot (GitHub Actions)**
1. `.github/workflows/meme-token.yml` har 30 min (aur manual "Run workflow") chalta hai. Ek run ~11 min leta hai (free API ki rate limit ki wajah se).
2. `meme-token/whale-buys.js`:
   - GeckoTerminal `trending_pools` se har chain ke hot pools leta hai (`whale-config.json`: networks, `poolsPerNetwork`, `minPoolLiquidityUsd` 10k). Lagbhag 39 pools.
   - Har pool ke `/trades` se: 1h buy/sell volume (flow), aur $500+ buys (`minBuyUsd`) feed me.
   - Chain totals (`chains`), `inflow`/`outflow` top 25 tokens banata hai.
   - GoPlus se rug check (`lib.js` `rugCheck`): honeypot, tax, top10 holders, mintable etc. -> level good / warn / risk / unknown (unsupported chain = unknown). 6 ghante cache.
   - Output: `site/data.json` (deploy hota hai, git me ignore) aur `whale-state.json` (state, commit hota hai).
3. Workflow `npx wrangler deploy` se site ko Cloudflare worker `meme-trench` par deploy karta hai (assets-only worker, `meme-token/wrangler.jsonc`, `account_id` pinned: naya account syndicatecrypto1). Phir `whale-state.json` commit/push karta hai.
4. Free API limits: GeckoTerminal ~30 req/min (429 par 20s wait + retry), isliye run slow hai.

**Layer 2: browser live scan (`site/index.html`)**
Browser khud, apne IP se (dono APIs me open CORS hai), ye loops chalata hai:
- `scan()`: har ~2.2 sec ek pool ka GeckoTerminal `/trades` lata hai. Nayi buys feed me upar daal deta hai, 1h flow aur chain totals delta se update karta hai. Jin tokens me pichle 15 min me buys aayi hain unhe har 3rd check me priority milti hai. 429 par 20 sec ruk jata hai.
- `dexLoop()`: har ~1 sec ek chain ka DexScreener batch (`/latest/dex/pairs/{chain}/{pool,pool,...}`, 30 pools) lata hai: live MC, liquidity, 24h volume, 24h%, 5-min buy/sell counts. MC badalne par 4 sec flash (green/red).
- `tick()` har 1 sec: screen redraw (agar data badla), "12s ago" timers, header "LIVE · tick Xs ago".
- `load()` har 60 sec naya `data.json` (snapshot) lata hai, live buys merge rehti hain.
- **Limit**: ye tab tak chalta hai jab page khula ho. Naye buys 2-10 sec delay se aate hain (free API), price/MC ~1 sec se. Asli real-time ke liye Helius/Alchemy WebSocket + server chahiye (paid key).

### 19.3 Files
- `meme-token/whale-buys.js`: snapshot generator. `whale-config.json`: chains, thresholds. `lib.js`: `rugCheck`, `getJson`. `wallets.json`: `"address": "@handle"` se naam dikhao (placeholder `ADDRESS_HERE` ignore hota hai). `whale-state.json`: state.
- `meme-token/site/index.html`: poora frontend (HTML+CSS+JS ek file).
- `meme-token/scan.js`: alag manual Telegram scanner (`node meme-token/scan.js --dry`): DexScreener profiles/boosts + rug check.
- `meme-token/wrangler.jsonc`: worker `meme-trench`, assets dir `./site`.

### 19.4 Chalane / deploy ke tarike
- Local test: `cd meme-token && node whale-buys.js` (~10 min), phir `cd site && python3 -m http.server`.
- Manual deploy: `cd meme-token && npx wrangler deploy` (local wrangler naye account syndicatecrypto1 me logged in hai).
- Auto: GitHub Actions (upar). Secret: `CLOUDFLARE_API_TOKEN` (repo secret, naye account ka token, "Edit Cloudflare Workers" / Workers Scripts Edit). Secret ka naam exact hona chahiye, naam ke aage space nahi.
- Chain add karna: `whale-config.json` `networks` me GeckoTerminal network id daalo; chip label ke liye `index.html` me `CH` map aur DexScreener slug alag ho to `DX` map update karo; GoPlus naam alag ho to `whale-buys.js` `GP` map.

### 19.4b Market Flow ke pro features (`site/pro.js`)
Market Flow me sub-tabs: Overview | Derivatives | Movers | Chains & ETF | Watchlist.
- **Derivatives**: Binance futures funding (premiumIndex, 20s), OI + long/short ratio (top 15), live liquidations (`!forceOrder@arr` WebSocket; long liq = SELL side), 15 min bias.
- **Movers**: top 200 coins ka 5m/1h change + volume surge (5m vol / avg 5m vol). PUMP/DUMP/VOL tags.
- **Chains & ETF**: DefiLlama top chains TVL 1d/7d + DEX volume; BTC ETF holdings via worker proxy `/api/etf` (btcetfdata.com, 10 min cache) aur ETH ETF flows via `/api/etf-eth` (xoomar.com, `XOOMAR_KEY` secret).
- **Watchlist**: star click, localStorage `spy.watch`.
- **Chart**: kisi bhi coin symbol pe click: candles + net taker flow (Binance klines).
- **Alerts** (bell): whale/liquidation/pump/sector flip pe toast + sound + desktop notification + optional Telegram (token browser localStorage me). Sirf page khula ho tabhi chalta hai.
- Mobile layout (`@media max-width:700px`). Helius real-time Solana whales API key chahiye, abhi nahi.
- `wrangler.jsonc`: `main: worker.js`, assets binding `ASSETS`, `/api/*` pehle worker.

### 19.4d More tabs (Funding Map, Basis & L/S, Smart Money, Backtest, Alert Rules, Multi-chart, Daily Brief, Views) + PWA + Push
- Funding Map, Basis/L-S/spot-vs-perp (Binance), Smart Money (HL whale fills), Backtest (daily, long-only, overfit-prone), Multi-chart, Daily Brief, Views (shareable `#v=` links).
- Alert Rules run in the page; with **Push ON** they are also checked server-side (price/24h/funding on Hyperliquid) every ~5 min by `.github/workflows/push-check.yml` -> `POST /api/push/run` (secret `PUSH_RUN_KEY`). Cloudflare free plan has no cron slot left. Keys: `VAPID_PRIVATE` secret, `VAPID_PUBLIC` var, KV `PUSH`.
- PWA: `manifest.webmanifest`, `icon.svg`; on iPhone add to Home Screen first.

### 19.4e Coin, History, Liq History, Calc, Paper + extras
- **Coin**: ek coin ka price, funding, OI, whales, liquidations, 7d charts. **History**: funding + OI + price 3/7/20 din.
- **Liq History**: 24h liquidation bars. Browser har 5 min me completed bucket server (`/api/liqhist`, KV `liqh`, max 1 write/5 min) pe bhejta hai. Sirf wahi time dikhta hai jab koi site khole tha.
- **Calc**: position size / risk + PnL. **Paper**: nakli paise se trading (SL/TP/liquidation har 2s, page khula ho tab).
- **Bybit** liquidation stream bhi judi (Binance + OKX + Bybit).
- **Alert Rules**: naye metrics RSI 14 (1h) aur Price vs 50-SMA (1h). Push me **Whale alerts** (top 20 HL whales, $1M+ open/close/flip) aur **Discord/Slack webhook** (Telegram nahi).
- **Screener**: filters save karo (💾). **Tabs pin**: tab pe double-click. **⬇ CSV**: current tab ki tables download. **Hinglish** button: labels Hinglish me.

### 19.4c Buildix-style tabs (Screener, HL Whales, Options, Cycles, Macro)
- **Screener**: 179+ Hyperliquid perps + HIP-3 markets (stocks, commodities, FX; `dex:coin` names) via `api.hyperliquid.xyz/info` (CORS ok), 5s refresh. Signal = rule score (24h momentum, funding, session OI/price) - heuristic, not advice.
- **HL Whales**: `meme-token/hl-snapshot.js` (run in the GitHub workflow every 30 min, writes `site/hl-snap.json`, git-ignored) trims the 40 MB leaderboard and 14 MB vaults files (no CORS). Browser then polls live `clearinghouseState` for the top 40 whales (net long/short per coin), top traders by 30d PnL, top 100 vaults, and a wallet explorer (any 0x address: positions, leverage, liq distance).
- **Options**: worker `/api/options?c=BTC|ETH` aggregates Deribit (OI per expiry/strike, put/call, max pain); DVOL direct from Deribit.
- **Cycles**: Binance 1d BTC history since 2017: our own rainbow log-regression bands, Mayer multiple, 200-week MA, S2F model (S2F is discredited since 2022).
- **Macro**: worker `/api/macro` = Polymarket top events by 24h volume.
- **Stablecoin supply**: DefiLlama stablecoincharts on the Chains & ETF tab.
- Not built (no free data / out of scope): liquidation map and cascade, SOPR/NVT/NUPL, HYPE burns, bridge flows (DefiLlama paid), AI query, trade journal, TV webhook.
- Local deploy needs `node hl-snapshot.js` first so `site/hl-snap.json` exists.

**Aur tabs:** Liq Map (whale positions se liquidation cascade, partial), HYPE & HyperEVM (Assistance Fund buyback balance, DeFi TVL, bridge TVL), On-Chain (MVRV, NUPL, NVT via Coin Metrics), Journal (localStorage + CSV import), Ask (rule-based query, AI nahi). Bridge flow (DefiLlama TVL delta), Embed widgets (`/embed.html?w=gainers|losers|volume|funding&n=10` iframe). Treemap (top 30/50/100 mcap, 24h/7d/1h/volume colour, click = price+volume chart) aur Social (Fear&Greed, CoinGecko trending coins/categories, word cloud; Twitter/AI summary nahi). Orderflow (book imbalance + CVD), Liq Heatmap (live Binance liquidations), Compare + Correlation heatmap, Network (ETH gas, BTC fees, SOL priority fee), Portfolio (manual + read-only wallet lookup), Dark/Light toggle, shareable links (`#flow/ETH`, `#map/SOL`). Token unlocks, SOPR, ETH ETF free source ke bina possible nahi; band browser pe push alerts ke liye backend chahiye.

### 19.5 Dhyan
- Free plan limits: Cloudflare account me 5 crons, 50 subrequests per invocation. Dono accounts ke crons bhare hain, isliye site me cron worker nahi, GitHub Actions snapshot hai.
- GitHub Actions free minutes limited hain (private repo ~2000/month). Har run ~11 min, isliye 30 min schedule. Bill/minutes khatam hone par schedule ruk sakta hai, tab bhi browser live scan snapshot ke bina bhi chalta hai (purane snapshot se).
- Data public on-chain / market data hai, late ya galat ho sakta hai. SAFE badge guarantee nahi. Financial advice nahi, memecoins me poora paisa doobne ka risk hai.

## 20. Poora system ek nazar me (kaun kahan chalta hai)

| Part | Kya karta hai | Kahan chalta hai | Deploy |
|---|---|---|---|
| Bot 1 (`wrangler.jsonc`) | Main strategy (CHoCH/BOS) + Spyder, crypto, Telegram signals, live.html | Cloudflare PURANA account, `crypto-flow-radar.live-scanner.workers.dev` | `npx wrangler deploy` (purane account login) |
| Bot 2 (`wrangler.markets.jsonc`) | Sirf Spyder, 24 markets symbols (gold, forex, stocks), RR 1:1, charts | Cloudflare NAYA account (syndicatecrypto1), `spyder-radar.workers.dev` | `npx wrangler deploy -c wrangler.markets.jsonc` |
| `paper-bot/` | Bybit paper trading ($100, 1% risk, 3% DD halt) | GitHub Actions har 15 min (`paper-bot.yml`), state `paper-bot/state.json` | auto |
| `meme-token/` | SPYDER TRENCH website | GitHub Actions snapshot + Cloudflare worker `meme-trench` (naya account) + browser live scan | auto / `npx wrangler deploy` |

- Bot 1 aur Bot 2 dono ek hi Telegram channel me post karte hain (duplicate signals ka risk).
- Telegram bot ke tokens/secrets (`TG_TOKEN`, `RUN_KEY`) kabhi chat ya code me mat daalo. Cloudflare secrets (`wrangler secret put`) ya GitHub secrets me hi rakho. Agar chat me paste ho jaye to turant revoke/roll karo (BotFather `/revoke`, Cloudflare token Roll).

## 21. Seekhi hui baatein (deploy/secrets/CI)

- GitHub Actions me secret ka naam exact match hona chahiye (`CLOUDFLARE_API_TOKEN`). Khali secret ka error: "In a non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN". Secret list check: `gh secret list -R Spyder15/crypto-flow-radar`.
- Workflow file push karne ke liye gh login me `workflow` scope chahiye (`gh auth refresh -h github.com -s workflow`).
- Cloudflare token ke liye: My Profile -> API Tokens -> template "Edit Cloudflare Workers" (ya custom: Account / Workers Scripts / Edit). "Access:" wali permissions nahi.
- `wrangler deploy` ka URL account ke workers.dev subdomain par banta hai (naya account = `*.spyder-radar.workers.dev`).
- Workflow `concurrency: meme-trench` hai: ek time par ek run, doosra wait karta hai.
- Local `git pull --rebase` zaroori hai push se pehle, kyunki workflows `state.json` files commit karte rehte hain.
- Free-tier me real-time ki limits: GeckoTerminal ~30/min, DexScreener ~300/min (pairs), GoPlus rate-limited. Zyada speed ke liye paid RPC/WebSocket chahiye.

### 19.4f Quant Bot and Learn tabs
- `meme-token/quant-bot.js` is a paper-only quant bot (no keys, no real orders). It runs inside `meme-token.yml` every 30 min. Strategies: momentum breakout, mean reversion (RSI + Bollinger, ranging markets only) and funding fade, on the top 40 Bybit perps (1h candles). Start $1000, 0.5% risk per trade, max 10 open, 3% daily loss stop, fees and slippage counted.
- State and results live in `meme-token/site/quant.json` (committed by the workflow, served by the site). Reset the bot by deleting that file.
- `site/quant.js` renders the **Quant Bot** tab (equity, drawdown, profit factor, per-strategy table, trades) and the **Learn** tab (lessons with calculators, interview-style questions, progress in `localStorage`).


### 19.4g Meme Quant + pro shell
- `meme-token/meme-quant-bot.js` runs every 5 min (`.github/workflows/meme-quant.yml`), PAPER only. State is KV key `mq` (binding PUSH): read from `/api/mq`, written with `POST /api/mq/put` + `x-run-key` (`PUSH_RUN_KEY`). Reset: delete KV key `mq`.
- Strategies: whale follow, volume breakout, dip reclaim; GoPlus check before entry; SL, TP1 half + trail, liquidity-pull exit, time stop.
- Website tab `Meme Quant` = `site/mquant.js` (DexScreener live P/L, GeckoTerminal candle chart popup).
- `site/shell.js`: left sidebar, Cmd/Ctrl+K palette, status bar, settings (theme, density, ticker, accent).


---

## 22. Ab tak ka poora kaam (timeline, A to Z)

**A. Telegram signal bot (`bot/`, `wrangler.jsonc`)**
- Bybit top 125 perps par 1H/4H/1D scan, CHoCH/BOS + FVG, 8 me se `MIN_CONF` (ab 6) confirmations. Entry/SL/TP1-3 + chart Telegram par.
- Trade tracker (15m candles): TP1 hit, SL breakeven, TP2 hit, SL to TP1, SL hit, TP3. TP1/TP2 message ka `undefined` crash bug fix hua. Retry/429/watchdog add.
- Radar (whale wallets, funding, volume burst), daily/weekly report, Spyder strategy (24 markets: gold, forex, stocks) alag worker `wrangler.markets.jsonc`.
- Sirf Spyder wala markets bot naye Cloudflare account par deploy; signal na aane wale issues (cron/limits) debug hue.

**B. Paper bot (`paper-bot/`)**: Bybit paper trading $100, 1% risk, 3% DD halt, GitHub Actions har 15 min.

**C. SPYDER TRENCH website (`meme-token/`)**
- Meme tab: tokens, heating up, inflow/outflow, whale buys (Solana/ETH/Base/BSC...), safety (GoPlus), meme money flow, trench redesign.
- Market Flow terminal (~38 tabs): Overview, Screener, Movers, Treemap, Chains, Coin, Compare, History, Watchlist, Derivatives, Liq Map/History, Funding Map, Basis & L/S, Options, Orderflow, HL Whales, HYPE, On-Chain, Smart Money, Gas/Network, Social, Macro, Cycles, Daily Brief, Views, Ask, Portfolio, Paper, Quant Bot, Meme Quant, Backtest, Alert Rules, Multi-chart, Journal, Calc, Learn.
- 16 features + ETH ETF flows, Buildix-style pro tabs, light/dark theme, embed widgets, shareable links, PWA + web push (VAPID, KV `PUSH`).
- Bug fixes: OKX liquidations, KV write audit (free limit 1000 writes/day), sw cache.
- **Quant Bot tab** (`quant-bot.js`, 30 min): paper, Bybit top 40 perps, momentum / mean reversion / funding fade, $1000, 0.5% risk, fees+slippage. State `site/quant.json`.
- **Quant chart popup** (`site/quant.js`): TradingView-style, har timeframe (1m..1D), zoom/pan, volume, MA, candle/line, crosshair, SL/TP/entry lines, "Fit trade", Snapshot (html2canvas) + share text.
- **Pro shell** (`site/shell.js`): left sidebar (6 groups, favorites, collapse), Cmd/Ctrl+K palette, settings (theme, density, ticker, accent), status bar (sessions, clock), mobile drawer. MEME mode me sidebar meme pages dikhata hai (Tokens, Heating up, Inflow/Outflow, Meme Quant, Smart Money, On-Chain, Social).
- **Meme Quant** (`meme-quant-bot.js`, har 5 min, `.github/workflows/meme-quant.yml`): paper $1000, 4% per trade, max 8 open, 5% daily stop. Strategies: whale follow, volume breakout, dip reclaim. GoPlus rug check, SL 15%, TP1 half +30% then trail, liquidity-pull exit, time stop. State KV `mq`: read `/api/mq`, write `POST /api/mq/put` + `x-run-key`. Tab `site/mquant.js`: live P/L, candle chart popup, exit markers, snapshot.

**D. CI/Deploy**: `meme-token.yml` (30 min: feed, quant bot, deploy, save state), `meme-quant.yml` (5 min), `paper-bot.yml`, `whales.yml`, `push-check.yml`, `pages.yml`. Deploy: `cd meme-token && npx wrangler@4 deploy` (data.json + hl-snapshot pehle refresh). Check: live HTML me `data-u=` tabs count = 38.

## 23. Third-party services (kya, kis liye)

| Service | Kis kaam ke liye | Kahan use hota hai | Key? |
|---|---|---|---|
| **Cloudflare Workers + KV + Assets** | Hosting, API proxy, state (KV `TRADES`, `PUSH`) | dono workers | Account token |
| **GitHub Actions / Pages** | Cron bots, deploy, state commit, static site | `.github/workflows` | `GITHUB_TOKEN`, secrets |
| **Telegram Bot API** | Signals aur updates bhejna | `bot/` | `TG_TOKEN` (secret) |
| **Bybit** (+ mirrors bytick, bybitglobal, bybit.nl/.kz) | Candles, OI, funding, tickers; paper bots ka data | bot, paper-bot, quant-bot | Nahi |
| **Binance** (spot/fapi/dapi, WebSocket) | Live prices, liquidations, orderflow, premium index | site, radar | Nahi |
| **OKX** | Liquidation / instruments data | worker `/api/okx-inst` | Nahi |
| **Hyperliquid** (api + stats-data) | Whale leaderboard, positions, HL snapshot | whales, HL Whales, Liq Map | Nahi |
| **Hypurrscan** | Wallet explorer links | radar, whale alerts | Nahi |
| **DexScreener** | Meme token pairs, live price/volume, boosts | site, scan, Meme Quant | Nahi |
| **GeckoTerminal** | On-chain candles (OHLCV), pools, whale trades | chart popup, Meme Quant, feed | Nahi |
| **GoPlus** | Token security / rug check | scan, Meme Quant | Nahi |
| **RugCheck** | Solana token report link | alerts | Nahi |
| **Jupiter (jup.ag)** | Solana swap link | token cards | Nahi |
| **Helius** | Solana whale transactions | `/api/sol-whales` | `HELIUS_KEY` (worker secret) |
| **PublicNode RPC** (eth, sol) | ETH gas, SOL fees | Network tab | Nahi |
| **mempool.space** | BTC fees/mempool | Network tab | Nahi |
| **DefiLlama** (api, stablecoins) | Chain TVL, DEX volume, stablecoins, bridges | Chains, Macro | Nahi |
| **CoinGecko** | Market caps, trending, categories (rate-limit noise normal) | Overview, Social, Treemap | Nahi |
| **alternative.me** | Fear & Greed | Social, Macro | Nahi |
| **Coin Metrics community** | MVRV, NUPL, NVT | On-Chain | Nahi |
| **blockchain.info** | BTC tx volume | On-Chain | Nahi |
| **Deribit** | Options book, DVOL | Options tab | Nahi |
| **Polymarket (gamma-api)** | Prediction markets | Macro/Views | Nahi |
| **btcetfdata.com** | BTC ETF holdings | `/api/etf` | Nahi |
| **xoomar.com** | ETH ETF flows, economic calendar | `/api/etf-eth` | `XOOMAR_KEY` (secret) |
| **QuickChart** | Signal chart images (sirf public candles/levels) | bot | Nahi |
| **html2canvas (cdnjs)** | Snapshot of page/chart | `site/snap.js` | Nahi |
| **Web Push (VAPID)** | Browser notifications | worker `/api/push/*` | `VAPID` keys, `PUSH_RUN_KEY` |

**Secrets list**: GitHub: `CLOUDFLARE_API_TOKEN`, `PUSH_RUN_KEY`. Worker: `HELIUS_KEY`, `XOOMAR_KEY`, `PUSH_RUN_KEY`, VAPID private. Bot: `TG_TOKEN`, `RUN_KEY`. Chat me paste hui keys (Cloudflare token, Helius, xoomar) rotate karo.

## 24. Limits aur reminders
- Dono quant bots paper-only hain; 50+ trades ke baad hi result trust karo. Real me slippage, rugs, fills worse.
- Free limits: Cloudflare KV 1000 writes/day (Meme Quant ~288/day), 5 crons, 50 subrequests; GeckoTerminal ~30/min; GitHub Actions minutes.
- Snapshot "Post to X" image attach nahi karta (X ki limit).
- Quant bot me funding accrual nahi.
- Meme Quant KV write sirf trade change par, warna max 30 min me ek (KV 1000 writes/day bachane ke liye). Site me 'updated' 30 min tak purana dikh sakta hai.

### 24.1 Recent incidents (2026-11-05)
- **Meme quant bot first run failed** (commit `52a3994`): KV write path fixed in `6827320` (run-key endpoint `POST /api/mq/put`). Runs #2-#4 passed.
- **Cloudflare KV 50% daily alert**: 5-min bot wrote KV too often. Fixed in `bb43e2c` (write only on trade change, else max once per 15 min). Limit resets 00:00 UTC. Agar phir bhi high ho to Workers Paid ($5/month).

### 24.2 Quant bot upgrades (2026-11-06)
- **Trailing stop**: +1R par stop breakeven, phir best price se 1R peeche trail (`TRAIL` exit). Card pe SL wahi rehta hai.
- **Funding accrual**: har trade ka funding cost/credit PnL me jodta hai.
- **Side cap**: max 6 trades ek hi direction me (crypto saath me chalta hai).
- **Auto-disable**: strategy ke last 30 closed me (min 20) PF < 0.8 ho to naye trades band (`off` in quant.json).
- **Backtest**: `cd meme-token && node quant-backtest.mjs 4000 30` (real signal logic, 1h, fees+slippage). Result (~5 mahine, 30+ symbols): crypto lagbhag breakeven (PF ~0.9-1.3, SOL/UNI/WLD positive), **gold/silver/oil/forex/index me PF 0.1-0.6 (loss)**, isliye `MACRO` list khaali hai. Overall strategy abhi profitable proven nahi.
- Real trading abhi off, paper only.
- **KV round 2 (2026-11-06)**: `/api/mq` aur `/api/liqhist` GET ab edge-cache (mq 20s, liqhist 2 min; bot reads mq with ?fresh=1) hote hain, to visitors KV reads nahi badhate. `liqhist` write max 15 min me ek (batch upload), Meme Quant heartbeat write 30 min. Writes ab lagbhag ~50 (mq) + ~96 (liqh) /din + push/trade changes.

### 24.3 Bybit proxy, public repo, Spyder 1:1, security (2026-11-06)
- **Bybit proxy** (`meme-token/bybit-proxy/`, worker `bybit-proxy.spyder-radar.workers.dev`): GitHub runners aur US Cloudflare edge ko Bybit 403 "blocked country" deta hai, isliye quant bot ka data Mumbai-pinned (`aws:ap-south-1`) proxy se aata hai. Sirf GET `/v5/market/tickers` aur `/v5/market/kline` forward hota hai (open proxy nahi). Deploy: `.github/workflows/bybit-check.yml` (proxy folder badalne par). Pehle quant bot chupchap fail hota tha (0 sec), ab fail par step exit 1 (`continue-on-error`) aur `quant.json` update hota hai.
- **Repo public** kiya gaya (Actions minutes 2000/month limit se bachne ke liye). Secrets repo me nahi hain (GitHub/Worker secrets me). Jo keys chat me paste hui thi (Cloudflare token, Helius, xoomar) unhe rotate karna zaroori hai.
- **Spyder strategy ab RR 1:1** (`bot/spyder.js`, `RR = 1`), Telegram messages bhi 1:1. Deploy: `npx wrangler deploy -c wrangler.markets.jsonc`. Purane open trades 1:2 par hi chalte hain.
- **Spyder backtest (macro: gold, silver, oil, forex, SPY/QQQ, 3000 candles, fees ke baad)**: 1H aur 4H dono me loss (avg -0.33R se -0.59R, win 30-52%). "100% winrate" claim galat hai. Bot sirf 1H scan karta hai, 4H add nahi kiya kyunki 4H bhi negative hai. Experimental, paper only.
- **Security review**: koi serious issue nahi (no committed secrets, workers me key auth, proxy allow-listed, workflows me `pull_request_target` nahi). Hardening (`78ea69a`): push subscribe sirf asli push services (Google/Mozilla/Apple/Windows) ke endpoint accept karta hai; `/api/liqhist` POST cross-origin par 403.
- **`/api/mq` cache 20s** (60s se kam), bot `?fresh=1` se hamesha taza state padhta hai.

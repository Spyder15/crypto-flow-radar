# Bybit Paper Bot

Fake-money trading bot. **No real orders, no exchange API keys.** Uses Bybit public market data only.

- Account: $100, risk 1% ($1) per trade, fees 0.11% round trip counted.
- Max drawdown 3%: open trades' worst case (SL + fees) must always fit above $97, and when equity touches $97 the bot HALTS (Telegram alert, no new trades) until `npm run reset`.
- Strategy: CHoCH/BOS + FVG setups on 1H for the top 25 crypto perps by volume, taken only with 6+/8 confirmations. TP1 -> SL to entry, TP2 -> SL to TP1, TP3 closes.
- Limits: max 3 open trades, max 4 new trades per day. Edit `config.json`.
- State lives in `state.json`. Run every 15 min via GitHub Actions (`.github/workflows/paper-bot.yml` in the repo root).

## Run
Local: `node src/bot.js` (reset: `npm run reset`).

GitHub: push this repo, then in Settings > Secrets > Actions add `TG_TOKEN` and `TG_CHAT` (optional, for Telegram alerts). The workflow runs at :02, :17, :32, :47.

Before any real money: watch paper results for 1-2 weeks. If you ever go live, use an API key with Trade permission only, never Withdraw.

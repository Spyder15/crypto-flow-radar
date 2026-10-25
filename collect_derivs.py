#!/usr/bin/env python3
"""Hourly derivatives snapshot collector (Binance USDT perps).

Binance only serves ~30 days of OI / long-short history, so this saves our own
history to derivs_data/derivs.jsonl for later research. It must run from a
machine that can reach fapi.binance.com (GitHub Actions runners in the US cannot).

One JSON line per run:
  {"ts": ISO-UTC, "coins": {SYMBOL: {price, funding, mark, oi, oi_usd, ls_acc, long_acc, top_ls}}}
"""
import json, os, sys, time, urllib.request, urllib.parse
from datetime import datetime, timezone

F = "https://fapi.binance.com"
TOP = int(os.environ.get("TOP", "60"))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "derivs_data")


def get(path, **params):
    url = F + path + ("?" + urllib.parse.urlencode(params) if params else "")
    for k in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "flow-radar"}), timeout=20) as r:
                return json.load(r)
        except Exception:
            time.sleep(1.5 * (k + 1))
    return None


def last(x):
    return x[-1] if x else None


def main():
    tk = get("/fapi/v1/ticker/24hr")
    if not tk:
        sys.exit("Binance unreachable")
    prem = {p["symbol"]: p for p in (get("/fapi/v1/premiumIndex") or [])}
    syms = [t for t in tk if t["symbol"].endswith("USDT") and "_" not in t["symbol"]]
    syms.sort(key=lambda t: -float(t["quoteVolume"]))
    coins = {}
    for t in syms[:TOP]:
        s = t["symbol"]
        oi = get("/fapi/v1/openInterest", symbol=s)
        ls = last(get("/futures/data/globalLongShortAccountRatio", symbol=s, period="5m", limit=1))
        tp = last(get("/futures/data/topLongShortPositionRatio", symbol=s, period="5m", limit=1))
        p = prem.get(s, {})
        coins[s] = {
            "price": float(t["lastPrice"]),
            "vol24": float(t["quoteVolume"]),
            "funding": float(p["lastFundingRate"]) if p else None,
            "mark": float(p["markPrice"]) if p else None,
            "oi": float(oi["openInterest"]) if oi else None,
            "ls_acc": float(ls["longShortRatio"]) if ls else None,
            "long_acc": float(ls["longAccount"]) if ls else None,
            "top_ls": float(tp["longShortRatio"]) if tp else None,
        }
        time.sleep(0.05)
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "derivs.jsonl"), "a") as f:
        f.write(json.dumps({"ts": datetime.now(timezone.utc).isoformat(timespec="seconds"), "coins": coins}) + "\n")
    print(f"saved {len(coins)} coins")


if __name__ == "__main__":
    main()

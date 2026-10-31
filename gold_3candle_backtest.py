"""Gold 3-candle strategy: 2 strong-body candles (body >= 80% of range), 3rd closes inside the 2nd,
near support (buy) / resistance (sell), entry on swing break, target 1:3. Data: GC=F from Yahoo."""
import sys, warnings
import numpy as np, pandas as pd, yfinance as yf
warnings.filterwarnings("ignore")
COST = 0.4  # price points per trade (spread + slippage)

def load(tf):
    per = {"5m": "59d", "15m": "59d", "1h": "729d"}[tf]
    d = yf.Ticker("GC=F").history(period=per, interval=tf).dropna()
    tr = pd.concat([d.High - d.Low, (d.High - d.Close.shift()).abs(), (d.Low - d.Close.shift()).abs()], axis=1).max(axis=1)
    d["atr"] = tr.rolling(14).mean()
    return d

def bt(d, rr=3, body=0.8, mode="with", sr=True, srn=50, near=1.0, wait=6, n=5, hours=None):
    o, h, l, c, a = (d[k].values for k in ("Open", "High", "Low", "Close", "atr")); N = len(d)
    hr = d.index.tz_convert("UTC").hour.values
    rng = h - l; bd = np.abs(c - o); strong = (rng > 0) & (bd >= body * rng)
    out = []; busy = -1; pend = None; sh = sl_ = None
    for i in range(srn + 2 * n, N - 1):
        k = i - n
        if h[k] == h[k - n:i + 1].max() and (h[k - n:k] < h[k]).all(): sh = h[k]
        if l[k] == l[k - n:i + 1].min() and (l[k - n:k] > l[k]).all(): sl_ = l[k]
        if i > busy and (pend is None or i > pend[3]) and not np.isnan(a[i]):
            for side in (1, -1):
                up = lambda j: c[j] > o[j]
                # with: strong candles in trade direction; rev: strong candles against it (exhaustion into the level)
                want = (side == 1) if mode == "with" else (side == -1)
                if not (strong[i - 2] and strong[i - 1] and up(i - 2) == want and up(i - 1) == want): continue
                if not (min(o[i - 1], c[i - 1]) <= c[i] <= max(o[i - 1], c[i - 1])): continue  # 3rd closes inside the 2nd body
                top, bot = h[i - 2:i + 1].max(), l[i - 2:i + 1].min()
                if sr:
                    lo, hi = l[i - srn:i - 2].min(), h[i - srn:i - 2].max()
                    if side == 1 and bot - lo > near * a[i]: continue
                    if side == -1 and hi - top > near * a[i]: continue
                pend = (side, top, bot, i + wait); break
        if pend and i > busy and (hours is None or hours[0] <= hr[i] < hours[1]):
            side, top, bot, exp = pend
            lvl = sh if side == 1 else sl_
            brk = lvl is not None and ((side == 1 and c[i] > max(lvl, top)) or (side == -1 and c[i] < min(lvl, bot)))
            if brk:
                ent = o[i + 1]; st = bot if side == 1 else top; risk = (ent - st) * side
                pend = None
                if risk <= 0 or risk < 0.3 * a[i]: continue
                tp = ent + side * rr * risk; res = None
                for j in range(i + 1, N):
                    hit_sl = (l[j] <= st) if side == 1 else (h[j] >= st); hit_tp = (h[j] >= tp) if side == 1 else (l[j] <= tp)
                    if hit_sl: res = (-1 - COST / risk, j); break
                    if hit_tp: res = (rr - COST / risk, j); break
                if res is None: break
                out.append(res[0]); busy = res[1]
            elif i >= exp: pend = None
    return np.array(out)

def show(name, r):
    if len(r) == 0: print(f"{name:42s} no trades"); return
    half = len(r) // 2
    print(f"{name:42s} n={len(r):4d} win={100 * (r > 0).mean():4.0f}% avgR={r.mean():+.2f} total={r.sum():+6.1f}R  halves {r[:half].mean():+.2f}/{r[half:].mean():+.2f}")

for tf in sys.argv[1:] or ["5m", "15m", "1h"]:
    d = load(tf); print(f"\n== GC=F {tf}  {len(d)} bars {d.index[0].date()} .. {d.index[-1].date()} ==")
    for mode in ("with", "rev"):
        for sr in (True, False):
            for rr in (3, 2):
                show(f"{mode:4s} S/R={'on ' if sr else 'off'} RR 1:{rr}", bt(d, rr=rr, mode=mode, sr=sr))

#!/usr/bin/env python3
"""
param_sweep.py — Trailing × ATR_mult 정밀 그리드 탐색
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Trailing:  6.0 ~ 9.0%  (0.2% 단위, 16개)
ATR_mult:  1.4 ~ 2.0x  (0.2 단위,   4개)
총 64 조합 × 5년 백테스트

출력:
  scripts/sweep_results.json  — 전체 그리드 결과
  콘솔: 히트맵 + 최적 조합
"""

import pathlib, sys, json
from itertools import product

BASE_DIR = pathlib.Path(__file__).parent
sys.path.insert(0, str(BASE_DIR))

import importlib.util
spec = importlib.util.spec_from_file_location("be", BASE_DIR / "backtest_engine.py")
be   = importlib.util.module_from_spec(spec)
spec.loader.exec_module(be)

run_backtest   = be.run_backtest
DEFAULT_PARAMS = be.DEFAULT_PARAMS

# ─── 그리드 정의 ──────────────────────────────────────────────
trailing_range = [round(6.0 + i * 0.2, 1) for i in range(16)]   # 6.0~9.0
atr_mult_range = [1.4, 1.6, 1.8, 2.0]

total = len(trailing_range) * len(atr_mult_range)
print(f"Trailing {trailing_range[0]}~{trailing_range[-1]}% (0.2단위) × ATR_mult {atr_mult_range[0]}~{atr_mult_range[-1]}x")
print(f"총 {total}조합 × 5년 백테스트 시작...\n")

grid = []
done = 0
for trailing, atr_mult in product(trailing_range, atr_mult_range):
    p = dict(DEFAULT_PARAMS)
    p["trailing"] = trailing
    p["atrMult"]  = atr_mult

    res = run_backtest(p, "5yr")
    kpi = res["kpi"]
    calmar = round(kpi["annRet"] / abs(kpi["mdd"]), 2) if kpi["mdd"] != 0 else 0

    row = {
        "trailing": trailing,
        "atr_mult": atr_mult,
        "totalRet": kpi["totalRet"],
        "annRet":   kpi["annRet"],
        "mdd":      kpi["mdd"],
        "sharpe":   kpi["sharpe"],
        "winRate":  kpi["winRate"],
        "calmar":   calmar,
        "trades":   kpi["trades"],
    }
    grid.append(row)
    done += 1
    bar = "█" * (done * 30 // total) + "░" * (30 - done * 30 // total)
    print(
        f"  [{bar}] {done:2}/{total} "
        f"T={trailing}% A={atr_mult:.1f}x │ "
        f"누적{kpi['totalRet']:+7.1f}% │ MDD{kpi['mdd']:5.1f}% │ "
        f"샤프{kpi['sharpe']:.2f} │ 칼마{calmar:.2f}"
    )

# ─── JSON 저장 ─────────────────────────────────────────────────
out_path = BASE_DIR / "sweep_results.json"
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(grid, f, ensure_ascii=False, indent=2)
print(f"\n✅ 결과 저장: {out_path}")

# ─── 최적 조합 ─────────────────────────────────────────────────
print("\n" + "=" * 72)
best_sharpe = max(grid, key=lambda x: x["sharpe"])
best_calmar = max(grid, key=lambda x: x["calmar"])
best_ret    = max(grid, key=lambda x: x["totalRet"])
# 수익률 ≥ +150% 조건 만족하면서 샤프 최고
balanced = [r for r in grid if r["totalRet"] >= 150]
best_balanced = max(balanced, key=lambda x: x["sharpe"]) if balanced else best_sharpe

def fmt(r):
    return (f"T={r['trailing']}% A={r['atr_mult']}x │ "
            f"누적{r['totalRet']:+.1f}% │ MDD{r['mdd']:.1f}% │ "
            f"샤프{r['sharpe']:.2f} │ 칼마{r['calmar']:.2f}")

print(f"[샤프 최고]     {fmt(best_sharpe)}")
print(f"[칼마 최고]     {fmt(best_calmar)}")
print(f"[수익 최고]     {fmt(best_ret)}")
print(f"[+150%+샤프]   {fmt(best_balanced)}")

# ─── 누적수익률 히트맵 ────────────────────────────────────────
print("\n=== 누적수익률 히트맵 (%) ===")
header = f"{'':12}" + "".join(f"  ATR={a:.1f}x" for a in atr_mult_range)
print(header)
for t in trailing_range:
    row_vals = []
    for a in atr_mult_range:
        v = next(r["totalRet"] for r in grid if r["trailing"]==t and r["atr_mult"]==a)
        row_vals.append(f"{v:+9.1f}")
    print(f"Trail={t:4.1f}% " + "".join(row_vals))

# ─── 샤프 히트맵 ──────────────────────────────────────────────
print("\n=== 샤프 히트맵 ===")
print(header)
for t in trailing_range:
    row_vals = []
    for a in atr_mult_range:
        v = next(r["sharpe"] for r in grid if r["trailing"]==t and r["atr_mult"]==a)
        row_vals.append(f"{v:9.2f}")
    print(f"Trail={t:4.1f}% " + "".join(row_vals))

# ─── 칼마 히트맵 ──────────────────────────────────────────────
print("\n=== 칼마비율 히트맵 (연환산/MDD) ===")
print(header)
for t in trailing_range:
    row_vals = []
    for a in atr_mult_range:
        v = next(r["calmar"] for r in grid if r["trailing"]==t and r["atr_mult"]==a)
        row_vals.append(f"{v:9.2f}")
    print(f"Trail={t:4.1f}% " + "".join(row_vals))

#!/usr/bin/env python3
"""
full_sweep.py — 전체 파라미터 그리드 탐색 (캐시 최적화)
데이터 로딩 monkey-patch로 1회만 수행, 시뮬만 반복
adx: 15,20,25,30 × rsi2Entry: 15,20,25,30 × zscore: 0.8,1.0,1.2,1.5
× trailing: 8.0,10.0,12.0 × stop_gate: False/True = 384조합
"""
import pathlib, sys, json, time
from itertools import product

BASE_DIR = pathlib.Path(__file__).parent
sys.path.insert(0, str(BASE_DIR))

import importlib.util
spec = importlib.util.spec_from_file_location("be", BASE_DIR/"backtest_engine.py")
be   = importlib.util.module_from_spec(spec)
spec.loader.exec_module(be)

# ── 데이터 1회 로딩 후 캐시 ────────────────────────────────────
print("📂 데이터 1회 로딩 중...", end=" ", flush=True)
t0 = time.time()
_stock_list = be.load_stock_list()
_gdb        = be.load_gdb()
_all_codes  = [be.INDEX_CODE] + [s["code"] for s in _stock_list]
_daily      = be.load_all_daily(_all_codes)
print(f"✓ {time.time()-t0:.1f}초, {len(_daily)}종목")

# monkey-patch: 이후 run_backtest 내부 로딩 함수를 캐시로 대체
be.load_stock_list  = lambda: _stock_list
be.load_gdb         = lambda: _gdb
be.load_all_daily   = lambda codes: _daily

# ── 그리드 ─────────────────────────────────────────────────────
adx_r      = [15, 20, 25, 30]
rsi2_r     = [15, 20, 25, 30]
zscore_r   = [0.8, 1.0, 1.2, 1.5]
trailing_r = [8.0, 10.0, 12.0]
# stop_gate: 당월 HardStop ≥ 2건 → 추가 진입 차단 (post-filter 근사)
gate_r     = [False, True]

combos = list(product(adx_r, rsi2_r, zscore_r, trailing_r, gate_r))
total  = len(combos)
print(f"총 {total}조합 탐색 시작...\n")

grid = []
t_start = time.time()

for idx, (adx, rsi2, zscore, trailing, gate) in enumerate(combos):
    p = {**be.DEFAULT_PARAMS,
         "adx": adx, "rsi2Entry": rsi2,
         "zscore": zscore, "trailing": trailing}

    try:
        res = be.run_backtest(p, "5yr")
        kpi = res["kpi"]
        tlog = res["tradeLog"]
    except Exception as e:
        continue

    # stop_gate 후처리: 당월 HardStop ≥ 2건이면 이후 거래 제거
    if gate:
        from collections import defaultdict
        month_stops = defaultdict(int)
        filtered = []
        for t in tlog:
            ym = t["ym"]
            if month_stops[ym] >= 2:
                continue
            filtered.append(t)
            if "HardStop" in t["reason"]:
                month_stops[ym] += 1
        tlog = filtered
        # KPI 재계산
        if not tlog:
            continue
        wins = [t for t in tlog if t["ret"] > 0]
        total_pnl = sum(t["pnl"] for t in tlog)
        total_ret = round(total_pnl / be.BASE_CAPITAL * 100, 2)
        n_m = kpi["months"]
        ann = round((pow(1 + total_ret/100, 12/max(n_m-1,1))-1)*100, 2) if n_m > 1 else total_ret
        # MDD 재계산 (간이)
        val = 100.0; peak = 100.0; mdd = 0.0
        by_ym = {}
        for t in tlog:
            by_ym.setdefault(t["ym"], []).append(t["ret"])
        for m in be.ALL_MONTHLY:
            if m["date"] < "21-03" or m["date"] > "26-03":
                continue
            for r in by_ym.get(m["date"], []):
                val += r/100 * be.CAPITAL_PER_SLOT / be.BASE_CAPITAL * 100
            if val > peak: peak = val
            dd = (val-peak)/peak*100
            if dd < mdd: mdd = dd
        sharpe = round(ann/14.5, 2)
        calmar = round(ann/abs(mdd), 2) if mdd != 0 else 0
        wr = round(len(wins)/len(tlog)*100, 1)
        kpi = {"totalRet": total_ret, "annRet": ann, "mdd": round(mdd,1),
               "sharpe": sharpe, "calmar": calmar, "winRate": wr,
               "trades": len(tlog)}
    else:
        calmar = round(kpi["annRet"]/abs(kpi["mdd"]),2) if kpi["mdd"] != 0 else 0
        kpi["calmar"] = calmar

    score = round(kpi["sharpe"]*0.4 + kpi["calmar"]*0.35 + kpi["winRate"]/100*0.25, 3)

    grid.append({
        "adx": adx, "rsi2Entry": rsi2, "zscore": zscore,
        "trailing": trailing, "stop_gate": gate,
        **{k: kpi[k] for k in ["totalRet","annRet","mdd","sharpe","calmar","winRate","trades"]},
        "score": score
    })

    if (idx+1) % 48 == 0:
        elapsed = time.time()-t_start
        eta = elapsed/(idx+1)*(total-idx-1)
        print(f"  {idx+1}/{total} ({elapsed:.0f}s 경과, ETA {eta:.0f}s)")

elapsed = time.time()-t_start
print(f"\n완료: {len(grid)}건 유효 / {elapsed:.0f}초 소요")

# ── 저장 ───────────────────────────────────────────────────────
out = BASE_DIR / "full_sweep_results.json"
with open(out, "w", encoding="utf-8") as f:
    json.dump(grid, f, ensure_ascii=False, indent=2)

# ── 리포트 ─────────────────────────────────────────────────────
HDR = f"{'adx':>4} {'rsi2':>5} {'z':>5} {'t':>5} {'g':>2} | {'ret%':>7} {'mdd%':>6} {'sharpe':>7} {'calmar':>7} {'wr%':>5} {'n':>4} {'score':>6}"

def show(label, rows, n=15):
    print(f"\n── {label} ──")
    print(HDR)
    for r in rows[:n]:
        g = "O" if r["stop_gate"] else "-"
        print(f"{r['adx']:>4} {r['rsi2Entry']:>5} {r['zscore']:>5} {r['trailing']:>5} {g:>2} | "
              f"{r['totalRet']:>+7.1f} {r['mdd']:>6.1f} {r['sharpe']:>7.2f} {r['calmar']:>7.2f} "
              f"{r['winRate']:>5.1f} {r['trades']:>4} {r['score']:>6.3f}")

show("종합스코어 TOP15",  sorted(grid, key=lambda x: -x["score"]))
show("칼마비율 TOP15",    sorted(grid, key=lambda x: -x["calmar"]))
show("샤프지수 TOP15",    sorted(grid, key=lambda x: -x["sharpe"]))
show("누적수익 TOP15",    sorted(grid, key=lambda x: -x["totalRet"]))

base = [r for r in grid if r["adx"]==20 and r["rsi2Entry"]==25
        and r["zscore"]==1.0 and r["trailing"]==10.0]
show("현재 파라미터 기준선 (gate 유무 비교)", base)

gate_on  = [r for r in grid if r["stop_gate"]]
gate_off = [r for r in grid if not r["stop_gate"]]
avg = lambda lst,k: sum(r[k] for r in lst)/len(lst) if lst else 0
print(f"\n── stop_gate 전체 평균 효과 ──")
print(f"             {'totalRet%':>10} {'mdd%':>6} {'sharpe':>8} {'calmar':>8} {'wr%':>6}")
print(f"  gate OFF : {avg(gate_off,'totalRet'):>+10.1f} {avg(gate_off,'mdd'):>6.1f} "
      f"{avg(gate_off,'sharpe'):>8.2f} {avg(gate_off,'calmar'):>8.2f} {avg(gate_off,'winRate'):>6.1f}")
print(f"  gate ON  : {avg(gate_on,'totalRet'):>+10.1f} {avg(gate_on,'mdd'):>6.1f} "
      f"{avg(gate_on,'sharpe'):>8.2f} {avg(gate_on,'calmar'):>8.2f} {avg(gate_on,'winRate'):>6.1f}")

print(f"\n✅ 저장: {out}")

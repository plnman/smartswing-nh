#!/usr/bin/env python3
"""
add_adx_to_gdb.py — GDB에 ADX(14) 월별 값 추가 패치
════════════════════════════════════════════════════
기존 gdb_stock_data.json에 adx 필드 추가 후 gdb_stocks.js 재생성.
ADX 타이밍: RSI-2와 동일 — 진입 월 M의 adx = M-1 마지막 거래일 기준 ADX(14)

실행:
  python add_adx_to_gdb.py              # 전체 200종목
  python add_adx_to_gdb.py --dry-run    # 첫 3종목만 테스트
"""

import sys, json, time, datetime, calendar, pathlib, argparse
import pandas as pd

BASE_DIR  = pathlib.Path(__file__).parent
JSON_PATH = BASE_DIR / "gdb_stock_data.json"
JS_PATH   = BASE_DIR.parent / "src" / "gdb_stocks.js"
STOCK_LIST = BASE_DIR / "stock_list.json"

GDB_START_YEAR, GDB_START_MONTH = 2021, 1
GDB_END_YEAR,   GDB_END_MONTH   = 2026, 3
FETCH_START = "20201101"
FETCH_END   = "20260331"
RATE_LIMIT_SLEEP = 0.3


def ym_range():
    result = []
    y, m = GDB_START_YEAR, GDB_START_MONTH
    while (y, m) <= (GDB_END_YEAR, GDB_END_MONTH):
        result.append(f"{str(y)[2:]}-{m:02d}")
        m += 1
        if m > 12: m = 1; y += 1
    return result


def get_prev_month_end(year, month):
    if month == 1: return year - 1, 12
    return year, month - 1


def fetch_daily_ohlcv(code: str) -> pd.DataFrame:
    try:
        from pykrx import stock as pykrx_stock
        df = pykrx_stock.get_market_ohlcv_by_date(FETCH_START, FETCH_END, code)
        if df is None or df.empty:
            return pd.DataFrame()
        df.index = pd.to_datetime(df.index).tz_localize(None)
        return df[["고가", "저가", "종가"]].rename(columns={"고가":"high","저가":"low","종가":"close"})
    except Exception as e:
        print(f"    ⚠  {code} 조회 실패: {e}")
        return pd.DataFrame()


def calc_adx_at(df: pd.DataFrame, cutoff: pd.Timestamp, period: int = 14) -> float:
    """cutoff 시점까지의 OHLCV로 ADX(14) 계산"""
    sub = df[df.index <= cutoff].copy()
    if len(sub) < period * 2 + 5:
        return 0.0  # 데이터 부족 → 0 (adx >= params.adx 필터에서 탈락 처리)

    h = sub["high"].astype(float)
    l = sub["low"].astype(float)
    c = sub["close"].astype(float)
    pc = c.shift(1)

    tr   = pd.concat([h-l, (h-pc).abs(), (l-pc).abs()], axis=1).max(axis=1)
    dmp  = (h - h.shift(1)).clip(lower=0)
    dmm  = (l.shift(1) - l).clip(lower=0)
    dmp  = dmp.where(dmp > dmm, 0.0)
    dmm  = dmm.where(dmm > dmp.shift(0), 0.0)

    atr  = tr.ewm(span=period, adjust=False).mean()
    dip  = dmp.ewm(span=period, adjust=False).mean() / (atr + 1e-9) * 100
    dim  = dmm.ewm(span=period, adjust=False).mean() / (atr + 1e-9) * 100
    dx   = ((dip - dim).abs() / (dip + dim + 1e-9)) * 100
    adx  = dx.ewm(span=period, adjust=False).mean()

    val = float(adx.iloc[-1])
    return round(val, 1) if not pd.isna(val) else 0.0


def build_adx_map(df: pd.DataFrame) -> dict:
    adx_map = {}
    if df.empty:
        return adx_map
    for ym in ym_range():
        yy, mm = int("20" + ym[:2]), int(ym[3:])
        py, pm = get_prev_month_end(yy, mm)
        prev_end = datetime.date(py, pm, calendar.monthrange(py, pm)[1])
        cutoff   = pd.Timestamp(prev_end)
        adx_map[ym] = calc_adx_at(df, cutoff)
    return adx_map


def write_gdb_js(data: dict, stock_list: list):
    now_str     = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    total_months = sum(len(v.get("monthly", {})) for v in data.values())
    lines = [
        "// ═══════════════════════════════════════════════════════════",
        "// GDB 확장 — KOSPI200 전종목 월간 수익률 + ATR + RSI-2 + ADX",
        "// 자동 생성: add_adx_to_gdb.py",
        f"// 생성일시: {now_str}",
        f"// 종목 수: {len(stock_list)}  / 월간 데이터: {total_months}건",
        "// ═══════════════════════════════════════════════════════════",
        "",
        "export const GDB_STOCK_POOL = [",
    ]
    pool_parts = [f'  {{ code:"{s["code"]}", name:"{s["name"]}" }}' for s in stock_list]
    lines.append(",\n".join(pool_parts))
    lines += ["];", "", "export const GDB_STOCK_MONTHLY = {"]

    yms = ym_range()
    stock_lines = []
    for s in stock_list:
        code = s["code"]
        if code not in data: continue
        entry    = data[code]
        monthly  = entry.get("monthly", {})
        atr_map  = entry.get("atr",     {})
        rsi2_map = entry.get("rsi2",    {})
        adx_map  = entry.get("adx",     {})

        month_parts = []
        for ym in yms:
            r_val    = monthly.get(ym)
            atr_val  = atr_map.get(ym)
            rsi2_val = rsi2_map.get(ym)
            adx_val  = adx_map.get(ym)
            if r_val is None and atr_val is None: continue
            parts = []
            if r_val    is not None: parts.append(f"r:{r_val}")
            if atr_val  is not None: parts.append(f"atr:{atr_val}")
            if rsi2_val is not None: parts.append(f"rsi2:{rsi2_val}")
            if adx_val  is not None: parts.append(f"adx:{adx_val}")
            month_parts.append(f'"{ym}":{{{",".join(parts)}}}')

        if month_parts:
            stock_lines.append(f'  "{code}":{{{",".join(month_parts)}}}')

    lines.append(",\n".join(stock_lines))
    lines += ["};", ""]
    JS_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"✅  {JS_PATH} 재생성 완료 ({len(stock_list)}종목, ADX 포함)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print("=" * 60)
    print("  add_adx_to_gdb.py — ADX 추가 GDB 패치")
    print("=" * 60)

    with open(JSON_PATH, encoding="utf-8") as f:
        data = json.load(f)

    with open(STOCK_LIST, encoding="utf-8") as f:
        stock_list = json.load(f)

    targets = stock_list[:3] if args.dry_run else stock_list
    print(f"\n▶ ADX 계산 시작 ({len(targets)}종목)\n")

    for idx, s in enumerate(targets, 1):
        code = s["code"]
        name = s["name"]
        print(f"  [{idx:3d}/{len(targets)}] {code} {name:<20}", end=" ", flush=True)

        # 이미 ADX 데이터가 있으면 스킵
        if data.get(code, {}).get("adx"):
            sample = [(k, v) for k, v in data[code]["adx"].items() if k >= "25-01"][-2:]
            print(f"⏭  기존 ADX 유지: {sample}")
            continue

        df = fetch_daily_ohlcv(code)
        if df.empty:
            print("⚠ 데이터 없음, adx=0 기본값 적용")
            data.setdefault(code, {})["adx"] = {ym: 0.0 for ym in ym_range()}
        else:
            adx_map = build_adx_map(df)
            data.setdefault(code, {})["adx"] = adx_map
            sample = [(k, v) for k, v in adx_map.items() if k >= "25-01"][-3:]
            print(f"✓  샘플 adx: {sample}")

        time.sleep(RATE_LIMIT_SLEEP)

    if not args.dry_run:
        print(f"\n▶ JSON 저장: {JSON_PATH}")
        with open(JSON_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)

    print(f"\n▶ JS 재생성 중...")
    write_gdb_js(data, stock_list)


if __name__ == "__main__":
    main()

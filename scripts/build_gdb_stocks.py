#!/usr/bin/env python3
"""
build_gdb_stocks.py — GDB RSI-2 추가 재빌드
════════════════════════════════════════════
pykrx로 200종목 일별 종가 수집 → RSI-2 계산 후
gdb_stock_data.json 및 src/gdb_stocks.js 재생성.

RSI-2 기준:
  - 진입 월 M의 rsi2 값 = M-1 마지막 거래일 기준 RSI(2)
  - 즉, 전월 말 신호로 당월 종목 우선순위 결정 (실전과 동일 타이밍)
  - 데이터 부족(상장 전 등) → fallback 50 (중립, 선택 우선순위 최하위 처리)

실행:
  python build_gdb_stocks.py              # 전체 200종목 재빌드
  python build_gdb_stocks.py --dry-run    # 첫 3종목만 테스트 (파일 저장 안 함)
  python build_gdb_stocks.py --skip-rsi2  # RSI-2 건너뛰고 기존 r/atr만 JS 재생성

필요 패키지: pykrx pandas
"""

import sys
import json
import time
import datetime
import calendar
import pathlib
import argparse

import pandas as pd
from pykrx import stock as pykrx_stock

# ─── 경로 설정 ─────────────────────────────────────────────────
BASE_DIR    = pathlib.Path(__file__).parent
JSON_PATH   = BASE_DIR / "gdb_stock_data.json"
JS_PATH     = BASE_DIR.parent / "src" / "gdb_stocks.js"
STOCK_LIST  = BASE_DIR / "stock_list.json"

# GDB 월 범위: 21-01 ~ 26-03
GDB_START_YEAR, GDB_START_MONTH = 2021, 1
GDB_END_YEAR,   GDB_END_MONTH   = 2026, 3

# pykrx 일별 조회 시작: 전월 말 RSI-2 확보를 위해 1개월 앞당김
FETCH_START = "20201101"
FETCH_END   = "20260331"

RATE_LIMIT_SLEEP = 0.25   # pykrx API 호출 간격 (초)


# ─── RSI-2 계산 헬퍼 ───────────────────────────────────────────
def calc_rsi2(closes: pd.Series) -> float:
    """
    2-period RSI (단순 평균 방식).
    입력: 최소 3개 이상의 종가 Series (최신순 또는 날짜순 모두 무관하게 tail 사용)
    출력: 0~100 float, 데이터 부족 시 50.0 (중립)
    """
    if len(closes) < 3:
        return 50.0

    tail = closes.tail(3).values          # [c0, c1, c2]  c2=가장 최근
    d1 = tail[1] - tail[0]
    d2 = tail[2] - tail[1]

    gains = [d for d in (d1, d2) if d > 0]
    losses = [abs(d) for d in (d1, d2) if d < 0]

    avg_gain = sum(gains) / 2
    avg_loss = sum(losses) / 2

    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100 - 100 / (1 + rs), 1)


def get_prev_month_end(year: int, month: int):
    """month의 전월 (year, month) 반환"""
    if month == 1:
        return year - 1, 12
    return year, month - 1


def ym_range():
    """GDB 전체 월 범위 (yy-mm 문자열 리스트)"""
    result = []
    y, m = GDB_START_YEAR, GDB_START_MONTH
    while (y, m) <= (GDB_END_YEAR, GDB_END_MONTH):
        result.append(f"{str(y)[2:]}-{m:02d}")
        m += 1
        if m > 12:
            m = 1
            y += 1
    return result


# ─── 일별 데이터 수집 ──────────────────────────────────────────
def fetch_daily_closes(code: str) -> pd.DataFrame:
    """
    pykrx로 code 종목의 일별 종가 DataFrame 반환.
    컬럼: 종가 (index: DatetimeIndex)
    """
    try:
        df = pykrx_stock.get_market_ohlcv_by_date(FETCH_START, FETCH_END, code)
        if df is None or df.empty:
            return pd.DataFrame()
        df.index = pd.to_datetime(df.index).tz_localize(None)
        return df[["종가"]].rename(columns={"종가": "close"})
    except Exception as e:
        print(f"    ⚠  {code} 일별 조회 실패: {e}")
        return pd.DataFrame()


def build_rsi2_map(df: pd.DataFrame) -> dict:
    """
    일별 종가 DataFrame → 각 GDB 월(ym)의 RSI-2 dict 반환.
    rsi2[ym] = 전월(M-1) 마지막 거래일 기준 RSI-2
    """
    rsi2_map = {}
    if df.empty:
        return rsi2_map

    for ym in ym_range():
        yy, mm = int("20" + ym[:2]), int(ym[3:])
        py, pm = get_prev_month_end(yy, mm)

        # 전월 마지막 날 기준 3 거래일 확보
        prev_end = datetime.date(py, pm, calendar.monthrange(py, pm)[1])
        cutoff   = pd.Timestamp(prev_end)

        # 전월 말 이전 데이터에서 최근 3거래일 종가
        subset = df[df.index <= cutoff]["close"]
        if len(subset) < 3:
            rsi2_map[ym] = 50.0
            continue

        rsi2_map[ym] = calc_rsi2(subset)

    return rsi2_map


# ─── JS 재생성 ─────────────────────────────────────────────────
def load_stock_list() -> list:
    with open(STOCK_LIST, encoding="utf-8") as f:
        return json.load(f)


def write_gdb_js(data: dict, stock_list: list):
    """gdb_stock_data(dict) → src/gdb_stocks.js 재생성"""
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    total_months = sum(len(v.get("monthly", {})) for v in data.values())

    lines = []
    lines.append("// ═══════════════════════════════════════════════════════════")
    lines.append("// GDB 확장 — KOSPI200 전종목 월간 수익률 + ATR + RSI-2")
    lines.append(f"// 자동 생성: build_gdb_stocks.py")
    lines.append(f"// 생성일시: {now_str}")
    lines.append(f"// 종목 수: {len(stock_list)}  / 월간 데이터: {total_months}건")
    lines.append("// ═══════════════════════════════════════════════════════════")
    lines.append("")

    # GDB_STOCK_POOL
    lines.append("export const GDB_STOCK_POOL = [")
    pool_parts = [f'  {{ code:"{s["code"]}", name:"{s["name"]}" }}' for s in stock_list]
    lines.append(",\n".join(pool_parts))
    lines.append("];")
    lines.append("")

    # GDB_STOCK_MONTHLY
    lines.append("export const GDB_STOCK_MONTHLY = {")
    stock_lines = []
    for s in stock_list:
        code = s["code"]
        if code not in data:
            continue
        entry = data[code]
        monthly = entry.get("monthly", {})
        atr_map = entry.get("atr", {})
        rsi2_map = entry.get("rsi2", {})

        month_parts = []
        for ym in ym_range():
            r_val    = monthly.get(ym)
            atr_val  = atr_map.get(ym)
            rsi2_val = rsi2_map.get(ym)
            if r_val is None and atr_val is None:
                continue
            parts = []
            if r_val    is not None: parts.append(f"r:{r_val}")
            if atr_val  is not None: parts.append(f"atr:{atr_val}")
            if rsi2_val is not None: parts.append(f"rsi2:{rsi2_val}")
            month_parts.append(f'"{ym}":{{{",".join(parts)}}}')

        if month_parts:
            stock_lines.append(f'  "{code}":{{{",".join(month_parts)}}}')

    lines.append(",\n".join(stock_lines))
    lines.append("};")
    lines.append("")

    JS_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"✅  {JS_PATH} 재생성 완료 ({len(stock_list)}종목)")


# ─── 메인 ──────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run",   action="store_true", help="첫 3종목만 테스트 (파일 저장 안 함)")
    parser.add_argument("--skip-rsi2", action="store_true", help="RSI-2 건너뛰고 기존 r/atr로만 JS 재생성")
    args = parser.parse_args()

    print("=" * 60)
    print("  build_gdb_stocks.py — RSI-2 추가 GDB 재빌드")
    print("=" * 60)

    # 기존 JSON 로드
    with open(JSON_PATH, encoding="utf-8") as f:
        data = json.load(f)

    stock_list = load_stock_list()
    targets = stock_list[:3] if args.dry_run else stock_list

    if not args.skip_rsi2:
        print(f"\n▶ RSI-2 계산 시작 ({len(targets)}종목, 예상 {len(targets)*0.5:.0f}~{len(targets)*2:.0f}초)")
        print(f"  pykrx 조회 범위: {FETCH_START} ~ {FETCH_END}\n")

        for idx, s in enumerate(targets, 1):
            code = s["code"]
            name = s["name"]
            print(f"  [{idx:3d}/{len(targets)}] {code} {name:<20}", end=" ", flush=True)

            df = fetch_daily_closes(code)
            if df.empty:
                print("⚠ 데이터 없음, rsi2=50 기본값 적용")
                data.setdefault(code, {})["rsi2"] = {ym: 50.0 for ym in ym_range()}
            else:
                rsi2_map = build_rsi2_map(df)
                data.setdefault(code, {})["rsi2"] = rsi2_map
                # 샘플 출력 (최근 3개월)
                sample = [(k, v) for k, v in rsi2_map.items() if k >= "25-01"][-3:]
                print(f"✓  샘플 rsi2: {sample}")

            time.sleep(RATE_LIMIT_SLEEP)

        if not args.dry_run:
            with open(JSON_PATH, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
            print(f"\n✅  {JSON_PATH} 저장 완료")
        else:
            print("\n[dry-run] JSON 저장 생략")
    else:
        print("⏭  --skip-rsi2: RSI-2 계산 건너뜀")

    # JS 재생성
    if not args.dry_run:
        print("\n▶ gdb_stocks.js 재생성 중...")
        write_gdb_js(data, stock_list)
    else:
        print("\n[dry-run] JS 재생성 생략")
        # dry-run 시 첫 종목 RSI-2 샘플 출력
        for s in targets:
            code = s["code"]
            rsi2 = data.get(code, {}).get("rsi2", {})
            print(f"  {code} RSI-2 전체: {dict(list(rsi2.items())[:5])} ...")

    print("\n완료.")


if __name__ == "__main__":
    main()

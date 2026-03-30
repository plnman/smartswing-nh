#!/usr/bin/env python3
"""
build_daily_gdb.py — 일별 OHLCV 수집 (Phase 2 기반 데이터)
═══════════════════════════════════════════════════════════
pykrx로 200종목 + KODEX200(069500) 의 5년치 일별 OHLCV를
scripts/daily_data/ 폴더에 종목별 CSV로 저장.

저장 형식 (per-stock CSV):
  date,open,high,low,close,volume
  2021-01-04,82600,85000,82400,83000,19345123
  ...

실행:
  python build_daily_gdb.py              # 전체 200종목 수집
  python build_daily_gdb.py --dry-run    # 첫 3종목만 테스트
  python build_daily_gdb.py --update     # 최신 날짜 이후만 추가 (증분 갱신)
  python build_daily_gdb.py --code 005930  # 특정 종목만 재수집

소요 시간: 약 5~15분 (네트워크 속도에 따라)
용량: 약 50~80MB (200종목 × 5년 × ~260거래일)
"""

import sys
import json
import time
import argparse
import datetime
import pathlib

import pandas as pd
from pykrx import stock as pykrx_stock

# ─── 경로 설정 ────────────────────────────────────────────────
BASE_DIR    = pathlib.Path(__file__).parent
STOCK_LIST  = BASE_DIR / "stock_list.json"
OUTPUT_DIR  = BASE_DIR / "daily_data"

FETCH_START = "20210101"
FETCH_END   = datetime.date.today().strftime("%Y%m%d")

# KODEX 200 ETF (KOSPI200 프록시)
INDEX_CODE = "069500"
INDEX_NAME = "KODEX200"

RATE_LIMIT_SLEEP = 0.3   # pykrx API 호출 간격


# ─── 데이터 수집 ──────────────────────────────────────────────
def fetch_ohlcv(code: str, start: str, end: str) -> pd.DataFrame:
    """
    pykrx로 일별 OHLCV DataFrame 반환.
    columns: date(str), open, high, low, close, volume
    """
    try:
        df = pykrx_stock.get_market_ohlcv_by_date(start, end, code)
        if df is None or df.empty:
            return pd.DataFrame()

        df.index = pd.to_datetime(df.index).tz_localize(None)
        df = df.rename(columns={
            "시가": "open", "고가": "high", "저가": "low",
            "종가": "close", "거래량": "volume"
        })
        # 필요 컬럼만
        cols = [c for c in ["open","high","low","close","volume"] if c in df.columns]
        df = df[cols].copy()
        df.index.name = "date"
        df.index = df.index.strftime("%Y-%m-%d")
        return df

    except Exception as e:
        print(f"    ⚠  {code} 조회 실패: {e}")
        return pd.DataFrame()


def get_last_date_in_csv(csv_path: pathlib.Path) -> str | None:
    """기존 CSV 마지막 날짜 반환 (증분 갱신용)"""
    if not csv_path.exists():
        return None
    try:
        df = pd.read_csv(csv_path, usecols=["date"])
        if df.empty:
            return None
        return df["date"].iloc[-1]  # 형식: "2026-03-21"
    except Exception:
        return None


# ─── 메인 ─────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run",  action="store_true", help="첫 3종목만 테스트 (저장 안 함)")
    parser.add_argument("--update",   action="store_true", help="최신 날짜 이후만 증분 갱신")
    parser.add_argument("--code",     type=str, default=None, help="특정 종목 코드만 재수집")
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(exist_ok=True)

    with open(STOCK_LIST, encoding="utf-8") as f:
        stock_list = json.load(f)

    # 인덱스(KODEX200) 추가
    targets = [{"code": INDEX_CODE, "name": INDEX_NAME}] + stock_list

    # 특정 종목만 재수집
    if args.code:
        targets = [s for s in targets if s["code"] == args.code]
        if not targets:
            print(f"❌  코드 {args.code} 를 stock_list.json에서 찾을 수 없음")
            sys.exit(1)

    if args.dry_run:
        targets = targets[:4]  # index + 3종목

    print("=" * 60)
    print("  build_daily_gdb.py — 일별 OHLCV 수집")
    print("=" * 60)
    print(f"  저장 경로: {OUTPUT_DIR}")
    print(f"  수집 범위: {FETCH_START} ~ {FETCH_END}")
    print(f"  대상 종목: {len(targets)}개")
    print()

    ok_count = 0
    skip_count = 0

    for idx, s in enumerate(targets, 1):
        code = s["code"]
        name = s["name"]
        csv_path = OUTPUT_DIR / f"{code}.csv"

        # 증분 갱신: 마지막 날짜 이후만 수집
        start = FETCH_START
        if args.update and csv_path.exists():
            last = get_last_date_in_csv(csv_path)
            if last:
                # 마지막 날짜 다음날부터
                next_day = (datetime.datetime.strptime(last, "%Y-%m-%d") + datetime.timedelta(days=1))
                next_str = next_day.strftime("%Y%m%d")
                if next_str > FETCH_END:
                    print(f"  [{idx:3d}/{len(targets)}] {code} {name:<20} ✓ 이미 최신")
                    skip_count += 1
                    continue
                start = next_str

        print(f"  [{idx:3d}/{len(targets)}] {code} {name:<20}", end=" ", flush=True)

        df = fetch_ohlcv(code, start, FETCH_END)
        if df.empty:
            print("⚠ 데이터 없음 (건너뜀)")
            continue

        if args.dry_run:
            print(f"✓ [dry-run] {len(df)}행 (저장 안 함) | 최근: {df.index[-1]} close={df['close'].iloc[-1]:,.0f}")
            ok_count += 1
            continue

        # 증분 갱신: 기존 + 신규 합치기
        if args.update and csv_path.exists():
            try:
                existing = pd.read_csv(csv_path, index_col="date")
                df = pd.concat([existing, df])
                df = df[~df.index.duplicated(keep="last")].sort_index()
            except Exception as e:
                print(f"⚠ 기존 파일 병합 실패: {e}, 전체 재작성")

        df.to_csv(csv_path)
        print(f"✓ {len(df)}행 | {df.index[0]} ~ {df.index[-1]}")
        ok_count += 1

        time.sleep(RATE_LIMIT_SLEEP)

    print(f"\n완료: {ok_count}종목 저장, {skip_count}종목 건너뜀")
    print(f"저장 경로: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()

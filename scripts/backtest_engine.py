#!/usr/bin/env python3
"""
backtest_engine.py — Phase 2 일별 엔진 (SmartSwing-NH)
═══════════════════════════════════════════════════════════
실전(telegram_alert.py)과 동일한 Python 환경에서 백테스트 수행.
일별 OHLCV 데이터로 HardStop / Trailing Stop / RSI-2 Exit를
실시간 트리거로 구현. 월간 근사값이 아닌 실제 청산 가격 기반.

파이프라인:
  1. 매월 신호 생성: sigThresh + L1 Shield (m.r≥thresh + KOSPI SMA5)
  2. RSI-2 낮은 순 종목 선택 (실전과 동일)
  3. 진입: entryDay 실제 거래일에 종가 매수
  4. 일별 청산 체크 (우선순위):
     a. Low ≤ HardStop 가격 → 즉시 HardStop 가격으로 청산
     b. Close ≤ Trailing Stop 가격 (고점 추적) → TrailingStop 가격으로 청산
     c. RSI-2 ≥ rsi2Exit → 과매수 신호, 종가 청산
     d. 보유 만기(timeCut) 도래 → 종가 청산
  5. results.json 출력 → 대시보드 연동

실행:
  python backtest_engine.py                # 전체 기간 백테스트
  python backtest_engine.py --period 1yr   # 1년 기간
  python backtest_engine.py --period 3yr
  python backtest_engine.py --period 5yr
  python backtest_engine.py --period custom --start 23-01 --end 26-03

출력:
  scripts/results.json
"""

import json
import math
import datetime
import pathlib
import argparse
import sys

import pandas as pd

# ─── 경로 설정 ────────────────────────────────────────────────
BASE_DIR     = pathlib.Path(__file__).parent
DAILY_DIR    = BASE_DIR / "daily_data"
GDB_JSON     = BASE_DIR / "gdb_stock_data.json"
STOCK_LIST   = BASE_DIR / "stock_list.json"
RESULTS_JSON = BASE_DIR / "results.json"

INDEX_CODE   = "069500"   # KODEX200 (KOSPI200 프록시)

# ─── 파라미터 (DEFAULT_PARAMS 동기화) ────────────────────────
DEFAULT_PARAMS = {
    "adx": 20, "rsi2Entry": 25, "zscore": 1.0,  # ★ #6: rsi2Entry 15→25 (v11.0 파라미터 동기화)
    "nSlots": 5,
    # ★ V3 확정 파라미터 (2026-03-24 그리드 탐색 후 확정)
    # Trailing 10.0%: 추세 연장 극대화, NaN 모멘텀홀드와 시너지
    # ATR_mult 1.6x: 손절 하방 고정, MDD -7.5% 구조적 한계선
    # 64조합 탐색 결과: 누적 +150.6% / MDD -7.5% / 샤프 1.19 / 칼마 2.64
    "hardStop": 5.3, "atrMult": 1.6,
    "timeCutOn": False, "timeCut": 10,
    "trailing": 10.0, "rsi2Exit": 99,
    "finBertThresh": 0.09,
    "cvdWin": 70, "cvdCompare": 7,
}
TRADE_COST_PCT = 0.31   # 라운드트립 거래비용 (%)
BASE_CAPITAL   = 50_000_000
CAPITAL_PER_SLOT = 10_000_000
NSLOTS_DEFAULT = 5

# ─── ALL_MONTHLY (GDB 동결 데이터, backtest.js와 동기화) ──────
ALL_MONTHLY = [
    {"date":"21-02","year":2021,"month":2,"r":1.32},
    {"date":"21-03","year":2021,"month":3,"r":1.25},
    {"date":"21-04","year":2021,"month":4,"r":1.76},
    {"date":"21-05","year":2021,"month":5,"r":1.31},
    {"date":"21-06","year":2021,"month":6,"r":2.55},
    {"date":"21-07","year":2021,"month":7,"r":-3.4},
    {"date":"21-08","year":2021,"month":8,"r":-0.97},
    {"date":"21-09","year":2021,"month":9,"r":-4.4},
    {"date":"21-10","year":2021,"month":10,"r":-3.2},
    {"date":"21-11","year":2021,"month":11,"r":-3.92},
    {"date":"21-12","year":2021,"month":12,"r":5.61},
    {"date":"22-01","year":2022,"month":1,"r":-9.19},
    {"date":"22-02","year":2022,"month":2,"r":0.99},
    {"date":"22-03","year":2022,"month":3,"r":1.12},
    {"date":"22-04","year":2022,"month":4,"r":-2.88},
    {"date":"22-05","year":2022,"month":5,"r":-0.15},
    {"date":"22-06","year":2022,"month":6,"r":-13.36},
    {"date":"22-07","year":2022,"month":7,"r":5.25},
    {"date":"22-08","year":2022,"month":8,"r":-0.11},
    {"date":"22-09","year":2022,"month":9,"r":-12.88},
    {"date":"22-10","year":2022,"month":10,"r":6.47},
    {"date":"22-11","year":2022,"month":11,"r":7.16},
    {"date":"22-12","year":2022,"month":12,"r":-9.33},
    {"date":"23-01","year":2023,"month":1,"r":8.99},
    {"date":"23-02","year":2023,"month":2,"r":-0.78},
    {"date":"23-03","year":2023,"month":3,"r":2.3},
    {"date":"23-04","year":2023,"month":4,"r":1.38},
    {"date":"23-05","year":2023,"month":5,"r":3.87},
    {"date":"23-06","year":2023,"month":6,"r":-0.33},
    {"date":"23-07","year":2023,"month":7,"r":2.26},
    {"date":"23-08","year":2023,"month":8,"r":-3.15},
    {"date":"23-09","year":2023,"month":9,"r":-2.39},
    {"date":"23-10","year":2023,"month":10,"r":-6.48},
    {"date":"23-11","year":2023,"month":11,"r":10.75},
    {"date":"23-12","year":2023,"month":12,"r":5.79},
    {"date":"24-01","year":2024,"month":1,"r":-6.08},
    {"date":"24-02","year":2024,"month":2,"r":5.75},
    {"date":"24-03","year":2024,"month":3,"r":5.36},
    {"date":"24-04","year":2024,"month":4,"r":-2.54},
    {"date":"24-05","year":2024,"month":5,"r":-1.89},
    {"date":"24-06","year":2024,"month":6,"r":7.21},
    {"date":"24-07","year":2024,"month":7,"r":-0.92},
    {"date":"24-08","year":2024,"month":8,"r":-4.98},
    {"date":"24-09","year":2024,"month":9,"r":-4.64},
    {"date":"24-10","year":2024,"month":10,"r":-1.58},
    {"date":"24-11","year":2024,"month":11,"r":-4.08},
    {"date":"24-12","year":2024,"month":12,"r":-2.35},
    {"date":"25-01","year":2025,"month":1,"r":4.89},
    {"date":"25-02","year":2025,"month":2,"r":0.28},
    {"date":"25-03","year":2025,"month":3,"r":-0.57},
    {"date":"25-04","year":2025,"month":4,"r":1.91},
    {"date":"25-05","year":2025,"month":5,"r":6.16},
    {"date":"25-06","year":2025,"month":6,"r":15.29},
    {"date":"25-07","year":2025,"month":7,"r":5.79},
    {"date":"25-08","year":2025,"month":8,"r":-1.93},
    {"date":"25-09","year":2025,"month":9,"r":10.21},
    {"date":"25-10","year":2025,"month":10,"r":22.24},
    {"date":"25-11","year":2025,"month":11,"r":-4.39},
    {"date":"25-12","year":2025,"month":12,"r":9.38},
    {"date":"26-01","year":2026,"month":1,"r":26.8},
    {"date":"26-02","year":2026,"month":2,"r":21.46},
    {"date":"26-03","year":2026,"month":3,"r":-7.6},
]

# KOSPI200 월말 누적지수 (EQUITY_CURVE_RAW, backtest.js 동기화)
EQUITY_CURVE = {
    "21-01":100.0,"21-02":101.32,"21-03":102.59,"21-04":104.4,
    "21-05":105.77,"21-06":108.47,"21-07":104.78,"21-08":103.76,
    "21-09":99.19,"21-10":96.02,"21-11":92.26,"21-12":97.44,
    "22-01":88.49,"22-02":89.37,"22-03":90.37,"22-04":87.77,
    "22-05":87.64,"22-06":75.93,"22-07":79.92,"22-08":79.83,
    "22-09":69.55,"22-10":74.05,"22-11":79.35,"22-12":71.95,
    "23-01":78.42,"23-02":77.81,"23-03":79.6,"23-04":80.7,
    "23-05":83.82,"23-06":83.54,"23-07":85.43,"23-08":82.74,
    "23-09":80.76,"23-10":75.53,"23-11":83.65,"23-12":88.49,
    "24-01":83.11,"24-02":87.89,"24-03":92.6,"24-04":90.25,
    "24-05":88.54,"24-06":94.92,"24-07":94.05,"24-08":89.37,
    "24-09":85.22,"24-10":83.87,"24-11":80.45,"24-12":78.56,
    "25-01":82.4,"25-02":82.63,"25-03":82.16,"25-04":83.73,
    "25-05":88.89,"25-06":102.48,"25-07":108.41,"25-08":106.32,
    "25-09":117.17,"25-10":143.23,"25-11":136.94,"25-12":149.79,
    "26-01":189.94,"26-02":230.7,"26-03":213.19,
}


# ─── 데이터 로드 ──────────────────────────────────────────────
def load_all_daily(codes: list[str]) -> dict[str, pd.DataFrame]:
    """모든 종목 일별 데이터 메모리 로드."""
    result = {}
    for code in codes:
        csv_path = DAILY_DIR / f"{code}.csv"
        if csv_path.exists():
            df = pd.read_csv(csv_path, index_col="date", parse_dates=True)
            df.index = pd.to_datetime(df.index)
            result[code] = df
    return result


def load_gdb() -> dict:
    with open(GDB_JSON, encoding="utf-8") as f:
        return json.load(f)


def load_stock_list() -> list:
    with open(STOCK_LIST, encoding="utf-8") as f:
        return json.load(f)


# ─── 헬퍼 ─────────────────────────────────────────────────────
def clamp(val, lo, hi):
    return max(lo, min(hi, val))


def get_hard_stop_pct(code: str, ym: str, atr_mult: float, gdb: dict) -> float:
    """ATR 기반 HardStop (%). clamp(1.5, ATR×atrMult, 8.0)"""
    atr = gdb.get(code, {}).get("atr", {}).get(ym)
    if atr is None:
        return 3.5
    return round(clamp(atr * atr_mult, 1.5, 8.0), 2)


def calc_rsi2_series(closes: pd.Series) -> pd.Series:
    """
    일별 종가 Series → RSI-2 Series.
    최소 3개 이상의 데이터 필요.

    ★ 설계 의도 (NaN 동작 명문화) ★
    연속 상승 구간에서 avg_loss = 0이 되면 RSI 분모가 정의 불가 → NaN 반환.
    이를 100으로 강제 보정(fillna)하지 않는 것이 의도적 설계 선택이다.

    이유:
    - NaN 구간 = 강력한 모멘텀 추세 (연속 양봉)
    - 이 구간에서 RSI-2≥99 exit를 발동하면 멀티배거 수익을 조기에 截斷함
    - 대신 Trailing Stop이 고점 추적 출구를 담당 → 수익 극대화
    - RSI-2 Exit는 '상승-하락-재상승'의 이중 과열(혼합 패턴)에서만 작동

    결론: avg_loss=0 → NaN은 [Momentum Hold] 신호.
          RSI-2가 뻗은 구간은 Trailing Stop에 위임하고 간섭하지 않는다.
    """
    delta = closes.diff()
    gain = delta.clip(lower=0)
    loss = (-delta).clip(lower=0)
    avg_gain = gain.rolling(2).mean()
    avg_loss = loss.rolling(2).mean()
    rs = avg_gain / avg_loss.replace(0, float("nan"))
    rsi = 100 - (100 / (1 + rs))
    # ※ fillna(100) 하지 않음 — 연속 상승 시 NaN 유지가 전략의 엣지(Edge)
    return rsi


def get_next_trading_day(daily_df: pd.DataFrame, target_date: datetime.date) -> datetime.date | None:
    """target_date 이후 첫 번째 실제 거래일 반환."""
    ts = pd.Timestamp(target_date)
    future = daily_df.index[daily_df.index >= ts]
    if len(future) == 0:
        return None
    return future[0].date()


def kospi_sma5_ok(ym: str) -> bool:
    """
    전월말 KOSPI200 지수가 최근 5개월 이동평균 이상이면 True.
    EQUITY_CURVE 월별 지수값 기준.
    """
    ym_keys = sorted(EQUITY_CURVE.keys())
    idx = next((i for i, k in enumerate(ym_keys) if k == ym), None)
    if idx is None or idx < 5:
        return True   # 데이터 부족 → 차단하지 않음
    prev_k = EQUITY_CURVE[ym_keys[idx - 1]]   # 전월말 지수
    sma5   = sum(EQUITY_CURVE[ym_keys[idx - j]] for j in range(1, 6)) / 5
    return prev_k >= sma5


def ym_to_dt(ym: str) -> datetime.date:
    """'25-03' → datetime.date(2025, 3, 1)"""
    yy, mm = int("20" + ym[:2]), int(ym[3:])
    return datetime.date(yy, mm, 1)


# ─── 일별 시뮬레이션 ──────────────────────────────────────────
def simulate_trade(
    code: str,
    entry_date: datetime.date,
    hold_days_target: int,
    hard_stop_pct: float,
    trailing_pct: float,
    rsi2_exit: float,
    daily_df: pd.DataFrame,
) -> dict:
    """
    진입~청산까지 일별 시뮬레이션.
    반환: {entry_date, exit_date, entry_price, exit_price, ret, reason, peak_price}
    """
    # 진입일 이후 거래일만 슬라이스
    ts_entry = pd.Timestamp(entry_date)
    trading_days = daily_df.index[daily_df.index >= ts_entry]
    if len(trading_days) == 0:
        return None

    # 진입: 진입일 종가
    entry_ts = trading_days[0]
    entry_price = float(daily_df.loc[entry_ts, "close"])
    if entry_price <= 0:
        return None

    hard_stop_price = entry_price * (1 - hard_stop_pct / 100)
    peak_price      = entry_price
    trailing_price  = entry_price * (1 - trailing_pct / 100)

    # RSI-2 계산을 위한 히스토리 (진입일 기준 최근 10거래일)
    hist_end   = daily_df.index[daily_df.index <= ts_entry]
    hist_start = hist_end[-10:] if len(hist_end) >= 10 else hist_end
    rsi2_base  = calc_rsi2_series(daily_df.loc[hist_start, "close"])

    # 보유 기간 루프
    exit_ts     = None
    exit_price  = entry_price
    reason      = "만기청산"
    days_held   = 0

    for i, ts in enumerate(trading_days):
        if i == 0:
            # 진입일: RSI-2 기준치만 업데이트
            continue

        days_held = i
        row = daily_df.loc[ts]
        lo    = float(row["low"])
        hi    = float(row["high"])
        close = float(row["close"])

        # ① HardStop: 장중 low가 HardStop 가격 이하
        if lo <= hard_stop_price:
            exit_ts    = ts
            exit_price = hard_stop_price
            reason     = f"HardStop({hard_stop_pct:.1f}%)"
            break

        # ② Trailing Stop: 고점 갱신 후 close 기준 추적
        if hi > peak_price:
            peak_price     = hi
            trailing_price = peak_price * (1 - trailing_pct / 100)

        if close <= trailing_price:
            exit_ts    = ts
            exit_price = close
            reason     = f"TrailingStop({trailing_pct:.1f}%)"
            break

        # ③ RSI-2 Exit: 일별 RSI-2 계산
        hist_closes = daily_df.loc[:ts, "close"].tail(5)
        if len(hist_closes) >= 3:
            rsi2_val = calc_rsi2_series(hist_closes).iloc[-1]
            if not math.isnan(rsi2_val) and rsi2_val >= rsi2_exit:
                exit_ts    = ts
                exit_price = close
                reason     = f"RSI-2≥{rsi2_exit:.0f}"
                break

        # ④ 만기: hold_days_target 거래일 경과
        if days_held >= hold_days_target:
            exit_ts    = ts
            exit_price = close
            reason     = "만기청산"
            break

    # 루프 끝까지 청산 못한 경우 → 마지막 거래일 종가
    if exit_ts is None:
        exit_ts    = trading_days[min(hold_days_target, len(trading_days) - 1)]
        exit_price = float(daily_df.loc[exit_ts, "close"])
        reason     = "만기청산"

    gross_ret = (exit_price / entry_price - 1) * 100
    net_ret   = round(gross_ret - TRADE_COST_PCT, 2)

    return {
        "entry_date":   entry_date.isoformat(),
        "exit_date":    exit_ts.date().isoformat(),
        "entry_price":  entry_price,
        "exit_price":   round(exit_price, 0),
        "ret":          net_ret,
        "reason":       reason,
        "peak_price":   round(peak_price, 0),
        "days_held":    int(days_held),
    }


# ─── 백테스트 메인 엔진 ────────────────────────────────────────
def run_backtest(
    params: dict = None,
    period: str  = "5yr",
    custom_start: str = None,
    custom_end: str   = None,
) -> dict:
    """
    일별 OHLCV 기반 백테스트 엔진.

    period: "1yr" | "3yr" | "5yr" | "custom"
    custom_start / custom_end: "yy-mm" 형식 (period="custom" 시 필수)

    반환: {tradeLog, curve, kpi, params}
    """
    if params is None:
        params = DEFAULT_PARAMS

    p = {**DEFAULT_PARAMS, **params}
    NSLOTS  = p["nSlots"]

    # 기간 설정
    period_map = {"1yr": 13, "3yr": 37, "5yr": 61}
    if period == "custom" and custom_start and custom_end:
        start_ym, end_ym = custom_start, custom_end
    else:
        n = period_map.get(period, 61)
        sorted_ym = sorted(EQUITY_CURVE.keys())
        end_ym   = sorted_ym[-1]
        start_ym = sorted_ym[max(0, len(sorted_ym) - n)]

    # 해당 기간의 monthly 슬라이스
    monthly = [m for m in ALL_MONTHLY if start_ym <= m["date"] <= end_ym]

    # sigThresh 계산
    sig_thresh_base = max(0.8, (p["adx"] - 20) * 0.15)
    sig_thresh      = sig_thresh_base * max(0.6, p["zscore"] * 0.35)

    # CVD 파라미터
    cvd_months = max(1, round(p["cvdWin"] / 15))
    cvd_gate   = -math.floor(p["cvdCompare"] / 2)

    # 데이터 로드
    print("📂 데이터 로드 중...", end=" ", flush=True)
    stock_list = load_stock_list()
    gdb        = load_gdb()
    all_codes  = [INDEX_CODE] + [s["code"] for s in stock_list]
    daily      = load_all_daily(all_codes)
    print(f"✓ ({len(daily)}개 종목)")

    trade_log = []
    trade_id  = 1

    for i, m in enumerate(monthly):
        # ── L1 Shield ─────────────────────────────────────
        # (1) 상승월 필터
        if m["r"] < sig_thresh:
            continue

        ym = m["date"]

        # (2) KOSPI SMA5 이격도
        if not kospi_sma5_ok(ym):
            continue

        # (3) CVD 게이트
        cvd_slice = monthly[max(0, i - cvd_months):i]
        if len(cvd_slice) >= 2:
            net_cvd = sum(1 if x["r"] > 0 else -1 for x in cvd_slice)
            if net_cvd <= cvd_gate:
                continue

        # ── 종목 선정 (RSI-2 낮은 순) ─────────────────────
        year, month = m["year"], m["month"]
        avail = [
            s for s in stock_list
            if gdb.get(s["code"], {}).get("rsi2", {}).get(ym) is not None
        ]
        if not avail:
            continue

        ranked = sorted(avail, key=lambda s: gdb[s["code"]]["rsi2"][ym])[:NSLOTS]

        for slot, stock in enumerate(ranked):
            code = stock["code"]

            # 진입일 계산 (slot 기반)
            entry_day_target = 3 + slot * 3   # 3, 6, 9, 12, 15
            entry_dt = datetime.date(year, month, 1)
            # 해당 월의 entry_day_target번째 영업일 근사 (달력 날짜 기준)
            import calendar as _cal
            last_day = _cal.monthrange(year, month)[1]
            target_d = min(entry_day_target, last_day)
            entry_candidate = datetime.date(year, month, target_d)

            # 실제 거래일 찾기
            if code not in daily:
                continue
            entry_actual = get_next_trading_day(daily[code], entry_candidate)
            if entry_actual is None:
                continue
            # 진입일이 당월 범위 벗어나면 스킵
            if entry_actual.month != month or entry_actual.year != year:
                continue

            # 보유일 계산
            prev_r = monthly[i - 1]["r"] if i > 0 else 0
            momentum_bonus = 5 if prev_r >= 8 else (2 if prev_r >= 5 else 0)
            raw_hold  = min(25, 18 + momentum_bonus)
            hold_days = min(p["timeCut"], raw_hold) if p["timeCutOn"] else raw_hold

            # ATR 기반 HardStop
            hs_pct = get_hard_stop_pct(code, ym, p["atrMult"], gdb)

            # 일별 시뮬레이션
            result = simulate_trade(
                code         = code,
                entry_date   = entry_actual,
                hold_days_target = hold_days,
                hard_stop_pct= hs_pct,
                trailing_pct = p["trailing"],
                rsi2_exit    = p["rsi2Exit"],
                daily_df     = daily[code],
            )
            if result is None:
                continue

            rsi2_val = gdb[code]["rsi2"][ym]
            pnl = round(result["ret"] / 100 * CAPITAL_PER_SLOT)

            trade_log.append({
                "id":         trade_id,
                "code":       code,
                "name":       stock["name"],
                "ym":         ym,
                "entry":      result["entry_date"],
                "exit":       result["exit_date"],
                "ret":        result["ret"],
                "pnl":        pnl,
                "reason":     result["reason"],
                "hardStop":   hs_pct,
                "l4":         f"RSI2:{rsi2_val:.0f}",
                "slot":       slot,
                "entryPrice": result["entry_price"],
                "exitPrice":  result["exit_price"],
                "peakPrice":  result["peak_price"],
                "daysHeld":   result["days_held"],
            })
            trade_id += 1

    print(f"✓ 총 {len(trade_log)}건 거래 시뮬레이션 완료")

    # ── Equity Curve 계산 ──────────────────────────────────
    # 거래를 exit_date 기준으로 월별 그룹화
    trade_by_exit_ym = {}
    for t in trade_log:
        exit_ym = t["exit"][:7].replace("-", "")   # "2025-06-15" → "202506" → "25-06"
        exit_dt = datetime.datetime.strptime(t["exit"], "%Y-%m-%d")
        k = f"{str(exit_dt.year)[2:]}-{exit_dt.month:02d}"
        if k not in trade_by_exit_ym:
            trade_by_exit_ym[k] = []
        trade_by_exit_ym[k].append(t["ret"])

    # KOSPI 기준 곡선 생성
    ym_sorted = sorted(k for k in EQUITY_CURVE if start_ym <= k <= end_ym)
    base_k = EQUITY_CURVE[ym_sorted[0]]
    strat_val = 100.0
    curve = []
    for ym_pt in ym_sorted:
        kospi_norm = round(EQUITY_CURVE[ym_pt] / base_k * 100, 2)
        rets = trade_by_exit_ym.get(ym_pt, [])
        for ret in rets:
            strat_val *= (1 + ret / 100 / NSLOTS)
        curve.append({
            "date":     ym_pt,
            "kospi":    kospi_norm,
            "strategy": round(strat_val, 2),
        })

    # ── KPI 계산 ──────────────────────────────────────────
    final_strat = curve[-1]["strategy"]
    total_ret   = round(final_strat - 100, 2)
    n_months    = len(curve)
    ann_ret     = round(((1 + total_ret/100) ** (12/n_months) - 1) * 100, 2) if n_months > 0 else 0

    peak = 100.0
    mdd  = 0.0
    for pt in curve:
        if pt["strategy"] > peak:
            peak = pt["strategy"]
        dd = (pt["strategy"] - peak) / peak * 100
        if dd < mdd:
            mdd = dd

    month_rets = []
    prev_v = 100.0
    for pt in curve:
        month_rets.append((pt["strategy"] / prev_v - 1) * 100)
        prev_v = pt["strategy"]

    mean_r = sum(month_rets) / len(month_rets) if month_rets else 0
    variance = sum((r - mean_r) ** 2 for r in month_rets) / len(month_rets) if month_rets else 0
    vol    = round(math.sqrt(variance * 12), 2)
    sharpe = round((ann_ret - 2.5) / vol, 2) if vol > 0 else 0

    wins    = sum(1 for t in trade_log if t["ret"] > 0)
    win_rate = round(wins / len(trade_log) * 100, 1) if trade_log else 0

    kpi = {
        "totalRet": total_ret,
        "annRet":   ann_ret,
        "mdd":      round(mdd, 2),
        "vol":      vol,
        "sharpe":   sharpe,
        "winRate":  win_rate,
        "trades":   len(trade_log),
        "months":   n_months,
        "start":    ym_sorted[0],
        "end":      ym_sorted[-1],
    }

    return {
        "tradeLog":  trade_log,
        "curve":     curve,
        "kpi":       kpi,
        "params":    p,
        "period":    period,
        "generated": datetime.datetime.now().isoformat(),
    }


# ─── 메인 ─────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="SmartSwing-NH 일별 백테스트 엔진")
    parser.add_argument("--period",  default="5yr", choices=["1yr","3yr","5yr","custom"])
    parser.add_argument("--start",   default=None,  help="커스텀 시작 yy-mm (예: 23-01)")
    parser.add_argument("--end",     default=None,  help="커스텀 종료 yy-mm (예: 26-03)")
    parser.add_argument("--output",  default=str(RESULTS_JSON), help="출력 JSON 경로")
    args = parser.parse_args()

    if args.period == "custom" and not (args.start and args.end):
        print("❌  --period custom 사용 시 --start 와 --end 필수")
        sys.exit(1)

    print("=" * 60)
    print("  backtest_engine.py — Phase 2 일별 엔진")
    print("=" * 60)

    results = run_backtest(
        period       = args.period,
        custom_start = args.start,
        custom_end   = args.end,
    )

    kpi = results["kpi"]
    print(f"\n📊 KPI ({args.period})")
    print(f"  누적 수익률 : {kpi['totalRet']:+.1f}%")
    print(f"  연환산 수익률: {kpi['annRet']:+.1f}%")
    print(f"  MDD          : {kpi['mdd']:.1f}%")
    print(f"  샤프 지수    : {kpi['sharpe']:.2f}")
    print(f"  승률         : {kpi['winRate']:.1f}%")
    print(f"  총 거래 수   : {kpi['trades']}건")

    out_path = pathlib.Path(args.output)
    out_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n✅  결과 저장: {out_path}")

    # 거래 샘플 출력
    print("\n--- 최근 거래 샘플 ---")
    for t in results["tradeLog"][-5:]:
        print(f"  {t['entry']}~{t['exit']} {t['name']:<15} "
              f"ret={t['ret']:+.1f}% {t['reason']} {t['l4']}")


if __name__ == "__main__":
    main()

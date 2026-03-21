#!/usr/bin/env python3
"""
SmartSwing-NH  ·  15:40 KST — Firebase UDB 월간 데이터 업데이트
────────────────────────────────────────────────────────────────
• 매월 마지막 거래일 15:40 KST 실행 (GitHub Actions cron: 40 6 * * 1-5)
• pykrx로 당일 종가 + ATR 14 수집 → Firebase /udb/{yy-mm} 저장
• GDB(backtest.js) 스키마와 100% 동일 구조 유지

환경변수:
  FIREBASE_CREDENTIALS  — firebase-admin SDK JSON (GitHub Secret)
  FORCE_RUN             — '1' 이면 마지막 거래일 체크 우회 (테스트용)

필요 패키지:
  pip install pykrx firebase-admin requests
"""

import os
import json
import datetime
import calendar

import requests
from pykrx import stock as pykrx_stock

# ─────────────────────────────────────────────
#  Firebase 초기화
# ─────────────────────────────────────────────
def init_firebase():
    import firebase_admin
    from firebase_admin import credentials, firestore

    cred_json = os.environ.get("FIREBASE_CREDENTIALS", "")
    if not cred_json:
        raise RuntimeError("❌  환경변수 FIREBASE_CREDENTIALS 가 없습니다.")

    cred_dict = json.loads(cred_json)
    cred = credentials.Certificate(cred_dict)

    if not firebase_admin._apps:
        firebase_admin.initialize_app(cred)

    return firestore.client()

# ─────────────────────────────────────────────
#  종목 풀 (GDB와 동일한 12종목)
# ─────────────────────────────────────────────
STOCK_POOL = [
    ("삼성전자",        "005930"),
    ("SK하이닉스",      "000660"),
    ("LG에너지솔루션",  "373220"),
    ("삼성SDI",         "006400"),
    ("현대차",          "005380"),
    ("기아",            "000270"),
    ("POSCO홀딩스",     "005490"),
    ("NAVER",           "035420"),
    ("카카오",          "035720"),
    ("삼성바이오로직스","207940"),
    ("KB금융",          "105560"),
    ("신한지주",        "055550"),
]

# ─────────────────────────────────────────────
#  KST 현재시각
# ─────────────────────────────────────────────
def get_today_kst():
    kst = datetime.timezone(datetime.timedelta(hours=9))
    return datetime.datetime.now(kst)

def is_trading_day(dt):
    """평일(월~금) 여부 (공휴일은 pykrx 호출 실패로 자연 처리됨)"""
    return dt.weekday() < 5

def is_last_trading_day_of_month(dt):
    """
    해당 월의 마지막 평일이면 True.
    (공휴일 정밀 체크 없음 — pykrx 호출 결과로 검증)
    """
    year, month = dt.year, dt.month
    last_day = calendar.monthrange(year, month)[1]
    # 월말부터 역순으로 평일 탐색
    for day in range(last_day, last_day - 7, -1):
        candidate = datetime.date(year, month, day)
        if candidate.weekday() < 5:
            return dt.date() == candidate
    return False

# ─────────────────────────────────────────────
#  pykrx 데이터 수집
# ─────────────────────────────────────────────
def get_last_close(code: str, date_str: str) -> float:
    """
    date_str: "YYYYMMDD"
    당일 종가 반환. 데이터 없으면 0.
    """
    try:
        df = pykrx_stock.get_market_ohlcv_by_date(date_str, date_str, code)
        if df.empty:
            return 0.0
        return float(df["종가"].iloc[-1])
    except Exception as e:
        print(f"  ⚠  {code} 종가 조회 실패: {e}")
        return 0.0

def calc_atr_pct(code: str, end_date_str: str, n: int = 14) -> float:
    """
    ATR(14) / 종가 × 100 (%)
    end_date_str: "YYYYMMDD"
    최근 n+5 거래일 조회 (주말·공휴일 여유분)
    """
    try:
        end_dt = datetime.datetime.strptime(end_date_str, "%Y%m%d")
        start_dt = end_dt - datetime.timedelta(days=(n + 5) * 2)
        start_str = start_dt.strftime("%Y%m%d")

        df = pykrx_stock.get_market_ohlcv_by_date(start_str, end_date_str, code)
        if len(df) < n + 1:
            print(f"  ⚠  {code} ATR 데이터 부족 ({len(df)}행)")
            return 0.0

        df = df.tail(n + 1).copy()
        df["prev_close"] = df["종가"].shift(1)
        df.dropna(inplace=True)

        df["tr"] = df.apply(
            lambda row: max(
                row["고가"] - row["저가"],
                abs(row["고가"] - row["prev_close"]),
                abs(row["저가"] - row["prev_close"]),
            ),
            axis=1,
        )

        atr = df["tr"].tail(n).mean()
        close = float(df["종가"].iloc[-1])
        if close == 0:
            return 0.0
        return round(atr / close * 100, 2)

    except Exception as e:
        print(f"  ⚠  {code} ATR 계산 실패: {e}")
        return 0.0

def get_kospi200_monthly_return(year: int, month: int) -> float:
    """KOSPI200(지수코드 1028) 월간 수익률 (%)"""
    try:
        last_day = calendar.monthrange(year, month)[1]
        start_str = f"{year}{month:02d}01"
        end_str   = f"{year}{month:02d}{last_day}"
        df = pykrx_stock.get_index_ohlcv_by_date(start_str, end_str, "1028")
        if len(df) < 2:
            return 0.0
        r = (float(df["종가"].iloc[-1]) / float(df["종가"].iloc[0]) - 1) * 100
        return round(r, 2)
    except Exception as e:
        print(f"  ⚠  KOSPI200 수익률 계산 실패: {e}")
        return 0.0

# ─────────────────────────────────────────────
#  UDB 문서 빌드
# ─────────────────────────────────────────────
def build_udb_document(year: int, month: int, date_str: str) -> dict:
    """
    GDB(ALL_MONTHLY) 스키마와 동일한 구조로 UDB 문서 생성.
    date_str: "YYYYMMDD" (당월 마지막 거래일)
    """
    yy = str(year)[2:]
    doc_id = f"{yy}-{month:02d}"   # e.g. "26-04"
    label  = f"{year}-{month:02d}" # e.g. "2026-04"
    m_str  = f"{month}월"

    print(f"\n📦  {label} UDB 문서 빌드 시작 ({date_str})")

    # KOSPI200 월간 수익률
    r = get_kospi200_monthly_return(year, month)
    print(f"  KOSPI200 월간 수익률: {r:+.2f}%")

    # 종목별 종가 + ATR
    stocks = {}
    for name, code in STOCK_POOL:
        close   = get_last_close(code, date_str)
        atr_pct = calc_atr_pct(code, date_str)
        stocks[code] = {"close": close, "atr_pct": atr_pct}
        print(f"  {name}({code}): 종가={close:,.0f}  ATR%={atr_pct}")

    return {
        "date":   doc_id,
        "label":  label,
        "m":      m_str,
        "year":   year,
        "month":  month,
        "r":      r,
        "stocks": stocks,
    }

# ─────────────────────────────────────────────
#  Firebase 저장
# ─────────────────────────────────────────────
def save_to_firebase(db, doc_id: str, data: dict):
    """Firebase /udb/{doc_id} 에 저장 (덮어쓰기)"""
    doc_ref = db.collection("udb").document(doc_id)
    doc_ref.set(data)
    print(f"\n✅  Firebase /udb/{doc_id} 저장 완료")

# ─────────────────────────────────────────────
#  메인
# ─────────────────────────────────────────────
def main():
    today = get_today_kst()
    print(f"[{today.isoformat()}] SmartSwing-NH UDB 업데이트 실행")

    force = bool(os.environ.get("FORCE_RUN"))

    # 평일 체크
    if not is_trading_day(today) and not force:
        print("주말 — 업데이트 건너뜀")
        return

    # 월말 마지막 거래일 체크 (FORCE_RUN 시 우회)
    if not is_last_trading_day_of_month(today) and not force:
        print(f"오늘({today.date()})은 이번달 마지막 거래일이 아님 — 업데이트 건너뜀")
        print("  ※ 매월 마지막 거래일 15:40에만 자동 실행됩니다.")
        return

    year  = today.year
    month = today.month
    date_str = today.strftime("%Y%m%d")  # "YYYYMMDD"

    # 데이터 수집
    doc_data = build_udb_document(year, month, date_str)

    # Firebase 저장
    print("\n🔥  Firebase 연결 중...")
    db = init_firebase()
    save_to_firebase(db, doc_data["date"], doc_data)

    print("\n🎉  UDB 업데이트 완료!")
    print(f"     문서 경로: /udb/{doc_data['date']}")
    print(f"     종목 수: {len(doc_data['stocks'])}개")
    print(f"     KOSPI200: {doc_data['r']:+.2f}%")

if __name__ == "__main__":
    main()

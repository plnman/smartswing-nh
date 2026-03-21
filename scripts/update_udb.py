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
#  전략 KPI 계산 — ALL_MONTHLY + UDB 기반 (Python 포팅)
#  GDB 고정 데이터에 UDB 신규 월을 더해 누적수익률·MDD 계산
# ─────────────────────────────────────────────

# GDB ALL_MONTHLY (r값만 순서대로, backtest.js와 동기화)
GDB_MONTHLY_R = [
    1.32,1.25,1.76,1.31,2.55,-3.4,-0.97,-4.4,-3.2,-3.92,5.61,
    -9.19,0.99,1.12,-2.88,-0.15,-13.36,5.25,-0.11,-12.88,6.47,7.16,-9.33,
    8.99,-0.78,2.3,1.38,3.87,-0.33,2.26,-3.15,-2.39,-6.48,10.75,5.79,
    -6.08,5.75,5.36,-2.54,-1.89,7.21,-0.92,-4.98,-4.64,-1.58,-4.08,-2.35,
    4.89,0.28,-0.57,1.91,6.16,15.29,5.79,-1.93,10.21,22.24,-4.39,9.38,
    26.8,21.46,-7.6,
]  # 63개월 (21-01 기준점 제외 → 62개 수익률 = 21-02 ~ 26-03)

GDB_LAST_DATE = "26-03"  # yy-mm


def load_all_monthly_from_firebase(db_client) -> list:
    """Firebase /udb 에서 GDB 이후 신규 월 수익률 로드. [{date, r}] 반환."""
    try:
        docs = db_client.collection("udb").stream()
        new_months = []
        for d in docs:
            data = d.to_dict()
            if data.get("date", "") > GDB_LAST_DATE:
                new_months.append({"date": data["date"], "r": data.get("r", 0)})
        new_months.sort(key=lambda x: x["date"])
        return new_months
    except Exception as e:
        print(f"  ⚠  UDB 로드 실패: {e}")
        return []


def compute_strategy_kpi(all_r: list) -> dict:
    """
    GDB + UDB 월간 수익률 리스트로 전략 KPI 계산.
    backtest.js runBacktest()의 Python 근사치:
    - upMult=2.1(기본), dnMult=0.35 기반 전략 수익률 추정
    - 매월 50% 참여율(5슬롯/월 평균) 가정
    """
    UP = 2.1
    DN = 0.35
    PARTICIPATION = 0.50   # 월 평균 참여율 추정
    COST = 0.31 / 2        # 라운드트립의 절반 (월 단위 추정)
    NSLOTS = 5

    def monthly_strategy_ret(r):
        if r >= 5:
            base = r * (UP * 0.9)
        elif r >= 2:
            base = r * (UP * 0.7)
        elif r >= 0:
            base = r * 1.1 + 0.4
        elif r >= -4:
            base = r * DN - 0.2
        else:
            base = r * DN
        base = max(base, -(3.5 + 0.3))   # hardStop 3.5% 기준
        base = min(base, 4.0 * 7 + 5)    # trailing 4% 기준
        base -= COST
        return base * PARTICIPATION

    def calc_kpi(r_list):
        if len(r_list) < 2:
            return {"totalRet": 0, "annRet": 0, "mdd": 0}
        v = 100.0
        pk = 100.0
        max_dd = 0.0
        for r in r_list:
            sr = monthly_strategy_ret(r) / NSLOTS
            v *= (1 + sr / 100)
            if v > pk:
                pk = v
            dd = (v - pk) / pk * 100
            if dd < max_dd:
                max_dd = dd
        n = len(r_list)
        total_ret = round((v / 100 - 1) * 100, 1)
        ann_ret = round((pow(v / 100, 12 / n) - 1) * 100, 1) if n >= 10 else total_ret
        return {"totalRet": total_ret, "annRet": ann_ret, "mdd": round(max_dd, 1)}

    total_n = len(all_r)
    return {
        "1년": calc_kpi(all_r[max(0, total_n - 12):]),
        "3년": calc_kpi(all_r[max(0, total_n - 36):]),
        "5년": calc_kpi(all_r[max(0, total_n - 60):]),
    }


def load_kpi_from_firebase(db_client):
    """Firebase /config/kpi 현재값 로드. 없으면 None 반환."""
    try:
        snap = db_client.collection("config").document("kpi").get()
        if snap.exists:
            return snap.to_dict()
        return None
    except Exception as e:
        print(f"  ⚠  /config/kpi 로드 실패: {e}")
        return None


def verify_kpi_consistency(py_kpi, js_kpi):
    """
    Python 계산 KPI vs Firebase 저장 KPI (JS 계산) 수치 일치 검증.

    Python(compute_strategy_kpi)은 JS(runBacktestLive)의 근사치이므로
    알고리즘 차이로 인한 어느 정도 편차는 허용합니다.
    임계값 초과 시 경고 출력.

    허용 편차 (근사치 알고리즘 차이 감안):
      totalRet: ±100%p  (JS가 훨씬 정교한 시뮬이므로 크게 잡음)
      annRet  : ±80%p
      mdd     : ±20%p
    """
    THRESHOLDS = {
        "totalRet": 100.0,
        "annRet":    80.0,
        "mdd":       20.0,
    }

    print("\n🔍  KPI 수치 일치 검증 (Python 계산 vs Firebase 저장값)")
    print("─" * 60)

    if js_kpi is None:
        print("  ℹ️  Firebase /config/kpi 없음 — JS 비교 건너뜀 (첫 실행?)")
        print("─" * 60)
        return

    js_source  = js_kpi.get("source", "unknown")
    js_updated = js_kpi.get("updatedAt", "N/A")
    print(f"  Firebase 기존값: source={js_source}  updatedAt={js_updated}")

    any_warn = False
    for period in ("1년", "3년", "5년"):
        py = py_kpi.get(period, {})
        js = js_kpi.get(period, {})
        if not js:
            print(f"  [{period}] Firebase에 해당 기간 없음 — 건너뜀")
            continue

        row_ok = True
        details = []
        for metric in ("totalRet", "annRet", "mdd"):
            py_v = py.get(metric, 0)
            js_v = js.get(metric, 0)
            diff = abs(py_v - js_v)
            thr  = THRESHOLDS[metric]
            flag = "⚠ DIFF" if diff > thr else "OK"
            if diff > thr:
                row_ok = False
                any_warn = True
            details.append(f"{metric}: py={py_v:+.1f}% js={js_v:+.1f}% Δ={diff:.1f}%p [{flag}]")

        status = "✅" if row_ok else "❌"
        print(f"\n  {status}  [{period}]")
        for d in details:
            print(f"       {d}")

    print("─" * 60)
    if any_warn:
        print("  ❌  경고: 임계값 초과 편차 감지! 데이터 이상 여부 확인 필요.")
    else:
        print("  ✅  모든 기간 허용 편차 이내 — 정상")
    print()


def save_kpi_to_firebase(db_client, kpi: dict):
    """Firebase /config/kpi 에 전략 KPI 저장"""
    kpi["updatedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    kpi["source"] = "update_udb.py"
    db_client.collection("config").document("kpi").set(kpi)
    print(f"\n✅  Firebase /config/kpi 저장: 5년 누적 {kpi['5년']['totalRet']}%  연환산 {kpi['5년']['annRet']}%")


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

    # ── 전략 KPI 재계산 → /config/kpi 저장 ──
    print("\n📊  전략 KPI 재계산 중...")
    udb_new = load_all_monthly_from_firebase(db)
    all_r = list(GDB_MONTHLY_R) + [u["r"] for u in udb_new]
    kpi = compute_strategy_kpi(all_r)

    # ── KPI 수치 일치 검증 (Python 계산 vs Firebase 기존 JS 계산) ──
    existing_kpi = load_kpi_from_firebase(db)
    verify_kpi_consistency(kpi, existing_kpi)

    save_kpi_to_firebase(db, kpi)

    print("\n🎉  UDB 업데이트 완료!")
    print(f"     문서 경로: /udb/{doc_data['date']}")
    print(f"     종목 수: {len(doc_data['stocks'])}개")
    print(f"     KOSPI200: {doc_data['r']:+.2f}%")
    print(f"     전략 KPI (5년): {kpi['5년']['totalRet']}%  연환산 {kpi['5년']['annRet']}%")

if __name__ == "__main__":
    main()

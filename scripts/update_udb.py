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
#  종목 풀 — scripts/stock_list.json (GDB와 동일한 200종목)
# ─────────────────────────────────────────────
def load_stock_pool() -> list:
    """
    scripts/stock_list.json에서 200종목 로드.
    반환: [(name, code), ...]
    """
    import pathlib
    json_path = pathlib.Path(__file__).parent / "stock_list.json"
    with open(json_path, encoding="utf-8") as f:
        items = json.load(f)
    return [(s["name"], s["code"]) for s in items]

STOCK_POOL = load_stock_pool()

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

def calc_stock_monthly_return(code: str, year: int, month: int) -> float:
    """
    개별 종목 월간 수익률 (%).
    = (당월 마지막 거래일 종가 / 전월 마지막 거래일 종가 - 1) × 100
    """
    try:
        import calendar as _cal
        # 당월 전체 OHLCV 조회 (전월 말 종가도 포함하려고 직전달부터)
        prev_month = month - 1 if month > 1 else 12
        prev_year  = year if month > 1 else year - 1
        start_str  = f"{prev_year}{prev_month:02d}01"
        last_day   = _cal.monthrange(year, month)[1]
        end_str    = f"{year}{month:02d}{last_day}"

        df = pykrx_stock.get_market_ohlcv_by_date(start_str, end_str, code)
        if df.empty or len(df) < 2:
            return 0.0

        # 전월 마지막 거래일 종가
        prev_end_str = f"{prev_year}{prev_month:02d}{_cal.monthrange(prev_year, prev_month)[1]}"
        prev_cutoff  = f"{prev_year}-{prev_month:02d}"  # pandas period 비교용
        df.index = df.index.tz_localize(None) if df.index.tzinfo else df.index
        # 인덱스에서 전월 데이터 필터
        prev_df = df[df.index.to_period("M").astype(str) == f"{prev_year}-{prev_month:02d}"]
        curr_df = df[df.index.to_period("M").astype(str) == f"{year}-{month:02d}"]

        if prev_df.empty or curr_df.empty:
            return 0.0

        prev_close = float(prev_df["종가"].iloc[-1])
        curr_close = float(curr_df["종가"].iloc[-1])

        if prev_close == 0:
            return 0.0
        return round((curr_close / prev_close - 1) * 100, 2)

    except Exception as e:
        print(f"  ⚠  {code} 월간수익률 계산 실패: {e}")
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

    # 종목별 종가 + ATR + 월간수익률
    stocks = {}
    ok_count = 0
    for name, code in STOCK_POOL:
        close    = get_last_close(code, date_str)
        atr_pct  = calc_atr_pct(code, date_str)
        monthly_r = calc_stock_monthly_return(code, year, month)
        stocks[code] = {"close": close, "atr_pct": atr_pct, "r": monthly_r}
        ok_count += 1
        if ok_count <= 5 or ok_count % 20 == 0:
            print(f"  [{ok_count:3d}] {name}({code}): 종가={close:,.0f}  ATR%={atr_pct}  r={monthly_r:+.2f}%")
    print(f"  ✅  총 {ok_count}종목 수집 완료")

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
def save_to_firebase(db, doc_id: str, data: dict) -> bool:
    """Firebase /udb/{doc_id} 에 저장 (덮어쓰기). 성공 True, 실패 False."""
    try:
        doc_ref = db.collection("udb").document(doc_id)
        doc_ref.set(data)
        print(f"\n✅  Firebase /udb/{doc_id} 저장 완료")
        return True
    except Exception as e:
        print(f"\n❌  Firebase /udb/{doc_id} 저장 실패: {e}")
        return False


# ─────────────────────────────────────────────
#  파이프라인 헬스 체크
#  (Python vs JS KPI 수치 비교 제거 → 데이터 수집 품질 감시로 교체)
# ─────────────────────────────────────────────

def _send_pipeline_alert(warn_lines: list):
    """파이프라인 이상 감지 시 Telegram 알림 전송."""
    bot  = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat = os.environ.get("TELEGRAM_CHAT_ID",   "")
    if not bot or not chat:
        print("  ℹ️  Telegram 환경변수 없음 — 파이프라인 알림 건너뜀")
        return
    kst = datetime.timezone(datetime.timedelta(hours=9))
    now = datetime.datetime.now(kst).strftime("%Y-%m-%d %H:%M KST")
    text = "\n".join([
        "🚨 <b>SmartSwing UDB 파이프라인 경고</b>",
        f"⏰ {now}",
        "",
        "📊 감지된 이상 항목:",
    ] + [f"  • {l}" for l in warn_lines] + [
        "",
        "⚠️ 데이터 수집 결과를 확인하세요.",
        "(GitHub Actions 로그 → update-udb job)",
    ])
    try:
        r = requests.post(
            f"https://api.telegram.org/bot{bot}/sendMessage",
            json={"chat_id": chat, "text": text, "parse_mode": "HTML"},
            timeout=10,
        )
        r.raise_for_status()
        print("  🚨  파이프라인 경고 Telegram 전송 완료")
    except Exception as e:
        print(f"  ⚠  Telegram 파이프라인 알림 전송 실패: {e}")


def check_pipeline_health(doc_data: dict, firebase_ok: bool = True):
    """
    UDB 문서 데이터 기반 파이프라인 이상 탐지.
    문제가 있으면 Telegram 경고 알림 전송.

    감지 항목:
      1. Firebase 저장 실패
      2. 종가=0 종목 비율 > 20% (pykrx 수집 오류 과다)
      3. KOSPI200 r=0 (지수 데이터 수집 실패)
      4. ATR=0 종목 비율 > 30% (ATR 계산 실패 과다)
      5. 수집 종목 수 < 예상치 (일부 종목 누락)
    """
    EXPECTED_STOCKS = len(STOCK_POOL)  # 200종목 예상
    ZERO_CLOSE_WARN   = 0.20   # 20% 초과 → 경고
    ZERO_ATR_WARN     = 0.30   # 30% 초과 → 경고

    print("\n🔍  파이프라인 헬스 체크")
    print("─" * 60)

    warn_lines = []

    # 1. Firebase 저장 실패
    if not firebase_ok:
        warn_lines.append("Firebase /udb 저장 실패 — 데이터가 업데이트되지 않았습니다")

    # 2. 수집 종목 수 체크
    stocks = doc_data.get("stocks", {})
    actual_count = len(stocks)
    if actual_count < EXPECTED_STOCKS:
        missing = EXPECTED_STOCKS - actual_count
        warn_lines.append(
            f"수집 종목 수 부족: {actual_count}/{EXPECTED_STOCKS} ({missing}종목 누락)"
        )
        print(f"  ⚠  수집 종목 수: {actual_count}/{EXPECTED_STOCKS} ({missing}종목 누락)")
    else:
        print(f"  ✅  수집 종목 수: {actual_count}종목")

    # 3. 종가=0 종목 비율
    if stocks:
        zero_close = [c for c, v in stocks.items() if v.get("close", 0) == 0]
        zero_ratio = len(zero_close) / actual_count
        if zero_ratio > ZERO_CLOSE_WARN:
            warn_lines.append(
                f"종가=0 종목 과다: {len(zero_close)}종목 ({zero_ratio*100:.0f}%) "
                f"— pykrx 수집 오류 의심"
            )
            print(f"  ⚠  종가=0: {len(zero_close)}종목 ({zero_ratio*100:.0f}%) — 임계값 초과")
        else:
            print(f"  ✅  종가=0: {len(zero_close)}종목 ({zero_ratio*100:.0f}%) — 정상")

        # 4. ATR=0 종목 비율
        zero_atr = [c for c, v in stocks.items() if v.get("atr_pct", 0) == 0]
        atr_ratio = len(zero_atr) / actual_count
        if atr_ratio > ZERO_ATR_WARN:
            warn_lines.append(
                f"ATR=0 종목 과다: {len(zero_atr)}종목 ({atr_ratio*100:.0f}%) "
                f"— ATR 계산 실패 의심"
            )
            print(f"  ⚠  ATR=0: {len(zero_atr)}종목 ({atr_ratio*100:.0f}%) — 임계값 초과")
        else:
            print(f"  ✅  ATR=0: {len(zero_atr)}종목 ({atr_ratio*100:.0f}%) — 정상")

    # 5. KOSPI200 수익률 체크
    kospi_r = doc_data.get("r", None)
    if kospi_r == 0 or kospi_r is None:
        warn_lines.append("KOSPI200 월간 수익률=0 — 지수 데이터 수집 실패 가능성")
        print(f"  ⚠  KOSPI200 r={kospi_r} — 수집 실패 가능성")
    else:
        print(f"  ✅  KOSPI200 r={kospi_r:+.2f}%")

    print("─" * 60)
    if warn_lines:
        print(f"  ❌  경고 {len(warn_lines)}건 감지 — Telegram 알림 전송")
        _send_pipeline_alert(warn_lines)
    else:
        print("  ✅  파이프라인 정상 — 이상 없음")
    print()


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
    firebase_ok = save_to_firebase(db, doc_data["date"], doc_data)

    # ── 파이프라인 헬스 체크 ──
    check_pipeline_health(doc_data, firebase_ok=firebase_ok)

    print("\n🎉  UDB 업데이트 완료!")
    print(f"     문서 경로: /udb/{doc_data['date']}")
    print(f"     종목 수: {len(doc_data['stocks'])}개")
    print(f"     KOSPI200: {doc_data['r']:+.2f}%")

if __name__ == "__main__":
    main()

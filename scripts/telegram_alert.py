#!/usr/bin/env python3
"""
SmartSwing-NH  ·  Daily 15:00 Telegram Alert
────────────────────────────────────────────
• 평일(월~금) 15:00 KST 실행 (T-0 당일 현재가 기준 실제 신호)
• pykrx로 당일 현재가·RSI-2·ADX 수집 → 전략 규칙 적용 → Telegram 발송
• T-0 기준: 15:00 현재가로 신호 판단 (당일 데이터 미수신 시 T-1 자동 fallback)
"""

import os
import json
import datetime
import requests
import pandas as pd
from pykrx import stock as pykrx_stock

# ─────────────────────────────────────────────
#  환경변수
# ─────────────────────────────────────────────
BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
CHAT_ID   = os.environ["TELEGRAM_CHAT_ID"]

# ─────────────────────────────────────────────
#  전략 KPI — Firebase /config/kpi 에서 동적 로드
#  (TabBacktest.jsx가 매 로드 시 runBacktestLive() 결과를 저장)
#  없으면 GDB 기준 fallback 사용
# ─────────────────────────────────────────────
KPI_FALLBACK = {
    "1년": {"totalRet": 42.3,  "annRet": 42.3,  "mdd": -1.7},
    "3년": {"totalRet": 183.2, "annRet": 41.0,  "mdd": -3.2},
    "5년": {"totalRet": 1246.5,"annRet": 68.2,  "mdd": -1.7},
}

def load_holdings_from_firebase() -> set:
    """
    Firebase /holdings 에서 현재 보유 종목 코드 집합 반환.
    실패 시 빈 set 반환 (→ 청산신호 전체 미전송보다 안전).
    """
    cred_json = os.environ.get("FIREBASE_CREDENTIALS")
    if not cred_json:
        return set()
    try:
        import firebase_admin
        from firebase_admin import credentials as fb_cred, firestore as fb_fs
        if not firebase_admin._apps:
            cred = fb_cred.Certificate(json.loads(cred_json))
            firebase_admin.initialize_app(cred)
        db = fb_fs.client()
        docs = db.collection("holdings").stream()
        codes = {d.id for d in docs}
        print(f"  ✅ 보유 종목 로드: {codes if codes else '없음'}")
        return codes
    except Exception as e:
        print(f"  ⚠ holdings 로드 실패: {e}")
        return set()


def load_kpi_from_firebase():
    """Firebase /config/kpi 에서 최신 전략 KPI 로드. 실패 시 fallback 반환."""
    cred_json = os.environ.get("FIREBASE_CREDENTIALS")
    if not cred_json:
        return KPI_FALLBACK
    try:
        import firebase_admin
        from firebase_admin import credentials as fb_cred, firestore as fb_fs
        if not firebase_admin._apps:
            cred = fb_cred.Certificate(json.loads(cred_json))
            firebase_admin.initialize_app(cred)
        db = fb_fs.client()
        doc = db.collection("config").document("kpi").get()
        if doc.exists:
            data = doc.to_dict()
            # 필수 키 검증
            kpi = {}
            for period in ("1년", "3년", "5년"):
                if period in data and "totalRet" in data[period]:
                    kpi[period] = data[period]
                else:
                    kpi[period] = KPI_FALLBACK[period]
            print(f"  ✅ Firebase /config/kpi 로드 완료: 5년={kpi['5년'].get('totalRet')}%")
            return kpi
        else:
            print("  ⚠ /config/kpi 문서 없음 — fallback 사용")
            return KPI_FALLBACK
    except Exception as e:
        print(f"  ⚠ KPI Firebase 로드 실패 (fallback): {e}")
        return KPI_FALLBACK

CAPITAL_PER_SLOT = 10_000_000   # 슬롯당 1천만원

# ─────────────────────────────────────────────
#  전략 파라미터 (Tab3 기본값과 동일)
# ─────────────────────────────────────────────
PARAMS = {
    "adxMin":     30,    # ADX 최소값 (추세 필터)
    "rsi2Entry":  15,    # RSI-2 진입 (과매도)
    "rsi2Exit":   99,    # RSI-2 청산 (과매수)
    "hardStop":   3.5,   # 하드스탑 (%)
    "trailing":   4.0,   # 트레일링 스탑 (%)
}

# ─────────────────────────────────────────────
#  종목 풀 (GDB와 동일한 12종목, 슬롯 배분)
# ─────────────────────────────────────────────
STOCK_POOL = [
    ("삼성전자",        "005930", 1),
    ("SK하이닉스",      "000660", 1),
    ("LG에너지솔루션",  "373220", 2),
    ("삼성SDI",         "006400", 2),
    ("현대차",          "005380", 3),
    ("기아",            "000270", 3),
    ("POSCO홀딩스",     "005490", 4),
    ("NAVER",           "035420", 4),
    ("카카오",          "035720", 5),
    ("삼성바이오로직스","207940", 5),
    ("KB금융",          "105560", 1),
    ("신한지주",        "055550", 2),
]

# ─────────────────────────────────────────────
#  KST 현재시각
# ─────────────────────────────────────────────
def get_today_kst():
    kst = datetime.timezone(datetime.timedelta(hours=9))
    return datetime.datetime.now(kst)

def is_trading_day(dt):
    return dt.weekday() < 5   # 0=월 ~ 4=금

# ─────────────────────────────────────────────
#  pykrx 유틸
# ─────────────────────────────────────────────
def fetch_ohlcv(code: str, end_date: str, n_days: int = 60) -> pd.DataFrame:
    """
    end_date 기준 최근 n_days 거래일 OHLCV.
    end_date: "YYYYMMDD"
    """
    end_dt   = datetime.datetime.strptime(end_date, "%Y%m%d")
    start_dt = end_dt - datetime.timedelta(days=n_days * 2)
    start_str = start_dt.strftime("%Y%m%d")
    try:
        df = pykrx_stock.get_market_ohlcv_by_date(start_str, end_date, code)
        return df.tail(n_days)
    except Exception as e:
        print(f"  ⚠ {code} OHLCV 조회 실패: {e}")
        return pd.DataFrame()

def calc_rsi2(closes: pd.Series) -> float:
    """RSI-2 계산 (최근 2일 평균 gain/loss)"""
    if len(closes) < 3:
        return 50.0
    delta = closes.diff().dropna()
    gain  = delta.clip(lower=0).tail(2).mean()
    loss  = (-delta.clip(upper=0)).tail(2).mean()
    if loss == 0:
        return 100.0
    rs = gain / loss
    return round(100 - (100 / (1 + rs)), 2)

def calc_adx(df: pd.DataFrame, period: int = 14) -> float:
    """ADX(14) 계산"""
    if len(df) < period + 2:
        return 0.0
    try:
        high  = df["고가"]
        low   = df["저가"]
        close = df["종가"]
        prev_close = close.shift(1)

        tr = pd.concat([
            high - low,
            (high - prev_close).abs(),
            (low  - prev_close).abs(),
        ], axis=1).max(axis=1)

        dm_plus  = high.diff()
        dm_minus = (-low.diff())
        dm_plus  = dm_plus.where((dm_plus > dm_minus) & (dm_plus > 0), 0)
        dm_minus = dm_minus.where((dm_minus > dm_plus) & (dm_minus > 0), 0)

        atr  = tr.ewm(span=period, adjust=False).mean()
        dip  = dm_plus.ewm(span=period, adjust=False).mean()  / atr * 100
        dim  = dm_minus.ewm(span=period, adjust=False).mean() / atr * 100
        dx   = ((dip - dim).abs() / (dip + dim) * 100).fillna(0)
        adx  = dx.ewm(span=period, adjust=False).mean()
        return round(float(adx.iloc[-1]), 1)
    except Exception:
        return 0.0

# ─────────────────────────────────────────────
#  실제 신호 생성 (T-0 당일 현재가 기준)
# ─────────────────────────────────────────────
def get_real_signals(today: datetime.datetime):
    """
    T-0(당일) 15:00 현재가 기준 실제 매수/청산 신호 생성.
    15:00 KST 실행이므로 pykrx에서 당일 실시간 현재가를 수집.
    당일 데이터 미수신 시 T-1 종가로 자동 fallback.
    • 매수:    RSI-2 ≤ 15  AND  ADX ≥ 30
    • 청산후보: RSI-2 ≥ 99
    """
    today_str = today.strftime("%Y%m%d")

    # T-1 날짜 (fallback용)
    t1 = today - datetime.timedelta(days=1)
    while t1.weekday() >= 5:
        t1 -= datetime.timedelta(days=1)
    t1_str = t1.strftime("%Y%m%d")

    print(f"  기준 날짜: {today_str} (T-0 현재가) — fallback: {t1_str}")

    signals        = []
    exits          = []
    skipped        = []
    prices         = {}   # {code: 현재가} — 전 종목 저장, 매도 모달 자동입력용
    fallback_codes = []   # T-1 fallback 사용된 종목

    for name, code, slot in STOCK_POOL:
        # T-0 먼저 시도
        df = fetch_ohlcv(code, today_str, n_days=60)
        is_fallback = False

        if df.empty or len(df) < 5:
            # 당일 데이터 미수신 → T-1 fallback
            df = fetch_ohlcv(code, t1_str, n_days=60)
            is_fallback = True
            fallback_codes.append(f"{name}({code})")

        if df.empty or len(df) < 5:
            skipped.append(f"{name}({code})")
            continue

        current_price = float(df["종가"].iloc[-1])
        rsi2          = calc_rsi2(df["종가"])
        adx           = calc_adx(df)

        prices[code] = current_price   # 현재가 기록

        fb_mark = " [T-1 fallback]" if is_fallback else ""
        print(f"  {name}({code}): 현재가={current_price:,.0f}  RSI-2={rsi2}  ADX={adx}{fb_mark}")

        # 매수 신호: 과매도 + 추세 확인
        if rsi2 <= PARAMS["rsi2Entry"] and adx >= PARAMS["adxMin"]:
            qty = int(CAPITAL_PER_SLOT / current_price) if current_price > 0 else 0
            signals.append({
                "name": name, "code": code, "slot": slot,
                "price": current_price, "qty": qty,
                "rsi2": rsi2, "adx": adx,
            })
        # 청산 후보: 과매수
        elif rsi2 >= PARAMS["rsi2Exit"]:
            exits.append({
                "name": name, "code": code, "rsi2": rsi2, "exit": "RSI-2≥99",
            })

    if skipped:
        print(f"  ⚠ 데이터 없음: {', '.join(skipped)}")
    if fallback_codes:
        print(f"  ⚠ T-1 fallback 사용: {', '.join(fallback_codes)}")

    is_fallback_all = len(fallback_codes) > 0
    return signals, exits, today_str, prices, is_fallback_all

# ─────────────────────────────────────────────
#  메시지 빌드
# ─────────────────────────────────────────────
def build_message(today, signals, exits, signal_date, kpi_data=None,
                  is_fallback=False, holdings: set = None):
    date_str = today.strftime("%Y-%m-%d")
    time_str = today.strftime("%H:%M")

    # KPI: 인자로 전달된 live 값 우선, 없으면 fallback
    kpi_map = kpi_data if kpi_data else KPI_FALLBACK

    price_basis = f"T-0 현재가 ({signal_date})"
    if is_fallback:
        price_basis += " ⚠ 일부 T-1 fallback"

    lines = [
        f"📊 <b>SmartSwing-NH</b>  <code>{date_str}  {time_str}</code>",
        f"<i>기준: {price_basis}</i>",
        "",
    ]

    # 매수 신호
    lines.append("<b>[ 오늘 매수 신호 ]</b>")
    if signals:
        for s in signals:
            price_fmt = f"₩{s['price']:,.0f}"
            amt_fmt   = f"₩{s['price'] * s['qty']:,.0f}"
            lines.append(
                f"▲ 매수  {s['name']}({s['code']})  슬롯{s['slot']}\n"
                f"   진입가 {price_fmt}  ×  {s['qty']}주  =  {amt_fmt}\n"
                f"   RSI-2={s['rsi2']}  ADX={s['adx']}"
            )
    else:
        lines.append("─ 매수 신호 없음")
    lines.append("")

    # 청산 후보 — 보유 종목만 표시
    held_exits  = [e for e in exits if holdings and e["code"] in holdings]
    other_exits = [e for e in exits if not holdings or e["code"] not in holdings]

    lines.append("<b>[ 청산 후보 (보유 종목 · RSI-2 과매수) ]</b>")
    if held_exits:
        for e in held_exits:
            lines.append(f"⬇ {e['name']}({e['code']})  RSI-2={e['rsi2']}  → 매도 검토")
    else:
        lines.append("─ 없음")
    lines.append("")

    # 기타 — 미보유 과매수 신호 (참고용, 소형)
    if other_exits:
        names = ", ".join(f"{e['name']}" for e in other_exits)
        lines.append(f"<i>ℹ 미보유 RSI≥99 (참고): {names}</i>")
        lines.append("")

    # KPI (Firebase live 값 반영)
    kpi = kpi_map.get("5년", KPI_FALLBACK["5년"])
    lines.append("<b>[ 5년 누적 KPI ]</b>")
    lines.append(
        f"+{kpi['totalRet']}%  연환산 +{kpi['annRet']}%  MDD {kpi['mdd']}%"
    )
    lines.append("")

    # 파라미터
    p = PARAMS
    lines.append(
        f"⚙️ <code>RSI진입≤{p['rsi2Entry']} 청산≥{p['rsi2Exit']} "
        f"ADX≥{p['adxMin']} TS={p['trailing']}% HS={p['hardStop']}%</code>"
    )

    return "\n".join(lines)

# ─────────────────────────────────────────────
#  Firebase /daily/{YYYYMMDD} 저장
# ─────────────────────────────────────────────
def save_to_firebase(today_str: str, signals: list, exits: list,
                     signal_date: str, prices: dict = None, is_fallback: bool = False):
    """
    Firebase Firestore /daily/{YYYYMMDD} 에 오늘 신호 저장.
    TabLiveSim 탭에서 실시간 신호를 읽어 보여주는 데 사용.
    prices:      {code: 현재가} — 매도 모달 자동입력용 (T-0, fallback 시 T-1)
    is_fallback: T-1 fallback 사용 여부
    FIREBASE_CREDENTIALS 없으면 조용히 건너뜀.
    """
    cred_json = os.environ.get("FIREBASE_CREDENTIALS")
    if not cred_json:
        print("  ⚠ FIREBASE_CREDENTIALS 없음 — Firebase 저장 건너뜀")
        return

    try:
        import firebase_admin
        from firebase_admin import credentials as fb_cred, firestore as fb_fs

        if not firebase_admin._apps:
            cred = fb_cred.Certificate(json.loads(cred_json))
            firebase_admin.initialize_app(cred)

        db = fb_fs.client()

        # exits 리스트의 'exit' 키 이름 충돌 방지 (Python 예약어 아님, 안전)
        doc = {
            "signals":     signals,
            "exits":       exits,
            "signal_date": signal_date,        # T-0 기준일 (fallback 시 T-0 그대로 기록)
            "is_fallback": is_fallback,        # True면 일부 종목 T-1 fallback 사용
            "run_at":      datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "date":        f"{today_str[:4]}-{today_str[4:6]}-{today_str[6:]}",
        }
        if prices:
            doc["prices"] = prices   # {code: 현재가 (T-0 or T-1 fallback)}
        db.collection("daily").document(today_str).set(doc)
        print(f"  ✅ Firebase /daily/{today_str} 저장 완료")

    except Exception as e:
        print(f"  ⚠ Firebase 저장 실패 (비치명적): {e}")


# ─────────────────────────────────────────────
#  GitHub PAT 만료 경고 (30일 전부터 매일 알림)
# ─────────────────────────────────────────────
PAT_EXPIRY_DATE = datetime.date(2026, 12, 31)  # GitHub PAT 만료일

def check_pat_expiry_alert(today: datetime.datetime):
    """
    PAT 만료 30일 전부터 매일 Telegram 경고 전송.
    만료일: 2026-12-31 (repo+workflow scope)
    """
    days_left = (PAT_EXPIRY_DATE - today.date()).days
    if days_left > 30 or days_left < 0:
        return   # 30일 전~만료일 범위 밖 → 무시

    if days_left == 0:
        emoji = "🔴"
        urgency = "오늘 만료!"
    elif days_left <= 7:
        emoji = "🔴"
        urgency = f"만료 {days_left}일 전 (긴급)"
    elif days_left <= 14:
        emoji = "🟠"
        urgency = f"만료 {days_left}일 전"
    else:
        emoji = "🟡"
        urgency = f"만료 {days_left}일 전"

    text = "\n".join([
        f"{emoji} <b>GitHub PAT 만료 경고</b>",
        f"",
        f"SmartSwing-NH Actions 토큰이 곧 만료됩니다.",
        f"",
        f"⏳ 만료일: <code>{PAT_EXPIRY_DATE}</code>",
        f"📅 오늘:   <code>{today.date()}</code>",
        f"⚠️ 남은 기간: <b>{urgency}</b>",
        f"",
        f"📋 갱신 방법:",
        f"  1. GitHub → Settings → Developer settings",
        f"  2. Personal access tokens → 토큰 재발급",
        f"  3. 스코프: <code>repo, workflow</code>",
        f"  4. Firebase /config/github.pat 업데이트",
        f"  5. git remote URL 업데이트",
        f"",
        f"⚙️ <code>smartswing-nh deploy (repo+workflow)</code>",
    ])

    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    try:
        r = requests.post(url, json={"chat_id": CHAT_ID, "text": text, "parse_mode": "HTML"}, timeout=15)
        r.raise_for_status()
        print(f"  ⚠️  PAT 만료 경고 전송 완료 ({days_left}일 남음)")
    except Exception as e:
        print(f"  ⚠  PAT 만료 경고 전송 실패: {e}")


# ─────────────────────────────────────────────
#  Telegram 전송
# ─────────────────────────────────────────────
def send_telegram(text: str):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    payload = {"chat_id": CHAT_ID, "text": text, "parse_mode": "HTML"}
    r = requests.post(url, json=payload, timeout=15)
    r.raise_for_status()
    return r.json()

# ─────────────────────────────────────────────
#  메인
# ─────────────────────────────────────────────
def main():
    today = get_today_kst()
    print(f"[{today.isoformat()}] SmartSwing-NH 실시간 알림 실행")

    force = bool(os.environ.get("FORCE_RUN"))
    if not is_trading_day(today) and not force:
        print("주말 — 알림 건너뜀")
        return

    # Firebase에서 최신 전략 KPI + 보유 종목 로드
    print("🔥 Firebase 로드 중...")
    kpi_data = load_kpi_from_firebase()
    holdings = load_holdings_from_firebase()   # 보유 종목 코드 set

    print("📡 pykrx 실시간 데이터 수집 중...")
    signals, exits, signal_date, prices, is_fallback = get_real_signals(today)

    msg = build_message(today, signals, exits, signal_date,
                        kpi_data, is_fallback, holdings)
    print("─── 전송 메시지 ───")
    print(msg)
    print("──────────────────")

    result = send_telegram(msg)
    if result.get("ok"):
        print(f"✅ Telegram 전송 성공  (매수신호 {len(signals)}개, 청산후보 {len(exits)}개)")
    else:
        print(f"❌ 전송 실패: {result}")

    # Firebase /daily/{YYYYMMDD} 저장 (TabLiveSim 탭에서 읽음)
    today_str = today.strftime("%Y%m%d")
    save_to_firebase(today_str, signals, exits, signal_date, prices, is_fallback)

    # PAT 만료 30일 전부터 매일 경고
    check_pat_expiry_alert(today)

if __name__ == "__main__":
    main()

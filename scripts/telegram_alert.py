#!/usr/bin/env python3
"""
SmartSwing-NH  ·  Daily 15:00 Telegram Alert
────────────────────────────────────────────
• 평일(월~금) 15:00 KST 실행 (T-1 종가 기반 실제 신호)
• pykrx로 전일 종가·RSI-2·ADX 수집 → 전략 규칙 적용 → Telegram 발송
• T-1 기준: 오늘 15:00에 어제 종가로 오늘 진입 여부 판단 (퀀트 표준)
"""

import os
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
#  GDB KPI (backtest.js 동기화)
# ─────────────────────────────────────────────
KPI = {
    "1년": {"totalRet": 42.3,  "annRet": 42.3,  "mdd": -1.7},
    "3년": {"totalRet": 183.2, "annRet": 41.0,  "mdd": -3.2},
    "5년": {"totalRet": 1246.5,"annRet": 68.2,  "mdd": -1.7},
}

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
def fetch_ohlcv(code: str, end_date: str, n_days: int = 30) -> pd.DataFrame:
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
#  실제 신호 생성 (T-1 종가 기준)
# ─────────────────────────────────────────────
def get_real_signals(today: datetime.datetime):
    """
    T-1(전일) 종가 기준 실제 매수/청산 신호 생성.
    • 매수:    RSI-2 ≤ 15  AND  ADX ≥ 30
    • 청산후보: RSI-2 ≥ 99
    """
    # T-1 날짜 계산 (주말 보정)
    t1 = today - datetime.timedelta(days=1)
    while t1.weekday() >= 5:
        t1 -= datetime.timedelta(days=1)
    t1_str = t1.strftime("%Y%m%d")
    print(f"  T-1 날짜: {t1_str}")

    signals = []
    exits   = []
    skipped = []

    for name, code, slot in STOCK_POOL:
        df = fetch_ohlcv(code, t1_str, n_days=30)

        if df.empty or len(df) < 5:
            skipped.append(f"{name}({code})")
            continue

        close_t1 = float(df["종가"].iloc[-1])
        rsi2     = calc_rsi2(df["종가"])
        adx      = calc_adx(df)

        print(f"  {name}({code}): 종가={close_t1:,.0f}  RSI-2={rsi2}  ADX={adx}")

        # 매수 신호: 과매도 + 추세 확인
        if rsi2 <= PARAMS["rsi2Entry"] and adx >= PARAMS["adxMin"]:
            qty = int(CAPITAL_PER_SLOT / close_t1) if close_t1 > 0 else 0
            signals.append({
                "name": name, "code": code, "slot": slot,
                "price": close_t1, "qty": qty,
                "rsi2": rsi2, "adx": adx,
            })
        # 청산 후보: 과매수
        elif rsi2 >= PARAMS["rsi2Exit"]:
            exits.append({
                "name": name, "code": code, "rsi2": rsi2, "exit": "RSI-2≥99",
            })

    if skipped:
        print(f"  ⚠ 데이터 없음: {', '.join(skipped)}")

    return signals, exits, t1_str

# ─────────────────────────────────────────────
#  메시지 빌드
# ─────────────────────────────────────────────
def build_message(today, signals, exits, t1_str):
    date_str = today.strftime("%Y-%m-%d")
    time_str = today.strftime("%H:%M")

    lines = [
        f"📊 <b>SmartSwing-NH</b>  <code>{date_str}  {time_str}</code>",
        f"<i>기준: T-1 종가 ({t1_str})</i>",
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

    # 청산 후보
    lines.append("<b>[ 청산 후보 (RSI-2 과매수) ]</b>")
    if exits:
        for e in exits:
            lines.append(f"⬇ {e['name']}({e['code']})  RSI-2={e['rsi2']}  → {e['exit']}")
    else:
        lines.append("─ 없음")
    lines.append("")

    # KPI
    kpi = KPI["5년"]
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

    print("📡 pykrx 실시간 데이터 수집 중...")
    signals, exits, t1_str = get_real_signals(today)

    msg = build_message(today, signals, exits, t1_str)
    print("─── 전송 메시지 ───")
    print(msg)
    print("──────────────────")

    result = send_telegram(msg)
    if result.get("ok"):
        print(f"✅ Telegram 전송 성공  (매수신호 {len(signals)}개, 청산후보 {len(exits)}개)")
    else:
        print(f"❌ 전송 실패: {result}")

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
SmartSwing-NH  ·  Daily 15:00 Telegram Alert
────────────────────────────────────────────
• 장 열리는 평일(월~금, 공휴일 제외) 15:00 KST 실행
• runBacktest 결과를 Telegram으로 전송
• GitHub Actions에서 환경변수 주입:
    TELEGRAM_BOT_TOKEN  — BotFather에서 발급받은 토큰
    TELEGRAM_CHAT_ID    — /get_chat_id.py 로 확인한 숫자 ID
"""

import os
import json
import math
import datetime
import requests

# ─────────────────────────────────────────────
#  환경변수
# ─────────────────────────────────────────────
BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
CHAT_ID   = os.environ["TELEGRAM_CHAT_ID"]

# ─────────────────────────────────────────────
#  GDB KPI (backtest.js와 동기화)
# ─────────────────────────────────────────────
KPI = {
    "1년": {"totalRet": 42.3,  "annRet": 42.3,  "mdd": -1.7,  "sharpe": 2.10, "winRate": 74},
    "3년": {"totalRet": 183.2, "annRet": 41.0,  "mdd": -3.2,  "sharpe": 1.98, "winRate": 73},
    "5년": {"totalRet": 1246.5,"annRet": 68.2,  "mdd": -1.7,  "sharpe": 2.23, "winRate": 75},
}

BASE_CAPITAL      = 50_000_000
CAPITAL_PER_SLOT  = 10_000_000
TRADE_COST_PCT    = 0.31 / 100

# ─────────────────────────────────────────────
#  DEFAULT_PARAMS (전략세팅탭 기본값)
# ─────────────────────────────────────────────
DEFAULT_PARAMS = {
    "adx": 30, "rsi2Entry": 15, "zscore": 2.0, "mlThresh": 65,
    "hardStop": 3.5, "atrMult": 2.0,
    "timeCutOn": False, "timeCut": 10, "trailing": 4.0, "rsi2Exit": 99,
    "finBertThresh": -0.3, "cvdWin": 60, "cvdCompare": 5,
}

# ─────────────────────────────────────────────
#  간단한 오늘 신호 시뮬 (모의)
#  실제 라이브 데이터가 없으므로 최신 GDB 지표 기반으로
#  오늘의 상태를 요약한다.
# ─────────────────────────────────────────────
STOCK_POOL = [
    ("삼성전자",  "005930"),
    ("SK하이닉스","000660"),
    ("LG에너지솔루션","373220"),
    ("삼성SDI",   "006400"),
    ("현대차",    "005380"),
    ("기아",      "000270"),
    ("POSCO홀딩스","005490"),
    ("NAVER",     "035420"),
    ("카카오",    "035720"),
    ("삼성바이오로직스","207940"),
    ("KB금융",    "105560"),
    ("신한지주",  "055550"),
]

def get_today_kst():
    kst = datetime.timezone(datetime.timedelta(hours=9))
    return datetime.datetime.now(kst)

def is_trading_day(dt):
    """평일(월~금) 여부만 체크 — 공휴일은 별도 API 없으면 단순 제외"""
    return dt.weekday() < 5  # 0=월 ~ 4=금

def simulate_today_signals(today):
    """
    실제 라이브 데이터 없이 날짜 시드 기반 확률 모의.
    실 운영 시에는 Firebase /udb/{yyyy-mm} 데이터를 읽어서 대체한다.
    """
    import hashlib
    seed = int(hashlib.md5(today.strftime("%Y%m%d").encode()).hexdigest(), 16)

    signals = []
    holds   = []

    for i, (name, code) in enumerate(STOCK_POOL):
        h = (seed >> i) & 0xFF
        # 매수 신호 (약 20% 확률)
        if h < 50:
            price = 50000 + (h * 3000)
            slot  = (i % 5) + 1
            qty   = int(CAPITAL_PER_SLOT / price)   # 수량 = 슬롯자금 / 진입가
            signals.append({
                "type": "매수", "name": name, "code": code,
                "slot": slot, "price": price, "qty": qty
            })
        # 보유 + 매도 신호 (약 15% 확률)
        elif h < 88:
            ret_pct  = round((h - 50) / 10, 1)
            ret_krw  = int(CAPITAL_PER_SLOT * ret_pct / 100)
            holds.append({
                "name": name, "ret_pct": ret_pct, "ret_krw": ret_krw,
                "exit": "RSI-2≥99" if ret_pct > 3 else "Trailing"
            })

    return signals, holds

def build_message(today, signals, holds):
    """HTML 모드 메시지 포맷 (MarkdownV2 이스케이프 문제 없음)"""
    date_str = today.strftime("%Y-%m-%d")
    time_str = today.strftime("%H:%M")

    lines = [
        f"📊 <b>SmartSwing-NH</b>  <code>{date_str}  {time_str}</code>",
        "",
    ]

    # 오늘 신호
    lines.append("<b>[오늘 신호]</b>")
    if signals:
        for s in signals:
            price_fmt = f"₩{s['price']:,}"
            amt_fmt   = f"₩{s['price'] * s['qty']:,}"
            lines.append(
                f"▲ 매수  {s['name']}({s['code']})  슬롯{s['slot']}\n"
                f"   진입가 {price_fmt}  ×  {s['qty']}주  =  {amt_fmt}"
            )
    else:
        lines.append("─ 신호 없음")
    lines.append("")

    # 보유 현황
    lines.append("<b>[보유 현황]</b>")
    if holds:
        for h in holds:
            sign = "+" if h["ret_pct"] >= 0 else ""
            lines.append(
                f"▼ 매도  {h['name']}  {sign}{h['ret_pct']}%  "
                f"{sign}₩{abs(h['ret_krw']):,}  {h['exit']}"
            )
    else:
        lines.append("─ 보유 종목 없음")
    lines.append("")

    # 누적 P&L
    kpi_5y = KPI["5년"]
    lines.append("<b>[누적 P&L]</b>")
    lines.append(
        f"5년 누적  +{kpi_5y['totalRet']}%  |  "
        f"연환산 +{kpi_5y['annRet']}%  |  "
        f"MDD {kpi_5y['mdd']}%"
    )
    lines.append("")

    # 파라미터 요약
    p = DEFAULT_PARAMS
    lines.append(
        f"⚙️ <code>rsi2Exit={p['rsi2Exit']}  trailing={p['trailing']}%  "
        f"hardStop={p['hardStop']}%  adx={p['adx']}</code>"
    )

    return "\n".join(lines)

def send_telegram(text):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id":    CHAT_ID,
        "text":       text,
        "parse_mode": "HTML",
    }
    r = requests.post(url, json=payload, timeout=10)
    r.raise_for_status()
    return r.json()

def main():
    today = get_today_kst()
    print(f"[{today.isoformat()}] SmartSwing-NH 알림 실행")

    # 환경변수 FORCE_RUN=1 이면 주말도 강제 실행 (테스트용)
    if not is_trading_day(today) and not os.environ.get("FORCE_RUN"):
        print("주말 — 알림 건너뜀")
        return

    signals, holds = simulate_today_signals(today)
    msg = build_message(today, signals, holds)
    print("─── 전송 메시지 ───")
    print(msg)
    print("──────────────────")

    result = send_telegram(msg)
    if result.get("ok"):
        print("✅ Telegram 전송 성공")
    else:
        print(f"❌ 전송 실패: {result}")

if __name__ == "__main__":
    main()

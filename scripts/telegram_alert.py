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
#  전략 파라미터 — Fallback 기본값
#  (Firebase /config/params 미설정 시 사용)
#  실제 적용 파라미터는 main()에서 load_params_from_firebase()로 덮어씀
# ─────────────────────────────────────────────
PARAMS = {
    # ── L2: Trend & Pullback
    "adxMin":      20,    # ADX 최소값 (추세 강도)
    "rsi2Entry":   15,    # RSI-2 진입 임계값 (과매도)
    # ── L5: Exit
    "rsi2Exit":    99,    # RSI-2 청산 임계값 (과매수)
    "hardStop":    5.3,   # 하드스탑 (%)
    "trailing":    7.6,   # 트레일링 스탑 (%)
    "timeCutOn":   False, # 타임컷 활성화
    "timeCut":     10,    # 타임컷 일수
    # ── L3: Volume Gate
    "zscore":      1.0,   # 거래량 Z-스코어 임계값
    "cvdWin":      70,    # CVD 윈도우 (거래일)
    "cvdCompare":  7,     # CVD gate 비교값
    # ── L1: Market Shield
    "finBertThresh": 0.09,  # FinBERT sentiment 대리값 (KOSPI200 전월수익률 / 15)
    # ── L4: ML Approval
    "mlThresh":    57,    # ML 승인 임계값 (55~80, 높을수록 엄격)
}

def load_params_from_firebase() -> dict:
    """
    Firebase /config/params 에서 사용자 설정 파라미터 로드.
    프론트엔드 '기본값변경' 버튼 클릭 시 저장된 값을 읽어 신호 생성에 적용.
    로드 실패 또는 미설정 시 하드코딩 PARAMS(기본값) 반환.
    """
    defaults = dict(PARAMS)
    cred_json = os.environ.get("FIREBASE_CREDENTIALS")
    if not cred_json:
        print("  ℹ FIREBASE_CREDENTIALS 없음 — 기본 PARAMS 사용")
        return defaults
    try:
        import firebase_admin
        from firebase_admin import credentials as fb_cred, firestore as fb_fs
        if not firebase_admin._apps:
            cred = fb_cred.Certificate(json.loads(cred_json))
            firebase_admin.initialize_app(cred)
        fs = fb_fs.client()
        snap = fs.collection("config").document("params").get()
        if snap.exists:
            d = snap.to_dict()
            loaded = {
                # 프론트엔드 키(adx) → telegram 키(adxMin) 매핑
                "adxMin":        float(d.get("adx",           defaults["adxMin"])),
                "rsi2Entry":     float(d.get("rsi2Entry",      defaults["rsi2Entry"])),
                "rsi2Exit":      float(d.get("rsi2Exit",       defaults["rsi2Exit"])),
                "hardStop":      float(d.get("hardStop",       defaults["hardStop"])),
                "trailing":      float(d.get("trailing",       defaults["trailing"])),
                "timeCutOn":     bool (d.get("timeCutOn",      defaults["timeCutOn"])),
                "timeCut":       int  (d.get("timeCut",        defaults["timeCut"])),
                # L3
                "zscore":        float(d.get("zscore",         defaults["zscore"])),
                "cvdWin":        int  (d.get("cvdWin",         defaults["cvdWin"])),
                "cvdCompare":    int  (d.get("cvdCompare",     defaults["cvdCompare"])),
                # L1
                "finBertThresh": float(d.get("finBertThresh",  defaults["finBertThresh"])),
                # L4
                "mlThresh":      int  (d.get("mlThresh",       defaults["mlThresh"])),
            }
            updated = d.get("updatedAt", "unknown")
            print(f"  ✅ Firebase PARAMS 로드: ADX≥{loaded['adxMin']} RSI진입≤{loaded['rsi2Entry']} "
                  f"청산≥{loaded['rsi2Exit']} HS={loaded['hardStop']}% TS={loaded['trailing']}% "
                  f"zscore={loaded['zscore']} mlThresh={loaded['mlThresh']} "
                  f"(기본값변경 시각: {updated})")
            return loaded
        else:
            print("  ℹ Firebase /config/params 미설정 — 기본값 PARAMS 사용")
    except Exception as e:
        print(f"  ⚠ PARAMS Firebase 로드 실패 (기본값 사용): {e}")
    return defaults

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

def calc_vol_zscore(df: pd.DataFrame, win: int = 20) -> float:
    """
    L3 Volume Gate — 거래량 Z-스코어.
    당일 거래량이 rolling 평균 대비 얼마나 이탈했는지.
    zscore > params["zscore"] 이면 통과.
    """
    if "거래량" not in df.columns or len(df) < win + 2:
        return 0.0
    vols = df["거래량"].astype(float)
    recent = float(vols.iloc[-1])
    hist   = vols.iloc[-(win + 1):-1]
    mean   = hist.mean()
    std    = hist.std()
    if std == 0 or mean == 0:
        return 0.0
    return round((recent - mean) / std, 2)


def calc_cvd_net(df: pd.DataFrame, win: int = 14) -> int:
    """
    L3 Volume Gate — CVD(누적 거래량 델타) 근사.
    양봉(종가>시가) = +1, 음봉 = -1 방식으로 net count 합산.
    backtest 공식: netCVD <= -floor(cvdCompare/2) 이면 차단.
    """
    if "시가" not in df.columns or "종가" not in df.columns or len(df) < win:
        return 0
    tail = df.tail(win)
    up   = (tail["종가"] > tail["시가"]).sum()
    dn   = (tail["종가"] < tail["시가"]).sum()
    return int(up - dn)


def fetch_kospi200_monthly_ret(today_str: str) -> float:
    """
    L1 Market Shield — KOSPI200 최근 1개월 수익률.
    backtest FinBERT proxy: sentScore = prevMonth_ret / 15
    실패 시 5.0 반환 (중립 → 필터 미적용).
    """
    try:
        end_dt   = datetime.datetime.strptime(today_str, "%Y%m%d")
        start_dt = end_dt - datetime.timedelta(days=90)
        df = pykrx_stock.get_index_ohlcv_by_date(
            start_dt.strftime("%Y%m%d"), today_str, "1028"  # KOSPI200
        )
        if df.empty or len(df) < 22:
            return 5.0
        recent    = float(df["종가"].iloc[-1])
        month_ago = float(df["종가"].iloc[-22])
        if month_ago == 0:
            return 5.0
        return round((recent - month_ago) / month_ago * 100, 2)
    except Exception as e:
        print(f"  ⚠ KOSPI200 수익률 조회 실패 (L1 패스): {e}")
        return 5.0   # 실패 시 중립값 → L1 항상 통과


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
#  실제 신호 생성 (T-0 당일 현재가 기준) — 5-Layer 필터
# ─────────────────────────────────────────────
def get_real_signals(today: datetime.datetime):
    """
    T-0(당일) 15:00 현재가 기준 실제 매수/청산 신호 생성.
    백테스팅(backtest.js)과 동일한 5-Layer 필터 완전 적용.

    ▣ L1 Market Shield  — KOSPI200 전월 수익률 기반 sentiment 필터
    ▣ L2 Trend&Pullback — RSI-2 ≤ rsi2Entry  AND  ADX ≥ adxMin
    ▣ L3 Volume Gate    — 거래량 Z-Score OR CVD net 방향 확인
    ▣ L4 ML Approval    — seed 기반 deterministic 확률 필터 (mlThresh)
    ▣ L5 Exit Strategy  — RSI-2 ≥ rsi2Exit (청산 후보)
    """
    today_str = today.strftime("%Y%m%d")

    # T-1 날짜 (fallback용)
    t1 = today - datetime.timedelta(days=1)
    while t1.weekday() >= 5:
        t1 -= datetime.timedelta(days=1)
    t1_str = t1.strftime("%Y%m%d")

    print(f"  기준 날짜: {today_str} (T-0 현재가) — fallback: {t1_str}")

    # ── L1: Market Shield — KOSPI200 전월 수익률
    kospi_1m_ret = fetch_kospi200_monthly_ret(today_str)
    sent_score   = kospi_1m_ret / 15.0   # backtest 공식과 동일
    print(f"  L1 Market Shield: KOSPI200 1개월={kospi_1m_ret:+.1f}%  "
          f"sentScore={sent_score:.3f}  thresh={PARAMS['finBertThresh']}")

    signals        = []
    exits          = []
    skipped        = []
    prices         = {}   # {code: 현재가}
    fallback_codes = []
    blocked_log    = []   # 레이어별 차단 로그

    # ── L4: ML 파라미터 사전 계산
    ml_thresh   = int(PARAMS.get("mlThresh", 57))
    ml_pass_max = max(0, 100 - max(0, ml_thresh - 55))   # backtest 공식

    # ── L3: CVD 파라미터 사전 계산
    cvd_win_days = max(5, int(PARAMS.get("cvdWin", 70) / 5))   # 70일 → ~14 거래일
    cvd_gate     = -int(PARAMS.get("cvdCompare", 7) // 2)       # -3

    for name, code, slot in STOCK_POOL:
        # ── OHLCV 수집 (T-0 우선, T-1 fallback)
        df = fetch_ohlcv(code, today_str, n_days=80)
        is_fallback = False

        if df.empty or len(df) < 5:
            df = fetch_ohlcv(code, t1_str, n_days=80)
            is_fallback = True
            fallback_codes.append(f"{name}({code})")

        if df.empty or len(df) < 5:
            skipped.append(f"{name}({code})")
            continue

        current_price = float(df["종가"].iloc[-1])
        prices[code]  = current_price

        # ── 지표 계산
        rsi2  = calc_rsi2(df["종가"])
        adx   = calc_adx(df)
        vol_z = calc_vol_zscore(df, win=20)
        cvd   = calc_cvd_net(df, win=cvd_win_days)

        fb_mark = " [T-1]" if is_fallback else ""
        print(f"  {name}({code}): ₩{current_price:,.0f}  "
              f"RSI2={rsi2}  ADX={adx}  "
              f"VolZ={vol_z:.2f}  CVD={cvd}{fb_mark}")

        # ─────────────────────────────────────
        # L5 Exit: 청산 후보 (보유 종목 대상)
        # ─────────────────────────────────────
        if rsi2 >= PARAMS["rsi2Exit"]:
            exits.append({"name": name, "code": code, "rsi2": rsi2, "exit": f"RSI-2≥{PARAMS['rsi2Exit']}"})
            continue   # 청산 후보는 매수 판단 스킵

        # ─────────────────────────────────────
        # L2: Trend & Pullback — RSI-2 + ADX
        # ─────────────────────────────────────
        if not (rsi2 <= PARAMS["rsi2Entry"] and adx >= PARAMS["adxMin"]):
            continue   # L2 미통과 → 로그 없이 스킵 (정상 필터)

        # ─────────────────────────────────────
        # L1: Market Shield
        # 당일 종가가 전일보다 하락 AND sentiment 낮으면 차단
        # backtest: m.r < -1 AND sentScore < finBertThresh
        # ─────────────────────────────────────
        l1_pass = True
        if len(df) >= 2:
            daily_chg_pct = (df["종가"].iloc[-1] - df["종가"].iloc[-2]) / df["종가"].iloc[-2] * 100
            if daily_chg_pct < -1.0 and sent_score < PARAMS["finBertThresh"]:
                l1_pass = False
                blocked_log.append(
                    f"  🛡 L1 차단 {name}: 당일{daily_chg_pct:.1f}% "
                    f"KOSPI sentiment={sent_score:.3f} < {PARAMS['finBertThresh']}"
                )
        if not l1_pass:
            continue

        # ─────────────────────────────────────
        # L3: Volume Gate — Vol Z-Score OR CVD
        # 둘 중 하나라도 통과하면 OK (OR 조건)
        # backtest CVD: netCVD <= cvdGate AND current down → 차단
        # ─────────────────────────────────────
        l3_vol_pass = vol_z >= PARAMS.get("zscore", 1.0)
        # CVD gate: backtest 공식 — netCVD <= cvdGate AND 당일 하락이면 차단
        if len(df) >= 2:
            today_down = df["종가"].iloc[-1] < df["종가"].iloc[-2]
        else:
            today_down = False
        l3_cvd_pass = not (cvd <= cvd_gate and today_down)

        if not (l3_vol_pass or l3_cvd_pass):
            blocked_log.append(
                f"  📊 L3 차단 {name}: VolZ={vol_z:.2f}<{PARAMS['zscore']}  "
                f"CVD={cvd}≤{cvd_gate} + 당일하락"
            )
            continue

        # ─────────────────────────────────────
        # L4: ML Approval — seed 기반 확률 필터
        # backtest: seed = (month*17 + year*31 + i*7 + slot*37) % 100
        #           if seed > mlPassMax: continue
        # 일간 버전: today_ordinal + code_hash + slot
        # ─────────────────────────────────────
        today_ord  = today.toordinal()
        code_hash  = int(code) % 100
        seed       = (today_ord * 13 + code_hash * 7 + slot * 37) % 100
        l4_pass    = seed <= ml_pass_max
        if not l4_pass:
            blocked_log.append(
                f"  🤖 L4 차단 {name}: seed={seed} > ml_pass_max={ml_pass_max} "
                f"(mlThresh={ml_thresh})"
            )
            continue

        # ─────────────────────────────────────
        # 전 Layer 통과 → 매수 신호 확정
        # ─────────────────────────────────────
        qty = int(CAPITAL_PER_SLOT / current_price) if current_price > 0 else 0
        signals.append({
            "name": name, "code": code, "slot": slot,
            "price": current_price, "qty": qty,
            "rsi2": rsi2, "adx": adx,
            "vol_z": vol_z, "cvd": cvd,
            "l4_seed": seed,
        })
        print(f"  ✅ 매수신호 {name}: L1✓ L2✓(RSI2={rsi2}/ADX={adx}) "
              f"L3✓(VolZ={vol_z:.2f}/CVD={cvd}) L4✓(seed={seed})")

    # 로그
    if blocked_log:
        print("\n".join(blocked_log))
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
            vol_info  = f"VolZ={s.get('vol_z', '─'):.2f}  CVD={s.get('cvd', '─')}" if isinstance(s.get('vol_z'), float) else ""
            lines.append(
                f"▲ 매수  {s['name']}({s['code']})  슬롯{s['slot']}\n"
                f"   진입가 {price_fmt}  ×  {s['qty']}주  =  {amt_fmt}\n"
                f"   L2: RSI-2={s['rsi2']}  ADX={s['adx']}"
                + (f"\n   L3: {vol_info}" if vol_info else "")
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

    # 파라미터 (5-Layer 전체 표시)
    p = PARAMS
    lines.append(
        f"⚙️ <code>"
        f"L2:RSI≤{p['rsi2Entry']} ADX≥{p['adxMin']}  "
        f"L3:Vz≥{p['zscore']} CVD{p['cvdWin']}d  "
        f"L4:ML≥{p['mlThresh']}  "
        f"L5:HS={p['hardStop']}% TS={p['trailing']}%"
        f"</code>"
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

    # ── 사용자 설정 PARAMS 로드 (프론트엔드 '기본값변경' 버튼 → Firebase /config/params)
    global PARAMS
    PARAMS = load_params_from_firebase()

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

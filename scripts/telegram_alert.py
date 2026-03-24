#!/usr/bin/env python3
"""
SmartSwing-NH  ·  Daily 15:00 Telegram Alert  v3.0  (안 A — 백테스팅 로직 완전 이식)
────────────────────────────────────────────────────────────────────────────────────
백테스팅(backtest.js)과 동일한 판단 로직:

  [시장 타이밍 필터]
  sigThresh = max(0.8, (adx-20)*0.15) × max(0.6, zscore*0.35)
  당월 KOSPI200 |수익률| < sigThresh → 매수 신호 없음

  [L1] 하락장 + 전월 약세 차단
  당월 r < -1% AND 전월 r/15 < finBertThresh → 차단

  [L3] CVD 차단
  최근 cvdWin/15 개월 KOSPI200 net 방향 ≤ cvdGate AND 하락장 → 차단

  [약한 모멘텀] |r| < sigThresh×2 → 슬롯 수 절반

  [종목 스크리닝]  (seed 랜덤 폐기 → 실제 기술지표)
  RSI-2 ≤ rsi2Entry  AND  ADX ≥ adx 만족 종목
  RSI-2 낮은 순 정렬 → 상위 nSlots 매수

  [청산] RSI-2 ≥ rsi2Exit
"""

import os
import json
import datetime
import time
import warnings
import requests
import pandas as pd
import numpy as np
from concurrent.futures import ThreadPoolExecutor, as_completed
from pykrx import stock as pykrx_stock

warnings.filterwarnings("ignore")

# ─────────────────────────────────────────────
#  환경변수
# ─────────────────────────────────────────────
BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
CHAT_ID   = os.environ["TELEGRAM_CHAT_ID"]

# ─────────────────────────────────────────────
#  GDB KOSPI200 200종목 풀 (gdb_stocks.js와 완전 동일)
# ─────────────────────────────────────────────
GDB_STOCK_POOL = [
    ("삼성전자",          "005930"),
    ("SK하이닉스",        "000660"),
    ("현대차",            "005380"),
    ("LG에너지솔루션",    "373220"),
    ("SK스퀘어",          "402340"),
    ("삼성바이오로직스",  "207940"),
    ("두산에너빌리티",    "034020"),
    ("한화에어로스페이스","012450"),
    ("기아",              "000270"),
    ("HD현대중공업",      "329180"),
    ("KB금융",            "105560"),
    ("삼성물산",          "028260"),
    ("셀트리온",          "068270"),
    ("신한지주",          "055550"),
    ("삼성생명",          "032830"),
    ("한화오션",          "042660"),
    ("미래에셋증권",      "006800"),
    ("현대모비스",        "012330"),
    ("NAVER",             "035420"),
    ("삼성전기",          "009150"),
    ("HD현대일렉트릭",    "267260"),
    ("고려아연",          "010130"),
    ("삼성SDI",           "006400"),
    ("한국전력",          "015760"),
    ("하나금융지주",      "086790"),
    ("한미반도체",        "042700"),
    ("HD한국조선해양",    "009540"),
    ("POSCO홀딩스",       "005490"),
    ("LS ELECTRIC",       "010120"),
    ("SK",                "034730"),
    ("한화시스템",        "272210"),
    ("효성중공업",        "298040"),
    ("삼성중공업",        "010140"),
    ("우리금융지주",      "316140"),
    ("카카오",            "035720"),
    ("LG화학",            "051910"),
    ("삼성화재",          "000810"),
    ("HD현대",            "267250"),
    ("HMM",               "011200"),
    ("현대로템",          "064350"),
    ("SK이노베이션",      "096770"),
    ("기업은행",          "024110"),
    ("두산",              "000150"),
    ("LG전자",            "066570"),
    ("메리츠금융지주",    "138040"),
    ("현대건설",          "000720"),
    ("한국항공우주",      "047810"),
    ("KT&G",              "033780"),
    ("포스코퓨처엠",      "003670"),
    ("현대글로비스",      "086280"),
    ("SK텔레콤",          "017670"),
    ("KT",                "030200"),
    ("하이브",            "352820"),
    ("LG",                "003550"),
    ("LIG넥스원",         "079550"),
    ("포스코인터내셔널",  "047050"),
    ("에이피알",          "278470"),
    ("한국금융지주",      "071050"),
    ("DB손해보험",        "005830"),
    ("NH투자증권",        "005940"),
    ("S-Oil",             "010950"),
    ("삼성에스디에스",    "018260"),
    ("키움증권",          "039490"),
    ("카카오뱅크",        "323410"),
    ("현대오토에버",      "307950"),
    ("크래프톤",          "259960"),
    ("대한항공",          "003490"),
    ("LS",                "006260"),
    ("이수페타시스",      "007660"),
    ("현대차2우B",        "005387"),
    ("삼성증권",          "016360"),
    ("한화",              "000880"),
    ("한화솔루션",        "009830"),
    ("카카오페이",        "377300"),
    ("한진칼",            "180640"),
    ("삼양식품",          "003230"),
    ("아모레퍼시픽",      "090430"),
    ("HD현대마린솔루션",  "443060"),
    ("유한양행",          "000100"),
    ("대우건설",          "047040"),
    ("SK바이오팜",        "326030"),
    ("한미약품",          "128940"),
    ("한국타이어앤테크놀로지", "161390"),
    ("LG이노텍",          "011070"),
    ("삼성E&A",           "028050"),
    ("삼성카드",          "029780"),
    ("LG유플러스",        "032640"),
    ("한전기술",          "052690"),
    ("LG씨엔에스",        "064400"),
    ("GS",                "078930"),
    ("HD건설기계",        "267270"),
    ("두산밥캣",          "241560"),
    ("CJ",                "001040"),
    ("LG디스플레이",      "034220"),
    ("BNK금융지주",       "138930"),
    ("JB금융지주",        "175330"),
    ("두산로보틱스",      "454910"),
    ("대한전선",          "001440"),
    ("맥쿼리인프라",      "088980"),
    ("오리온",            "271560"),
    ("코웨이",            "021240"),
    ("현대제철",          "004020"),
    ("포스코DX",          "022100"),
    ("엔씨소프트",        "036570"),
    ("산일전기",          "062040"),
    ("KCC",               "002380"),
    ("한화생명",          "088350"),
    ("엘앤에프",          "066970"),
    ("한화비전",          "489790"),
    ("에코프로머티",      "450080"),
    ("넷마블",            "251270"),
    ("한온시스템",        "018880"),
    ("한화엔진",          "082740"),
    ("대덕전자",          "353200"),
    ("일진전기",          "103590"),
    ("LG생활건강",        "051900"),
    ("강원랜드",          "035250"),
    ("서울보증보험",      "031210"),
    ("DB하이텍",          "000990"),
    ("OCI홀딩스",         "010060"),
    ("SKC",               "011790"),
    ("영원무역",          "111770"),
    ("더존비즈온",        "012510"),
    ("롯데케미칼",        "011170"),
    ("대한조선",          "439260"),
    ("한국가스공사",      "036460"),
    ("현대엘리베이터",    "017800"),
    ("신영증권",          "001720"),
    ("금호석유화학",      "011780"),
    ("롯데지주",          "004990"),
    ("에스원",            "012750"),
    ("SK바이오사이언스",  "302440"),
    ("한솔케미칼",        "014680"),
    ("신세계",            "004170"),
    ("롯데쇼핑",          "023530"),
    ("CJ제일제당",        "097950"),
    ("영원무역홀딩스",    "009970"),
    ("미래에셋생명",      "085620"),
    ("한전KPS",           "051600"),
    ("한올바이오파마",    "009420"),
    ("에스엘",            "005850"),
    ("팬오션",            "028670"),
    ("현대해상",          "001450"),
    ("씨에스윈드",        "112610"),
    ("이마트",            "139480"),
    ("iM금융지주",        "139130"),
    ("풍산",              "103140"),
    ("이수스페셜티케미컬","457190"),
    ("두산퓨얼셀",        "336260"),
    ("HD현대마린엔진",    "071970"),
    ("GS건설",            "006360"),
    ("케이뱅크",          "279570"),
    ("한미사이언스",      "008930"),
    ("동서",              "026960"),
    ("DL이앤씨",          "375500"),
    ("CJ대한통운",        "000120"),
    ("한국카본",          "017960"),
    ("한국앤컴퍼니",      "000240"),
    ("HJ중공업",          "097230"),
    ("코리안리",          "003690"),
    ("HL만도",            "204320"),
    ("효성",              "004800"),
    ("제일기획",          "030000"),
    ("현대지에프홀딩스",  "005440"),
    ("SK가스",            "018670"),
    ("F&F",               "383220"),
    ("세아베스틸지주",    "001430"),
    ("미스토홀딩스",      "081660"),
    ("DN오토모티브",      "007340"),
    ("농심",              "004370"),
    ("현대위아",          "011210"),
    ("다우기술",          "023590"),
    ("코스맥스",          "192820"),
    ("아모레퍼시픽홀딩스","002790"),
    ("BGF리테일",         "282330"),
    ("롯데에너지머티리얼즈","020150"),
    ("현대백화점",        "069960"),
    ("대신증권",          "003540"),
    ("SK이터닉스",        "475150"),
    ("달바글로벌",        "483650"),
    ("코오롱인더",        "120110"),
    ("SK리츠",            "395400"),
    ("가온전선",          "000500"),
    ("대웅제약",          "069620"),
    ("LX인터내셔널",      "001120"),
    ("SK아이이테크놀로지","361610"),
    ("한국콜마",          "161890"),
    ("동원산업",          "006040"),
    ("금호타이어",        "073240"),
    ("시프트업",          "462870"),
    ("호텔신라",          "008770"),
    ("녹십자",            "006280"),
    ("GS리테일",          "007070"),
    ("롯데관광개발",      "032350"),
    ("한화투자증권",      "003530"),
    ("파라다이스",        "034230"),
    ("HDC",               "012630"),
    ("코스모신소재",      "005070"),
    ("SK오션플랜트",      "100090"),
    ("HDC현대산업개발",   "294870"),
]

# ─────────────────────────────────────────────
#  전략 파라미터 — backtest.js DEFAULT_PARAMS와 완전 동일
#  Firebase /config/params 에서 덮어씀
# ─────────────────────────────────────────────
PARAMS = {
    "adx":           20,    # ADX 최소값 (시장 추세 강도 / 종목 ADX 하한)
    "rsi2Entry":     15,    # RSI-2 진입 임계값 (이하일 때 매수)
    "zscore":        1.0,   # sigThresh 스케일 인자
    "nSlots":        5,     # 동시 보유 최대 종목 수
    # hardStop: backtest.js에서도 직접 미사용 (atrMult 기반 동적 계산이 우선)
    # 실전 fallback용 — holdings에 hard_stop_pct 없을 때만 적용
    "hardStop":      5.3,
    "atrMult":       1.6,   # backtest.js getStockHardStop과 동일
                            # dynamic_hard_stop = clamp(1.5%, ATR14% × atrMult, 8.0%)
    # trailing: 실전 전용 — pct_from_high ≤ -trailing% 시 청산 경고
    #   backtest.js는 월별 데이터 한계로 Trailing Stop 미포함 (반락 구간 백테스트 수치 보수적)
    "trailing":      7.6,
    "rsi2Exit":      99,    # RSI-2 청산 임계값 (backtest.js와 완전 동일)
    "finBertThresh": 0.09,  # L1: 전월 수익률/15 임계값
    "cvdWin":        70,    # CVD 윈도우 (일, /15 = 개월)
    "cvdCompare":    7,     # cvdGate = -floor(7/2) = -3
}

CAPITAL_PER_SLOT = 10_000_000

KPI_FALLBACK = {
    # 2026-03-24 재산출 — Profit Cap 제거 후
    "1년": {"totalRet": 155.5, "annRet": 137.7, "mdd": -5.9},
    "3년": {"totalRet": 248.0, "annRet":  49.8, "mdd": -4.7},
    "5년": {"totalRet": 380.3, "annRet":  36.2, "mdd": -1.9},
}

PAT_EXPIRY_DATE = datetime.date(2026, 12, 31)


# ═══════════════════════════════════════════════════════════
#  Firebase 연동
# ═══════════════════════════════════════════════════════════

def _init_firebase():
    import firebase_admin
    from firebase_admin import credentials as fb_cred, firestore as fb_fs
    cred_json = os.environ.get("FIREBASE_CREDENTIALS")
    if not cred_json:
        return None
    if not firebase_admin._apps:
        cred = fb_cred.Certificate(json.loads(cred_json))
        firebase_admin.initialize_app(cred)
    return fb_fs.client()


def load_params_from_firebase() -> dict:
    defaults = dict(PARAMS)
    try:
        db = _init_firebase()
        if db is None:
            return defaults
        snap = db.collection("config").document("params").get()
        if snap.exists:
            d = snap.to_dict()
            loaded = {
                "adx":           float(d.get("adx",           defaults["adx"])),
                "rsi2Entry":     float(d.get("rsi2Entry",     defaults["rsi2Entry"])),
                "zscore":        float(d.get("zscore",        defaults["zscore"])),
                "nSlots":        int  (d.get("nSlots",        defaults["nSlots"])),
                "hardStop":      float(d.get("hardStop",      defaults["hardStop"])),  # fallback only
                "atrMult":       float(d.get("atrMult",       defaults["atrMult"])),   # dynamic hardStop
                "trailing":      float(d.get("trailing",      defaults["trailing"])),
                "rsi2Exit":      float(d.get("rsi2Exit",      defaults["rsi2Exit"])),
                "finBertThresh": float(d.get("finBertThresh", defaults["finBertThresh"])),
                "cvdWin":        float(d.get("cvdWin",        defaults["cvdWin"])),
                "cvdCompare":    float(d.get("cvdCompare",    defaults["cvdCompare"])),
            }
            print(f"  ✅ Firebase PARAMS: adx={loaded['adx']} rsi2Entry={loaded['rsi2Entry']} "
                  f"nSlots={loaded['nSlots']} atrMult={loaded['atrMult']} rsi2Exit={loaded['rsi2Exit']}")
            return loaded
    except Exception as e:
        print(f"  ⚠ PARAMS 로드 실패: {e}")
    return defaults


def load_holdings_from_firebase() -> dict:
    """
    Returns:
      {code: {"entry_price": float|None, "quantity": int|None,
              "entry_date": str|None, "high_price": float|None, "name": str|None}}
    entry_price 등이 없는 구형 문서(코드 ID만)도 key로 포함.
    """
    try:
        db = _init_firebase()
        if db is None:
            return {}
        holdings = {}
        for doc in db.collection("holdings").stream():
            d = doc.to_dict() or {}
            holdings[doc.id] = {
                "entry_price":   d.get("entry_price"),
                "quantity":      d.get("quantity"),
                "entry_date":    d.get("entry_date"),
                "high_price":    d.get("high_price"),
                "name":          d.get("name"),
                "hard_stop_pct": d.get("hard_stop_pct"),  # ATR 기반 종목별 동적 hardStop
            }
        print(f"  ✅ 보유 종목: {list(holdings.keys()) if holdings else '없음'}")
        return holdings
    except Exception as e:
        print(f"  ⚠ holdings 로드 실패: {e}")
        return {}


def load_kpi_from_firebase() -> dict:
    try:
        db = _init_firebase()
        if db is None:
            return KPI_FALLBACK
        doc = db.collection("config").document("kpi").get()
        if doc.exists:
            data = doc.to_dict()
            kpi  = {}
            for p in ("1년", "3년", "5년"):
                entry = data.get(p, {})
                kpi[p] = entry if "totalRet" in entry else KPI_FALLBACK[p]
            return kpi
    except Exception as e:
        print(f"  ⚠ KPI 로드 실패: {e}")
    return KPI_FALLBACK


def save_to_firebase(today_str: str, signals: list, exits: list,
                     signal_date: str, prices: dict = None,
                     is_fallback: bool = False,
                     market_info: dict = None):
    try:
        db = _init_firebase()
        if db is None:
            return
        doc = {
            "signals":     signals,
            "exits":       exits,
            "signal_date": signal_date,
            "is_fallback": is_fallback,
            "run_at":      datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "date":        f"{today_str[:4]}-{today_str[4:6]}-{today_str[6:]}",
            "engine":      "backtest-parity-v3",
        }
        if prices:
            doc["prices"] = prices
        if market_info:
            doc["market_info"] = market_info
        db.collection("daily").document(today_str).set(doc)
        print(f"  ✅ Firebase /daily/{today_str} 저장 완료")
    except Exception as e:
        print(f"  ⚠ Firebase 저장 실패: {e}")


def save_holdings_to_firebase(signals: list, current_holdings: dict):
    """
    매수 신호 발생 시 /holdings/{code} 에 진입 정보 자동 저장.
    이미 entry_price 가 기록된 종목은 덮어쓰지 않음 (중복 진입 방지).
    """
    if not signals:
        return
    try:
        db = _init_firebase()
        if db is None:
            return
        kst_now  = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9)))
        today_str = kst_now.strftime("%Y-%m-%d")
        for s in signals:
            code    = s["code"]
            existing = current_holdings.get(code, {})
            if existing.get("entry_price") is not None:
                print(f"  ℹ {s['name']}({code}) 이미 보유 중 — holdings 유지")
                continue
            doc_data = {
                "entry_price":   float(s["price"]),
                "quantity":      int(s["qty"]),
                "entry_date":    today_str,
                "high_price":    float(s["price"]),         # 최초 고가 = 진입가
                "name":          s["name"],
                "hard_stop_pct": float(s.get("hard_stop_pct",
                                             PARAMS.get("hardStop", 5.3))),
                # hard_stop_pct: 진입 시점 ATR×atrMult 동적값 저장
                # (backtest.js getStockHardStop 동일 로직)
            }
            db.collection("holdings").document(code).set(doc_data)
            print(f"  ✅ holdings 저장: {s['name']}({code})  "
                  f"₩{s['price']:,.0f} × {s['qty']}주  진입일 {today_str}")
    except Exception as e:
        print(f"  ⚠ holdings 저장 실패: {e}")


def update_high_price_and_check_stops(
        holdings: dict, prices: dict, p: dict) -> list:
    """
    매일 15:00 실행 시 보유 종목별:
      1) 현재가 > 기존 high_price → Firebase high_price 갱신
      2) hardStop  : entry_price 대비 현재가 하락률 ≥ p["hardStop"]%
      3) trailing  : high_price 대비 현재가 하락률 ≥ p["trailing"]%

    Returns:
      [{"code", "name", "alert_type", "entry_price", "current_price",
        "high_price", "pct_from_entry", "pct_from_high"}]
    """
    alerts = []
    if not holdings:
        return alerts
    try:
        db = _init_firebase()
        if db is None:
            return alerts

        # global fallback (holdings에 hard_stop_pct 없는 구형 문서용)
        hard_pct_fallback = float(p.get("hardStop",  5.3))
        trailing_pct      = float(p.get("trailing",  7.6))

        for code, info in holdings.items():
            entry_price = info.get("entry_price")
            high_price  = info.get("high_price")
            name        = info.get("name") or code
            curr_price  = prices.get(code)
            # 종목별 동적 hardStop 우선, 없으면 global fallback
            hard_pct = float(info.get("hard_stop_pct") or hard_pct_fallback)

            if entry_price is None or curr_price is None or curr_price <= 0:
                continue

            # high_price 갱신
            new_high = high_price or entry_price
            if curr_price > new_high:
                new_high = curr_price
                try:
                    db.collection("holdings").document(code).update(
                        {"high_price": float(new_high)})
                    print(f"  📈 {name}({code}) high_price 갱신: ₩{new_high:,.0f}")
                except Exception as upd_e:
                    print(f"  ⚠ high_price 갱신 실패 ({code}): {upd_e}")

            pct_from_entry = (curr_price / entry_price - 1) * 100  # 음수 = 손실
            pct_from_high  = (curr_price / new_high  - 1) * 100   # 음수 = 고점 대비 하락

            alert_types = []
            if pct_from_entry <= -hard_pct:
                alert_types.append("hardStop")
            if pct_from_high  <= -trailing_pct:
                alert_types.append("trailing")

            if alert_types:
                alerts.append({
                    "code":            code,
                    "name":            name,
                    "alert_type":      "/".join(alert_types),
                    "entry_price":     entry_price,
                    "current_price":   curr_price,
                    "high_price":      new_high,
                    "pct_from_entry":  round(pct_from_entry, 2),
                    "pct_from_high":   round(pct_from_high,  2),
                })
                print(f"  🚨 STOP 경고: {name}({code})  "
                      f"진입대비 {pct_from_entry:+.2f}%  "
                      f"고점대비 {pct_from_high:+.2f}%  [{'/'.join(alert_types)}]")

    except Exception as e:
        print(f"  ⚠ stop 체크 실패: {e}")
    return alerts


# ═══════════════════════════════════════════════════════════
#  시장 데이터 수집
# ═══════════════════════════════════════════════════════════

def _fetch_one(args):
    code, start_str, end_str, n_days = args
    try:
        df = pykrx_stock.get_market_ohlcv_by_date(start_str, end_str, code)
        return code, df.tail(n_days) if not df.empty else pd.DataFrame()
    except Exception:
        return code, pd.DataFrame()


def fetch_all_ohlcv(codes: list, end_date: str,
                    n_days: int = 60, max_workers: int = 5) -> dict:
    """200종목 병렬 OHLCV 수집."""
    end_dt    = datetime.datetime.strptime(end_date, "%Y%m%d")
    start_dt  = end_dt - datetime.timedelta(days=int(n_days * 1.8))
    start_str = start_dt.strftime("%Y%m%d")
    args_list = [(c, start_str, end_date, n_days) for c in codes]
    results   = {}
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futs = {ex.submit(_fetch_one, a): a[0] for a in args_list}
        done = 0
        for fut in as_completed(futs):
            code, df = fut.result()
            results[code] = df
            done += 1
            if done % 40 == 0:
                print(f"    {done}/{len(codes)} 종목 수집...")
    return results


def get_kospi200_monthly_history(today: datetime.datetime, n_months: int = 8) -> list:
    """
    KOSPI200 월별 수익률 계산 (최근 n_months개월).
    Returns list of {"year":y, "month":m, "r":ret%} — index 0 = 당월, 1 = 전월, ...
    """
    today_str = today.strftime("%Y%m%d")
    start_dt  = today - datetime.timedelta(days=(n_months + 2) * 35)
    start_str = start_dt.strftime("%Y%m%d")
    try:
        # pykrx get_index_ohlcv_by_date("1028") → KRX API '지수명' 컬럼 변경으로 오류
        # KODEX 200 ETF(069500)로 대체 — KOSPI200 추종, 수익률 오차 <0.5%
        df = pykrx_stock.get_market_ohlcv_by_date(start_str, today_str, "069500")
        if df.empty:
            return []
        close = df["종가"].astype(float)
        close.index = pd.to_datetime(close.index)

        results = []
        curr_y, curr_m = today.year, today.month

        for i in range(n_months):
            yr = curr_y
            mo = curr_m - i
            while mo <= 0:
                mo += 12; yr -= 1

            m_start = pd.Timestamp(yr, mo, 1)
            nxt_yr  = yr + 1 if mo == 12 else yr
            nxt_mo  = 1      if mo == 12 else mo + 1
            m_end   = pd.Timestamp(nxt_yr, nxt_mo, 1)

            # 이전 달 마지막 영업일 (기준 종가)
            pre_yr = yr - 1 if mo == 1 else yr
            pre_mo = 12     if mo == 1 else mo - 1
            pre_start = pd.Timestamp(pre_yr, pre_mo, 1)

            month_data = close[(close.index >= m_start) & (close.index < m_end)]
            prev_data  = close[(close.index >= pre_start) & (close.index < m_start)]

            if len(month_data) >= 1 and not prev_data.empty:
                ret = (month_data.iloc[-1] / prev_data.iloc[-1] - 1) * 100
                results.append({"year": yr, "month": mo, "r": float(ret)})

        return results  # [0]=당월, [1]=전월, ...
    except Exception as e:
        print(f"  ⚠ KOSPI200 월별 수익률 조회 실패: {e}")
        return []


# ═══════════════════════════════════════════════════════════
#  기술 지표 (RSI-2, ADX-14)
# ═══════════════════════════════════════════════════════════

def _rsi_series(close: pd.Series, period: int) -> pd.Series:
    delta = close.diff()
    gain  = delta.clip(lower=0).ewm(span=period, adjust=False).mean()
    loss  = (-delta.clip(upper=0)).ewm(span=period, adjust=False).mean()
    return 100 - (100 / (1 + gain / (loss + 1e-9)))


def _adx_series(df: pd.DataFrame, period: int = 14) -> pd.Series:
    h, l, c = df["고가"].astype(float), df["저가"].astype(float), df["종가"].astype(float)
    pc  = c.shift(1)
    tr  = pd.concat([h - l, (h - pc).abs(), (l - pc).abs()], axis=1).max(axis=1)
    dmp = h.diff();  dmm = (-l.diff())
    dmp = dmp.where((dmp > dmm) & (dmp > 0), 0.0)
    dmm = dmm.where((dmm > dmp) & (dmm > 0), 0.0)
    atr = tr.ewm(span=period, adjust=False).mean()
    dip = dmp.ewm(span=period, adjust=False).mean() / (atr + 1e-9) * 100
    dim = dmm.ewm(span=period, adjust=False).mean() / (atr + 1e-9) * 100
    dx  = ((dip - dim).abs() / (dip + dim + 1e-9)) * 100
    return dx.ewm(span=period, adjust=False).mean()


def _atr_pct(df: pd.DataFrame, period: int = 14) -> float:
    """
    ATR(14) / 종가 × 100 — backtest.js getStockHardStop 과 동일 기준.
    dynamic_hard_stop = clamp(1.5%, ATR% × atrMult, 8.0%)
    """
    h  = df["고가"].astype(float)
    l  = df["저가"].astype(float)
    c  = df["종가"].astype(float)
    pc = c.shift(1)
    tr = pd.concat([h - l, (h - pc).abs(), (l - pc).abs()], axis=1).max(axis=1)
    atr      = tr.ewm(span=period, adjust=False).mean()
    last_c   = float(c.iloc[-1])
    last_atr = float(atr.iloc[-1])
    if last_c <= 0:
        return 3.5  # 백테스트 폴백값과 동일
    return last_atr / last_c * 100


# ═══════════════════════════════════════════════════════════
#  신호 생성 — 안 A (백테스팅 로직 완전 이식)
# ═══════════════════════════════════════════════════════════

def get_real_signals(today: datetime.datetime):
    """
    백테스팅(backtest.js runBacktest)과 동일한 판단 로직 실전 적용.
    Returns: (signals, exits, signal_date, prices, is_fallback, market_info)
    """
    today_str = today.strftime("%Y%m%d")
    p = PARAMS

    # ── sigThresh 계산 (backtest.js와 완전 동일)
    sig_thresh_base = max(0.8, (p["adx"] - 20) * 0.15)
    sig_thresh      = sig_thresh_base * max(0.6, p["zscore"] * 0.35)

    print(f"  📐 sigThresh = max(0.8, ({p['adx']}-20)×0.15)×max(0.6, {p['zscore']}×0.35)"
          f" = {sig_thresh_base:.3f}×{max(0.6, p['zscore']*0.35):.3f} = {sig_thresh:.3f}")

    # ── KOSPI200 월별 데이터
    print("  📈 KOSPI200 월별 수익률 계산 중...")
    monthly_hist = get_kospi200_monthly_history(today, n_months=8)

    market_info = {"sig_thresh": round(sig_thresh, 3)}

    if len(monthly_hist) < 1:
        print("  ⚠ KOSPI200 데이터 수집 실패 → 신호 없음")
        market_info["blocked"] = "KOSPI200 데이터 없음"
        return [], [], today_str, {}, False, market_info

    curr = monthly_hist[0]  # 당월
    prev = monthly_hist[1] if len(monthly_hist) > 1 else {"r": 0.0, "year": 0, "month": 0}
    abs_r = abs(curr["r"])

    market_info["curr_ret"]  = round(curr["r"], 2)
    market_info["prev_ret"]  = round(prev["r"], 2)

    print(f"  📊 당월 KOSPI200: {curr['r']:+.2f}%  전월: {prev['r']:+.2f}%  "
          f"|당월| = {abs_r:.2f}  sigThresh = {sig_thresh:.3f}")

    # ── L0: 시장 모멘텀 필터 (backtest: absR < sigThresh → return)
    if abs_r < sig_thresh:
        reason = f"|{abs_r:.2f}%| < sigThresh {sig_thresh:.3f}"
        print(f"  ⛔ L0 차단: {reason} → 매수 신호 없음")
        market_info["blocked"] = f"L0: {reason}"
        return [], [], today_str, {}, False, market_info

    # ── L1: 하락장 + 전월 약세 (backtest: m.r < -1 && sentScore < finBertThresh)
    if curr["r"] < -1:
        sent_score = prev["r"] / 15
        if sent_score < p["finBertThresh"]:
            reason = (f"하락장({curr['r']:+.2f}%) AND "
                      f"전월 sentScore={sent_score:.3f} < {p['finBertThresh']}")
            print(f"  ⛔ L1 차단: {reason}")
            market_info["blocked"] = f"L1: {reason}"
            return [], [], today_str, {}, False, market_info

    # ── L3: CVD 차단 (backtest: netCVD <= cvdGate && m.r < 0)
    cvd_months = max(1, round(p["cvdWin"] / 15))
    cvd_slice  = monthly_hist[1 : 1 + cvd_months]  # 전월부터 N개월
    if len(cvd_slice) >= 2:
        net_cvd  = sum(1 if m["r"] > 0 else -1 for m in cvd_slice)
        cvd_gate = -int(p["cvdCompare"] / 2)
        market_info["net_cvd"] = net_cvd
        if net_cvd <= cvd_gate and curr["r"] < 0:
            reason = f"netCVD={net_cvd} ≤ cvdGate={cvd_gate} AND 하락장"
            print(f"  ⛔ L3 차단: {reason}")
            market_info["blocked"] = f"L3: {reason}"
            return [], [], today_str, {}, False, market_info

    # ── 약한 모멘텀: |absR| < sigThresh*2 → 슬롯 절반 (backtest: seed%2==0 continue)
    weak_market    = abs_r < sig_thresh * 2
    effective_slots = max(1, p["nSlots"] // 2) if weak_market else p["nSlots"]
    if weak_market:
        print(f"  ⚠ 약한 모멘텀 ({abs_r:.2f}% < {sig_thresh*2:.2f}) "
              f"→ 유효 슬롯 {p['nSlots']} → {effective_slots}")
    market_info["weak_market"]     = weak_market
    market_info["effective_slots"] = effective_slots

    # ── 종목 OHLCV 수집 (RSI-2 ≥ 14일치 필요 → 60봉)
    codes = [code for _, code in GDB_STOCK_POOL]
    print(f"  📡 200종목 OHLCV 수집 중 ({today_str})...")
    t0      = time.time()
    all_dfs = fetch_all_ohlcv(codes, today_str, n_days=60)

    # T-1 fallback
    t1         = today - datetime.timedelta(days=1)
    while t1.weekday() >= 5:
        t1 -= datetime.timedelta(days=1)
    t1_str     = t1.strftime("%Y%m%d")
    fallback_names = []
    for name, code in GDB_STOCK_POOL:
        df = all_dfs.get(code, pd.DataFrame())
        if df.empty or len(df) < 10:
            _, df_fb = _fetch_one((code,
                                   (datetime.datetime.strptime(t1_str, "%Y%m%d")
                                    - datetime.timedelta(days=120)).strftime("%Y%m%d"),
                                   t1_str, 60))
            if not df_fb.empty:
                all_dfs[code] = df_fb
                fallback_names.append(name)

    valid = sum(1 for df in all_dfs.values() if not df.empty and len(df) >= 15)
    print(f"  ✅ 수집 완료: {valid}/200 유효  ({time.time()-t0:.0f}초)")

    # ── RSI-2 + ADX 스크리닝 (backtest: RSI-2 기반 진입 / ADX 추세 확인)
    name_map   = {code: name for name, code in GDB_STOCK_POOL}
    candidates = []

    for code, df in all_dfs.items():
        if df.empty or len(df) < 15:
            continue
        try:
            close = df["종가"].astype(float)
            rsi2  = float(_rsi_series(close, 2).iloc[-1])
            rsi14 = float(_rsi_series(close, 14).iloc[-1])
            adx   = float(_adx_series(df, 14).iloc[-1])
            vol   = df["거래량"].astype(float)
            vm    = vol.rolling(21).mean().shift(1)
            vs    = vol.rolling(21).std().shift(1)
            vol_z = float(((vol - vm) / (vs + 1e-9)).iloc[-1])
            price = float(close.iloc[-1])

            if pd.isna(rsi2) or pd.isna(adx):
                continue

            # ── dynamic hardStop (backtest.js getStockHardStop 동일 공식)
            # clamp(1.5, ATR14% × atrMult, 8.0)
            atr_pct_val   = _atr_pct(df, 14)
            dyn_hard_stop = round(max(1.5, min(8.0, atr_pct_val * p["atrMult"])), 2)

            candidates.append({
                "code":          code,
                "name":          name_map.get(code, code),
                "rsi2":          round(rsi2, 1),
                "rsi14":         round(rsi14, 1),
                "adx":           round(adx, 1),
                "vol_z":         round(vol_z, 2),
                "price":         price,
                "hard_stop_pct": dyn_hard_stop,  # 종목별 동적 hardStop
            })
        except Exception:
            continue

    # ── 조건 필터: RSI-2 ≤ rsi2Entry AND ADX ≥ adx
    filtered = [c for c in candidates
                if c["rsi2"] <= p["rsi2Entry"] and c["adx"] >= p["adx"]]

    # RSI-2 오름차순 (가장 과매도 → 슬롯1)
    filtered.sort(key=lambda x: x["rsi2"])

    print(f"\n  ── 스크리닝 결과 ─────────────────────────────────────")
    print(f"  유효 종목: {len(candidates)}개  "
          f"RSI-2≤{p['rsi2Entry']} AND ADX≥{p['adx']}: {len(filtered)}개")
    for i, c in enumerate(filtered[:15]):
        star = "★" if i < effective_slots else " "
        print(f"  {star}#{i+1:2d}  {c['name'][:10]:10s}  "
              f"RSI-2={c['rsi2']:5.1f}  ADX={c['adx']:5.1f}  VolZ={c['vol_z']:+.2f}")
    if not filtered:
        print("  (조건 미달 종목 없음)")
    print("  ─────────────────────────────────────────────────────\n")

    market_info["n_candidates"]    = len(candidates)
    market_info["n_filtered"]      = len(filtered)

    # ── 매수 신호 (상위 effective_slots)
    prices  = {c["code"]: c["price"] for c in candidates}
    signals = []
    for slot_idx, cand in enumerate(filtered[:effective_slots], start=1):
        qty = int(CAPITAL_PER_SLOT / cand["price"]) if cand["price"] > 0 else 0
        signals.append({
            "name":          cand["name"],
            "code":          cand["code"],
            "slot":          slot_idx,
            "price":         cand["price"],
            "qty":           qty,
            "rsi2":          cand["rsi2"],
            "rsi14":         cand["rsi14"],
            "adx":           cand["adx"],
            "vol_z":         cand["vol_z"],
            "rank":          slot_idx,
            "hard_stop_pct": cand["hard_stop_pct"],  # 종목별 ATR 기반 동적 hardStop
        })

    # ── 청산 후보: RSI-2 ≥ rsi2Exit
    exits = [
        {"name": c["name"], "code": c["code"],
         "rsi2": c["rsi2"], "exit": f"RSI-2≥{p['rsi2Exit']}"}
        for c in candidates if c["rsi2"] >= p["rsi2Exit"]
    ]

    if fallback_names:
        print(f"  ⚠ T-1 fallback: "
              + ", ".join(fallback_names[:5])
              + (f" 외 {len(fallback_names)-5}종목" if len(fallback_names) > 5 else ""))

    return signals, exits, today_str, prices, bool(fallback_names), market_info


# ═══════════════════════════════════════════════════════════
#  메시지 빌드
# ═══════════════════════════════════════════════════════════

def build_message(today, signals, exits, signal_date,
                  kpi_data=None, is_fallback=False,
                  holdings: dict = None, market_info: dict = None,
                  stop_alerts: list = None):
    date_str = today.strftime("%Y-%m-%d")
    time_str = today.strftime("%H:%M")
    kpi_map  = kpi_data or KPI_FALLBACK
    p        = PARAMS
    mi       = market_info or {}

    sig_thresh   = mi.get("sig_thresh", 0)
    curr_ret     = mi.get("curr_ret", 0)
    prev_ret     = mi.get("prev_ret", 0)
    blocked      = mi.get("blocked", "")
    weak_market  = mi.get("weak_market", False)
    eff_slots    = mi.get("effective_slots", p["nSlots"])
    n_filtered   = mi.get("n_filtered", 0)

    lines = [
        f"📊 <b>SmartSwing-NH</b>  <code>{date_str}  {time_str}</code>",
        f"<i>🔁 Engine: 백테스팅 동일로직 v3  |  KOSPI200 시장타이밍 + RSI-2/ADX 스크리닝</i>",
        f"<i>기준: T-0 현재가 ({signal_date})"
        + (" ⚠ 일부 T-1 fallback" if is_fallback else "") + "</i>",
        "",
    ]

    # 시장 타이밍 상태
    lines.append("<b>[ 시장 타이밍 ]</b>")
    lines.append(
        f"당월 KOSPI200: <code>{curr_ret:+.2f}%</code>  "
        f"전월: <code>{prev_ret:+.2f}%</code>  "
        f"sigThresh: <code>{sig_thresh:.3f}</code>"
    )
    if blocked:
        lines.append(f"⛔ 차단: {blocked}")
    elif weak_market:
        lines.append(f"⚠ 약한 모멘텀 → 유효 슬롯 {eff_slots}개")
    else:
        lines.append(f"✅ 진입 조건 충족 (유효 슬롯 {eff_slots}개)")
    lines.append(f"<code>후보 종목: RSI-2≤{p['rsi2Entry']} AND ADX≥{p['adx']} → {n_filtered}개</code>")
    lines.append("")

    # 매수 신호
    lines.append("<b>[ 오늘 매수 신호 ]</b>")
    if signals:
        for s in signals:
            hs = s.get("hard_stop_pct") or p.get("hardStop", 5.3)
            lines.append(
                f"▲ 슬롯{s['slot']}  {s['name']}({s['code']})\n"
                f"   ₩{s['price']:,.0f}  ×  {s['qty']}주  "
                f"= ₩{s['price'] * s['qty']:,.0f}\n"
                f"   RSI-2={s['rsi2']}  ADX={s['adx']}  VolZ={s['vol_z']:+.2f}"
                f"  HS={hs:.1f}%"
            )
    else:
        if blocked:
            lines.append("─ 시장 타이밍 필터 차단 → 매수 없음")
        elif n_filtered == 0:
            lines.append(f"─ 조건 만족 종목 없음 (RSI-2≤{p['rsi2Entry']} AND ADX≥{p['adx']})")
        else:
            lines.append("─ 매수 신호 없음")
    lines.append("")

    # 청산 후보 — RSI-2 과매수 + hardStop/trailing 경고 통합
    held_exits  = [e for e in exits if holdings and e["code"] in holdings]
    other_exits = [e for e in exits if not holdings or e["code"] not in holdings]
    sa          = stop_alerts or []

    # stop 경고 코드 집합 (중복 출력 방지용)
    stop_codes = {a["code"] for a in sa}

    lines.append("<b>[ 청산 후보 (보유 종목) ]</b>")

    any_exit = False

    # ① hardStop / trailing 경고 (최우선)
    for a in sa:
        any_exit = True
        tag = ""
        if "hardStop" in a["alert_type"] and "trailing" in a["alert_type"]:
            tag = "🔴 하드스탑+트레일링"
        elif "hardStop" in a["alert_type"]:
            tag = "🔴 하드스탑"
        else:
            tag = "🟠 트레일링스탑"
        lines.append(
            f"{tag}  {a['name']}({a['code']})\n"
            f"   진입 ₩{a['entry_price']:,.0f}  현재 ₩{a['current_price']:,.0f}"
            f"  진입대비 <code>{a['pct_from_entry']:+.2f}%</code>\n"
            f"   고점 ₩{a['high_price']:,.0f}  고점대비 <code>{a['pct_from_high']:+.2f}%</code>"
            f"  [{a['alert_type']}]"
        )

    # stop_code → alert_type 빠른 조회
    stop_type_map = {a["code"]: a["alert_type"] for a in sa}

    # ② RSI-2 과매수 (stop 경고와 중복 시 병기)
    for e in held_exits:
        any_exit = True
        extra = f"  (+ {stop_type_map[e['code']]})" if e["code"] in stop_codes else ""
        lines.append(f"⬇ {e['name']}({e['code']})  RSI-2={e['rsi2']}  → 매도 검토{extra}")

    if not any_exit:
        lines.append("─ 없음")
    lines.append("")

    if other_exits:
        names = ", ".join(e["name"] for e in other_exits[:5])
        lines.append(f"<i>ℹ 미보유 RSI≥{p['rsi2Exit']} (참고): {names}</i>")
        lines.append("")

    # KPI
    kpi = kpi_map.get("5년", KPI_FALLBACK["5년"])
    lines.append("<b>[ 5년 누적 KPI ]</b>")
    lines.append(f"+{kpi['totalRet']}%  연환산 +{kpi['annRet']}%  MDD {kpi['mdd']}%")
    lines.append("")

    lines.append(
        f"⚙️ <code>adx≥{p['adx']}  rsi2Entry≤{p['rsi2Entry']}  "
        f"z={p['zscore']}  nSlots={p['nSlots']}  "
        f"HS={p['hardStop']}%  TS={p['trailing']}%</code>"
    )
    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════
#  PAT 만료 경고
# ═══════════════════════════════════════════════════════════

def check_pat_expiry_alert(today: datetime.datetime):
    days_left = (PAT_EXPIRY_DATE - today.date()).days
    if days_left > 30 or days_left < 0:
        return
    emoji   = "🔴" if days_left <= 7 else ("🟠" if days_left <= 14 else "🟡")
    urgency = f"만료 {days_left}일 전" + (" (긴급)" if days_left <= 7 else "")
    text    = (f"{emoji} <b>GitHub PAT 만료 경고</b>\n"
               f"⏳ 만료일: <code>{PAT_EXPIRY_DATE}</code>  |  <b>{urgency}</b>\n"
               f"📋 GitHub → Settings → Developer settings → PAT 재발급 → Secrets 업데이트")
    try:
        requests.post(
            f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
            json={"chat_id": CHAT_ID, "text": text, "parse_mode": "HTML"},
            timeout=15,
        ).raise_for_status()
    except Exception as e:
        print(f"  ⚠ PAT 경고 전송 실패: {e}")


# ═══════════════════════════════════════════════════════════
#  Telegram 전송
# ═══════════════════════════════════════════════════════════

def send_telegram(text: str):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    r   = requests.post(url, json={"chat_id": CHAT_ID, "text": text, "parse_mode": "HTML"}, timeout=15)
    r.raise_for_status()
    return r.json()


# ═══════════════════════════════════════════════════════════
#  메인
# ═══════════════════════════════════════════════════════════

def get_today_kst():
    return datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9)))

def is_trading_day(dt):
    return dt.weekday() < 5


def main():
    today = get_today_kst()
    print(f"[{today.isoformat()}] SmartSwing-NH 백테스팅 동일로직 v3 실행")

    force = bool(os.environ.get("FORCE_RUN"))
    if not is_trading_day(today) and not force:
        print("주말 — 건너뜀")
        return

    print("🔥 Firebase 로드 중...")
    global PARAMS
    PARAMS   = load_params_from_firebase()
    kpi_data = load_kpi_from_firebase()
    holdings = load_holdings_from_firebase()

    t_total = time.time()
    signals, exits, signal_date, prices, is_fallback, market_info = get_real_signals(today)
    print(f"\n⏱ 총 소요: {time.time()-t_total:.0f}초")

    # ── 매수 신호 발생 시 Firebase /holdings/{code} 자동 저장
    if signals:
        print("\n💾 holdings 자동 저장 중...")
        save_holdings_to_firebase(signals, holdings)
        # holdings dict 갱신 (방금 저장한 신호 정보 반영 — 이후 stop 체크에 사용)
        for s in signals:
            if s["code"] not in holdings or holdings[s["code"]].get("entry_price") is None:
                holdings[s["code"]] = {
                    "entry_price": float(s["price"]),
                    "quantity":    int(s["qty"]),
                    "entry_date":  today.strftime("%Y-%m-%d"),
                    "high_price":  float(s["price"]),
                    "name":        s["name"],
                }

    # ── hardStop / trailing 조건 체크
    print("\n🛡 보유 종목 stop 조건 체크...")
    stop_alerts = update_high_price_and_check_stops(holdings, prices, PARAMS)

    msg = build_message(today, signals, exits, signal_date,
                        kpi_data, is_fallback, holdings, market_info,
                        stop_alerts=stop_alerts)
    print("─── 전송 메시지 ───")
    print(msg)
    print("──────────────────")

    result = send_telegram(msg)
    if result.get("ok"):
        print(f"✅ 전송 성공  (매수 {len(signals)}개, 청산후보 {len(exits)}개, "
              f"stop경고 {len(stop_alerts)}개)")
    else:
        print(f"❌ 전송 실패: {result}")

    today_str = today.strftime("%Y%m%d")
    save_to_firebase(today_str, signals, exits, signal_date, prices, is_fallback, market_info)
    check_pat_expiry_alert(today)


if __name__ == "__main__":
    main()

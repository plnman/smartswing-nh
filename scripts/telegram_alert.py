#!/usr/bin/env python3
"""
SmartSwing-NH  ·  Daily 15:00 Telegram Alert  v2.0  (XGBoost Edition)
────────────────────────────────────────────────────────────────────────
GDB KOSPI200 200종목 XGBoost 스코어링 → 상위 nSlots 종목 매수 신호

피처 (9개):
  RSI-2, RSI-14, ADX-14, Vol Z-Score, CVD net, Mom5, Mom20, BB %B, KOSPI 1m

학습:
  과거 300 거래일 데이터 / 레이블 = 5일 후 종가 > 오늘 종가 (binary)

랭킹:
  200종목 전체 스코어링 → predict_proba 점수 내림차순
  상위 nSlots 종목 → 슬롯 1,2,...,nSlots (점수 1위 = 슬롯1 = 최우선)
  점수 ≥ mlThresh/100 이어야 최종 매수 신호 확정
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
#  전략 파라미터 — Firebase /config/params 에서 덮어씀
# ─────────────────────────────────────────────
PARAMS = {
    "nSlots":   5,     # 동시 보유 최대 종목 수 (상위 nSlots 매수)
    "mlThresh": 57,    # XGBoost 최소 점수 (0~100)
    "rsi2Exit": 99,    # RSI-2 청산 임계값
    "hardStop": 5.3,   # 하드스탑 % (참고용)
    "trailing": 7.6,   # 트레일링 스탑 % (참고용)
}

CAPITAL_PER_SLOT = 10_000_000

KPI_FALLBACK = {
    "1년": {"totalRet": 159.5, "annRet": 159.5, "mdd": -7.6},
    "3년": {"totalRet": 167.8, "annRet": 38.9,  "mdd": -17.2},
    "5년": {"totalRet": 107.8, "annRet": 15.8,  "mdd": -35.9},
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
                "nSlots":   int  (d.get("nSlots",   defaults["nSlots"])),
                "mlThresh": int  (d.get("mlThresh",  defaults["mlThresh"])),
                "rsi2Exit": float(d.get("rsi2Exit",  defaults["rsi2Exit"])),
                "hardStop": float(d.get("hardStop",  defaults["hardStop"])),
                "trailing": float(d.get("trailing",  defaults["trailing"])),
            }
            print(f"  ✅ Firebase PARAMS: nSlots={loaded['nSlots']} "
                  f"mlThresh={loaded['mlThresh']} 청산RSI≥{loaded['rsi2Exit']}")
            return loaded
    except Exception as e:
        print(f"  ⚠ PARAMS 로드 실패: {e}")
    return defaults


def load_holdings_from_firebase() -> set:
    try:
        db = _init_firebase()
        if db is None:
            return set()
        codes = {d.id for d in db.collection("holdings").stream()}
        print(f"  ✅ 보유 종목: {codes if codes else '없음'}")
        return codes
    except Exception as e:
        print(f"  ⚠ holdings 로드 실패: {e}")
        return set()


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
                     is_fallback: bool = False, scores: list = None):
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
            "engine":      "xgboost-v2",
        }
        if prices:
            doc["prices"] = prices
        if scores:
            doc["scores"] = [
                {"code": r["code"], "name": r["name"],
                 "score": round(r["score"], 4), "price": r["price"]}
                for r in scores[:20]
            ]
        db.collection("daily").document(today_str).set(doc)
        print(f"  ✅ Firebase /daily/{today_str} 저장 완료")
    except Exception as e:
        print(f"  ⚠ Firebase 저장 실패: {e}")


# ═══════════════════════════════════════════════════════════
#  시장 데이터 수집 (병렬)
# ═══════════════════════════════════════════════════════════

def _fetch_one(args):
    code, start_str, end_str, n_days = args
    try:
        df = pykrx_stock.get_market_ohlcv_by_date(start_str, end_str, code)
        return code, df.tail(n_days) if not df.empty else pd.DataFrame()
    except Exception:
        return code, pd.DataFrame()


def fetch_all_ohlcv(codes: list, end_date: str,
                    n_days: int = 310, max_workers: int = 5) -> dict:
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
            code, df   = fut.result()
            results[code] = df
            done += 1
            if done % 40 == 0:
                print(f"    {done}/{len(codes)} 종목 수집...")
    return results


def fetch_kospi200_series(end_date: str, n_days: int = 340) -> pd.Series:
    """KOSPI200 지수 종가 시계열."""
    end_dt   = datetime.datetime.strptime(end_date, "%Y%m%d")
    start_dt = end_dt - datetime.timedelta(days=int(n_days * 1.8))
    try:
        df = pykrx_stock.get_index_ohlcv_by_date(
            start_dt.strftime("%Y%m%d"), end_date, "1028"
        )
        return df["종가"].tail(n_days).astype(float)
    except Exception as e:
        print(f"  ⚠ KOSPI200 조회 실패: {e}")
        return pd.Series(dtype=float)


# ═══════════════════════════════════════════════════════════
#  피처 엔지니어링
# ═══════════════════════════════════════════════════════════

FEATURE_COLS = [
    "rsi2", "rsi14", "adx", "vol_z", "cvd_net",
    "mom5", "mom20", "bb_pct", "kospi_1m",
]


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


def engineer_features_df(df: pd.DataFrame, kospi_1m_map: pd.Series) -> pd.DataFrame:
    """단일 종목 전체 히스토리 → 피처 DataFrame (벡터화)."""
    close = df["종가"].astype(float)
    high  = df["고가"].astype(float)
    low   = df["저가"].astype(float)
    open_ = df["시가"].astype(float)
    vol   = df["거래량"].astype(float)

    feat = pd.DataFrame(index=df.index)
    feat["rsi2"]    = _rsi_series(close, 2)
    feat["rsi14"]   = _rsi_series(close, 14)
    feat["adx"]     = _adx_series(df, 14)

    vm = vol.rolling(21).mean().shift(1)
    vs = vol.rolling(21).std().shift(1)
    feat["vol_z"]   = (vol - vm) / (vs + 1e-9)

    direction       = (close > open_).astype(float) - (close < open_).astype(float)
    feat["cvd_net"] = direction.rolling(14).sum()

    feat["mom5"]    = close.pct_change(5)  * 100
    feat["mom20"]   = close.pct_change(20) * 100

    sma20 = close.rolling(20).mean()
    std20 = close.rolling(20).std()
    feat["bb_pct"]  = (close - (sma20 - 2 * std20)) / (4 * std20 + 1e-9)

    feat["kospi_1m"] = kospi_1m_map.reindex(feat.index).ffill().fillna(0.0)
    return feat


# ═══════════════════════════════════════════════════════════
#  XGBoost 학습 + 전종목 스코어링
# ═══════════════════════════════════════════════════════════

def train_xgb_model(all_dfs: dict, kospi_1m_map: pd.Series):
    """
    200종목 과거 데이터 → XGBoost 학습.
    레이블: 5일 후 종가 > 오늘 종가.
    lookahead 방지: feature[t] / label[t+5], 마지막 5행 제거.
    """
    import xgboost as xgb

    X_list, y_list = [], []
    for code, df in all_dfs.items():
        if df.empty or len(df) < 60:
            continue
        try:
            feat = engineer_features_df(df, kospi_1m_map)
            future_ret = df["종가"].astype(float).shift(-5) / df["종가"].astype(float) - 1
            y = (future_ret > 0.0).astype(int)
            combined = feat.copy()
            combined["__y"] = y
            combined = combined.dropna().iloc[:-5]   # 마지막 5행 제거
            if len(combined) < 20:
                continue
            X_list.append(combined[FEATURE_COLS])
            y_list.append(combined["__y"])
        except Exception:
            continue

    if not X_list:
        print("  ⚠ 학습 데이터 없음")
        return None

    X = pd.concat(X_list, ignore_index=True)
    y = pd.concat(y_list, ignore_index=True)

    pos_ratio  = float(y.mean())
    scale_pos  = (1 - pos_ratio) / (pos_ratio + 1e-9)

    model = xgb.XGBClassifier(
        n_estimators=200,
        max_depth=4,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        min_child_weight=5,
        gamma=1,
        scale_pos_weight=scale_pos,
        eval_metric="logloss",
        random_state=42,
        verbosity=0,
        n_jobs=-1,
    )
    model.fit(X, y)

    imp = pd.Series(model.feature_importances_, index=FEATURE_COLS).sort_values(ascending=False)
    print(f"  ✅ XGBoost 학습: {len(X):,}샘플  클래스비={pos_ratio:.1%}")
    print(f"  📊 피처 중요도: " + "  ".join(f"{k}={v:.3f}" for k, v in imp.items()))
    return model


def score_all_stocks(model, all_dfs: dict, kospi_1m_map: pd.Series) -> list:
    """전종목 오늘(최신행) XGBoost 스코어 계산 → 내림차순 정렬."""
    rows = []
    name_map = {code: name for name, code in GDB_STOCK_POOL}
    for code, df in all_dfs.items():
        if df.empty or len(df) < 30:
            continue
        try:
            feat = engineer_features_df(df, kospi_1m_map)
            today_feat = feat[FEATURE_COLS].iloc[-1]
            if today_feat.isna().any():
                continue
            score = float(model.predict_proba([today_feat.values])[0][1])
            rows.append({
                "score":  score,
                "code":   code,
                "name":   name_map.get(code, code),
                "price":  float(df["종가"].iloc[-1]),
                "rsi2":   round(float(feat["rsi2"].iloc[-1]),  1),
                "rsi14":  round(float(feat["rsi14"].iloc[-1]), 1),
                "adx":    round(float(feat["adx"].iloc[-1]),   1),
                "vol_z":  round(float(feat["vol_z"].iloc[-1]), 2),
                "cvd":    int(feat["cvd_net"].iloc[-1]),
                "mom5":   round(float(feat["mom5"].iloc[-1]),  1),
            })
        except Exception:
            continue

    rows.sort(key=lambda x: x["score"], reverse=True)
    return rows


# ═══════════════════════════════════════════════════════════
#  신호 생성
# ═══════════════════════════════════════════════════════════

def get_real_signals(today: datetime.datetime):
    today_str = today.strftime("%Y%m%d")
    t1 = today - datetime.timedelta(days=1)
    while t1.weekday() >= 5:
        t1 -= datetime.timedelta(days=1)
    t1_str = t1.strftime("%Y%m%d")

    codes = [code for _, code in GDB_STOCK_POOL]

    # ── 데이터 수집
    print(f"  📡 200종목 OHLCV 수집 중 (T-0: {today_str})...")
    t0      = time.time()
    all_dfs = fetch_all_ohlcv(codes, today_str, n_days=310)

    # T-0 실패 종목 → T-1 fallback
    fallback_names = []
    for name, code in GDB_STOCK_POOL:
        df = all_dfs.get(code, pd.DataFrame())
        if df.empty or len(df) < 5:
            _, df_fb = _fetch_one((code,
                                   (datetime.datetime.strptime(t1_str, "%Y%m%d")
                                    - datetime.timedelta(days=560)).strftime("%Y%m%d"),
                                   t1_str, 310))
            if not df_fb.empty:
                all_dfs[code] = df_fb
                fallback_names.append(name)

    valid = sum(1 for df in all_dfs.values() if not df.empty and len(df) >= 30)
    print(f"  ✅ 수집 완료: {valid}/200 유효  ({time.time()-t0:.0f}초)")

    # ── KOSPI200 시계열
    print("  📈 KOSPI200 지수 수집...")
    kospi_ser = fetch_kospi200_series(today_str, n_days=340)
    # 1개월 수익률 시계열 생성 (전 종목 인덱스 합집합 기준)
    all_idx = pd.DatetimeIndex([])
    for df in all_dfs.values():
        if not df.empty:
            all_idx = all_idx.union(df.index)
    if not kospi_ser.empty:
        k1m_raw      = kospi_ser.pct_change(22) * 100
        kospi_1m_map = k1m_raw.reindex(k1m_raw.index.union(all_idx)).ffill().reindex(all_idx).fillna(0.0)
    else:
        kospi_1m_map = pd.Series(0.0, index=all_idx)

    # ── XGBoost 학습
    print("  🤖 XGBoost 학습 중...")
    t_train = time.time()
    model   = train_xgb_model(all_dfs, kospi_1m_map)
    print(f"  ✅ 학습 완료 ({time.time()-t_train:.0f}초)")

    if model is None:
        return [], [], today_str, {}, False, []

    # ── 전종목 스코어링 + 랭킹
    print("  🎯 전종목 스코어링...")
    scores = score_all_stocks(model, all_dfs, kospi_1m_map)
    prices = {r["code"]: r["price"] for r in scores}

    # Top20 로그
    print("\n  ── XGBoost 랭킹 (상위 20위) ─────────────────────────")
    for i, r in enumerate(scores[:20]):
        star = "★" if i < PARAMS["nSlots"] and r["score"] >= PARAMS["mlThresh"] / 100 else " "
        print(f"  {star}#{i+1:2d}  {r['name'][:10]:10s}  "
              f"score={r['score']:.3f}  RSI2={r['rsi2']:5.1f}  "
              f"ADX={r['adx']:5.1f}  VolZ={r['vol_z']:+.2f}  Mom5={r['mom5']:+.1f}%")
    print("  ─────────────────────────────────────────────────────\n")

    # ── 매수 신호: 상위 nSlots + score ≥ mlThresh/100
    min_score = PARAMS["mlThresh"] / 100
    signals   = []
    for slot_idx, row in enumerate(scores[:PARAMS["nSlots"]], start=1):
        if row["score"] < min_score:
            print(f"  ⚠ #{slot_idx} {row['name']} score={row['score']:.3f} "
                  f"< threshold={min_score:.2f} → 임계점 미달 스킵")
            continue
        qty = int(CAPITAL_PER_SLOT / row["price"]) if row["price"] > 0 else 0
        signals.append({
            "name":  row["name"],
            "code":  row["code"],
            "slot":  slot_idx,
            "price": row["price"],
            "qty":   qty,
            "score": row["score"],
            "rsi2":  row["rsi2"],
            "adx":   row["adx"],
            "vol_z": row["vol_z"],
            "cvd":   row["cvd"],
            "rank":  slot_idx,
        })

    # ── 청산 후보: 보유 종목 RSI-2 ≥ rsi2Exit
    exits = [
        {"name": r["name"], "code": r["code"],
         "rsi2": r["rsi2"], "exit": f"RSI-2≥{PARAMS['rsi2Exit']}"}
        for r in scores if r["rsi2"] >= PARAMS["rsi2Exit"]
    ]

    if fallback_names:
        print(f"  ⚠ T-1 fallback: "
              + ", ".join(fallback_names[:5])
              + (f" 외 {len(fallback_names)-5}종목" if len(fallback_names) > 5 else ""))

    return signals, exits, today_str, prices, bool(fallback_names), scores


# ═══════════════════════════════════════════════════════════
#  메시지 빌드
# ═══════════════════════════════════════════════════════════

def build_message(today, signals, exits, signal_date,
                  kpi_data=None, is_fallback=False,
                  holdings: set = None, scores: list = None):
    date_str = today.strftime("%Y-%m-%d")
    time_str = today.strftime("%H:%M")
    kpi_map  = kpi_data or KPI_FALLBACK
    min_score = PARAMS["mlThresh"] / 100

    lines = [
        f"📊 <b>SmartSwing-NH</b>  <code>{date_str}  {time_str}</code>",
        f"<i>🤖 Engine: XGBoost v2  |  KOSPI200 200종목 스코어링</i>",
        f"<i>기준: T-0 현재가 ({signal_date})"
        + (" ⚠ 일부 T-1 fallback" if is_fallback else "") + "</i>",
        "",
    ]

    # 매수 신호
    lines.append("<b>[ 오늘 매수 신호 ]</b>")
    if signals:
        for s in signals:
            lines.append(
                f"▲ 슬롯{s['slot']}  {s['name']}({s['code']})\n"
                f"   ₩{s['price']:,.0f}  ×  {s['qty']}주  "
                f"= ₩{s['price'] * s['qty']:,.0f}\n"
                f"   🎯 XGB={s['score']:.3f}  RSI-2={s['rsi2']}  "
                f"ADX={s['adx']}  VolZ={s['vol_z']:+.2f}"
            )
    else:
        lines.append(f"─ 매수 신호 없음 (임계점 {min_score:.2f} 미달)")
    lines.append("")

    # Top10 스코어 표
    if scores and len(scores) >= 5:
        lines.append("<b>[ XGBoost Top 10 ]</b>")
        for i, r in enumerate(scores[:10], 1):
            filled = "█" * int(r["score"] * 10)
            empty  = "░" * (10 - int(r["score"] * 10))
            mark   = "▲" if any(s["code"] == r["code"] for s in signals) else " "
            lines.append(
                f"<code>{mark}#{i:2d} {r['name'][:8]:8s} "
                f"{filled}{empty} {r['score']:.3f} RSI2={r['rsi2']:4.0f}</code>"
            )
        lines.append("")

    # 청산 후보
    held_exits  = [e for e in exits if holdings and e["code"] in holdings]
    other_exits = [e for e in exits if not holdings or e["code"] not in holdings]

    lines.append("<b>[ 청산 후보 (보유 종목 · RSI-2 과매수) ]</b>")
    if held_exits:
        for e in held_exits:
            lines.append(f"⬇ {e['name']}({e['code']})  RSI-2={e['rsi2']}  → 매도 검토")
    else:
        lines.append("─ 없음")
    lines.append("")

    if other_exits:
        names = ", ".join(e["name"] for e in other_exits[:5])
        lines.append(f"<i>ℹ 미보유 RSI≥{PARAMS['rsi2Exit']} (참고): {names}</i>")
        lines.append("")

    # KPI
    kpi = kpi_map.get("5년", KPI_FALLBACK["5년"])
    lines.append("<b>[ 5년 누적 KPI ]</b>")
    lines.append(f"+{kpi['totalRet']}%  연환산 +{kpi['annRet']}%  MDD {kpi['mdd']}%")
    lines.append("")

    p = PARAMS
    lines.append(
        f"⚙️ <code>nSlots={p['nSlots']}  mlThresh={p['mlThresh']}  "
        f"청산≥{p['rsi2Exit']}  HS={p['hardStop']}%  TS={p['trailing']}%</code>"
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
    print(f"[{today.isoformat()}] SmartSwing-NH XGBoost v2 실행")

    force = bool(os.environ.get("FORCE_RUN"))
    if not is_trading_day(today) and not force:
        print("주말 — 건너뜀")
        return

    print("🔥 Firebase 로드 중...")
    global PARAMS
    PARAMS   = load_params_from_firebase()
    kpi_data = load_kpi_from_firebase()
    holdings = load_holdings_from_firebase()

    t_total  = time.time()
    signals, exits, signal_date, prices, is_fallback, scores = get_real_signals(today)
    print(f"\n⏱ 총 소요: {time.time()-t_total:.0f}초")

    msg = build_message(today, signals, exits, signal_date,
                        kpi_data, is_fallback, holdings, scores)
    print("─── 전송 메시지 ───")
    print(msg)
    print("──────────────────")

    result = send_telegram(msg)
    if result.get("ok"):
        print(f"✅ 전송 성공  (매수 {len(signals)}개, 청산후보 {len(exits)}개)")
    else:
        print(f"❌ 전송 실패: {result}")

    today_str = today.strftime("%Y%m%d")
    save_to_firebase(today_str, signals, exits, signal_date, prices, is_fallback, scores)
    check_pat_expiry_alert(today)


if __name__ == "__main__":
    main()

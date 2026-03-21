# UDB 스키마 — GDB 완전 호환

## 원칙
- GDB(동결): `/src/backtest.js` — 2021-01 ~ 2026-03, 절대 수정 금지
- UDB(누적): Firebase Firestore `/udb/{yy-mm}` — 2026-04부터 매월 추가
- runBacktest는 `GDB데이터 + UDB데이터`를 배열로 단순 합산해서 실행

---

## Firebase 문서 경로

```
/udb/26-04   ← 2026년 4월
/udb/26-05   ← 2026년 5월
...
```

---

## 문서 구조 (GDB의 ALL_MONTHLY + STOCK_ATR와 100% 동일)

```json
{
  "date":  "26-04",
  "label": "2026-04",
  "m":     "4월",
  "year":  2026,
  "month": 4,
  "r":     2.31,          // KOSPI200 월간 수익률 (%)

  "stocks": {
    "005930": { "close": 78400, "atr_pct": 2.1 },
    "000660": { "close": 198000, "atr_pct": 3.4 },
    "373220": { "close": 412000, "atr_pct": 4.2 },
    "006400": { "close": 295000, "atr_pct": 3.8 },
    "005380": { "close": 221000, "atr_pct": 2.9 },
    "000270": { "close": 108500, "atr_pct": 2.6 },
    "005490": { "close": 387000, "atr_pct": 3.1 },
    "035420": { "close": 209000, "atr_pct": 2.8 },
    "035720": { "close": 47200,  "atr_pct": 3.5 },
    "207940": { "close": 785000, "atr_pct": 2.4 },
    "105560": { "close": 92100,  "atr_pct": 2.2 },
    "055550": { "close": 58700,  "atr_pct": 2.0 }
  }
}
```

---

## GDB의 STOCK_ATR 대응 관계

```javascript
// GDB (backtest.js)
export const STOCK_ATR = {
  "005930": [2.1, 2.3, ...],   // 62개월 배열
  "000660": [3.4, 3.1, ...],
  ...
};

// UDB → 매월 atr_pct 1개씩 append되는 구조
// runBacktest 실행 시: GDB배열 + UDB월별 atr_pct 이어붙이기
```

---

## update_udb.py 수집 항목 (pykrx 기준)

```python
from pykrx import stock

# 당일 종가
close = stock.get_market_ohlcv_by_date("20260430", "20260430", code)["종가"]

# ATR = 최근 14일 True Range 평균 / 종가 × 100
# (고가-저가, |고가-전일종가|, |저가-전일종가| 중 최대값 평균)
atr_pct = calc_atr_pct(code, date)

# KOSPI200 월간 수익률
kospi = stock.get_index_ohlcv_by_date("20260401", "20260430", "1028")
r = (kospi["종가"][-1] / kospi["종가"][0] - 1) * 100
```

---

## 월말 자동 업데이트 흐름

```
매월 마지막 거래일 15:40 (별도 cron)
  → pykrx로 월간 데이터 수집
  → Firebase /udb/{yy-mm} 저장
  → 다음달부터 runBacktest가 자동으로 포함
```

---

## backtest.js 연동 방식 (장기 계획)

```javascript
// 현재: GDB만 사용
const data = ALL_MONTHLY;  // 62개월

// 목표: GDB + UDB 합산
const udbData = await fetchFirebase("/udb");  // 월별 fetch
const data = [...ALL_MONTHLY, ...udbData];    // seamless 합산
```

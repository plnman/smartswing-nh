// ════════════════════════════════════════════════════════════════════════
// TabBacktest — 백테스팅 탭 (SmartSwing_Dashboard_v3 Tab1 완전 이식)
// GDB 동결 데이터 기반. backtest.js에서 모든 데이터/엔진 임포트.
// UDB(Firebase) 신규 월 데이터 자동 merge 지원.
// ════════════════════════════════════════════════════════════════════════
import React, { useState, useEffect, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea,
} from "recharts";
import {
  EQUITY_CURVE_RAW, ALL_MONTHLY, DEFAULT_PARAMS,
  KPI_BY_PERIOD,
  BASE_CAPITAL, CAPITAL_PER_SLOT, TRADE_COST_PCT,
  krw, STOCK_POOL,
  rc, heatColor, runBacktest,
  buildLiveMonthly, buildLiveEquityCurve, buildLiveStockATR,
  computeKPIByPeriod, computeYearlyStats, runBacktestLive,
} from "../backtest.js";
import { db, COL } from "../firebase.js";
import { collection, getDocs, doc, setDoc } from "firebase/firestore";

// ── 차트 커스텀 툴팁
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 border border-slate-600 rounded-xl p-3 shadow-xl text-xs min-w-[180px]">
      <p className="text-slate-400 font-semibold mb-2 border-b border-slate-700 pb-1">📅 {label}</p>
      {payload.map(p => {
        const chg = +(p.value - 100).toFixed(1);
        return (
          <div key={p.name} className="flex justify-between gap-3 mb-1">
            <span style={{ color: p.color }} className="font-medium">{p.name}</span>
            <span className="font-bold" style={{ color: p.color }}>
              {p.value?.toFixed(1)}&nbsp;
              <span className={chg >= 0 ? "text-emerald-300" : "text-red-300"}>
                ({chg >= 0 ? "+" : ""}{chg}%)
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
};

// ── AI 파라미터 변경 파서
function parseAIChanges(changesStr) {
  const result = {};
  changesStr.split(", ").forEach(part => {
    const colonIdx = part.indexOf(":");
    if (colonIdx < 0) return;
    const name = part.slice(0, colonIdx).trim().replace("%","").replace("일","");
    const vals = part.slice(colonIdx + 1).split("→");
    if (vals.length < 2) return;
    const fromVal = parseFloat(vals[0]);
    const toVal   = parseFloat(vals[1]);
    if (isNaN(toVal)) return;
    if (name === "ADX")                              result.adx        = toVal;
    else if (name === "RSI-2" && fromVal < 50)       result.rsi2Entry  = toVal;
    else if (name === "RSI-2" && fromVal >= 50)      result.rsi2Exit   = toVal;
    else if (name === "Z-Score")                     result.zscore     = toVal;
    else if (name === "Time-Cut")                    result.timeCut    = toVal;
    else if (name === "Trailing")                    result.trailing   = toVal;
  });
  return result;
}

// ── AI 전략 제안 컴포넌트
function AISuggestions({ period, kpi, params, setParams, stratTotalRet = 0, stratMdd = 0, stratWr = 0 }) {
  const [applied, setApplied] = useState(null);
  const [beforeSnap, setBeforeSnap] = useState(null);

  // ★ #7: v11.0 기준 (adx:20, rsi2Entry:25, zscore:1.0, trailing:10.0) AI 제안 갱신
  const sug = [
    { id:1, changes:"ADX:20→15, RSI-2:25→30",             score:0.87, comment:"추세/과매도 필터 완화 → 진입 기회↑" },
    { id:2, changes:"Z-Score:1.0→1.3, Trailing:10.0→8.0", score:0.82, comment:"변동성 상향 + TrailingStop 강화 → MDD↓" },
    { id:3, changes:"ADX:20→25, RSI-2:25→20",              score:0.79, comment:"추세 필터 강화 + 과매도 엄격화 → 승률↑" },
  ];

  const sugResults = useMemo(() =>
    sug.map(s => {
      const sp = { ...params, ...parseAIChanges(s.changes) };
      const { curve, tradeLog } = runBacktest(period, sp);
      const fin = curve.length > 0 ? curve[curve.length - 1].strategy : 100;
      const nM  = Math.max(curve.length - 1, 1);
      const ret = +(fin - 100).toFixed(1);
      const ann = nM >= 10 ? +((Math.pow(fin / 100, 12 / nM) - 1) * 100).toFixed(1) : ret;
      let peak = -Infinity, maxDD = 0;
      for (const pt of curve) {
        if (pt.strategy > peak) peak = pt.strategy;
        const dd = (pt.strategy - peak) / peak * 100;
        if (dd < maxDD) maxDD = dd;
      }
      const mdd = +maxDD.toFixed(1);
      const wr  = tradeLog.length > 0
        ? +(tradeLog.filter(t => t.ret > 0).length / tradeLog.length * 100).toFixed(1) : 0;
      return { id: s.id, ret, ann, mdd, wr, trades: tradeLog.length };
    }),
  [period, params]); // eslint-disable-line

  const handleApply = (s) => {
    if (!setParams) return;
    setBeforeSnap({ ret: stratTotalRet, mdd: stratMdd, wr: stratWr });
    setParams(prev => ({ ...prev, ...parseAIChanges(s.changes) }));
    setApplied(s.id);
  };

  const diff = (next, cur, invert = false) => {
    const d = +(next - cur).toFixed(1);
    if (d === 0) return <span className="text-slate-500">±0</span>;
    const pos = invert ? d < 0 : d > 0;
    return <span className={pos ? "text-emerald-400" : "text-red-400"}>{d > 0 ? "+" : ""}{d}</span>;
  };

  return (
    <div className="bg-slate-800 rounded-xl p-4 border border-indigo-800">
      <div className="flex items-center gap-2 mb-3">
        <span>💡</span>
        <p className="text-sm font-semibold text-indigo-300">AI 전략 제안 (Optuna TPE 30 trials)</p>
        <span className="text-[10px] text-slate-500 ml-1">— 아래 수치는 실제 백테스팅 시뮬 결과</span>
        <span className="ml-auto text-[10px] text-slate-500 bg-slate-700 px-2 py-0.5 rounded">
          현재: 누적 {stratTotalRet >= 0 ? "+" : ""}{stratTotalRet}% / MDD {stratMdd}% / 승률 {stratWr}%
        </span>
      </div>

      {applied !== null && beforeSnap && (() => {
        const sr = sugResults.find(r => r.id === applied);
        if (!sr) return null;
        return (
          <div className="mb-3 px-3 py-2 bg-emerald-900/30 border border-emerald-700 rounded-xl text-xs flex items-center gap-4 flex-wrap">
            <span className="text-emerald-400 font-semibold">✅ 제안 {applied} 적용됨</span>
            <span className="text-slate-400">
              누적 <span className="text-slate-300 font-bold">{beforeSnap.ret >= 0 ? "+" : ""}{beforeSnap.ret}%</span>
              {" → "}
              <span className="text-emerald-300 font-bold">{sr.ret >= 0 ? "+" : ""}{sr.ret}%</span>
              {" "}{diff(sr.ret, beforeSnap.ret)}pp
            </span>
            <span className="text-slate-400">
              MDD <span className="text-slate-300 font-bold">{beforeSnap.mdd}%</span>
              {" → "}
              <span className="font-bold">{sr.mdd}%</span>
              {" "}{diff(sr.mdd, beforeSnap.mdd, true)}pp
            </span>
            <span className="text-slate-400">
              승률 <span className="text-slate-300 font-bold">{beforeSnap.wr}%</span>
              {" → "}
              <span className="font-bold">{sr.wr}%</span>
              {" "}{diff(sr.wr, beforeSnap.wr)}pp
            </span>
            <button onClick={() => { setApplied(null); setBeforeSnap(null); }}
              className="ml-auto text-[10px] text-slate-500 hover:text-slate-300 bg-slate-700 px-2 py-0.5 rounded">✕</button>
          </div>
        );
      })()}

      <div className="grid grid-cols-3 gap-3">
        {sug.map((s, idx) => {
          const sr = sugResults[idx];
          const isApplied = applied === s.id;
          return (
            <div key={s.id} className={`bg-slate-900 rounded-xl p-3 border transition-all ${isApplied ? "border-emerald-500 shadow-lg shadow-emerald-900/30" : "border-slate-700 hover:border-indigo-600"}`}>
              <div className="flex justify-between mb-2">
                <span className={`text-xs font-bold ${isApplied ? "text-emerald-400" : "text-indigo-300"}`}>
                  {isApplied ? "✅ 적용중" : `제안 ${s.id}`}
                </span>
                <span className="text-[10px] bg-indigo-900 text-indigo-300 px-1.5 py-0.5 rounded">score {s.score}</span>
              </div>
              <p className="text-[11px] text-slate-300 mb-2 font-mono leading-relaxed">{s.changes}</p>
              <div className="bg-slate-800 rounded-lg p-2 mb-2 space-y-1 text-[10px]">
                <div className="flex justify-between">
                  <span className="text-slate-500">누적수익</span>
                  <span>
                    <span className={`font-bold ${sr.ret >= 0 ? "text-emerald-400" : "text-red-400"}`}>{sr.ret >= 0 ? "+" : ""}{sr.ret}%</span>
                    <span className="text-slate-600 ml-1">({diff(sr.ret, stratTotalRet)}pp)</span>
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">MDD</span>
                  <span>
                    <span className="font-bold text-red-400">{sr.mdd}%</span>
                    <span className="text-slate-600 ml-1">({diff(sr.mdd, stratMdd, true)}pp)</span>
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">승률</span>
                  <span>
                    <span className="font-bold text-blue-400">{sr.wr}%</span>
                    <span className="text-slate-600 ml-1">({diff(sr.wr, stratWr)}pp)</span>
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">거래건수</span>
                  <span className="font-bold text-slate-300">{sr.trades}건</span>
                </div>
              </div>
              <p className="text-[10px] text-slate-500 mb-2">💬 {s.comment}</p>
              <button onClick={() => handleApply(s)}
                className={`w-full py-1.5 rounded text-[11px] font-semibold transition-all ${isApplied ? "bg-emerald-800 text-emerald-200 cursor-default" : "bg-indigo-700 hover:bg-indigo-600 text-white"}`}>
                {isApplied ? "✅ 현재 적용중" : "▶ 이 파라미터로 적용"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 메인 백테스팅 탭
export default function TabBacktest({ params, setParams, period, setPeriod, customRange, setCustomRange }) {
  const [running, setRunning]   = useState(false);
  const [selectedTrade, setSelectedTrade] = useState(null);
  const [expandedCode, setExpandedCode]   = useState(null);

  // ── UDB Live 데이터 (Firebase에서 GDB 이후 신규 월 로드)
  const [liveData, setLiveData] = useState(null);

  useEffect(() => {
    getDocs(collection(db, COL.UDB)).then(snap => {
      const udbDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const liveMonthly  = buildLiveMonthly(udbDocs);
      const liveCurve    = buildLiveEquityCurve(udbDocs);
      const liveStockAtr = buildLiveStockATR(udbDocs);
      const newData = { allMonthly: liveMonthly, equityCurve: liveCurve, stockAtr: liveStockAtr };
      setLiveData(newData);

      // 전략 KPI 계산 후 Firebase /config/kpi 에 저장 (Telegram 알림용)
      try {
        const { curve: kpiCurve, tradeLog: kpiTrades } = runBacktestLive("5년", DEFAULT_PARAMS, null, newData);
        const fin5y = kpiCurve.length > 0 ? kpiCurve[kpiCurve.length - 1].strategy : 100;
        const n5y   = Math.max(kpiCurve.length - 1, 1);
        const ret5y = +(fin5y - 100).toFixed(1);
        const ann5y = n5y >= 10 ? +((Math.pow(fin5y / 100, 12 / n5y) - 1) * 100).toFixed(1) : ret5y;
        let pk5 = -Infinity, mdd5 = 0;
        kpiCurve.forEach(p => {
          if (p.strategy > pk5) pk5 = p.strategy;
          const dd = (p.strategy - pk5) / pk5 * 100;
          if (dd < mdd5) mdd5 = dd;
        });
        const wr5y = kpiTrades.length > 0
          ? +(kpiTrades.filter(t => t.ret > 0).length / kpiTrades.length * 100).toFixed(1) : 0;

        const { curve: kpiCurve3, tradeLog: kpiTrades3 } = runBacktestLive("3년", DEFAULT_PARAMS, null, newData);
        const fin3y = kpiCurve3.length > 0 ? kpiCurve3[kpiCurve3.length - 1].strategy : 100;
        const n3y   = Math.max(kpiCurve3.length - 1, 1);
        const ret3y = +(fin3y - 100).toFixed(1);
        const ann3y = n3y >= 10 ? +((Math.pow(fin3y / 100, 12 / n3y) - 1) * 100).toFixed(1) : ret3y;

        const { curve: kpiCurve1, tradeLog: kpiTrades1 } = runBacktestLive("1년", DEFAULT_PARAMS, null, newData);
        const fin1y = kpiCurve1.length > 0 ? kpiCurve1[kpiCurve1.length - 1].strategy : 100;
        const ret1y = +(fin1y - 100).toFixed(1);

        setDoc(doc(db, "config", "kpi"), {
          "1년": { totalRet: ret1y, annRet: ret1y, mdd: 0 },
          "3년": { totalRet: ret3y, annRet: ann3y, mdd: 0 },
          "5년": { totalRet: ret5y, annRet: ann5y, mdd: +mdd5.toFixed(1), wr: wr5y },
          updatedAt: new Date().toISOString(),
          source: "TabBacktest",
        }).catch(() => {}); // config write 실패 시 무시
      } catch (e) {
        console.warn("KPI Firebase 저장 실패:", e);
      }
    }).catch(e => {
      console.warn("UDB 로드 실패 (GDB fallback):", e);
    });
  }, []); // eslint-disable-line

  const { curve, monthly, tradeLog } = useMemo(
    () => liveData
      ? runBacktestLive(period, params, customRange, liveData)
      : runBacktest(period, params, customRange),
    [period, params, customRange, liveData]
  );

  // 커스텀 기간: KOSPI200 KPI 동적 계산 (항상 live curve 우선)
  const liveCurve = liveData?.equityCurve ?? EQUITY_CURVE_RAW;
  const liveKPIMap = computeKPIByPeriod(liveCurve);

  const kpi = (() => {
    if (period !== "커스텀") return liveKPIMap[period] ?? liveKPIMap["5년"];
    const raw2 = (customRange?.start && customRange?.end)
      ? (() => {
          const si = liveCurve.findIndex(e => e.d === customRange.start);
          const ei = liveCurve.findIndex(e => e.d === customRange.end);
          return (si >= 0 && ei >= si) ? liveCurve.slice(si, ei + 1) : liveCurve;
        })()
      : liveCurve;
    const kospiRet = +((raw2[raw2.length-1].k / raw2[0].k - 1) * 100).toFixed(1);
    let pk = -Infinity, md = 0;
    raw2.forEach(p => { if (p.k > pk) pk = p.k; const dd = (p.k - pk) / pk * 100; if (dd < md) md = dd; });
    const kospiAnn = raw2.length >= 10
      ? +((Math.pow(raw2[raw2.length-1].k / raw2[0].k, 12 / (raw2.length - 1)) - 1) * 100).toFixed(1) : kospiRet;
    return { totalRet: kospiRet, annRet: kospiAnn, mdd: +md.toFixed(1), vol: 0, sharpe: 0,
             start: customRange?.start || "", end: customRange?.end || "", months: raw2.length };
  })();

  useEffect(() => { setSelectedTrade(null); setExpandedCode(null); }, [period, params]);

  const finalStrat    = curve.length > 0 ? curve[curve.length - 1].strategy : 100;
  const stratTotalRet = +(finalStrat - 100).toFixed(1);
  const nMonths       = Math.max(curve.length - 1, 1);
  const stratAnnRet   = nMonths >= 10
    ? +((Math.pow(finalStrat / 100, 12 / nMonths) - 1) * 100).toFixed(1)
    : stratTotalRet;

  const stratMdd = (() => {
    let peak = -Infinity, maxDD = 0;
    for (const pt of curve) {
      if (pt.strategy > peak) peak = pt.strategy;
      const dd = (pt.strategy - peak) / peak * 100;
      if (dd < maxDD) maxDD = dd;
    }
    return +maxDD.toFixed(1);
  })();

  const worstKospiMonth = monthly.length > 0 ? +Math.min(...monthly.map(m => m.r)).toFixed(1) : 0;
  const dnMultLocal = +Math.max(0.12, 0.35 - (3.5 - params.hardStop) * 0.04).toFixed(3);
  const estimatedWorstRisk = worstKospiMonth < 0
    ? +(Math.max(worstKospiMonth * dnMultLocal, -(params.hardStop + 0.3)) - TRADE_COST_PCT).toFixed(1)
    : 0;
  const worstMonth = (() => {
    if (curve.length < 2) return 0;
    let worst = 0;
    for (let i = 1; i < curve.length; i++) {
      const chg = (curve[i].strategy - curve[i-1].strategy) / curve[i-1].strategy * 100;
      if (chg < worst) worst = chg;
    }
    return +worst.toFixed(1);
  })();

  const stratWr = tradeLog.length > 0
    ? +(tradeLog.filter(t => t.ret > 0).length / tradeLog.length * 100).toFixed(1) : 0;

  const tradeAnnotations = useMemo(() => {
    const map = {};
    const filtered = expandedCode ? tradeLog.filter(t => t.code === expandedCode) : tradeLog;
    filtered.forEach(t => {
      const em = t.entry.slice(0, 5);
      const xm = t.exit.slice(0, 5);
      if (!map[em]) map[em] = { entries: [], exits: [] };
      if (!map[xm]) map[xm] = { entries: [], exits: [] };
      map[em].entries.push(t);
      if (em !== xm) map[xm].exits.push(t);
      else map[em].exits.push(t);
    });
    return map;
  }, [tradeLog, expandedCode]);

  const stratShrp = (() => {
    if (curve.length < 3) return 0;
    const rets = curve.slice(1).map((pt, i) =>
      (pt.strategy - curve[i].strategy) / curve[i].strategy * 100);
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const std  = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length);
    return std > 0 ? +((mean / std) * Math.sqrt(12)).toFixed(2) : 0;
  })();

  // ── V3 Python 엔진 기준 KPI (상단 카드 표시용 — GDB 시뮬 아님)
  const v3Kpi = (() => {
    if (period !== "커스텀" && KPI_BY_PERIOD[period]) return KPI_BY_PERIOD[period];
    // 커스텀 기간: EVOLUTION_DATA v3 슬라이스로 계산
    if (period === "커스텀" && customRange?.start && customRange?.end) {
      const cs = customRange.start.slice(0, 5);
      const ce = customRange.end.slice(0, 5);
      const sl = EVOLUTION_DATA.filter(d => d.date >= cs && d.date <= ce);
      if (sl.length >= 2) {
        const v3Ret = +((sl[sl.length - 1].v3 / sl[0].v3 - 1) * 100).toFixed(1);
        let pk = -Infinity, maxDD = 0;
        sl.forEach(d => { if (d.v3 > pk) pk = d.v3; const dd = (d.v3 - pk) / pk * 100; if (dd < maxDD) maxDD = dd; });
        const nM = sl.length - 1;
        const ann = nM >= 10 ? +((Math.pow(sl[sl.length - 1].v3 / sl[0].v3, 12 / nM) - 1) * 100).toFixed(1) : v3Ret;
        return { totalRet: v3Ret, annRet: ann, mdd: +maxDD.toFixed(1), sharpe: stratShrp, vol: 0 };
      }
    }
    return { totalRet: stratTotalRet, annRet: stratAnnRet, mdd: stratMdd, sharpe: stratShrp };
  })();

  const finalCapital    = Math.round(BASE_CAPITAL * (1 + v3Kpi.totalRet / 100));
  const profitCapital   = finalCapital - BASE_CAPITAL;
  const tradeTotalPnl   = tradeLog.reduce((s, t) => s + t.pnl, 0);

  const kpiCards = [
    { label:"전략 누적 수익률 (V3)",  val:`+${v3Kpi.totalRet}%`,
      sub:`연환산 +${v3Kpi.annRet}% | KOSPI200 +${kpi.totalRet}% (${kpi.start}~${kpi.end})`,
      ok: v3Kpi.totalRet > kpi.totalRet,
      capital: `원금 5천만 → ${krw(profitCapital)} (최종 ${(finalCapital/10000).toFixed(0)}만원)` },
    { label:"최대 낙폭 MDD",          val:`${v3Kpi.mdd}%`,
      sub:(() => {
        const km = Math.abs(kpi.mdd || 0);
        if (km === 0) return `KOSPI MDD 계산중 / V3 MDD ${v3Kpi.mdd}%`;
        const defStr = Math.abs(v3Kpi.mdd) < km
          ? Math.round((1 - Math.abs(v3Kpi.mdd) / km) * 100) + "% 축소"
          : Math.round((Math.abs(v3Kpi.mdd) / km - 1) * 100) + "% 확대";
        return `KOSPI MDD ${kpi.mdd}% / 전략 ${defStr}`;
      })(),
      ok: Math.abs(v3Kpi.mdd) <= Math.abs(kpi.mdd || 999) + 15,
      capital: `원금 5천만 기준 최대손실 ${krw(Math.round(BASE_CAPITAL * v3Kpi.mdd / 100))}` },
    { label:"승률 Win Rate",           val:`${stratWr}%`,
      sub:`${tradeLog.length}건 거래 (5슬롯 기준) / 목표 ≥ 60%`, ok: stratWr >= 60,
      capital: `수익거래 합산 ${krw(tradeLog.filter(t=>t.ret>0).reduce((s,t)=>s+t.pnl,0))}` },
    { label:"누적 손익 (단순)",        val:`${krw(tradeTotalPnl)}`,
      sub:`5슬롯 재투자기준 ${krw(profitCapital)} / 거래별 1천만원 기준`, ok: tradeTotalPnl > 0,
      capital: `거래 ${tradeLog.length}건 단순합산` },
    { label:"샤프 지수",               val:`${v3Kpi.sharpe || stratShrp}`,
      sub:`KOSPI200 샤프 ${kpi.sharpe || "N/A"} (${period}) 대비`, ok: (v3Kpi.sharpe || stratShrp) >= 1.0 },
  ];

  const periodBadge = () => {
    const fmt = (yymm) => {
      if (!yymm) return "";
      const [yy, mm] = yymm.split("-");
      return `20${yy}년 ${parseInt(mm, 10)}월`;
    };
    if (period === "커스텀") return `${fmt(customRange?.start)} ~ ${fmt(customRange?.end)}`;
    return `${fmt(kpi?.start)} ~ ${fmt(kpi?.end)}`;
  };

  const run = () => { setRunning(true); setTimeout(() => setRunning(false), 1800); };
  const heatDisplay = monthly;

  const { tradeStatsByCode, distinctStocks } = useMemo(() => {
    const map = {};
    const order = [];
    tradeLog.forEach(t => {
      if (!map[t.code]) {
        map[t.code] = { name: t.name, count: 0, firstEntry: t.entry, lastExit: t.exit, trades: [], totalPnl: 0, winCount: 0 };
        order.push(t.code);
      }
      const s = map[t.code];
      s.count   += 1;
      s.trades.push(t);
      s.totalPnl += t.pnl;
      if (t.ret > 0) s.winCount += 1;
      if (t.entry < s.firstEntry) s.firstEntry = t.entry;
      if (t.exit  > s.lastExit)   s.lastExit   = t.exit;
    });
    return { tradeStatsByCode: map, distinctStocks: order };
  }, [tradeLog]);

  const periodEndMm = period === "커스텀" ? (customRange?.end ?? "") : (KPI_BY_PERIOD[period]?.end ?? "");

  return (
    <div className="space-y-5">

      {/* 기간 선택 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {["1년","3년","5년","커스텀"].map(p => (
            <button key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-all ${
                period === p ? "bg-indigo-600 text-white shadow-lg shadow-indigo-900/40"
                             : "bg-slate-700 text-slate-300 hover:bg-slate-600"}`}>{p}</button>
          ))}
        </div>
        {period === "커스텀" && (
          <div className="flex items-center gap-2 bg-slate-800 border border-indigo-700/50 rounded-lg px-3 py-1.5">
            <span className="text-[11px] text-slate-400">시작</span>
            <select value={customRange?.start || "21-03"}
              onChange={e => setCustomRange(r => ({ ...r, start: e.target.value }))}
              className="bg-slate-700 text-indigo-200 text-xs rounded px-1.5 py-0.5 border border-slate-600">
              {EQUITY_CURVE_RAW.slice(0, -1).map(pt => (
                <option key={pt.d} value={pt.d}>{pt.d}</option>
              ))}
            </select>
            <span className="text-slate-500">~</span>
            <span className="text-[11px] text-slate-400">종료</span>
            <select value={customRange?.end || "26-03"}
              onChange={e => setCustomRange(r => ({ ...r, end: e.target.value }))}
              className="bg-slate-700 text-indigo-200 text-xs rounded px-1.5 py-0.5 border border-slate-600">
              {EQUITY_CURVE_RAW.slice(1).map(pt => (
                <option key={pt.d} value={pt.d}>{pt.d}</option>
              ))}
            </select>
          </div>
        )}
        <span className="text-[11px] text-indigo-300 bg-indigo-900/40 px-3 py-1 rounded-full">
          📡 {periodBadge()} · KOSPI200 실데이터
        </span>
        <div className="ml-auto flex items-center gap-3">
          <button onClick={run} disabled={running}
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white text-sm font-semibold rounded flex items-center gap-2">
            {running
              ? <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><circle cx="12" cy="12" r="10" strokeOpacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>실행 중…</>
              : "▶ 백테스팅 실행"}
          </button>
        </div>
      </div>

      {/* KPI 카드 5개 */}
      <div className="grid grid-cols-5 gap-3">
        {kpiCards.map(k => (
          <div key={k.label} className="bg-slate-800 rounded-xl p-4 border border-slate-700 hover:border-indigo-700 transition-colors">
            <p className="text-[11px] text-slate-400 mb-1">{k.label}</p>
            <p className={`text-2xl font-bold ${k.ok ? "text-emerald-400" : "text-red-400"}`}>{k.val}</p>
            <p className="text-[10px] text-slate-500 mt-1">{k.sub}</p>
            {k.capital && (
              <p className="text-[9px] text-indigo-400 mt-1 border-t border-slate-700 pt-1">
                💰 {k.capital}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* AI 전략 제안 */}
      <AISuggestions period={period} kpi={kpi} params={params} setParams={setParams}
        stratTotalRet={stratTotalRet} stratMdd={stratMdd} stratWr={stratWr} />

      {/* 수익률 비교 차트 */}
      <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            수익률 비교 차트
            <span className="text-[10px] text-slate-400 font-normal">— 기간 시작 기준 base=100 재정규화</span>
            {selectedTrade && curve.some(pt => pt.date === selectedTrade.entry.slice(0,5)) && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-900/60 text-indigo-300 border border-indigo-700">
                📌 {selectedTrade.name} ▲{selectedTrade.entry.slice(0,5)} ▼{selectedTrade.exit.slice(0,5)}
              </span>
            )}
          </p>
          <div className="flex items-center gap-3 text-[10px] text-slate-400 flex-wrap">
            <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-indigo-400 inline-block rounded"/>전략 시뮬</span>
            <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-emerald-400 inline-block rounded"/>B&H</span>
            <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-slate-400 inline-block rounded"/>KOSPI200</span>
            {/* ★ P5: Trailing Stop 미반영 보수적 시뮬 안내 레이블 */}
            <span className="ml-2 px-2 py-0.5 rounded bg-amber-900/40 border border-amber-700/50 text-amber-400 font-medium">
              ⚠ Trailing Stop 미반영 · 보수적 시뮬값
            </span>
          </div>
        </div>
        {/* 기간 요약 행 */}
        <div className="flex gap-3 text-xs mb-3 mt-2 flex-wrap">
          <span className="bg-slate-900 rounded-lg px-3 py-1.5 border border-slate-700">
            <span className="text-slate-500">KOSPI200 누적</span>
            <span className={`font-bold ml-1 ${rc(kpi.totalRet)}`}>{kpi.totalRet > 0 ? "+" : ""}{kpi.totalRet}%</span>
          </span>
          <span className="bg-slate-900 rounded-lg px-3 py-1.5 border border-slate-700">
            <span className="text-slate-500">B&H 누적</span>
            <span className={`font-bold ml-1 ${rc(curve.length > 0 ? curve[curve.length-1].buyhold - 100 : 0)}`}>
              {(() => { const v = curve.length > 0 ? +(curve[curve.length-1].buyhold - 100).toFixed(1) : 0; return (v>=0?"+":"")+v+"%"; })()}
            </span>
          </span>
          <span className="bg-indigo-900/40 rounded-lg px-3 py-1.5 border border-indigo-700">
            <span className="text-indigo-300">전략 누적</span>
            <span className={`font-bold ml-1 ${rc(stratTotalRet)}`}>{stratTotalRet >= 0 ? "+" : ""}{stratTotalRet}%</span>
            <span className="text-indigo-400 ml-2 text-[10px]">({krw(profitCapital)})</span>
          </span>
          <span className="bg-emerald-900/20 rounded-lg px-3 py-1.5 border border-emerald-800/50">
            <span className="text-slate-500 text-[10px]">원금 5천만 → 최종</span>
            <span className="font-bold ml-1 text-emerald-300">{(finalCapital/10000).toFixed(0)}만원</span>
          </span>
          <span className="bg-slate-900 rounded-lg px-3 py-1.5 border border-slate-700">
            <span className="text-slate-500">MDD</span>
            <span className="font-bold ml-1 text-red-400">{kpi.mdd}%</span>
          </span>
          <span className="bg-slate-900 rounded-lg px-3 py-1.5 border border-slate-700">
            <span className="text-slate-500">샤프</span>
            <span className={`font-bold ml-1 ${kpi.sharpe >= 1 ? "text-emerald-400" : "text-yellow-400"}`}>{kpi.sharpe}</span>
          </span>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={curve} margin={{ top: 28, right: 16, bottom: 4, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="date" tick={{ fill:"#64748b", fontSize:10 }}
              interval={Math.max(1, Math.floor(curve.length / 10))} />
            <YAxis tick={{ fill:"#64748b", fontSize:10 }} domain={["auto","auto"]} />
            <Tooltip content={<ChartTooltip />} />
            <ReferenceLine y={100} stroke="#334155" strokeDasharray="4 2"
              label={{ value:"기준(100)", fill:"#475569", fontSize:9, position:"insideTopRight" }} />
            {selectedTrade && (() => {
              const em = selectedTrade.entry.slice(0, 5);
              const xm = selectedTrade.exit.slice(0, 5);
              const emOk = curve.some(pt => pt.date === em);
              const xmOk = curve.some(pt => pt.date === xm);
              const same = em === xm;
              if (!emOk) return null;
              return <>
                <ReferenceLine x={em} stroke={same?"#a78bfa":"#34d399"} strokeWidth={3} strokeDasharray="8 3"
                  label={{ value:same?"🔷 진입·청산":("🔷 매수 "+selectedTrade.name), position:"insideTopLeft", fill:same?"#a78bfa":"#34d399", fontSize:9, fontWeight:"bold" }}/>
                {!same && xmOk && <ReferenceLine x={xm} stroke="#f87171" strokeWidth={3} strokeDasharray="8 3"
                  label={{ value:`🔶 매도 ${selectedTrade.ret>=0?"+":""}${selectedTrade.ret}%`, position:"insideTopLeft", fill:"#f87171", fontSize:9, fontWeight:"bold" }}/>}
              </>;
            })()}
            <Line type="monotone" dataKey="strategy" name="SmartSwing" stroke="#818cf8" strokeWidth={2.5}
              dot={(props) => {
                const { cx, cy, payload } = props;
                const ann = tradeAnnotations[payload?.date];
                const isSel = selectedTrade &&
                  (selectedTrade.entry.slice(0,5) === payload?.date ||
                   selectedTrade.exit.slice(0,5)  === payload?.date);
                if (!ann || (ann.entries.length === 0 && ann.exits.length === 0)) {
                  return <circle key={`nd-${payload?.date}`} cx={cx} cy={cy} r={0} fill="none" />;
                }
                const hasEntry = ann.entries.length > 0;
                const hasExit  = ann.exits.length  > 0;
                const avgRet   = hasExit
                  ? +(ann.exits.reduce((s, t) => s + t.ret, 0) / ann.exits.length).toFixed(1) : null;
                const same     = hasEntry && hasExit;
                return (
                  <g key={`dot-${payload?.date}`}>
                    {hasEntry && (
                      <text x={cx} y={cy - 10} textAnchor="middle"
                        fill={isSel ? "#a78bfa" : "#34d399"}
                        fontSize={same ? 10 : 11} fontWeight="bold">▲</text>
                    )}
                    {hasExit && (
                      <>
                        <text x={cx} y={cy + 14} textAnchor="middle"
                          fill={isSel ? "#a78bfa" : (avgRet >= 0 ? "#f87171" : "#fb923c")}
                          fontSize={same ? 10 : 11} fontWeight="bold">▼</text>
                        {avgRet !== null && (
                          <text x={cx} y={cy + 24} textAnchor="middle"
                            fill={avgRet >= 0 ? "#34d399" : "#f87171"}
                            fontSize={8} fontWeight="bold">
                            {avgRet >= 0 ? "+" : ""}{avgRet}%
                          </text>
                        )}
                      </>
                    )}
                    {isSel && <circle cx={cx} cy={cy} r={5} fill="none" stroke="#a78bfa" strokeWidth={2}/>}
                  </g>
                );
              }}
              activeDot={{ r:5, fill:"#818cf8" }}
            />
            <Line type="monotone" dataKey="buyhold"  name="B&H"      stroke="#34d399" strokeWidth={1.5} strokeDasharray="6 3" dot={false} />
            <Line type="monotone" dataKey="kospi"    name="KOSPI200" stroke="#94a3b8" strokeWidth={2}   dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* 연도별 성과 + 히트맵 — 숨김 처리 (#2 #3) */}
      <div className="grid grid-cols-2 gap-4" style={{ display: "none" }}>
        {/* 연도별 실제 성과 */}
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <div className="flex items-center gap-2 mb-3">
            <p className="text-sm font-semibold text-slate-200">연도별 KOSPI200 실제 성과</p>
            <span className="text-[10px] bg-indigo-900/40 text-indigo-300 px-2 py-0.5 rounded">실데이터</span>
          </div>
          <div className="space-y-1.5 text-xs">
            {Object.entries(computeYearlyStats(liveData?.allMonthly ?? ALL_MONTHLY)).map(([yr, s]) => {
              const barW = Math.min(Math.abs(s.ret) / 100 * 100, 100);
              return (
                <div key={yr} className="flex items-center gap-2 bg-slate-900 rounded-lg px-3 py-2">
                  <span className="text-slate-400 font-mono w-9">{yr}</span>
                  <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${s.ret >= 0 ? "bg-emerald-500" : "bg-red-500"}`}
                      style={{ width: `${barW}%` }} />
                  </div>
                  <span className={`w-14 text-right font-bold ${rc(s.ret)}`}>{s.ret > 0 ? "+" : ""}{s.ret}%</span>
                  <span className="w-14 text-right text-red-400 text-[10px]">{s.mdd}%</span>
                  <span className="w-9 text-right text-slate-500 text-[10px]">σ{s.vol}</span>
                </div>
              );
            })}
            <div className="flex items-center justify-between bg-indigo-900/30 rounded-lg px-3 py-2 border border-indigo-800/50 mt-1">
              <span className="text-indigo-300 font-bold text-xs">선택 기간 ({period})</span>
              <span className="text-emerald-400 font-bold text-xs">{kpi.totalRet > 0 ? "+" : ""}{kpi.totalRet}%</span>
              <span className="text-slate-400 text-xs">연 {kpi.annRet > 0 ? "+" : ""}{kpi.annRet}%</span>
              <span className="text-red-400 text-xs">MDD {kpi.mdd}%</span>
            </div>
          </div>
        </div>

        {/* 월별 히트맵 */}
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <div className="flex items-center gap-2 mb-3">
            <p className="text-sm font-semibold text-slate-200">월별 수익률 히트맵</p>
            <span className="text-[10px] bg-indigo-900/40 text-indigo-300 px-2 py-0.5 rounded">
              KOSPI200 실데이터 · {heatDisplay.length}개월
            </span>
          </div>
          <div className={`grid gap-1 ${
            heatDisplay.length <= 12 ? "grid-cols-4" :
            heatDisplay.length <= 36 ? "grid-cols-6" : "grid-cols-10"
          }`}>
            {heatDisplay.map(m => (
              <div key={m.label}
                className={`rounded-lg p-1.5 text-center cursor-default hover:scale-105 transition-transform ${heatColor(m.r)}`}>
                <div className="text-[8px] opacity-60">{m.label.slice(2)}</div>
                <div className={`font-bold ${heatDisplay.length > 24 ? "text-[9px]" : "text-xs"}`}>
                  {m.r > 0 ? "+" : ""}{m.r}%
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 mt-3 text-[10px] text-slate-500 items-center">
            <span className="w-3 h-3 rounded bg-red-700 inline-block"/>&lt;-5%
            <span className="w-3 h-3 rounded bg-red-400 inline-block ml-1"/>-5~0%
            <span className="w-3 h-3 rounded bg-emerald-400 inline-block ml-1"/>0~5%
            <span className="w-3 h-3 rounded bg-emerald-600 inline-block ml-1"/>5~15%
            <span className="w-3 h-3 rounded bg-emerald-800 inline-block ml-1"/>&gt;15%
          </div>
        </div>
      </div>

      {/* 거래 테이블 */}
      <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <p className="text-sm font-semibold text-slate-200">거래 기록</p>
          <span className="text-[10px] bg-indigo-900/50 text-indigo-300 border border-indigo-700 px-2 py-0.5 rounded font-semibold">
            총 {tradeLog.length}건 · {period} 기준
          </span>
          <span className="text-[10px] text-slate-500 bg-slate-700 px-2 py-0.5 rounded">종목 클릭 시 상세 보기</span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${tradeTotalPnl >= 0 ? "bg-emerald-900/30 text-emerald-300 border-emerald-800" : "bg-red-900/30 text-red-300 border-red-800"}`}>
            단순합산 {krw(tradeTotalPnl)}
            <span className="text-[9px] font-normal ml-1 opacity-70">(1천만/건)</span>
          </span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${profitCapital >= 0 ? "bg-indigo-900/30 text-indigo-300 border-indigo-800" : "bg-red-900/30 text-red-300 border-red-800"}`}>
            재투자 {krw(profitCapital)}
            <span className="text-[9px] font-normal ml-1 opacity-70">(5슬롯 기준)</span>
          </span>
          {selectedTrade && (
            <button onClick={() => setSelectedTrade(null)} className="ml-auto text-[10px] text-slate-400 hover:text-slate-200 px-2 py-0.5 rounded bg-slate-700">✕ 닫기</button>
          )}
        </div>
        <div className="overflow-y-auto" style={{ maxHeight:"300px" }}>
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-800 z-10">
              <tr className="text-slate-500 border-b border-slate-700">
                <th className="pb-2 text-center w-7">#</th>
                <th className="pb-2 text-left">종목</th>
                <th className="pb-2 text-center">거래</th>
                <th className="pb-2 text-center">최초 매수일</th>
                <th className="pb-2 text-center">최종 매도일</th>
                <th className="pb-2 text-right">누적수익</th>
                <th className="pb-2 text-right">
                  <span className="flex flex-col items-end leading-tight">
                    <span>손익합산</span>
                    <span className="text-[9px] text-slate-600">(1천만 기준)</span>
                  </span>
                </th>
                <th className="pb-2 text-center w-6"></th>
              </tr>
            </thead>
            <tbody>
              {distinctStocks.map((code, idx) => {
                const st = tradeStatsByCode[code];
                if (!st) return null;
                const isHolding  = periodEndMm !== "" && st.lastExit.slice(0,5) >= periodEndMm;
                const isExpanded = expandedCode === code;
                const compRet = +(st.trades.reduce((acc, t) => acc * (1 + t.ret / 100), 1) * 100 - 100).toFixed(1);
                return (
                  <React.Fragment key={code}>
                    <tr
                      onClick={() => setExpandedCode(isExpanded ? null : code)}
                      className={`border-b border-slate-700/50 cursor-pointer transition-all ${
                        isExpanded ? "bg-indigo-950/40 border-indigo-800" : "hover:bg-slate-700/30"
                      }`}>
                      <td className="py-2.5 text-center text-slate-600 font-mono text-[10px]">{idx + 1}</td>
                      <td className="py-2.5">
                        <span className="font-semibold text-slate-200">{st.name}</span>
                        <span className="text-slate-500 font-normal ml-1 text-[10px]">{code}</span>
                      </td>
                      <td className="py-2.5 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          st.count >= 3 ? "bg-indigo-900 text-indigo-300" : "bg-slate-700 text-slate-300"
                        }`}>{st.count}건</span>
                        <span className="block text-[9px] text-slate-500 mt-0.5">{st.winCount}승/{st.count - st.winCount}패</span>
                      </td>
                      <td className="py-2.5 text-center">
                        <span className="text-emerald-400 font-mono">▲ {st.firstEntry}</span>
                      </td>
                      <td className="py-2.5 text-center">
                        {isHolding
                          ? <span className="text-yellow-400 font-semibold animate-pulse">🔴 보유중</span>
                          : <span className="text-red-400 font-mono">▼ {st.lastExit}</span>
                        }
                      </td>
                      <td className={`py-2.5 text-right font-bold ${rc(compRet)}`}>
                        {compRet >= 0 ? "+" : ""}{compRet}%
                      </td>
                      <td className={`py-2.5 text-right ${rc(st.totalPnl)}`}>
                        <span className="font-bold">{krw(st.totalPnl)}</span>
                      </td>
                      <td className="py-2.5 text-center text-slate-500 text-[11px]">
                        {isExpanded ? "▲" : "▼"}
                      </td>
                    </tr>

                    {isExpanded && st.trades.map((t, ti) => (
                      <tr key={`sub-${t.id}`}
                        onClick={() => setSelectedTrade(selectedTrade?.id === t.id ? null : t)}
                        className={`border-b border-slate-700/30 cursor-pointer transition-all ${
                          selectedTrade?.id === t.id ? "bg-indigo-900/20" : "bg-slate-900/50 hover:bg-slate-700/20"
                        }`}>
                        <td className="py-1.5 text-center text-slate-700 text-[9px]">└</td>
                        <td className="py-1.5 text-slate-400 text-[10px] pl-2">
                          거래 {ti + 1}{t.slot !== undefined && <span className="ml-1 text-slate-600 text-[9px]">S{t.slot+1}</span>}
                        </td>
                        <td className="py-1.5 text-center">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] ${
                            t.reason.includes("Stop")||t.reason.includes("갭")
                              ? "bg-red-900/50 text-red-400"
                              : "bg-emerald-900/50 text-emerald-400"
                          }`}>{t.reason}</span>
                        </td>
                        <td className="py-1.5 text-center text-emerald-500 font-mono text-[10px]">▲ {t.entry}</td>
                        <td className="py-1.5 text-center text-red-400 font-mono text-[10px]">▼ {t.exit}</td>
                        <td className={`py-1.5 text-right font-bold text-[10px] ${rc(t.ret)}`}>
                          {t.ret >= 0 ? "+" : ""}{t.ret}%
                        </td>
                        <td className={`py-1.5 text-right text-[10px] ${rc(t.pnl)}`}>
                          {krw(t.pnl)}
                          <div className="text-[8px] text-slate-600">1천만 기준</div>
                        </td>
                        <td className="py-1.5 text-center">
                          <span className="text-[9px] bg-indigo-900/60 text-indigo-400 px-1.5 py-0.5 rounded">{t.l4}</span>
                        </td>
                      </tr>
                    ))}

                    {isExpanded && selectedTrade && st.trades.some(t => t.id === selectedTrade.id) && (
                      <tr key={`detail-${selectedTrade.id}`}>
                        <td colSpan={8} className="py-0 pb-2">
                          <div className="bg-slate-900 rounded-xl px-4 py-3 border border-indigo-700 mx-2 mt-1 grid grid-cols-4 gap-4 text-xs">
                            <div>
                              <p className="text-slate-500 mb-1 text-[10px] font-semibold uppercase tracking-wider">종목 정보</p>
                              <p className="text-slate-200 font-bold">{selectedTrade.name}</p>
                              <p className="text-slate-400 font-mono">{selectedTrade.code}</p>
                            </div>
                            <div>
                              <p className="text-slate-500 mb-1 text-[10px] font-semibold uppercase tracking-wider">진입/청산</p>
                              <p className="text-emerald-400">▲ {selectedTrade.entry}</p>
                              <p className="text-red-400">▼ {selectedTrade.exit}</p>
                              <p className="text-slate-500 mt-0.5">보유: {(() => {
                                const [ey,em,ed] = selectedTrade.entry.split("-").map(Number);
                                const [xy,xm,xd] = selectedTrade.exit.split("-").map(Number);
                                const d1 = new Date(2000+ey,em-1,ed), d2 = new Date(2000+xy,xm-1,xd);
                                return Math.round((d2-d1)/(1000*60*60*24))+"일";
                              })()}</p>
                            </div>
                            <div>
                              <p className="text-slate-500 mb-1 text-[10px] font-semibold uppercase tracking-wider">손익 분석</p>
                              <p className={`text-xl font-bold ${rc(selectedTrade.ret)}`}>{selectedTrade.ret > 0 ? "+" : ""}{selectedTrade.ret}%</p>
                              <p className={`text-sm font-bold ${rc(selectedTrade.pnl)}`}>{krw(selectedTrade.pnl)}</p>
                              <p className="text-slate-500 text-[10px] mt-0.5">L4 ML 신뢰도: {selectedTrade.l4}</p>
                            </div>
                            <div>
                              <p className="text-slate-500 mb-1 text-[10px] font-semibold uppercase tracking-wider">청산 사유</p>
                              <span className={`px-2 py-1 rounded text-[11px] font-bold ${
                                selectedTrade.reason.includes("Stop")||selectedTrade.reason.includes("갭") ? "bg-red-900 text-red-300" : "bg-emerald-900 text-emerald-300"
                              }`}>{selectedTrade.reason}</span>
                              <p className="text-slate-500 text-[10px] mt-1.5">
                                {selectedTrade.reason.includes("RSI-2") ? "RSI-2가 청산 임계값 도달 → 즉시 전량 매도" :
                                 selectedTrade.reason.includes("Stop") ? "Hard Stop 발동 → 손실 제한 매도" :
                                 selectedTrade.reason.includes("Trailing") ? "Trailing Stop 활성화 → 고점 대비 하락 청산" :
                                 selectedTrade.reason.includes("갭") ? "갭하락 감지 → 장전 조기 청산" : "Time-Cut → 보유기간 만료 청산"}
                              </p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {/* ★ #4: 총 거래횟수 합계 행 */}
              <tr className="border-t-2 border-indigo-700 bg-indigo-950/30">
                <td colSpan={2} className="py-2.5 px-2 text-xs font-bold text-indigo-300">
                  📊 합계 ({distinctStocks.length}개 종목)
                </td>
                <td className="py-2.5 text-center">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-800 text-indigo-200">
                    총 {tradeLog.length}건
                  </span>
                  <span className="block text-[9px] text-slate-500 mt-0.5">
                    {tradeLog.filter(t=>t.ret>0).length}승/{tradeLog.filter(t=>t.ret<=0).length}패
                  </span>
                </td>
                <td className="py-2.5 text-center text-slate-500 text-[10px]">—</td>
                <td className="py-2.5 text-center text-slate-500 text-[10px]">—</td>
                <td className={`py-2.5 text-right font-bold text-xs ${rc(tradeTotalPnl)}`}>
                  {tradeTotalPnl >= 0 ? "+" : ""}{(tradeTotalPnl / BASE_CAPITAL * 100).toFixed(1)}%
                </td>
                <td className={`py-2.5 text-right font-bold text-xs ${rc(tradeTotalPnl)}`}>
                  {krw(tradeTotalPnl)}
                </td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── V3 vs KOSPI200 Alpha Tracking Panel ── */}
      <AlphaTrackingPanel period={period} v3Kpi={v3Kpi} kpi={kpi} customRange={customRange} />

      {/* ── Python 엔진 전체 매매 기록 + 손익 검증 ── */}
      <TradeVerifyPanel />

    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// EvolutionPanel — Phase1(유령) / Phase2(현실) / V3(엣지) 자산곡선 비교
// 투자자가 하락장에서도 시스템을 신뢰할 수 있는 '심리적 닻' 패널
// ════════════════════════════════════════════════════════════════════════
const EVOLUTION_DATA = [{"date":"21-03","kospi":100.0,"p1":107.55,"p2":103.93,"v3":104.29},{"date":"21-04","kospi":101.76,"p1":121.64,"p2":112.59,"v3":112.3},{"date":"21-05","kospi":103.1,"p1":128.92,"p2":116.75,"v3":116.44},{"date":"21-06","kospi":105.73,"p1":169.02,"p2":133.52,"v3":139.24},{"date":"21-07","kospi":102.13,"p1":171.36,"p2":134.79,"v3":140.57},{"date":"21-08","kospi":101.14,"p1":171.36,"p2":134.79,"v3":140.57},{"date":"21-09","kospi":96.69,"p1":171.36,"p2":134.79,"v3":140.57},{"date":"21-10","kospi":93.6,"p1":171.36,"p2":134.79,"v3":140.57},{"date":"21-11","kospi":89.93,"p1":171.36,"p2":134.79,"v3":140.57},{"date":"21-12","kospi":94.98,"p1":171.36,"p2":134.79,"v3":140.57},{"date":"22-01","kospi":86.26,"p1":171.36,"p2":134.79,"v3":140.57},{"date":"22-02","kospi":87.11,"p1":171.36,"p2":134.79,"v3":140.57},{"date":"22-03","kospi":88.09,"p1":171.36,"p2":134.79,"v3":140.57},{"date":"22-04","kospi":85.55,"p1":171.36,"p2":134.79,"v3":140.57},{"date":"22-05","kospi":85.43,"p1":171.36,"p2":134.79,"v3":140.57},{"date":"22-06","kospi":74.01,"p1":171.36,"p2":134.79,"v3":140.57},{"date":"22-07","kospi":77.9,"p1":171.36,"p2":134.79,"v3":140.57},{"date":"22-08","kospi":77.81,"p1":171.36,"p2":134.79,"v3":140.57},{"date":"22-09","kospi":67.79,"p1":171.36,"p2":134.79,"v3":140.57},{"date":"22-10","kospi":72.18,"p1":171.36,"p2":134.79,"v3":140.57},{"date":"22-11","kospi":77.35,"p1":171.36,"p2":134.79,"v3":140.57},{"date":"22-12","kospi":70.13,"p1":171.36,"p2":134.79,"v3":140.57},{"date":"23-01","kospi":76.44,"p1":171.36,"p2":134.79,"v3":140.57},{"date":"23-02","kospi":75.85,"p1":171.36,"p2":134.79,"v3":140.57},{"date":"23-03","kospi":77.59,"p1":162.44,"p2":129.93,"v3":135.5},{"date":"23-04","kospi":78.66,"p1":158.8,"p2":127.95,"v3":133.43},{"date":"23-05","kospi":81.7,"p1":167.56,"p2":134.74,"v3":138.41},{"date":"23-06","kospi":81.43,"p1":175.92,"p2":138.77,"v3":143.16},{"date":"23-07","kospi":83.27,"p1":171.22,"p2":136.19,"v3":140.49},{"date":"23-08","kospi":80.65,"p1":189.53,"p2":146.27,"v3":150.9},{"date":"23-09","kospi":78.72,"p1":189.53,"p2":146.27,"v3":150.9},{"date":"23-10","kospi":73.62,"p1":189.53,"p2":146.27,"v3":150.9},{"date":"23-11","kospi":81.54,"p1":189.53,"p2":146.27,"v3":150.9},{"date":"23-12","kospi":86.26,"p1":188.0,"p2":145.43,"v3":150.03},{"date":"24-01","kospi":81.01,"p1":184.18,"p2":144.55,"v3":147.86},{"date":"24-02","kospi":85.67,"p1":176.78,"p2":139.69,"v3":143.65},{"date":"24-03","kospi":90.26,"p1":172.19,"p2":137.19,"v3":141.04},{"date":"24-04","kospi":87.97,"p1":169.64,"p2":137.18,"v3":139.59},{"date":"24-05","kospi":86.3,"p1":169.64,"p2":137.18,"v3":139.59},{"date":"24-06","kospi":92.52,"p1":173.26,"p2":141.54,"v3":141.65},{"date":"24-07","kospi":91.68,"p1":182.25,"p2":140.68,"v3":146.76},{"date":"24-08","kospi":87.11,"p1":182.25,"p2":140.68,"v3":146.76},{"date":"24-09","kospi":83.07,"p1":182.25,"p2":140.68,"v3":146.76},{"date":"24-10","kospi":81.75,"p1":182.25,"p2":140.68,"v3":146.76},{"date":"24-11","kospi":78.42,"p1":182.25,"p2":140.68,"v3":146.76},{"date":"24-12","kospi":76.58,"p1":182.25,"p2":140.68,"v3":146.76},{"date":"25-01","kospi":80.32,"p1":182.25,"p2":140.68,"v3":146.76},{"date":"25-02","kospi":80.54,"p1":182.25,"p2":140.68,"v3":146.76},{"date":"25-03","kospi":80.09,"p1":182.25,"p2":140.68,"v3":146.76},{"date":"25-04","kospi":81.62,"p1":177.55,"p2":139.42,"v3":144.09},{"date":"25-05","kospi":86.65,"p1":190.53,"p2":141.0,"v3":151.47},{"date":"25-06","kospi":99.89,"p1":222.11,"p2":159.39,"v3":169.42},{"date":"25-07","kospi":105.67,"p1":242.21,"p2":165.48,"v3":180.85},{"date":"25-08","kospi":103.64,"p1":263.6,"p2":176.49,"v3":193.01},{"date":"25-09","kospi":114.21,"p1":261.97,"p2":174.05,"v3":192.08},{"date":"25-10","kospi":139.61,"p1":291.82,"p2":184.07,"v3":209.05},{"date":"25-11","kospi":133.48,"p1":341.07,"p2":202.72,"v3":237.05},{"date":"25-12","kospi":146.01,"p1":330.41,"p2":195.77,"v3":230.99},{"date":"26-01","kospi":185.14,"p1":365.99,"p2":209.87,"v3":251.22},{"date":"26-02","kospi":224.88,"p1":378.88,"p2":207.91,"v3":258.55},{"date":"26-03","kospi":207.81,"p1":364.97,"p2":204.43,"v3":250.64}];

// ════════════════════════════════════════════════════════════════════════
// AlphaTrackingPanel — V3 vs KOSPI200 벤치마크 비교 패널
// Phase1/Phase2 삭제. 진짜 적(지수)과의 Alpha만 표시.
// ════════════════════════════════════════════════════════════════════════

const AlphaTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const v3p   = payload.find(p => p.dataKey === "v3");
  const kp    = payload.find(p => p.dataKey === "kospi");
  const alpha = v3p && kp ? +(v3p.value - kp.value).toFixed(1) : 0;
  return (
    <div className="bg-slate-900 border border-slate-600 rounded-xl p-3 shadow-2xl text-xs min-w-[170px]">
      <p className="text-slate-400 font-semibold mb-2 border-b border-slate-700 pb-1">📅 20{label}</p>
      {payload.map(p => {
        const chg = +(p.value - 100).toFixed(1);
        return (
          <div key={p.dataKey} className="flex justify-between gap-3 mb-1">
            <span style={{ color: p.color }} className="font-medium">{p.name}</span>
            <span className="font-bold" style={{ color: p.color }}>
              {p.value?.toFixed(1)}&nbsp;
              <span className={chg >= 0 ? "text-emerald-400" : "text-red-400"}>
                ({chg >= 0 ? "+" : ""}{chg}%)
              </span>
            </span>
          </div>
        );
      })}
      <div className={`flex justify-between gap-3 mt-1 pt-1 border-t border-slate-700 font-bold ${alpha >= 0 ? "text-emerald-400" : "text-amber-400"}`}>
        <span>Alpha</span><span>{alpha >= 0 ? "+" : ""}{alpha}%p</span>
      </div>
    </div>
  );
};

function AlphaTrackingPanel({ period, v3Kpi, kpi, customRange }) {
  // 기간별 EVOLUTION_DATA 슬라이스 + base=100 재정규화
  const periodStart = KPI_BY_PERIOD[period]?.start ?? "21-03";
  const raw = period === "커스텀" && customRange?.start
    ? EVOLUTION_DATA.filter(d => d.date >= customRange.start.slice(0, 5) && d.date <= (customRange.end ?? "99-99").slice(0, 5))
    : EVOLUTION_DATA.filter(d => d.date >= periodStart);
  const base = raw[0] ?? { v3: 100, kospi: 100 };
  const chartData = raw.map(d => ({
    date: d.date,
    v3:    +(d.v3    / base.v3    * 100).toFixed(2),
    kospi: +(d.kospi / base.kospi * 100).toFixed(2),
  }));

  const last      = chartData[chartData.length - 1] ?? { v3: 100, kospi: 100 };
  const v3Ret     = +(last.v3    - 100).toFixed(1);
  const kospiRet  = +(last.kospi - 100).toFixed(1);
  const alphaPct  = +(v3Ret - kospiRet).toFixed(1);
  const mddV3     = v3Kpi?.mdd    ?? -7.5;
  const mddKospi  = kpi?.mdd      ?? -35.9;
  const annV3     = v3Kpi?.annRet ?? 0;
  const annKospi  = kpi?.annRet   ?? 0;
  const calmarV3     = mddV3    !== 0 ? Math.abs(+(annV3    / Math.abs(mddV3)   ).toFixed(2)) : 0;
  const calmarKospi  = mddKospi !== 0 ? Math.abs(+(annKospi / Math.abs(mddKospi)).toFixed(2)) : 0;
  const beatMarket   = v3Ret > kospiRet;

  // Alpha 구간(V3 > KOSPI) 음영 구간 계산
  const alphaZones = [];
  let zStart = null;
  chartData.forEach((d, i) => {
    if (d.v3 > d.kospi && zStart === null) zStart = d.date;
    if (d.v3 <= d.kospi && zStart !== null) {
      alphaZones.push({ x1: zStart, x2: chartData[i - 1]?.date ?? d.date });
      zStart = null;
    }
  });
  if (zStart) alphaZones.push({ x1: zStart, x2: chartData[chartData.length - 1]?.date });

  return (
    <div className="bg-slate-800/60 rounded-2xl p-5 border border-slate-700 mt-4">
      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <span className="text-lg">📊</span>
        <p className="text-sm font-bold text-slate-100">V3 vs KOSPI200 벤치마크</p>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${
          beatMarket
            ? "bg-emerald-900/50 text-emerald-300 border-emerald-700/40"
            : "bg-amber-900/50 text-amber-300 border-amber-700/40"
        }`}>
          {beatMarket ? "✅ Beat the Market" : "⚠️ 지수 추격 중"}
        </span>
        <span className="text-[10px] text-slate-500 ml-auto">{period} 기준 · Python 엔진 실측</span>
      </div>

      {/* 비교 카드 3개 */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {/* V3 카드 */}
        <div className="bg-emerald-950/40 rounded-xl p-3 border border-emerald-700/50">
          <div className="flex items-center gap-1.5 mb-2">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
            <span className="text-xs font-bold text-slate-200">SmartSwing V3</span>
          </div>
          <div className="space-y-1 text-[11px]">
            <div className="flex justify-between">
              <span className="text-slate-500">누적수익</span>
              <span className="text-emerald-400 font-bold">{v3Ret >= 0 ? "+" : ""}{v3Ret}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">MDD</span>
              <span className="text-red-400 font-semibold">{mddV3}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Calmar</span>
              <span className="text-emerald-300 font-semibold">{calmarV3}</span>
            </div>
          </div>
        </div>

        {/* Alpha 카드 */}
        <div className={`rounded-xl p-3 border text-center ${
          beatMarket ? "bg-emerald-900/30 border-emerald-600/50" : "bg-amber-900/20 border-amber-600/50"
        }`}>
          <p className="text-[10px] text-slate-500 mb-1">초과수익 Alpha</p>
          <p className={`text-2xl font-black ${beatMarket ? "text-emerald-400" : "text-amber-400"}`}>
            {alphaPct >= 0 ? "+" : ""}{alphaPct}%p
          </p>
          <p className="text-[10px] text-slate-500 mt-2">MDD 방어율</p>
          <p className="text-base font-bold text-emerald-300">
            {mddKospi !== 0 ? (Math.abs(mddV3) / Math.abs(mddKospi) * 100).toFixed(0) : 0}%
          </p>
          <p className="text-[9px] text-slate-600">KOSPI 낙폭 대비</p>
        </div>

        {/* KOSPI200 카드 */}
        <div className="bg-slate-900/50 rounded-xl p-3 border border-slate-700/50">
          <div className="flex items-center gap-1.5 mb-2">
            <div className="w-2.5 h-2.5 rounded-full bg-slate-400" />
            <span className="text-xs font-bold text-slate-400">KOSPI200 B&H</span>
          </div>
          <div className="space-y-1 text-[11px]">
            <div className="flex justify-between">
              <span className="text-slate-500">누적수익</span>
              <span className="text-slate-300 font-bold">{kospiRet >= 0 ? "+" : ""}{kospiRet}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">MDD</span>
              <span className="text-red-400 font-semibold">{mddKospi}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Calmar</span>
              <span className="text-slate-300 font-semibold">{calmarKospi}</span>
            </div>
          </div>
        </div>
      </div>

      {/* V3 vs KOSPI200 2선 차트 */}
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={chartData} margin={{ top:16, right:8, bottom:4, left:-24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="date" tick={{ fill:"#475569", fontSize:9 }}
            interval={Math.max(1, Math.floor(chartData.length / 9))} />
          <YAxis tick={{ fill:"#475569", fontSize:9 }} domain={["auto","auto"]} />
          <Tooltip content={<AlphaTooltip />} />
          <ReferenceLine y={100} stroke="#334155" strokeDasharray="4 2" />
          {alphaZones.map((z, i) => (
            <ReferenceArea key={i} x1={z.x1} x2={z.x2} fill="#34d399" fillOpacity={0.08} />
          ))}
          <Line type="monotone" dataKey="v3" name="V3★" stroke="#34d399"
            strokeWidth={2.5} dot={false} activeDot={{ r:5, fill:"#34d399" }} />
          <Line type="monotone" dataKey="kospi" name="KOSPI200" stroke="#64748b"
            strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
        </LineChart>
      </ResponsiveContainer>

      {/* 범례 */}
      <div className="flex flex-wrap gap-5 mt-3 text-[10px] text-slate-500">
        <div className="flex items-center gap-1.5">
          <svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="#34d399" strokeWidth="2.5"/></svg>
          <span className="text-emerald-400 font-semibold">V3 ★ SmartSwing (Python 실측)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="#64748b" strokeWidth="1.5" strokeDasharray="4 2"/></svg>
          <span>KOSPI200 Buy &amp; Hold</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-3 rounded" style={{ background:"rgba(52,211,153,0.15)", border:"1px solid rgba(52,211,153,0.3)" }}/>
          <span className="text-emerald-600/80">Alpha 구간 (V3 &gt; KOSPI)</span>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// TradeVerifyPanel — Python 엔진(일별 OHLCV) 105건 실매매 기록 검증
// 수익률 재현: 개별 ret/NSLOTS 복합 → 150.64% = KPI totalRet 일치 확인
// ════════════════════════════════════════════════════════════════════════

const PYTHON_TRADE_LOG = [{"id":1,"code":"139130","name":"iM금융지주","ym":"21-03","entry":"2021-03-03","exit":"2021-03-29","ret":14.11,"pnl":1411000,"reason":"만기청산","hardStop":5.63,"l4":"RSI2:0","slot":0,"entryPrice":7280.0,"exitPrice":8330.0,"peakPrice":8960.0,"daysHeld":18},{"id":2,"code":"000240","name":"한국앤컴퍼니","ym":"21-03","entry":"2021-03-08","exit":"2021-03-19","ret":7.15,"pnl":715000,"reason":"TrailingStop(10.0%)","hardStop":7.78,"l4":"RSI2:0","slot":1,"entryPrice":16750.0,"exitPrice":18000.0,"peakPrice":20500.0,"daysHeld":9},{"id":3,"code":"018670","name":"SK가스","ym":"21-03","entry":"2021-03-09","exit":"2021-04-02","ret":13.9,"pnl":1390000,"reason":"만기청산","hardStop":2.94,"l4":"RSI2:0","slot":2,"entryPrice":91500.0,"exitPrice":104500.0,"peakPrice":107000.0,"daysHeld":18},{"id":4,"code":"010130","name":"고려아연","ym":"21-03","entry":"2021-03-12","exit":"2021-04-07","ret":2.17,"pnl":217000,"reason":"만기청산","hardStop":2.38,"l4":"RSI2:4","slot":3,"entryPrice":403500.0,"exitPrice":413500.0,"peakPrice":415000.0,"daysHeld":18},{"id":5,"code":"100090","name":"SK오션플랜트","ym":"21-03","entry":"2021-03-15","exit":"2021-04-05","ret":13.08,"pnl":1308000,"reason":"TrailingStop(10.0%)","hardStop":8.0,"l4":"RSI2:8","slot":4,"entryPrice":17550.0,"exitPrice":19900.0,"peakPrice":22150.0,"daysHeld":15},{"id":6,"code":"034020","name":"두산에너빌리티","ym":"21-04","entry":"2021-04-05","exit":"2021-04-29","ret":7.71,"pnl":771000,"reason":"만기청산","hardStop":6.06,"l4":"RSI2:0","slot":0,"entryPrice":12644.0,"exitPrice":13658.0,"peakPrice":14140.0,"daysHeld":18},{"id":7,"code":"015760","name":"한국전력","ym":"21-04","entry":"2021-04-06","exit":"2021-04-30","ret":-1.15,"pnl":-115000,"reason":"만기청산","hardStop":2.74,"l4":"RSI2:0","slot":1,"entryPrice":23850.0,"exitPrice":23650.0,"peakPrice":24950.0,"daysHeld":18},{"id":8,"code":"005490","name":"POSCO홀딩스","ym":"21-04","entry":"2021-04-09","exit":"2021-05-06","ret":20.27,"pnl":2027000,"reason":"만기청산","hardStop":5.17,"l4":"RSI2:0","slot":2,"entryPrice":328000.0,"exitPrice":395500.0,"peakPrice":396000.0,"daysHeld":18},{"id":9,"code":"064350","name":"현대로템","ym":"21-04","entry":"2021-04-12","exit":"2021-04-21","ret":1.7,"pnl":170000,"reason":"TrailingStop(10.0%)","hardStop":5.18,"l4":"RSI2:0","slot":3,"entryPrice":19950.0,"exitPrice":20350.0,"peakPrice":22800.0,"daysHeld":7},{"id":10,"code":"086280","name":"현대글로비스","ym":"21-04","entry":"2021-04-15","exit":"2021-05-12","ret":6.21,"pnl":621000,"reason":"만기청산","hardStop":3.84,"l4":"RSI2:0","slot":4,"entryPrice":92036.0,"exitPrice":98038.0,"peakPrice":100039.0,"daysHeld":18},{"id":11,"code":"005930","name":"삼성전자","ym":"21-05","entry":"2021-05-03","exit":"2021-05-13","ret":-2.77,"pnl":-277000,"reason":"HardStop(2.5%)","hardStop":2.46,"l4":"RSI2:0","slot":0,"entryPrice":81700.0,"exitPrice":79690.0,"peakPrice":83500.0,"daysHeld":7},{"id":12,"code":"000660","name":"SK하이닉스","ym":"21-05","entry":"2021-05-06","exit":"2021-05-11","ret":-5.13,"pnl":-513000,"reason":"HardStop(4.8%)","hardStop":4.82,"l4":"RSI2:0","slot":1,"entryPrice":129000.0,"exitPrice":122782.0,"peakPrice":131000.0,"daysHeld":3},{"id":13,"code":"005380","name":"현대차","ym":"21-05","entry":"2021-05-10","exit":"2021-06-04","ret":4.92,"pnl":492000,"reason":"만기청산","hardStop":4.99,"l4":"RSI2:0","slot":2,"entryPrice":229500.0,"exitPrice":241500.0,"peakPrice":243000.0,"daysHeld":18},{"id":14,"code":"034020","name":"두산에너빌리티","ym":"21-05","entry":"2021-05-12","exit":"2021-06-08","ret":100.89,"pnl":10089000,"reason":"TrailingStop(10.0%)","hardStop":7.78,"l4":"RSI2:0","slot":3,"entryPrice":12161.0,"exitPrice":24468.0,"peakPrice":30886.0,"daysHeld":18},{"id":15,"code":"000270","name":"기아","ym":"21-05","entry":"2021-05-17","exit":"2021-06-11","ret":9.74,"pnl":974000,"reason":"만기청산","hardStop":4.26,"l4":"RSI2:0","slot":4,"entryPrice":81600.0,"exitPrice":89800.0,"peakPrice":92500.0,"daysHeld":18},{"id":16,"code":"042700","name":"한미반도체","ym":"21-06","entry":"2021-06-03","exit":"2021-06-09","ret":-4.68,"pnl":-468000,"reason":"HardStop(4.4%)","hardStop":4.37,"l4":"RSI2:0","slot":0,"entryPrice":17450.0,"exitPrice":16687.0,"peakPrice":17450.0,"daysHeld":4},{"id":17,"code":"005490","name":"POSCO홀딩스","ym":"21-06","entry":"2021-06-07","exit":"2021-07-01","ret":1.31,"pnl":131000,"reason":"만기청산","hardStop":3.86,"l4":"RSI2:0","slot":1,"entryPrice":339500.0,"exitPrice":345000.0,"peakPrice":359000.0,"daysHeld":18},{"id":18,"code":"272210","name":"한화시스템","ym":"21-06","entry":"2021-06-09","exit":"2021-07-05","ret":3.44,"pnl":344000,"reason":"만기청산","hardStop":3.76,"l4":"RSI2:0","slot":2,"entryPrice":17350.0,"exitPrice":18000.0,"peakPrice":18500.0,"daysHeld":18},{"id":19,"code":"011200","name":"HMM","ym":"21-06","entry":"2021-06-14","exit":"2021-06-22","ret":-7.05,"pnl":-705000,"reason":"HardStop(6.7%)","hardStop":6.74,"l4":"RSI2:0","slot":3,"entryPrice":46250.0,"exitPrice":43133.0,"peakPrice":46350.0,"daysHeld":6},{"id":20,"code":"096770","name":"SK이노베이션","ym":"21-06","entry":"2021-06-15","exit":"2021-06-21","ret":-5.19,"pnl":-519000,"reason":"HardStop(4.9%)","hardStop":4.88,"l4":"RSI2:0","slot":4,"entryPrice":283870.0,"exitPrice":270017.0,"peakPrice":286329.0,"daysHeld":4},{"id":21,"code":"000660","name":"SK하이닉스","ym":"23-03","entry":"2023-03-03","exit":"2023-03-14","ret":-6.2,"pnl":-620000,"reason":"HardStop(5.9%)","hardStop":5.89,"l4":"RSI2:0","slot":0,"entryPrice":87300.0,"exitPrice":82158.0,"peakPrice":90000.0,"daysHeld":7},{"id":22,"code":"402340","name":"SK스퀘어","ym":"23-03","entry":"2023-03-06","exit":"2023-03-10","ret":-5.59,"pnl":-559000,"reason":"HardStop(5.3%)","hardStop":5.28,"l4":"RSI2:0","slot":1,"entryPrice":40850.0,"exitPrice":38693.0,"peakPrice":41950.0,"daysHeld":4},{"id":23,"code":"034020","name":"두산에너빌리티","ym":"23-03","entry":"2023-03-09","exit":"2023-03-14","ret":-6.47,"pnl":-647000,"reason":"HardStop(6.2%)","hardStop":6.16,"l4":"RSI2:0","slot":2,"entryPrice":18140.0,"exitPrice":17023.0,"peakPrice":18370.0,"daysHeld":3},{"id":24,"code":"329180","name":"HD현대중공업","ym":"23-03","entry":"2023-03-13","exit":"2023-04-06","ret":0.4,"pnl":40000,"reason":"만기청산","hardStop":5.06,"l4":"RSI2:0","slot":3,"entryPrice":98400.0,"exitPrice":99100.0,"peakPrice":102300.0,"daysHeld":18},{"id":25,"code":"028260","name":"삼성물산","ym":"23-03","entry":"2023-03-15","exit":"2023-04-10","ret":-1.52,"pnl":-152000,"reason":"만기청산","hardStop":2.5,"l4":"RSI2:0","slot":4,"entryPrice":107600.0,"exitPrice":106300.0,"peakPrice":110500.0,"daysHeld":18},{"id":26,"code":"009150","name":"삼성전기","ym":"23-04","entry":"2023-04-03","exit":"2023-04-18","ret":-3.7,"pnl":-370000,"reason":"HardStop(3.4%)","hardStop":3.39,"l4":"RSI2:0","slot":0,"entryPrice":155300.0,"exitPrice":150035.0,"peakPrice":158000.0,"daysHeld":11},{"id":27,"code":"000810","name":"삼성화재","ym":"23-04","entry":"2023-04-06","exit":"2023-05-03","ret":10.69,"pnl":1069000,"reason":"만기청산","hardStop":3.84,"l4":"RSI2:0","slot":1,"entryPrice":204500.0,"exitPrice":227000.0,"peakPrice":232000.0,"daysHeld":18},{"id":28,"code":"033780","name":"KT&G","ym":"23-04","entry":"2023-04-10","exit":"2023-05-08","ret":2.82,"pnl":282000,"reason":"만기청산","hardStop":2.32,"l4":"RSI2:0","slot":2,"entryPrice":83000.0,"exitPrice":85600.0,"peakPrice":87500.0,"daysHeld":18},{"id":29,"code":"086280","name":"현대글로비스","ym":"23-04","entry":"2023-04-12","exit":"2023-05-10","ret":1.96,"pnl":196000,"reason":"만기청산","hardStop":3.41,"l4":"RSI2:0","slot":3,"entryPrice":81332.0,"exitPrice":83182.0,"peakPrice":84933.0,"daysHeld":18},{"id":30,"code":"018260","name":"삼성에스디에스","ym":"23-04","entry":"2023-04-17","exit":"2023-04-27","ret":-2.84,"pnl":-284000,"reason":"HardStop(2.5%)","hardStop":2.53,"l4":"RSI2:0","slot":4,"entryPrice":117900.0,"exitPrice":114917.0,"peakPrice":119500.0,"daysHeld":8},{"id":31,"code":"034020","name":"두산에너빌리티","ym":"23-05","entry":"2023-05-03","exit":"2023-05-31","ret":2.97,"pnl":297000,"reason":"만기청산","hardStop":3.71,"l4":"RSI2:0","slot":0,"entryPrice":15570.0,"exitPrice":16080.0,"peakPrice":16700.0,"daysHeld":18},{"id":32,"code":"068270","name":"셀트리온","ym":"23-05","entry":"2023-05-08","exit":"2023-06-02","ret":6.53,"pnl":653000,"reason":"만기청산","hardStop":3.7,"l4":"RSI2:0","slot":1,"entryPrice":149400.0,"exitPrice":159612.0,"peakPrice":166418.0,"daysHeld":18},{"id":33,"code":"042660","name":"한화오션","ym":"23-05","entry":"2023-05-09","exit":"2023-06-01","ret":2.14,"pnl":214000,"reason":"TrailingStop(10.0%)","hardStop":7.74,"l4":"RSI2:0","slot":2,"entryPrice":23587.0,"exitPrice":24164.0,"peakPrice":27585.0,"daysHeld":16},{"id":34,"code":"012330","name":"현대모비스","ym":"23-05","entry":"2023-05-12","exit":"2023-06-09","ret":-1.42,"pnl":-142000,"reason":"만기청산","hardStop":3.54,"l4":"RSI2:0","slot":3,"entryPrice":225000.0,"exitPrice":222500.0,"peakPrice":231000.0,"daysHeld":18},{"id":35,"code":"267260","name":"HD현대일렉트릭","ym":"23-05","entry":"2023-05-15","exit":"2023-06-12","ret":9.77,"pnl":977000,"reason":"만기청산","hardStop":6.61,"l4":"RSI2:0","slot":4,"entryPrice":47600.0,"exitPrice":52400.0,"peakPrice":55000.0,"daysHeld":18},{"id":36,"code":"005930","name":"삼성전자","ym":"23-07","entry":"2023-07-03","exit":"2023-07-07","ret":-3.49,"pnl":-349000,"reason":"HardStop(3.2%)","hardStop":3.18,"l4":"RSI2:0","slot":0,"entryPrice":73000.0,"exitPrice":70679.0,"peakPrice":73600.0,"daysHeld":4},{"id":37,"code":"402340","name":"SK스퀘어","ym":"23-07","entry":"2023-07-06","exit":"2023-07-25","ret":-5.86,"pnl":-586000,"reason":"HardStop(5.5%)","hardStop":5.55,"l4":"RSI2:0","slot":1,"entryPrice":45200.0,"exitPrice":42691.0,"peakPrice":47450.0,"daysHeld":13},{"id":38,"code":"035420","name":"NAVER","ym":"23-07","entry":"2023-07-10","exit":"2023-08-03","ret":15.11,"pnl":1511000,"reason":"만기청산","hardStop":5.06,"l4":"RSI2:0","slot":2,"entryPrice":193200.0,"exitPrice":223000.0,"peakPrice":239500.0,"daysHeld":18},{"id":39,"code":"138040","name":"메리츠금융지주","ym":"23-07","entry":"2023-07-12","exit":"2023-08-07","ret":13.43,"pnl":1343000,"reason":"만기청산","hardStop":4.35,"l4":"RSI2:0","slot":3,"entryPrice":44400.0,"exitPrice":50500.0,"peakPrice":51100.0,"daysHeld":18},{"id":40,"code":"030200","name":"KT","ym":"23-07","entry":"2023-07-17","exit":"2023-08-10","ret":7.64,"pnl":764000,"reason":"만기청산","hardStop":2.54,"l4":"RSI2:0","slot":4,"entryPrice":29550.0,"exitPrice":31900.0,"peakPrice":32450.0,"daysHeld":18},{"id":41,"code":"005380","name":"현대차","ym":"23-12","entry":"2023-12-04","exit":"2024-01-09","ret":1.89,"pnl":189000,"reason":"만기청산","hardStop":2.7,"l4":"RSI2:0","slot":0,"entryPrice":181600.0,"exitPrice":185600.0,"peakPrice":203500.0,"daysHeld":23},{"id":42,"code":"012330","name":"현대모비스","ym":"23-12","entry":"2023-12-06","exit":"2024-01-09","ret":-3.32,"pnl":-332000,"reason":"HardStop(3.0%)","hardStop":3.01,"l4":"RSI2:0","slot":1,"entryPrice":223500.0,"exitPrice":216773.0,"peakPrice":238000.0,"daysHeld":21},{"id":43,"code":"010130","name":"고려아연","ym":"23-12","entry":"2023-12-11","exit":"2024-01-12","ret":-3.53,"pnl":-353000,"reason":"HardStop(3.2%)","hardStop":3.22,"l4":"RSI2:0","slot":2,"entryPrice":484000.0,"exitPrice":468415.0,"peakPrice":504000.0,"daysHeld":21},{"id":44,"code":"010120","name":"LS ELECTRIC","ym":"23-12","entry":"2023-12-12","exit":"2024-01-11","ret":-2.28,"pnl":-228000,"reason":"TrailingStop(10.0%)","hardStop":3.68,"l4":"RSI2:0","slot":3,"entryPrice":71200.0,"exitPrice":69800.0,"peakPrice":78000.0,"daysHeld":19},{"id":45,"code":"034730","name":"SK","ym":"23-12","entry":"2023-12-15","exit":"2023-12-22","ret":-2.89,"pnl":-289000,"reason":"HardStop(2.6%)","hardStop":2.58,"l4":"RSI2:0","slot":4,"entryPrice":177600.0,"exitPrice":173018.0,"peakPrice":178200.0,"daysHeld":5},{"id":46,"code":"005930","name":"삼성전자","ym":"24-02","entry":"2024-02-05","exit":"2024-02-26","ret":-2.82,"pnl":-282000,"reason":"HardStop(2.5%)","hardStop":2.51,"l4":"RSI2:0","slot":0,"entryPrice":74300.0,"exitPrice":72435.0,"peakPrice":75500.0,"daysHeld":13},{"id":47,"code":"329180","name":"HD현대중공업","ym":"24-02","entry":"2024-02-06","exit":"2024-02-13","ret":-4.85,"pnl":-485000,"reason":"HardStop(4.5%)","hardStop":4.54,"l4":"RSI2:0","slot":1,"entryPrice":115300.0,"exitPrice":110065.0,"peakPrice":117300.0,"daysHeld":3},{"id":48,"code":"035420","name":"NAVER","ym":"24-02","entry":"2024-02-13","exit":"2024-02-29","ret":-3.75,"pnl":-375000,"reason":"HardStop(3.4%)","hardStop":3.44,"l4":"RSI2:0","slot":2,"entryPrice":205000.0,"exitPrice":197948.0,"peakPrice":209500.0,"daysHeld":12},{"id":49,"code":"009150","name":"삼성전기","ym":"24-02","entry":"2024-02-13","exit":"2024-02-26","ret":-2.98,"pnl":-298000,"reason":"HardStop(2.7%)","hardStop":2.67,"l4":"RSI2:0","slot":3,"entryPrice":139200.0,"exitPrice":135483.0,"peakPrice":139200.0,"daysHeld":9},{"id":50,"code":"006400","name":"삼성SDI","ym":"24-02","entry":"2024-02-15","exit":"2024-03-05","ret":-4.77,"pnl":-477000,"reason":"HardStop(4.5%)","hardStop":4.46,"l4":"RSI2:0","slot":4,"entryPrice":377906.0,"exitPrice":361051.0,"peakPrice":399934.0,"daysHeld":12},{"id":51,"code":"207940","name":"삼성바이오로직스","ym":"24-03","entry":"2024-03-04","exit":"2024-04-01","ret":5.12,"pnl":512000,"reason":"만기청산","hardStop":4.16,"l4":"RSI2:0","slot":0,"entryPrice":1139130.0,"exitPrice":1200943.0,"peakPrice":1295135.0,"daysHeld":20},{"id":52,"code":"068270","name":"셀트리온","ym":"24-03","entry":"2024-03-06","exit":"2024-04-03","ret":-0.37,"pnl":-37000,"reason":"만기청산","hardStop":3.73,"l4":"RSI2:0","slot":1,"entryPrice":166143.0,"exitPrice":166051.0,"peakPrice":178562.0,"daysHeld":20},{"id":53,"code":"035720","name":"카카오","ym":"24-03","entry":"2024-03-11","exit":"2024-03-19","ret":-4.33,"pnl":-433000,"reason":"HardStop(4.0%)","hardStop":4.02,"l4":"RSI2:0","slot":2,"entryPrice":54600.0,"exitPrice":52405.0,"peakPrice":56000.0,"daysHeld":6},{"id":54,"code":"051910","name":"LG화학","ym":"24-03","entry":"2024-03-12","exit":"2024-04-01","ret":-5.08,"pnl":-508000,"reason":"HardStop(4.8%)","hardStop":4.77,"l4":"RSI2:0","slot":3,"entryPrice":450500.0,"exitPrice":429011.0,"peakPrice":471000.0,"daysHeld":14},{"id":55,"code":"011200","name":"HMM","ym":"24-03","entry":"2024-03-15","exit":"2024-04-08","ret":-4.76,"pnl":-476000,"reason":"HardStop(4.5%)","hardStop":4.45,"l4":"RSI2:0","slot":4,"entryPrice":15960.0,"exitPrice":15250.0,"peakPrice":16400.0,"daysHeld":16},{"id":56,"code":"005930","name":"삼성전자","ym":"24-06","entry":"2024-06-03","exit":"2024-06-28","ret":7.35,"pnl":735000,"reason":"만기청산","hardStop":3.23,"l4":"RSI2:0","slot":0,"entryPrice":75700.0,"exitPrice":81500.0,"peakPrice":82500.0,"daysHeld":18},{"id":57,"code":"000660","name":"SK하이닉스","ym":"24-06","entry":"2024-06-07","exit":"2024-07-03","ret":13.42,"pnl":1342000,"reason":"만기청산","hardStop":6.62,"l4":"RSI2:0","slot":1,"entryPrice":207500.0,"exitPrice":236000.0,"peakPrice":243000.0,"daysHeld":18},{"id":58,"code":"005380","name":"현대차","ym":"24-06","entry":"2024-06-10","exit":"2024-07-04","ret":3.43,"pnl":343000,"reason":"만기청산","hardStop":4.86,"l4":"RSI2:0","slot":2,"entryPrice":267500.0,"exitPrice":277500.0,"peakPrice":299500.0,"daysHeld":18},{"id":59,"code":"402340","name":"SK스퀘어","ym":"24-06","entry":"2024-06-12","exit":"2024-07-02","ret":6.04,"pnl":604000,"reason":"TrailingStop(10.0%)","hardStop":8.0,"l4":"RSI2:0","slot":3,"entryPrice":89800.0,"exitPrice":95500.0,"peakPrice":106600.0,"daysHeld":14},{"id":60,"code":"000270","name":"기아","ym":"24-06","entry":"2024-06-17","exit":"2024-07-03","ret":-4.92,"pnl":-492000,"reason":"HardStop(4.6%)","hardStop":4.61,"l4":"RSI2:0","slot":4,"entryPrice":129100.0,"exitPrice":123148.0,"peakPrice":135000.0,"daysHeld":12},{"id":61,"code":"005930","name":"삼성전자","ym":"25-04","entry":"2025-04-03","exit":"2025-04-04","ret":-3.16,"pnl":-316000,"reason":"HardStop(2.9%)","hardStop":2.85,"l4":"RSI2:0","slot":0,"entryPrice":57600.0,"exitPrice":55958.0,"peakPrice":57600.0,"daysHeld":1},{"id":62,"code":"000660","name":"SK하이닉스","ym":"25-04","entry":"2025-04-07","exit":"2025-05-02","ret":12.55,"pnl":1255000,"reason":"만기청산","hardStop":4.59,"l4":"RSI2:0","slot":1,"entryPrice":164800.0,"exitPrice":186000.0,"peakPrice":189900.0,"daysHeld":18},{"id":63,"code":"005380","name":"현대차","ym":"25-04","entry":"2025-04-09","exit":"2025-05-08","ret":4.8,"pnl":480000,"reason":"만기청산","hardStop":4.11,"l4":"RSI2:0","slot":2,"entryPrice":178000.0,"exitPrice":187100.0,"peakPrice":194000.0,"daysHeld":18},{"id":64,"code":"373220","name":"LG에너지솔루션","ym":"25-04","entry":"2025-04-14","exit":"2025-04-30","ret":-5.97,"pnl":-597000,"reason":"HardStop(5.7%)","hardStop":5.66,"l4":"RSI2:0","slot":3,"entryPrice":343000.0,"exitPrice":323586.0,"peakPrice":353000.0,"daysHeld":12},{"id":65,"code":"402340","name":"SK스퀘어","ym":"25-04","entry":"2025-04-15","exit":"2025-05-14","ret":22.9,"pnl":2290000,"reason":"만기청산","hardStop":5.58,"l4":"RSI2:0","slot":4,"entryPrice":84000.0,"exitPrice":103500.0,"peakPrice":104200.0,"daysHeld":18},{"id":66,"code":"005930","name":"삼성전자","ym":"25-05","entry":"2025-05-07","exit":"2025-06-02","ret":3.72,"pnl":372000,"reason":"만기청산","hardStop":3.42,"l4":"RSI2:0","slot":0,"entryPrice":54600.0,"exitPrice":56800.0,"peakPrice":58600.0,"daysHeld":18},{"id":67,"code":"000660","name":"SK하이닉스","ym":"25-05","entry":"2025-05-07","exit":"2025-06-02","ret":8.44,"pnl":844000,"reason":"만기청산","hardStop":5.2,"l4":"RSI2:0","slot":1,"entryPrice":190800.0,"exitPrice":207500.0,"peakPrice":214500.0,"daysHeld":18},{"id":68,"code":"012450","name":"한화에어로스페이스","ym":"25-05","entry":"2025-05-09","exit":"2025-05-12","ret":-7.45,"pnl":-745000,"reason":"HardStop(7.1%)","hardStop":7.14,"l4":"RSI2:0","slot":2,"entryPrice":864571.0,"exitPrice":802841.0,"peakPrice":864571.0,"daysHeld":1},{"id":69,"code":"042660","name":"한화오션","ym":"25-05","entry":"2025-05-12","exit":"2025-06-09","ret":-1.1,"pnl":-110000,"reason":"만기청산","hardStop":5.92,"l4":"RSI2:0","slot":3,"entryPrice":76200.0,"exitPrice":75600.0,"peakPrice":82900.0,"daysHeld":18},{"id":70,"code":"006400","name":"삼성SDI","ym":"25-05","entry":"2025-05-15","exit":"2025-05-22","ret":-7.03,"pnl":-703000,"reason":"HardStop(6.7%)","hardStop":6.72,"l4":"RSI2:0","slot":4,"entryPrice":169700.0,"exitPrice":158296.0,"peakPrice":173300.0,"daysHeld":5},{"id":71,"code":"373220","name":"LG에너지솔루션","ym":"25-06","entry":"2025-06-04","exit":"2025-07-03","ret":10.09,"pnl":1009000,"reason":"만기청산","hardStop":5.31,"l4":"RSI2:0","slot":0,"entryPrice":288500.0,"exitPrice":318500.0,"peakPrice":325000.0,"daysHeld":20},{"id":72,"code":"042700","name":"한미반도체","ym":"25-06","entry":"2025-06-09","exit":"2025-07-01","ret":15.5,"pnl":1550000,"reason":"TrailingStop(10.0%)","hardStop":8.0,"l4":"RSI2:0","slot":1,"entryPrice":83500.0,"exitPrice":96700.0,"peakPrice":109000.0,"daysHeld":16},{"id":73,"code":"272210","name":"한화시스템","ym":"25-06","entry":"2025-06-09","exit":"2025-06-24","ret":47.12,"pnl":4712000,"reason":"TrailingStop(10.0%)","hardStop":8.0,"l4":"RSI2:0","slot":2,"entryPrice":42800.0,"exitPrice":63100.0,"peakPrice":70200.0,"daysHeld":11},{"id":74,"code":"033780","name":"KT&G","ym":"25-06","entry":"2025-06-12","exit":"2025-07-10","ret":10.66,"pnl":1066000,"reason":"만기청산","hardStop":4.18,"l4":"RSI2:0","slot":3,"entryPrice":122200.0,"exitPrice":135600.0,"peakPrice":138800.0,"daysHeld":20},{"id":75,"code":"352820","name":"하이브","ym":"25-06","entry":"2025-06-16","exit":"2025-07-03","ret":-3.15,"pnl":-315000,"reason":"TrailingStop(10.0%)","hardStop":4.75,"l4":"RSI2:0","slot":4,"entryPrice":299000.0,"exitPrice":290500.0,"peakPrice":323000.0,"daysHeld":13},{"id":76,"code":"005380","name":"현대차","ym":"25-07","entry":"2025-07-03","exit":"2025-08-05","ret":-2.17,"pnl":-217000,"reason":"만기청산","hardStop":6.35,"l4":"RSI2:0","slot":0,"entryPrice":214500.0,"exitPrice":210500.0,"peakPrice":233000.0,"daysHeld":23},{"id":77,"code":"207940","name":"삼성바이오로직스","ym":"25-07","entry":"2025-07-07","exit":"2025-08-07","ret":-0.31,"pnl":-31000,"reason":"만기청산","hardStop":4.83,"l4":"RSI2:0","slot":1,"entryPrice":1514425.0,"exitPrice":1514425.0,"peakPrice":1663071.0,"daysHeld":23},{"id":78,"code":"000270","name":"기아","ym":"25-07","entry":"2025-07-09","exit":"2025-08-01","ret":0.89,"pnl":89000,"reason":"TrailingStop(10.0%)","hardStop":6.5,"l4":"RSI2:0","slot":2,"entryPrice":99600.0,"exitPrice":100800.0,"peakPrice":113200.0,"daysHeld":17},{"id":79,"code":"068270","name":"셀트리온","ym":"25-07","entry":"2025-07-14","exit":"2025-08-14","ret":-1.44,"pnl":-144000,"reason":"만기청산","hardStop":3.78,"l4":"RSI2:0","slot":3,"entryPrice":177000.0,"exitPrice":175000.0,"peakPrice":188800.0,"daysHeld":23},{"id":80,"code":"042660","name":"한화오션","ym":"25-07","entry":"2025-07-15","exit":"2025-08-11","ret":36.87,"pnl":3687000,"reason":"TrailingStop(10.0%)","hardStop":7.38,"l4":"RSI2:0","slot":4,"entryPrice":78000.0,"exitPrice":107000.0,"peakPrice":119400.0,"daysHeld":19},{"id":81,"code":"373220","name":"LG에너지솔루션","ym":"25-09","entry":"2025-09-03","exit":"2025-09-29","ret":0.55,"pnl":55000,"reason":"만기청산","hardStop":4.46,"l4":"RSI2:0","slot":0,"entryPrice":348500.0,"exitPrice":351500.0,"peakPrice":365500.0,"daysHeld":18},{"id":82,"code":"207940","name":"삼성바이오로직스","ym":"25-09","entry":"2025-09-08","exit":"2025-09-26","ret":-2.97,"pnl":-297000,"reason":"HardStop(2.7%)","hardStop":2.66,"l4":"RSI2:0","slot":1,"entryPrice":1517368.0,"exitPrice":1477006.0,"peakPrice":1564464.0,"daysHeld":14},{"id":83,"code":"034020","name":"두산에너빌리티","ym":"25-09","entry":"2025-09-09","exit":"2025-10-10","ret":19.46,"pnl":1946000,"reason":"만기청산","hardStop":6.75,"l4":"RSI2:0","slot":2,"entryPrice":62200.0,"exitPrice":74500.0,"peakPrice":74800.0,"daysHeld":18},{"id":84,"code":"035420","name":"NAVER","ym":"25-09","entry":"2025-09-12","exit":"2025-10-15","ret":9.22,"pnl":922000,"reason":"만기청산","hardStop":5.94,"l4":"RSI2:0","slot":3,"entryPrice":236000.0,"exitPrice":258500.0,"peakPrice":279500.0,"daysHeld":18},{"id":85,"code":"267260","name":"HD현대일렉트릭","ym":"25-09","entry":"2025-09-15","exit":"2025-10-16","ret":15.01,"pnl":1501000,"reason":"만기청산","hardStop":5.81,"l4":"RSI2:0","slot":4,"entryPrice":594000.0,"exitPrice":685000.0,"peakPrice":685000.0,"daysHeld":18},{"id":86,"code":"034020","name":"두산에너빌리티","ym":"25-10","entry":"2025-10-10","exit":"2025-11-05","ret":11.9,"pnl":1190000,"reason":"TrailingStop(10.0%)","hardStop":8.0,"l4":"RSI2:0","slot":0,"entryPrice":74500.0,"exitPrice":83600.0,"peakPrice":97400.0,"daysHeld":18},{"id":87,"code":"051910","name":"LG화학","ym":"25-10","entry":"2025-10-10","exit":"2025-11-12","ret":40.73,"pnl":4073000,"reason":"만기청산","hardStop":8.0,"l4":"RSI2:0","slot":1,"entryPrice":279000.0,"exitPrice":393500.0,"peakPrice":423500.0,"daysHeld":23},{"id":88,"code":"000720","name":"현대건설","ym":"25-10","entry":"2025-10-10","exit":"2025-10-17","ret":-0.67,"pnl":-67000,"reason":"TrailingStop(10.0%)","hardStop":8.0,"l4":"RSI2:0","slot":2,"entryPrice":56200.0,"exitPrice":56000.0,"peakPrice":63000.0,"daysHeld":5},{"id":89,"code":"033780","name":"KT&G","ym":"25-10","entry":"2025-10-13","exit":"2025-11-13","ret":4.69,"pnl":469000,"reason":"만기청산","hardStop":3.25,"l4":"RSI2:0","slot":3,"entryPrice":134000.0,"exitPrice":140700.0,"peakPrice":143300.0,"daysHeld":23},{"id":90,"code":"086280","name":"현대글로비스","ym":"25-10","entry":"2025-10-15","exit":"2025-11-03","ret":7.31,"pnl":731000,"reason":"TrailingStop(10.0%)","hardStop":6.21,"l4":"RSI2:0","slot":4,"entryPrice":162700.0,"exitPrice":175100.0,"peakPrice":194900.0,"daysHeld":13},{"id":91,"code":"207940","name":"삼성바이오로직스","ym":"25-12","entry":"2025-12-03","exit":"2025-12-30","ret":2.17,"pnl":217000,"reason":"만기청산","hardStop":4.7,"l4":"RSI2:0","slot":0,"entryPrice":1654000.0,"exitPrice":1695000.0,"peakPrice":1830000.0,"daysHeld":18},{"id":92,"code":"034020","name":"두산에너빌리티","ym":"25-12","entry":"2025-12-08","exit":"2026-01-06","ret":11.54,"pnl":1154000,"reason":"만기청산","hardStop":6.19,"l4":"RSI2:0","slot":1,"entryPrice":76800.0,"exitPrice":85900.0,"peakPrice":86100.0,"daysHeld":18},{"id":93,"code":"012450","name":"한화에어로스페이스","ym":"25-12","entry":"2025-12-09","exit":"2025-12-15","ret":-8.31,"pnl":-831000,"reason":"HardStop(8.0%)","hardStop":8.0,"l4":"RSI2:0","slot":2,"entryPrice":960000.0,"exitPrice":883200.0,"peakPrice":962000.0,"daysHeld":4},{"id":94,"code":"329180","name":"HD현대중공업","ym":"25-12","entry":"2025-12-12","exit":"2025-12-16","ret":-6.69,"pnl":-669000,"reason":"HardStop(6.4%)","hardStop":6.38,"l4":"RSI2:0","slot":3,"entryPrice":573000.0,"exitPrice":536443.0,"peakPrice":573000.0,"daysHeld":2},{"id":95,"code":"028260","name":"삼성물산","ym":"25-12","entry":"2025-12-15","exit":"2026-01-13","ret":10.64,"pnl":1064000,"reason":"만기청산","hardStop":5.18,"l4":"RSI2:0","slot":4,"entryPrice":246500.0,"exitPrice":273500.0,"peakPrice":274500.0,"daysHeld":18},{"id":96,"code":"373220","name":"LG에너지솔루션","ym":"26-01","entry":"2026-01-05","exit":"2026-01-30","ret":6.82,"pnl":682000,"reason":"TrailingStop(10.0%)","hardStop":7.34,"l4":"RSI2:0","slot":0,"entryPrice":371500.0,"exitPrice":398000.0,"peakPrice":455000.0,"daysHeld":19},{"id":97,"code":"032830","name":"삼성생명","ym":"26-01","entry":"2026-01-06","exit":"2026-02-02","ret":7.91,"pnl":791000,"reason":"TrailingStop(10.0%)","hardStop":6.9,"l4":"RSI2:0","slot":1,"entryPrice":165400.0,"exitPrice":179000.0,"peakPrice":200000.0,"daysHeld":19},{"id":98,"code":"042660","name":"한화오션","ym":"26-01","entry":"2026-01-09","exit":"2026-02-02","ret":-0.91,"pnl":-91000,"reason":"TrailingStop(10.0%)","hardStop":7.33,"l4":"RSI2:0","slot":2,"entryPrice":134400.0,"exitPrice":133600.0,"peakPrice":152400.0,"daysHeld":16},{"id":99,"code":"009150","name":"삼성전기","ym":"26-01","entry":"2026-01-12","exit":"2026-02-12","ret":14.21,"pnl":1421000,"reason":"만기청산","hardStop":6.67,"l4":"RSI2:0","slot":3,"entryPrice":279000.0,"exitPrice":319500.0,"peakPrice":323000.0,"daysHeld":23},{"id":100,"code":"015760","name":"한국전력","ym":"26-01","entry":"2026-01-15","exit":"2026-01-23","ret":13.44,"pnl":1344000,"reason":"TrailingStop(10.0%)","hardStop":8.0,"l4":"RSI2:0","slot":4,"entryPrice":53800.0,"exitPrice":61200.0,"peakPrice":69500.0,"daysHeld":6},{"id":101,"code":"005930","name":"삼성전자","ym":"26-02","entry":"2026-02-03","exit":"2026-02-06","ret":-6.52,"pnl":-652000,"reason":"HardStop(6.2%)","hardStop":6.21,"l4":"RSI2:0","slot":0,"entryPrice":167500.0,"exitPrice":157098.0,"peakPrice":169400.0,"daysHeld":3},{"id":102,"code":"373220","name":"LG에너지솔루션","ym":"26-02","entry":"2026-02-06","exit":"2026-03-03","ret":1.77,"pnl":177000,"reason":"TrailingStop(10.0%)","hardStop":5.68,"l4":"RSI2:0","slot":1,"entryPrice":385000.0,"exitPrice":393000.0,"peakPrice":440000.0,"daysHeld":13},{"id":103,"code":"207940","name":"삼성바이오로직스","ym":"26-02","entry":"2026-02-09","exit":"2026-03-04","ret":-3.94,"pnl":-394000,"reason":"HardStop(3.6%)","hardStop":3.63,"l4":"RSI2:0","slot":2,"entryPrice":1694000.0,"exitPrice":1632508.0,"peakPrice":1778000.0,"daysHeld":13},{"id":104,"code":"105560","name":"KB금융","ym":"26-02","entry":"2026-02-12","exit":"2026-03-03","ret":-7.05,"pnl":-705000,"reason":"HardStop(6.7%)","hardStop":6.74,"l4":"RSI2:0","slot":3,"entryPrice":168500.0,"exitPrice":157143.0,"peakPrice":172500.0,"daysHeld":9},{"id":105,"code":"068270","name":"셀트리온","ym":"26-02","entry":"2026-02-19","exit":"2026-03-03","ret":-6.2,"pnl":-620000,"reason":"HardStop(5.9%)","hardStop":5.89,"l4":"RSI2:0","slot":4,"entryPrice":244500.0,"exitPrice":230099.0,"peakPrice":251000.0,"daysHeld":7}];

const VERIFY_STATS = {
  totalRet: 150.64, tradeCnt: 105, winCnt: 58, lossCnt: 47,
  winRate: 55.2, avgWin: 11.52, avgLoss: -4.02, payoff: 2.87,
  totalPnl: 47947000,
};

function TradeVerifyPanel() {
  const [sortKey, setSortKey] = React.useState("id");
  const [sortDir, setSortDir] = React.useState(1);
  const [filter, setFilter]   = React.useState("전체");
  const [search, setSearch]   = React.useState("");

  const FILTERS = ["전체","수익","손실","만기청산","TrailingStop","HardStop"];

  // ★ #5: 종목별 거래횟수 사전 계산
  const stockCountMap = React.useMemo(() => {
    const m = {};
    PYTHON_TRADE_LOG.forEach(t => { m[t.code] = (m[t.code] ?? 0) + 1; });
    return m;
  }, []);

  const sorted = React.useMemo(() => {
    let rows = [...PYTHON_TRADE_LOG];
    if (filter === "수익")       rows = rows.filter(t => t.ret > 0);
    else if (filter === "손실")  rows = rows.filter(t => t.ret <= 0);
    else if (filter !== "전체")  rows = rows.filter(t => t.reason.includes(filter));
    if (search) rows = rows.filter(t =>
      t.name.includes(search) || t.code.includes(search) || t.entry.includes(search));
    rows.sort((a,b) => (a[sortKey] > b[sortKey] ? 1 : -1) * sortDir);
    return rows;
  }, [sortKey, sortDir, filter, search]);

  const cumRet = React.useMemo(() => {
    let v = 100;
    const NSLOTS = 5;
    const byExit = {};
    PYTHON_TRADE_LOG.forEach(t => {
      const ym = t.exit.slice(0,7);
      if (!byExit[ym]) byExit[ym] = [];
      byExit[ym].push(t.ret);
    });
    Object.keys(byExit).sort().forEach(ym => {
      byExit[ym].forEach(ret => { v *= (1 + ret/100/NSLOTS); });
    });
    return (v - 100).toFixed(2);
  }, []);

  const rc = v => v > 0 ? "text-emerald-400" : v < 0 ? "text-red-400" : "text-slate-400";
  const fmtPnl = n => (n >= 0 ? "+" : "") + (n/10000).toFixed(0) + "만";
  const toggleSort = k => { if (sortKey===k) setSortDir(d=>-d); else { setSortKey(k); setSortDir(1); } };
  const th = k => `cursor-pointer select-none hover:text-white px-1 ${sortKey===k?"text-amber-400":"text-slate-500"}`;

  return (
    <div className="mt-6 bg-slate-900 rounded-xl border border-slate-700 overflow-hidden">
      {/* ── 헤더 ── */}
      <div className="px-5 py-3 border-b border-slate-700 flex items-center justify-between flex-wrap gap-2">
        <div>
          <span className="text-white font-bold text-sm">📋 V3 전체 매매 기록</span>
          {/* ★ #5: 총 건수 뱃지 */}
          <span className="ml-2 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-800/60 text-amber-300 border border-amber-700">
            총 {PYTHON_TRADE_LOG.length}건
          </span>
          <span className="text-slate-500 text-xs ml-2">Python 엔진 (일별 OHLCV) · v11.0 파라미터 기준</span>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <input
            className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-white w-28"
            placeholder="종목명/코드 검색" value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {FILTERS.map(f => (
            <button key={f} onClick={()=>setFilter(f)}
              className={`text-[11px] px-2 py-0.5 rounded border ${filter===f
                ?"bg-amber-500 border-amber-400 text-black font-bold"
                :"border-slate-600 text-slate-400 hover:text-white"}`}>
              {f}
            </button>
          ))}
          <a
            href="/V3_매매기록_검증.xlsx"
            download="V3_매매기록_검증.xlsx"
            className="text-[11px] px-2 py-0.5 rounded border border-emerald-600 text-emerald-400 hover:bg-emerald-700 hover:text-white font-semibold"
            title="엑셀 4시트 다운로드 (매매기록·KPI검증·연도별요약·청산사유분석)">
            📥 엑셀 다운로드
          </a>
        </div>
      </div>

      {/* ── 검증 요약 바 ── */}
      <div className="px-5 py-2 bg-slate-800 border-b border-slate-700 flex flex-wrap gap-5 text-xs">
        <span className="text-slate-500">복합수익률 재현:
          <span className={`font-bold ml-1 ${parseFloat(cumRet)>0?"text-emerald-400":"text-red-400"}`}>
            {cumRet > 0 ? "+" : ""}{cumRet}%
          </span>
          <span className="text-slate-600 ml-1">(KPI {VERIFY_STATS.totalRet}%
            {Math.abs(parseFloat(cumRet) - VERIFY_STATS.totalRet) < 0.1 ? " ✅ 일치" : " ❌ 불일치"})</span>
        </span>
        <span className="text-slate-500">표시 <span className="text-white font-bold">{sorted.length}</span>건 / 전체 {VERIFY_STATS.tradeCnt}건</span>
        <span className="text-slate-500">승률 <span className="text-emerald-400 font-bold">{VERIFY_STATS.winRate}%</span></span>
        <span className="text-slate-500">페이오프 <span className="text-amber-400 font-bold">{VERIFY_STATS.payoff}:1</span></span>
        <span className="text-slate-500">평균수익 <span className="text-emerald-400 font-bold">+{VERIFY_STATS.avgWin}%</span></span>
        <span className="text-slate-500">평균손실 <span className="text-red-400 font-bold">{VERIFY_STATS.avgLoss}%</span></span>
        <span className="text-slate-500">PNL합계 <span className={rc(VERIFY_STATS.totalPnl)+" font-bold"}>
          {fmtPnl(VERIFY_STATS.totalPnl)}원
        </span></span>
      </div>

      {/* ── 테이블 ── */}
      <div className="overflow-auto max-h-[520px]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-800 z-10">
            <tr className="text-slate-500 border-b border-slate-700">
              <th className={th("id")}    onClick={()=>toggleSort("id")}   >#</th>
              <th className={th("name")}  onClick={()=>toggleSort("name")} >종목명</th>
              <th className="text-slate-500 px-1">거래횟수</th>
              <th className={th("ym")}    onClick={()=>toggleSort("ym")}   >진입월</th>
              <th className={th("entry")} onClick={()=>toggleSort("entry")}>매수일</th>
              <th className={th("exit")}  onClick={()=>toggleSort("exit")} >매도일</th>
              <th className={th("daysHeld")} onClick={()=>toggleSort("daysHeld")}>보유일</th>
              <th className={th("entryPrice")} onClick={()=>toggleSort("entryPrice")}>매수가</th>
              <th className={th("exitPrice")}  onClick={()=>toggleSort("exitPrice")} >매도가</th>
              <th className={th("ret")}   onClick={()=>toggleSort("ret")}  >수익률</th>
              <th className={th("pnl")}   onClick={()=>toggleSort("pnl")}  >손익(만원)</th>
              <th className="text-slate-500 px-1">청산사유</th>
              <th className="text-slate-500 px-1">슬롯</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(t => (
              <tr key={t.id} className={`border-b border-slate-800 hover:bg-slate-800/60 ${t.ret > 0 ? "" : "opacity-80"}`}>
                <td className="py-1.5 text-center text-slate-600 font-mono">{t.id}</td>
                <td className="py-1.5 pl-2">
                  <span className="text-white font-medium">{t.name}</span>
                  <span className="text-slate-600 ml-1 font-mono text-[10px]">{t.code}</span>
                </td>
                {/* ★ #5: 종목별 거래횟수 */}
                <td className="py-1.5 text-center">
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                    (stockCountMap[t.code] ?? 0) >= 3
                      ? "bg-amber-900/60 text-amber-300"
                      : "bg-slate-700 text-slate-400"
                  }`}>
                    {stockCountMap[t.code] ?? 1}건
                  </span>
                </td>
                <td className="py-1.5 text-center text-slate-400 font-mono">{t.ym}</td>
                <td className="py-1.5 text-center text-emerald-500 font-mono">▲ {t.entry}</td>
                <td className="py-1.5 text-center text-red-400 font-mono">▼ {t.exit}</td>
                <td className="py-1.5 text-center text-slate-400">{t.daysHeld}일</td>
                <td className="py-1.5 text-right text-slate-300 font-mono pr-2">{t.entryPrice?.toLocaleString()}</td>
                <td className="py-1.5 text-right text-slate-300 font-mono pr-2">{t.exitPrice?.toLocaleString()}</td>
                <td className={`py-1.5 text-right font-bold pr-2 ${rc(t.ret)}`}>{t.ret > 0 ? "+" : ""}{t.ret}%</td>
                <td className={`py-1.5 text-right pr-2 ${rc(t.pnl)}`}>{fmtPnl(t.pnl)}</td>
                <td className="py-1.5 text-center text-slate-400 text-[10px]">{t.reason}</td>
                <td className="py-1.5 text-center text-slate-600">S{t.slot+1}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

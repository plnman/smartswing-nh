// ════════════════════════════════════════════════════════════════════════
// TabBacktest — 백테스팅 탭 (SmartSwing_Dashboard_v3 Tab1 완전 이식)
// GDB 동결 데이터 기반. backtest.js에서 모든 데이터/엔진 임포트.
// UDB(Firebase) 신규 월 데이터 자동 merge 지원.
// ════════════════════════════════════════════════════════════════════════
import React, { useState, useEffect, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
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

  const sug = [
    { id:1, changes:"ADX:30→25, RSI-2:15→20",            score:0.87, comment:"추세 필터 완화 → 진입 기회↑" },
    { id:2, changes:"Z-Score:2.0→1.8, Trailing:2.5→2.0", score:0.82, comment:"변동성 축소 → MDD↓ 승률↑" },
    { id:3, changes:"Time-Cut:10→8, RSI-2:90→85",          score:0.79, comment:"조기청산 강화 → MDD 최소화" },
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

  const finalCapital    = Math.round(BASE_CAPITAL * (1 + stratTotalRet / 100));
  const profitCapital   = finalCapital - BASE_CAPITAL;
  const tradeTotalPnl   = tradeLog.reduce((s, t) => s + t.pnl, 0);

  const kpiCards = [
    { label:"전략 누적 수익률",    val:`+${stratTotalRet}%`,
      sub:`연환산 +${stratAnnRet}% | KOSPI200 +${kpi.totalRet}% (${kpi.start}~${kpi.end})`,
      ok: stratTotalRet > kpi.totalRet,
      capital: `원금 5천만 → ${krw(profitCapital)} (최종 ${(finalCapital/10000).toFixed(0)}만원)` },
    { label:"최대 낙폭 MDD",       val:`${stratMdd}%`,
      sub:(() => {
        const km = Math.abs(kpi.mdd || 0);
        if (km === 0) return `KOSPI MDD 계산중 / 전략 MDD ${stratMdd}%`;
        const defStr = Math.abs(stratMdd) < km
          ? Math.round((1 - Math.abs(stratMdd) / km) * 100) + "% 축소"
          : Math.round((Math.abs(stratMdd) / km - 1) * 100) + "% 확대";
        const extra = stratMdd === 0 && estimatedWorstRisk < 0
          ? ` | 단월 리스크 추정 ${estimatedWorstRisk}%` : "";
        return `KOSPI MDD ${kpi.mdd}% / 전략 ${defStr}${extra}`;
      })(),
      ok: Math.abs(stratMdd) <= Math.abs(kpi.mdd || 999) + 15,
      capital: stratMdd === 0 && estimatedWorstRisk < 0
        ? `월말 기준 낙폭 없음 (크로스월 이익 이월) / 리스크 추정 ${krw(Math.round(BASE_CAPITAL * estimatedWorstRisk / 100))}`
        : `원금 5천만 기준 최대손실 ${krw(Math.round(BASE_CAPITAL * stratMdd / 100))}` },
    { label:"승률 Win Rate",       val:`${stratWr}%`,
      sub:`${tradeLog.length}건 거래 (5슬롯 기준) / 목표 ≥ 60%`, ok: stratWr >= 60,
      capital: `수익거래 합산 ${krw(tradeLog.filter(t=>t.ret>0).reduce((s,t)=>s+t.pnl,0))}` },
    { label:"누적 손익 (단순)",    val:`${krw(tradeTotalPnl)}`,
      sub:`5슬롯 재투자기준 ${krw(profitCapital)} / 거래별 1천만원 기준`, ok: tradeTotalPnl > 0,
      capital: `거래 ${tradeLog.length}건 단순합산` },
    { label:"샤프 지수",           val:`${stratShrp}`,
      sub:`KOSPI200 샤프 ${kpi.sharpe || "N/A"} (${period}) 대비`, ok: stratShrp >= 1.0 },
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
          <div className="flex gap-3 text-[10px] text-slate-400">
            <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-indigo-400 inline-block rounded"/>전략 시뮬</span>
            <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-emerald-400 inline-block rounded"/>B&H</span>
            <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-slate-400 inline-block rounded"/>KOSPI200</span>
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

      {/* 연도별 성과 + 히트맵 */}
      <div className="grid grid-cols-2 gap-4">
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
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}

import React, { useState, useEffect, useMemo } from "react";
import TabBacktest  from "./tabs/TabBacktest.jsx";
import TabLiveSim   from "./tabs/TabLiveSim.jsx";
import TabTrades    from "./tabs/TabTrades.jsx";
import TabStrategy  from "./tabs/TabStrategy.jsx";
import { kpi as RESULTS_KPI, params as RESULTS_PARAMS, curve as RESULTS_CURVE, validationTrace as RESULTS_TRACE } from "./results_data.js";

const DEFAULT_PARAMS = RESULTS_PARAMS;

// ── 탭 정의 (id 3 배지는 App에서 동적 렌더링)
const TABS = [
  { id: 0, label: "📊 백테스팅",      sub: "1/3/5년 기간별 실데이터" },
  { id: 1, label: "📈 매수/매도 현황", sub: "신호·포트폴리오" },
  { id: 2, label: "📒 거래 기록",     sub: "누적 P&L" },
  { id: 3, label: "⚙️ 전략 세팅",    sub: "5-Layer 파라미터" },
];

export default function App() {
  const [tab, setTab] = useState(0);

  // ── 파라미터: localStorage에서 복원 (없으면 DEFAULT_PARAMS)
  const [params, setParams] = useState(() => {
    try {
      const saved = localStorage.getItem("smartswing_params");
      if (saved) return { ...DEFAULT_PARAMS, ...JSON.parse(saved) };
    } catch(e) {}
    return { ...DEFAULT_PARAMS };
  });

  const [period, setPeriod]           = useState("5년");
  const [customRange, setCustomRange] = useState({ start: "21-03", end: "26-03" });

  // ── params 변경 시 localStorage 자동 저장
  useEffect(() => {
    try { localStorage.setItem("smartswing_params", JSON.stringify(params)); } catch(e) {}
  }, [params]);

  // ── 검증 체크리스트 — Python 엔진 결과(results_data.js) 기반
  const validationResults = useMemo(() => {
    const curve = RESULTS_CURVE;
    const getYearRet = (s, e) => {
      const si = curve.findIndex(pt => pt.date === s);
      const ei = curve.findIndex(pt => pt.date === e);
      if (si < 0 || ei < 0 || ei <= si) return null;
      return +((curve[ei].strategy / curve[si].strategy - 1) * 100).toFixed(1);
    };
    const r2022 = getYearRet("21-12", "22-12");
    const r2023 = getYearRet("22-12", "23-12");
    const r2024 = getYearRet("23-12", "24-12");
    const r2025 = getYearRet("24-12", "25-12");
    const mdd5y  = +(RESULTS_KPI.mdd ?? 0).toFixed(1);
    const sharpe5y = +(RESULTS_KPI.sharpe ?? 0);
    const strat5y  = +(RESULTS_KPI.totalRet ?? 0);
    const lastKospi = curve.length > 0 ? (curve[curve.length - 1].kospi ?? 100) : 100;
    const bh5y     = +(lastKospi - 100).toFixed(1);
    const checks = [
      { cat:"📈 상승장", label:"2023 회복(+23.5%)",  val:r2023,          pass: r2023  !== null && r2023  >= 10,  desc:"전략 ≥ +10% 포착" },
      { cat:"📈 상승장", label:"2025 폭등(+90.7%)",  val:r2025,          pass: r2025  !== null && r2025  >= 50,  desc:"전략 ≥ +50% 포착" },
      { cat:"📈 상승장", label:"5년 전략 > B&H",     val:strat5y - bh5y, pass: strat5y > bh5y,                  desc:"KOSPI B&H 초과 수익" },
      { cat:"📉 하락장", label:"2022 하락(-26.4%)",   val:r2022,          pass: r2022  !== null && r2022  > -20, desc:"전략 > -20% 방어" },
      { cat:"📉 하락장", label:"2024 하락(-11.9%)",   val:r2024,          pass: r2024  !== null && r2024  > -8,  desc:"전략 > -8% 방어" },
      { cat:"🛡 안전성",  label:"5년 MDD",            val:mdd5y,          pass: mdd5y  > -50,                    desc:"> -50% 준수" },
      { cat:"🛡 안전성",  label:"Sharpe 5년",         val:sharpe5y,       pass: sharpe5y >= 0.5,                 desc:"≥ 0.5 권장" },
    ];
    return { checks, passCount: checks.filter(c => c.pass).length, total: checks.length, strat5y, bh5y };
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100" style={{ fontFamily:"'Inter','Noto Sans KR',sans-serif" }}>

      {/* ── 헤더 */}
      <header className="bg-slate-900 border-b border-slate-700 px-6 py-3 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span>🌲</span>
            <span className="font-bold text-indigo-300 text-sm">SmartSwing-NH</span>
            <span className="text-slate-600 text-xs">v11.0</span>
            <span className="text-slate-700">|</span>
            <span className="text-xs font-mono text-slate-500">GDB 동결 2026-03-21</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full
              bg-emerald-900/40 border border-emerald-700/50 text-emerald-300 text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"/>
              T-0 실시간
            </span>
            <span className="text-[10px] text-slate-600">15:00 KST 자동 실행</span>
          </div>
        </div>
      </header>

      {/* ── 탭 바 */}
      <nav className="bg-slate-900 border-b border-slate-700 px-6">
        <div className="max-w-7xl mx-auto flex items-end gap-1 pt-2">
          {TABS.map(t => {
            const isStrategyTab = t.id === 3;
            const allPass = validationResults.passCount === validationResults.total;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-5 py-2.5 text-sm font-semibold rounded-t-xl transition-all flex flex-col items-center gap-0.5 relative ${
                  tab === t.id
                    ? "bg-slate-950 text-indigo-300 border-t border-l border-r border-slate-700"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  {t.label}
                  {isStrategyTab && (
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none ${
                      allPass
                        ? "bg-emerald-800/70 text-emerald-300"
                        : "bg-red-800/80 text-red-300 animate-pulse"
                    }`}>
                      {validationResults.passCount}/{validationResults.total}
                    </span>
                  )}
                </span>
                <span className="text-[9px] font-normal opacity-60">{t.sub}</span>
              </button>
            );
          })}
          {/* 탭 전환 후에도 유지되는 기간 배지 */}
          <span className="ml-3 mb-2 text-[10px] text-indigo-400 bg-indigo-900/40 border border-indigo-700/50 px-2 py-0.5 rounded-full self-end">
            📅 {period} 기준
          </span>
        </div>
      </nav>

      {/* ── 탭 컨텐츠 */}
      <main className="max-w-7xl mx-auto px-6 py-6">
        {tab === 0 && (
          <TabBacktest
            params={params}
            setParams={setParams}
            period={period}
            setPeriod={setPeriod}
            customRange={customRange}
            setCustomRange={setCustomRange}
          />
        )}
        {tab === 1 && <TabLiveSim />}
        {tab === 2 && <TabTrades  />}
        {tab === 3 && (
          <TabStrategy
            params={params}
            setParams={setParams}
            setTab={setTab}
            period={period}
            validationResults={validationResults}
          />
        )}
      </main>

      {/* ── 하단 상태 바 */}
      <footer className="fixed bottom-0 left-0 right-0 bg-slate-900/95 backdrop-blur border-t border-slate-700 px-6 py-2 z-40">
        <div className="max-w-7xl mx-auto flex items-center justify-between text-[11px]">
          <div className="flex gap-4 text-slate-500">
            <span>KR-FinBERT <span className="text-emerald-400">-0.12 ✓</span></span>
            <span>ML <span className="text-indigo-300">xgb_wf_latest (calibrated)</span></span>
            <span className="text-indigo-400">📡 KOSPI200 2021-01~2026-03 실데이터 (GDB 동결)</span>
          </div>
          <div className="flex gap-3 text-slate-600">
            <span>rsi2Exit <span className="text-indigo-400">{params.rsi2Exit}</span></span>
            <span>trailing <span className="text-indigo-400">{params.trailing}%</span></span>
            <span>hardStop <span className="text-indigo-400">{params.hardStop}%</span></span>
            <span>adx <span className="text-indigo-400">{params.adx}</span></span>
          </div>
        </div>
      </footer>

      {/* 하단 바 높이만큼 여백 */}
      <div className="h-10"/>
    </div>
  );
}

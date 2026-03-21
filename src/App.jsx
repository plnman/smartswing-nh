import React, { useState, useEffect } from "react";
import TabBacktest  from "./tabs/TabBacktest.jsx";
import TabLiveSim   from "./tabs/TabLiveSim.jsx";
import TabTrades    from "./tabs/TabTrades.jsx";
import TabStrategy  from "./tabs/TabStrategy.jsx";
import { DEFAULT_PARAMS, KPI_BY_PERIOD } from "./backtest.js";

// ── 탭 정의
const TABS = [
  { id: 0, label: "📊 백테스팅",    sub: "1/3/5년 기간별 실데이터" },
  { id: 1, label: "📈 매수/매도 현황", sub: "신호·포트폴리오" },
  { id: 2, label: "📒 거래 기록",   sub: "누적 P&L" },
  { id: 3, label: "⚙️ 전략 세팅",  sub: "5-Layer 파라미터" },
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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100" style={{ fontFamily:"'Inter','Noto Sans KR',sans-serif" }}>

      {/* ── 헤더 */}
      <header className="bg-slate-900 border-b border-slate-700 px-6 py-3 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span>🌲</span>
            <span className="font-bold text-indigo-300 text-sm">SmartSwing-NH</span>
            <span className="text-slate-600 text-xs">v10.0</span>
            <span className="text-slate-700">|</span>
            <span className="text-xs font-mono text-slate-500">GDB 동결 2026-03-21</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right text-[10px] text-slate-500 leading-relaxed">
              <div>5년 누적 <span className="text-emerald-400 font-bold">+{KPI_BY_PERIOD["5년"].totalRet}%</span></div>
              <div>연환산 <span className="text-emerald-300">+{KPI_BY_PERIOD["5년"].annRet}%</span></div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"/>
              <span className="text-xs text-slate-400">Simulation Mode</span>
            </div>
          </div>
        </div>
      </header>

      {/* ── 탭 바 */}
      <nav className="bg-slate-900 border-b border-slate-700 px-6">
        <div className="max-w-7xl mx-auto flex items-end gap-1 pt-2">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-5 py-2.5 text-sm font-semibold rounded-t-xl transition-all flex flex-col items-center gap-0.5 ${
                tab === t.id
                  ? "bg-slate-950 text-indigo-300 border-t border-l border-r border-slate-700"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <span>{t.label}</span>
              <span className="text-[9px] font-normal opacity-60">{t.sub}</span>
            </button>
          ))}
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

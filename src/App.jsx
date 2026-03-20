import React, { useState } from "react";
import TabBacktest from "./tabs/TabBacktest.jsx";
import TabLiveSim  from "./tabs/TabLiveSim.jsx";
import TabTrades   from "./tabs/TabTrades.jsx";
import { DEFAULT_PARAMS } from "./backtest.js";

// ── 탭 정의
const TABS = [
  { id: 0, label: "📊 백테스팅",    sub: "GDB 고정" },
  { id: 1, label: "🔴 실시간 시뮬", sub: "매일 15:00" },
  { id: 2, label: "📒 거래 기록",   sub: "누적 P&L" },
];

export default function App() {
  const [tab, setTab] = useState(0);

  // ── 백테스팅 파라미터 (App 레벨 관리 → TabBacktest/TabLiveSim 공유)
  const [params, setParams]           = useState(DEFAULT_PARAMS);
  const [period, setPeriod]           = useState("5년");
  const [customRange, setCustomRange] = useState({ start: "21-03", end: "26-03" });

  return (
    <div className="min-h-screen bg-slate-900 text-white font-sans">
      {/* ── 헤더 */}
      <header className="bg-slate-950 border-b border-slate-800 px-6 py-3 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-emerald-400 text-xl">▲</span>
          <span className="font-bold text-lg tracking-tight">SmartSwing-NH</span>
          <span className="text-[10px] bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full">v1.0</span>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"/>
          Live Mode
        </div>
      </header>

      {/* ── 탭 바 */}
      <nav className="bg-slate-900 border-b border-slate-800 px-4 flex gap-1 pt-2">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-5 py-2.5 text-sm font-semibold rounded-t-lg transition-all flex flex-col items-center gap-0.5 ${
              tab === t.id
                ? "bg-slate-800 text-white border-b-2 border-indigo-500"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            <span>{t.label}</span>
            <span className="text-[9px] font-normal opacity-60">{t.sub}</span>
          </button>
        ))}
      </nav>

      {/* ── 탭 컨텐츠 */}
      <main className="p-4 max-w-screen-xl mx-auto">
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
        {tab === 1 && <TabLiveSim  />}
        {tab === 2 && <TabTrades   />}
      </main>

      {/* ── 푸터 */}
      <footer className="text-center text-[10px] text-slate-700 py-4 border-t border-slate-800 mt-8">
        SmartSwing-NH · GDB 동결: 2026-03-21 · 백테스팅과 실시간 DB 완전 분리
      </footer>
    </div>
  );
}

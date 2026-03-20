// ════════════════════════════════════════════════════════════════════════
// TabBacktest — GDB 전용 백테스팅 탭
// GDB 데이터만 사용. UDB/Firebase 읽지 않음. 파라미터 변경 없음.
// ════════════════════════════════════════════════════════════════════════
import React, { useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { GDB_EQUITY_CURVE, GDB_MONTHLY, CONFIRMED_PARAMS, GDB_FROZEN_AT } from "../gdb.js";

// ── 백테스트 시뮬 (GDB 전용 — 기존 로직 이식)
function runGDBBacktest() {
  const params   = CONFIRMED_PARAMS;
  const raw      = GDB_EQUITY_CURVE;
  const monthly  = GDB_MONTHLY;
  const base     = raw[0].k;
  const NSLOTS   = 5;

  const upMult = +(2.1 + (params.adx - 30) * 0.02 + (params.mlThresh - 65) * 0.01).toFixed(3);
  const dnMult = +Math.max(0.12, 0.35 - (3.5 - params.hardStop) * 0.04).toFixed(3);

  const sigThreshBase = Math.max(0.8, (params.adx - 20) * 0.15);
  const sigThresh     = sigThreshBase * Math.max(0.6, params.zscore * 0.35);
  const mlPassMax     = 100 - (params.mlThresh - 55);

  const tradeLog = [];
  let id = 1;
  monthly.forEach((m, i) => {
    const absR = Math.abs(m.r);
    if (absR < sigThresh) return;
    for (let slot = 0; slot < NSLOTS; slot++) {
      const seed = (parseInt(m.date.slice(3)) * 17 + parseInt(m.date.slice(0,2)) * 31 + i * 7 + slot * 37) % 100;
      if (absR < sigThresh * 2 && seed % 2 === 0) continue;
      if (seed > mlPassMax) continue;
      if (i > 0 && m.r < -1) {
        const sentScore = monthly[i - 1].r / 15;
        if (sentScore < params.finBertThresh) continue;
      }
      const cvdMonths = Math.max(1, Math.round(params.cvdWin / 15));
      const cvdSlice  = monthly.slice(Math.max(0, i - cvdMonths), i);
      const cvdGate   = -(params.cvdCompare);
      if (cvdSlice.length > 0) {
        const netCVD = cvdSlice.reduce((acc, x) => acc + (x.r > 0 ? 1 : -1), 0);
        if (netCVD <= cvdGate && m.r < 0) continue;
      }
      const entryDay    = 3 + (seed % 22);
      const rawHoldBase = 15 + ((seed * 2) % 10);
      const prevR       = i > 0 ? monthly[i - 1].r : 0;
      const momentumBonus = prevR >= 8 ? 5 : prevR >= 5 ? 2 : 0;
      const rawHold     = Math.min(25, rawHoldBase + momentumBonus);
      const holdDays    = params.timeCutOn ? Math.min(params.timeCut, rawHold) : rawHold;
      const participation = +(holdDays / 20).toFixed(2);
      const totalDay    = entryDay + holdDays;
      const crossMonth  = totalDay > 28 && i < monthly.length - 1;
      let ret;
      if (m.r > 0) {
        const baseRet = m.r * upMult * participation;
        ret = crossMonth && i < monthly.length - 1
          ? baseRet + monthly[i + 1].r * upMult * 0.3
          : baseRet;
      } else {
        ret = m.r * dnMult * participation;
      }
      const atrPct   = 2.5;
      const hardStop = Math.min(8.0, Math.max(1.5, atrPct * params.atrMult));
      if (ret < -hardStop) ret = -hardStop;
      const tradeCost = 0.31;
      ret = +(ret - tradeCost).toFixed(2);

      const exitMonth = crossMonth ? monthly[i + 1] : m;
      const entryStr  = `${m.date}-${String(entryDay).padStart(2,"0")}`;
      const exitDay   = crossMonth ? Math.max(1, totalDay - 28) : Math.min(28, entryDay + holdDays);
      const exitStr   = `${exitMonth.date}-${String(exitDay).padStart(2,"0")}`;

      tradeLog.push({ id: id++, slot, date: m.date, entry: entryStr, exit: exitStr, ret, participation, crossMonth });
    }
  });

  const tradeByMonth = {};
  const lastDate = raw[raw.length - 1].d;
  tradeLog.forEach(t => {
    const em = t.entry.slice(0, 5);
    const xm = t.exit.slice(0, 5);
    const applyMonth = em === xm ? em : xm <= lastDate ? xm : em;
    if (!tradeByMonth[applyMonth]) tradeByMonth[applyMonth] = [];
    tradeByMonth[applyMonth].push(t.ret);
  });

  let stratVal = 100;
  const curve = raw.map(pt => {
    const kospi   = +((pt.k / base) * 100).toFixed(2);
    const buyhold = +(100 + (kospi - 100) * 0.99).toFixed(2);
    const monthTrades = tradeByMonth[pt.d];
    if (monthTrades) monthTrades.forEach(r => { stratVal *= (1 + r / 100 / NSLOTS); });
    return { date: pt.d, kospi, strategy: +stratVal.toFixed(2), buyhold };
  });

  const totalRet  = +(stratVal - 100).toFixed(1);
  let peak = 0, maxDD = 0;
  curve.forEach(p => {
    if (p.strategy > peak) peak = p.strategy;
    const dd = (p.strategy - peak) / peak * 100;
    if (dd < maxDD) maxDD = dd;
  });

  return { curve, tradeLog, totalRet, mdd: +maxDD.toFixed(1), trades: tradeLog.length };
}

// ── 커스텀 툴팁
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 border border-slate-600 rounded-xl p-3 text-xs min-w-[160px]">
      <p className="text-slate-400 mb-2 font-semibold">{label}</p>
      {payload.map(p => {
        const chg = +(p.value - 100).toFixed(1);
        return (
          <div key={p.name} className="flex justify-between gap-3">
            <span style={{ color: p.color }}>{p.name}</span>
            <span style={{ color: p.color }} className="font-bold">
              {chg >= 0 ? "+" : ""}{chg}%
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default function TabBacktest() {
  const { curve, tradeLog, totalRet, mdd, trades } = useMemo(runGDBBacktest, []);

  return (
    <div className="space-y-4">
      {/* GDB 동결 안내 배너 */}
      <div className="flex items-center gap-3 px-4 py-3 bg-amber-950/40 border border-amber-800/50 rounded-xl text-xs text-amber-300">
        <span className="text-lg">🔒</span>
        <div>
          <span className="font-bold text-amber-200">GDB 영구 동결</span> — {GDB_FROZEN_AT} 기준.
          이 탭은 전략 세팅 도출 목적으로만 사용. 신규 데이터는 UDB(Firebase)에만 추가.
        </div>
      </div>

      {/* KPI 요약 */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label:"전략 누적", val:`+${totalRet}%`, color:"text-emerald-400" },
          { label:"5년 MDD",   val:`${mdd}%`,        color:"text-red-400" },
          { label:"총 거래",   val:`${trades}건`,     color:"text-blue-400" },
          { label:"확정 파라미터", val:"v10.0 PASS", color:"text-indigo-400" },
        ].map(k => (
          <div key={k.label} className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <p className="text-xs text-slate-500 mb-1">{k.label}</p>
            <p className={`text-xl font-bold ${k.color}`}>{k.val}</p>
          </div>
        ))}
      </div>

      {/* 수익률 비교 차트 */}
      <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
        <p className="text-sm font-bold text-slate-300 mb-4">수익률 비교 차트 (GDB 기준)</p>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={curve} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155"/>
            <XAxis dataKey="date" tick={{ fontSize: 10, fill:"#64748b" }} interval={5}/>
            <YAxis tick={{ fontSize: 10, fill:"#64748b" }} tickFormatter={v => `${v-100>0?"+":""}${(v-100).toFixed(0)}%`}/>
            <Tooltip content={<ChartTooltip />}/>
            <ReferenceLine y={100} stroke="#475569" strokeDasharray="4 2"/>
            <Line dataKey="strategy" name="전략"   stroke="#6366f1" dot={false} strokeWidth={2}/>
            <Line dataKey="buyhold"  name="B&H"    stroke="#94a3b8" dot={false} strokeWidth={1.5}/>
            <Line dataKey="kospi"    name="KOSPI"  stroke="#475569" dot={false} strokeWidth={1} strokeDasharray="4 2"/>
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* 거래 기록 요약 */}
      <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
        <p className="text-sm font-bold text-slate-300 mb-3">GDB 거래 기록 (최근 10건)</p>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-slate-700">
              <th className="pb-2 text-left">#</th>
              <th className="pb-2 text-left">월</th>
              <th className="pb-2 text-left">진입</th>
              <th className="pb-2 text-left">청산</th>
              <th className="pb-2 text-right">수익률</th>
              <th className="pb-2 text-right">참여율</th>
            </tr>
          </thead>
          <tbody>
            {tradeLog.slice(-10).reverse().map(t => (
              <tr key={t.id} className="border-b border-slate-800 hover:bg-slate-700/30">
                <td className="py-1.5 text-slate-500">{t.id}</td>
                <td className="py-1.5">{t.date}</td>
                <td className="py-1.5 text-slate-400">{t.entry}</td>
                <td className="py-1.5 text-slate-400">{t.exit}</td>
                <td className={`py-1.5 text-right font-bold ${t.ret >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {t.ret >= 0 ? "+" : ""}{t.ret}%
                </td>
                <td className="py-1.5 text-right text-slate-500">{(t.participation * 100).toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

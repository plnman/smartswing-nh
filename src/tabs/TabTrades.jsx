// ════════════════════════════════════════════════════════════════════════
// TabTrades — 실제 거래 기록 + 누적 P&L 관리
// Firebase /trades 컬렉션에서 로드 → 차트 + 테이블 표시
// ════════════════════════════════════════════════════════════════════════
import React, { useState, useEffect, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { db, COL } from "../firebase.js";
import { collection, getDocs, orderBy, query } from "firebase/firestore";

const BASE_CAPITAL = 50_000_000; // 5천만원

const krw = v => {
  const abs = Math.abs(v), sign = v >= 0 ? "+" : "-";
  if (abs >= 100_000_000) return sign + (abs / 100_000_000).toFixed(2) + "억";
  if (abs >=  10_000_000) return sign + (abs / 10_000_000).toFixed(1) + "천만";
  return sign + Math.round(abs / 10_000) + "만";
};

export default function TabTrades() {
  const [trades,   setTrades]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [firebaseOk, setFirebaseOk] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDocs(
          query(collection(db, COL.TRADES), orderBy("createdAt", "asc"))
        );
        setTrades(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        setFirebaseOk(true);
      } catch(e) {
        console.warn("거래 기록 로드 실패:", e.message);
        setFirebaseOk(false);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // ── 누적 곡선 계산
  const { curve, kpi } = useMemo(() => {
    if (trades.length === 0) return { curve: [], kpi: null };

    let equity = 100;
    let peak   = 100;
    let maxDD  = 0;
    const SLOT_WEIGHT = 1 / 5; // 5슬롯 분산

    const curve = trades.map((t, i) => {
      equity *= (1 + t.actualRet / 100 * SLOT_WEIGHT);
      if (equity > peak) peak = equity;
      const dd = (equity - peak) / peak * 100;
      if (dd < maxDD) maxDD = dd;
      return { idx: i + 1, date: t.date, equity: +equity.toFixed(2), ret: t.actualRet };
    });

    const totalRet  = +(equity - 100).toFixed(1);
    const wins      = trades.filter(t => t.actualRet >= 0).length;
    const winRate   = +(wins / trades.length * 100).toFixed(1);
    const avgRet    = +(trades.reduce((s, t) => s + t.actualRet, 0) / trades.length).toFixed(2);

    return {
      curve,
      kpi: { totalRet, mdd: +maxDD.toFixed(1), winRate, avgRet, count: trades.length },
    };
  }, [trades]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500">
        <svg className="animate-spin w-6 h-6 mr-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <circle cx="12" cy="12" r="10" strokeOpacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10"/>
        </svg>
        거래 기록 로딩 중…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Firebase 상태 */}
      {firebaseOk === false && (
        <div className="flex items-center gap-3 px-4 py-3 bg-amber-950/40 border border-amber-800/50 rounded-xl text-xs text-amber-300">
          ⚠ Firebase 미연결 — 거래 기록을 불러올 수 없습니다. firebase.js config를 설정해 주세요.
        </div>
      )}

      {/* KPI */}
      {kpi ? (
        <div className="grid grid-cols-5 gap-3">
          {[
            { label:"실거래 누적",  val:`${kpi.totalRet >= 0 ? "+" : ""}${kpi.totalRet}%`, color:"text-emerald-400" },
            { label:"실거래 MDD",   val:`${kpi.mdd}%`,    color:"text-red-400" },
            { label:"총 거래",      val:`${kpi.count}건`, color:"text-blue-400" },
            { label:"승률",         val:`${kpi.winRate}%`,color:"text-indigo-400" },
            { label:"평균 수익률",  val:`${kpi.avgRet >= 0 ? "+" : ""}${kpi.avgRet}%`, color: kpi.avgRet >= 0 ? "text-emerald-400" : "text-red-400" },
          ].map(k => (
            <div key={k.label} className="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <p className="text-xs text-slate-500 mb-1">{k.label}</p>
              <p className={`text-xl font-bold ${k.color}`}>{k.val}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-slate-800 rounded-xl p-8 border border-slate-700 text-center text-slate-600 text-sm">
          아직 실거래 기록이 없습니다 — 실시간 시뮬 탭에서 거래 완료를 등록하면 여기에 표시됩니다.
        </div>
      )}

      {/* 누적 수익률 곡선 */}
      {curve.length > 0 && (
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <p className="text-sm font-bold text-slate-300 mb-4">실거래 누적 수익률 곡선</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={curve} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155"/>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill:"#64748b" }}/>
              <YAxis tick={{ fontSize: 10, fill:"#64748b" }} tickFormatter={v => `${v-100 >= 0 ? "+" : ""}${(v-100).toFixed(0)}%`}/>
              <Tooltip
                contentStyle={{ background:"#1e293b", border:"1px solid #475569", borderRadius:"8px", fontSize:"11px" }}
                formatter={(v) => [`${(v-100).toFixed(1)}%`, "누적 수익"]}
              />
              <ReferenceLine y={100} stroke="#475569" strokeDasharray="4 2"/>
              <Line dataKey="equity" name="실거래 누적" stroke="#6366f1" dot={true} strokeWidth={2}/>
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 거래 기록 테이블 */}
      <div className="bg-slate-800 rounded-xl border border-slate-700">
        <div className="flex items-center gap-2 p-4 border-b border-slate-700">
          <span className="text-sm font-bold text-slate-200">실거래 기록</span>
          <span className="text-xs bg-slate-700 text-slate-400 px-2 py-0.5 rounded-full">
            {trades.length}건
          </span>
        </div>
        {trades.length === 0 ? (
          <div className="p-8 text-center text-slate-600 text-sm">거래 기록 없음</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-700">
                <th className="px-4 py-2 text-left">날짜</th>
                <th className="px-4 py-2 text-left">종목</th>
                <th className="px-4 py-2 text-right">매수가</th>
                <th className="px-4 py-2 text-right">매도가</th>
                <th className="px-4 py-2 text-right">수량</th>
                <th className="px-4 py-2 text-right">실수익률</th>
                <th className="px-4 py-2 text-right">손익</th>
              </tr>
            </thead>
            <tbody>
              {[...trades].reverse().map(t => {
                const pnl = t.qty ? (t.sellPrice - t.buyPrice) * t.qty - (t.buyPrice * t.qty * 0.0031) : null;
                return (
                  <tr key={t.id} className="border-b border-slate-800 hover:bg-slate-700/30">
                    <td className="px-4 py-2 text-slate-400">{t.date}</td>
                    <td className="px-4 py-2 font-medium">{t.stock?.name || "—"}</td>
                    <td className="px-4 py-2 text-right text-slate-300">{t.buyPrice?.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right text-slate-300">{t.sellPrice?.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right text-slate-500">{t.qty || "—"}</td>
                    <td className={`px-4 py-2 text-right font-bold ${t.actualRet >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {t.actualRet >= 0 ? "+" : ""}{t.actualRet}%
                    </td>
                    <td className={`px-4 py-2 text-right ${pnl && pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {pnl !== null ? krw(pnl) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

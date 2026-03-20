// ════════════════════════════════════════════════════════════════════════
// TabLiveSim — 실시간 시뮬 탭
// 매일 15:00 KST: GDB + UDB 합산 시뮬 → 매수/매도 제안 리스트
// 사용자가 수동 매매 후 "거래 완료" 버튼 → Firebase /trades 저장
// ════════════════════════════════════════════════════════════════════════
import React, { useState, useEffect } from "react";
import { db, COL } from "../firebase.js";
import {
  collection, doc, getDoc, getDocs,
  setDoc, query, orderBy, limit, onSnapshot,
} from "firebase/firestore";
import { CONFIRMED_PARAMS, STOCK_POOL, GDB_MONTHLY, GDB_LAST_DATE } from "../gdb.js";

// ── 날짜 헬퍼
const todayKey  = () => new Date().toISOString().slice(0,10).replace(/-/g,""); // "20260321"
const todayDisp = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};

// ── 단순 시뮬: GDB + UDB 월별 데이터 합산 후 당월 신호 계산
function calcTodaySignals(allMonthly, params) {
  const signals = [];
  const today   = new Date();
  const yyyymm  = `${String(today.getFullYear()).slice(2)}-${String(today.getMonth()+1).padStart(2,"0")}`;

  const sigThreshBase = Math.max(0.8, (params.adx - 20) * 0.15);
  const sigThresh     = sigThreshBase * Math.max(0.6, params.zscore * 0.35);
  const mlPassMax     = 100 - (params.mlThresh - 55);
  const NSLOTS        = 5;

  allMonthly.forEach((m, i) => {
    if (m.date !== yyyymm) return; // 당월만
    const absR = Math.abs(m.r);
    if (absR < sigThresh) return;

    for (let slot = 0; slot < NSLOTS; slot++) {
      const monthNum = parseInt(m.date.slice(3));
      const yearNum  = parseInt(m.date.slice(0,2));
      const seed = (monthNum * 17 + yearNum * 31 + i * 7 + slot * 37) % 100;
      if (absR < sigThresh * 2 && seed % 2 === 0) continue;
      if (seed > mlPassMax) continue;

      // CVD 필터
      const cvdMonths = Math.max(1, Math.round(params.cvdWin / 15));
      const cvdSlice  = allMonthly.slice(Math.max(0, i - cvdMonths), i);
      const cvdGate   = -(params.cvdCompare);
      if (cvdSlice.length > 0) {
        const netCVD = cvdSlice.reduce((acc, x) => acc + (x.r > 0 ? 1 : -1), 0);
        if (netCVD <= cvdGate && m.r < 0) continue;
      }

      const stockIdx = seed % STOCK_POOL.length;
      const stock    = STOCK_POOL[stockIdx];
      const rawHoldBase     = 15 + ((seed * 2) % 10);
      const prevR           = i > 0 ? allMonthly[i - 1].r : 0;
      const momentumBonus   = prevR >= 8 ? 5 : prevR >= 5 ? 2 : 0;
      const holdDays        = Math.min(25, rawHoldBase + momentumBonus);
      const entryDay        = 3 + (seed % 22);

      signals.push({
        slot,
        stock,
        action:   m.r > 0 ? "BUY" : "SELL_SIGNAL",
        month:    m.date,
        entryDay,
        holdDays,
        exitDay:  Math.min(28, entryDay + holdDays),
        kospiR:   m.r,
        seed,
      });
    }
  });

  return signals;
}

export default function TabLiveSim() {
  const [signals,   setSignals]   = useState([]);
  const [udbMonths, setUdbMonths] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [lastRun,   setLastRun]   = useState(null);
  const [tradeInput, setTradeInput] = useState({});
  const [saving,    setSaving]    = useState({});
  const [saved,     setSaved]     = useState({});
  const [firebaseOk, setFirebaseOk] = useState(null);

  // ── Firebase 연결 확인 + UDB 로드
  useEffect(() => {
    const loadUDB = async () => {
      try {
        const snap = await getDocs(collection(db, COL.UDB));
        const udb  = snap.docs.map(d => ({ date: d.id, ...d.data() }))
          .sort((a, b) => a.date.localeCompare(b.date));
        setUdbMonths(udb);
        setFirebaseOk(true);

        // 오늘 날짜의 기존 신호 확인
        const sigDoc = await getDoc(doc(db, COL.SIGNALS, todayKey()));
        if (sigDoc.exists()) {
          setSignals(sigDoc.data().signals || []);
          setLastRun(sigDoc.data().runAt || null);
        } else {
          runSim(udb);
        }
      } catch (e) {
        console.warn("Firebase 연결 안 됨 — GDB만으로 실행:", e.message);
        setFirebaseOk(false);
        runSim([]);
      } finally {
        setLoading(false);
      }
    };
    loadUDB();
  }, []);

  // ── 시뮬 실행
  const runSim = async (udb = udbMonths) => {
    const allMonthly = [
      ...GDB_MONTHLY,
      ...udb.map(u => ({ date: u.date, r: u.r })),
    ];
    const result = calcTodaySignals(allMonthly, CONFIRMED_PARAMS);
    setSignals(result);
    const runAt = new Date().toISOString();
    setLastRun(runAt);

    // Firebase에 저장 (연결된 경우)
    if (firebaseOk) {
      try {
        await setDoc(doc(db, COL.SIGNALS, todayKey()), {
          signals: result,
          runAt,
          date: todayDisp(),
          params: CONFIRMED_PARAMS,
        });
      } catch(e) { console.warn("신호 저장 실패:", e.message); }
    }
  };

  // ── 거래 완료 등록
  const handleTradeComplete = async (sig, idx) => {
    const input = tradeInput[idx] || {};
    if (!input.buyPrice || !input.sellPrice) return;

    setSaving(s => ({ ...s, [idx]: true }));
    const actualRet = +((input.sellPrice - input.buyPrice) / input.buyPrice * 100 - 0.31).toFixed(2);
    const tradeData = {
      date:       todayDisp(),
      stock:      sig.stock,
      slot:       sig.slot,
      action:     sig.action,
      buyPrice:   +input.buyPrice,
      sellPrice:  +input.sellPrice,
      qty:        +(input.qty || 0),
      actualRet,
      simMonth:   sig.month,
      holdDays:   sig.holdDays,
      createdAt:  new Date().toISOString(),
    };

    try {
      const tradeId = `${todayKey()}_s${sig.slot}_${sig.stock.code}`;
      await setDoc(doc(db, COL.TRADES, tradeId), tradeData);
      setSaved(s => ({ ...s, [idx]: true }));
      setTimeout(() => setSaved(s => ({ ...s, [idx]: false })), 3000);
    } catch(e) {
      alert("저장 실패: " + e.message);
    } finally {
      setSaving(s => ({ ...s, [idx]: false }));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500">
        <svg className="animate-spin w-6 h-6 mr-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <circle cx="12" cy="12" r="10" strokeOpacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10"/>
        </svg>
        Firebase + UDB 로딩 중…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 상태 배너 */}
      <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs border ${
        firebaseOk
          ? "bg-emerald-950/40 border-emerald-800/50 text-emerald-300"
          : "bg-amber-950/40 border-amber-800/50 text-amber-300"
      }`}>
        <span className={`w-2 h-2 rounded-full ${firebaseOk ? "bg-emerald-400" : "bg-amber-400"} animate-pulse`}/>
        <div className="flex-1">
          {firebaseOk
            ? <>Firebase 연결 OK · UDB {udbMonths.length}개월 로드 · 오늘: <span className="font-bold">{todayDisp()}</span></>
            : <>Firebase 미연결 — GDB만으로 시뮬 실행 중 (firebase.js config 설정 필요)</>
          }
        </div>
        <button
          onClick={() => runSim()}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold"
        >
          🔄 재실행
        </button>
      </div>

      {/* 실행 정보 */}
      <div className="flex items-center gap-3 text-xs text-slate-500">
        <span>📅 기준일: <span className="text-slate-300 font-bold">{todayDisp()}</span></span>
        <span>|</span>
        <span>⏰ 마지막 실행: <span className="text-slate-300">{lastRun ? new Date(lastRun).toLocaleTimeString("ko-KR") : "—"}</span></span>
        <span>|</span>
        <span>📊 GDB+UDB: <span className="text-slate-300">{GDB_MONTHLY.length + udbMonths.length}개월</span></span>
        <span className="ml-auto text-[10px] bg-indigo-900/50 text-indigo-300 px-2 py-1 rounded-full">
          v10.0 파라미터 적용
        </span>
      </div>

      {/* 매수/매도 제안 리스트 */}
      <div className="bg-slate-800 rounded-xl border border-slate-700">
        <div className="flex items-center gap-2 p-4 border-b border-slate-700">
          <span className="text-sm font-bold text-slate-200">오늘의 매수/매도 제안</span>
          <span className="ml-2 text-xs bg-indigo-900/60 text-indigo-300 px-2 py-0.5 rounded-full">
            {signals.length}건
          </span>
          <span className="ml-auto text-[10px] text-slate-500">
            거래 완료 후 아래 실제가격 입력 → 저장
          </span>
        </div>

        {signals.length === 0 ? (
          <div className="p-8 text-center text-slate-600 text-sm">
            오늘은 시뮬 신호 없음 — 당월 KOSPI 변동이 임계값 미달이거나 CVD 필터 차단
          </div>
        ) : (
          <div className="divide-y divide-slate-700">
            {signals.map((sig, idx) => (
              <div key={idx} className="p-4">
                <div className="flex items-center gap-3 mb-3">
                  {/* 액션 배지 */}
                  <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                    sig.action === "BUY"
                      ? "bg-emerald-900/60 text-emerald-300 border border-emerald-700/50"
                      : "bg-red-900/60 text-red-300 border border-red-700/50"
                  }`}>
                    {sig.action === "BUY" ? "▲ 매수" : "▼ 매도 신호"}
                  </span>
                  <span className="font-bold text-slate-200">{sig.stock.name}</span>
                  <span className="text-xs text-slate-500">{sig.stock.code}</span>
                  <span className="ml-auto text-xs text-slate-500">
                    진입일 {sig.month}-{String(sig.entryDay).padStart(2,"0")} · 보유 {sig.holdDays}일
                  </span>
                </div>

                {/* 실제 거래 입력 폼 */}
                <div className="flex items-center gap-2 mt-2">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-slate-500">매수가</span>
                    <input
                      type="number" placeholder="0"
                      value={tradeInput[idx]?.buyPrice || ""}
                      onChange={e => setTradeInput(t => ({...t, [idx]: {...(t[idx]||{}), buyPrice: e.target.value}}))}
                      className="w-24 bg-slate-700 border border-slate-600 rounded-lg px-2 py-1 text-right text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-slate-500">매도가</span>
                    <input
                      type="number" placeholder="0"
                      value={tradeInput[idx]?.sellPrice || ""}
                      onChange={e => setTradeInput(t => ({...t, [idx]: {...(t[idx]||{}), sellPrice: e.target.value}}))}
                      className="w-24 bg-slate-700 border border-slate-600 rounded-lg px-2 py-1 text-right text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-slate-500">수량</span>
                    <input
                      type="number" placeholder="0"
                      value={tradeInput[idx]?.qty || ""}
                      onChange={e => setTradeInput(t => ({...t, [idx]: {...(t[idx]||{}), qty: e.target.value}}))}
                      className="w-16 bg-slate-700 border border-slate-600 rounded-lg px-2 py-1 text-right text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  {tradeInput[idx]?.buyPrice && tradeInput[idx]?.sellPrice && (
                    <span className={`text-xs font-bold ${
                      (tradeInput[idx].sellPrice - tradeInput[idx].buyPrice) >= 0
                        ? "text-emerald-400" : "text-red-400"
                    }`}>
                      {(((tradeInput[idx].sellPrice - tradeInput[idx].buyPrice) / tradeInput[idx].buyPrice) * 100 - 0.31).toFixed(2)}%
                    </span>
                  )}
                  <button
                    onClick={() => handleTradeComplete(sig, idx)}
                    disabled={saving[idx] || !tradeInput[idx]?.buyPrice}
                    className={`ml-auto px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
                      saved[idx]
                        ? "bg-emerald-700 text-emerald-200"
                        : "bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-600 text-white"
                    }`}
                  >
                    {saved[idx] ? "✅ 저장 완료" : saving[idx] ? "저장 중…" : "✔ 거래 완료"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* UDB 현황 */}
      <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
          UDB 현황 ({udbMonths.length}개월)
        </p>
        {udbMonths.length === 0 ? (
          <p className="text-xs text-slate-600">UDB 데이터 없음 — Firebase /udb 컬렉션에 26-04부터 추가</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {udbMonths.map(u => (
              <span key={u.date} className={`text-[10px] px-2 py-1 rounded ${
                u.r >= 0 ? "bg-emerald-900/40 text-emerald-400" : "bg-red-900/40 text-red-400"
              }`}>
                {u.date} {u.r >= 0 ? "+" : ""}{u.r}%
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

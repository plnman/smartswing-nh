// ════════════════════════════════════════════════════════════════════════
// TabLiveSim — 실시간 신호 탭 (v2.0  2026-03-21)
//
// 데이터 흐름:
//   telegram_alert.py (GitHub Actions 15:00 KST)
//     → pykrx T-1 종가 수집 → Telegram 발송
//     → Firebase /daily/{YYYYMMDD} 저장
//   이 탭:
//     → /daily/{today}   읽기 → 매수 신호 + 청산 후보 표시
//     → /holdings/{code} 읽기 → 현재 보유 포트폴리오 표시
//     → 재실행 버튼 → GitHub Actions workflow_dispatch 호출
// ════════════════════════════════════════════════════════════════════════
import React, { useState, useEffect } from "react";
import { db, COL } from "../firebase.js";
import {
  collection, doc, getDoc, getDocs,
  setDoc, deleteDoc, addDoc,
} from "firebase/firestore";

// ── GitHub 설정 (재실행 버튼용)
const GH_OWNER = "plnman";
const GH_REPO  = "smartswing-nh";
const GH_WF    = "daily_alert.yml";

// ── KST 기준 오늘 날짜
function getKSTDateKey() {
  const kst = new Date(Date.now() + 9 * 3600_000);
  return kst.toISOString().slice(0, 10).replace(/-/g, ""); // "20260321"
}
function getKSTDateDisp() {
  const kst = new Date(Date.now() + 9 * 3600_000);
  return kst.toISOString().slice(0, 10); // "2026-03-21"
}

// ════════════════════════════════════════════════════════════════════════
//  메인 컴포넌트
// ════════════════════════════════════════════════════════════════════════
export default function TabLiveSim() {
  const [daily,     setDaily]     = useState(null);   // /daily/{today} 문서
  const [holdings,  setHoldings]  = useState({});     // {code: holdingObj}
  const [udbMonths, setUdbMonths] = useState([]);     // /udb 월별 목록
  const [loading,   setLoading]   = useState(true);

  // 재실행 버튼 상태
  const [rerunning, setRerunning] = useState(false);
  const [rerunMsg,  setRerunMsg]  = useState("");

  // 매수 등록 모달
  const [addModal, setAddModal] = useState(null);     // signal 객체
  const [addForm,  setAddForm]  = useState({ entry_price: "", qty: "" });

  // 매도 완료 모달
  const [sellModal, setSellModal] = useState(null);   // holding 객체
  const [sellForm,  setSellForm]  = useState({ sell_price: "", sell_date: "" });

  const todayKey  = getKSTDateKey();
  const todayDisp = getKSTDateDisp();

  // ── 초기 데이터 로드
  useEffect(() => {
    const load = async () => {
      try {
        // 오늘 신호
        const dailySnap = await getDoc(doc(db, COL.DAILY, todayKey));
        setDaily(dailySnap.exists() ? dailySnap.data() : null);

        // 보유 포지션
        const hSnap = await getDocs(collection(db, COL.HOLDINGS));
        const map   = {};
        hSnap.forEach(d => { map[d.id] = d.data(); });
        setHoldings(map);

        // UDB 현황
        const uSnap = await getDocs(collection(db, COL.UDB));
        const uList = uSnap.docs
          .map(d => ({ date: d.id, r: d.data().r ?? 0 }))
          .sort((a, b) => a.date.localeCompare(b.date));
        setUdbMonths(uList);

      } catch (e) {
        console.error("Firebase 로드 실패:", e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [todayKey]);

  // ── 재실행: Firestore /config/github 에서 PAT 읽어 GitHub API 호출
  const handleRerun = async () => {
    setRerunning(true);
    setRerunMsg("GitHub PAT 확인 중…");
    try {
      const cfgSnap = await getDoc(doc(db, "config", "github"));
      const pat = cfgSnap.exists() ? cfgSnap.data().pat : null;

      if (!pat) {
        setRerunMsg(
          "❌ PAT 미등록 — Firebase Console > Firestore > config/github 문서에 pat 필드 추가 필요"
        );
        setRerunning(false);
        return;
      }

      setRerunMsg("GitHub Actions 트리거 중…");
      const res = await fetch(
        `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${GH_WF}/dispatches`,
        {
          method: "POST",
          headers: {
            Authorization:          `Bearer ${pat}`,
            Accept:                 "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({ ref: "main" }),
        }
      );

      if (res.status === 204) {
        setRerunMsg("✅ 재실행 요청 완료 — 약 2~3분 후 Telegram 알림 + 이 페이지 새로고침");
      } else {
        const txt = await res.text();
        setRerunMsg(`❌ 실패 (HTTP ${res.status}): ${txt}`);
      }
    } catch (e) {
      setRerunMsg(`❌ 오류: ${e.message}`);
    } finally {
      setRerunning(false);
      setTimeout(() => setRerunMsg(""), 10_000);
    }
  };

  // ── 매수 등록 (모달 확인)
  const handleAddHolding = async () => {
    if (!addModal) return;
    const entryPrice = parseFloat(addForm.entry_price);
    const qty        = parseInt(addForm.qty, 10);
    if (!entryPrice || !qty) return;

    const data = {
      name:        addModal.name,
      code:        addModal.code,
      slot:        addModal.slot,
      rsi2:        addModal.rsi2,
      adx:         addModal.adx,
      entry_price: entryPrice,
      qty,
      amount:      entryPrice * qty,
      entry_date:  todayDisp,
    };

    await setDoc(doc(db, COL.HOLDINGS, addModal.code), data);
    setHoldings(prev => ({ ...prev, [addModal.code]: data }));
    setAddModal(null);
    setAddForm({ entry_price: "", qty: "" });
  };

  // ── 매도 완료 버튼 → 모달 열기
  const handleSellClick = (code) => {
    const h = holdings[code];
    if (!h) return;
    setSellModal({ ...h, code });
    setSellForm({ sell_price: "", sell_date: todayDisp });
  };

  // ── 매도 확정 → /trades 저장 + holding 삭제
  const handleConfirmSell = async () => {
    if (!sellModal) return;
    const sellPrice = parseFloat(sellForm.sell_price);
    if (!sellPrice || sellPrice <= 0) return;

    const h          = sellModal;
    const actualRet  = +((sellPrice / h.entry_price - 1) * 100 - 0.31).toFixed(2);
    const pnl        = Math.round((sellPrice - h.entry_price) * h.qty
                         - h.entry_price * h.qty * 0.0031);

    const tradeDoc = {
      // 기본 정보
      date:        sellForm.sell_date || todayDisp,
      stock:       { name: h.name, code: h.code },
      slot:        h.slot,

      // 매수 조건 (진입 시점 스냅샷)
      buyPrice:    h.entry_price,
      buyDate:     h.entry_date,
      qty:         h.qty,
      buyAmount:   h.amount,
      entryRsi2:   h.rsi2,
      entryAdx:    h.adx,

      // 매도 결과
      sellPrice,
      sellDate:    sellForm.sell_date || todayDisp,
      actualRet,
      pnl,

      createdAt:   new Date().toISOString(),
    };

    await addDoc(collection(db, COL.TRADES), tradeDoc);
    await deleteDoc(doc(db, COL.HOLDINGS, h.code));
    setHoldings(prev => {
      const next = { ...prev };
      delete next[h.code];
      return next;
    });
    setSellModal(null);
  };

  // ── 로딩
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500">
        <svg className="animate-spin w-6 h-6 mr-3" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="3">
          <circle cx="12" cy="12" r="10" strokeOpacity="0.3"/>
          <path d="M12 2a10 10 0 0 1 10 10"/>
        </svg>
        Firebase 로딩 중…
      </div>
    );
  }

  const signals    = daily?.signals || [];
  const exits      = daily?.exits   || [];
  const heldExits  = exits.filter(e => !!holdings[e.code]);   // 보유 중 → 청산 권고
  const otherExits = exits.filter(e => !holdings[e.code]);    // 미보유 → 기타 정보
  const t1Date  = daily?.t1_date;
  const runAt   = daily?.run_at;

  return (
    <div className="space-y-4">

      {/* ── 상태 배너 */}
      <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs border ${
        daily
          ? "bg-emerald-950/40 border-emerald-800/50"
          : "bg-amber-950/40 border-amber-800/50"
      }`}>
        <span className={`w-2 h-2 rounded-full shrink-0 ${
          daily ? "bg-emerald-400 animate-pulse" : "bg-amber-400"
        }`}/>
        <div className="flex-1 leading-relaxed">
          {daily ? (
            <span className="text-emerald-300">
              오늘 신호 로드 완료 &middot; T-1 기준:{" "}
              <span className="font-bold text-white">{t1Date}</span>
              {runAt && (
                <span className="text-slate-500 ml-2">
                  · 실행 {new Date(runAt).toLocaleTimeString("ko-KR")}
                </span>
              )}
            </span>
          ) : (
            <span className="text-amber-300">
              오늘 신호 없음 — 아직 15:00 자동 알림 전이거나 수동 재실행이 필요합니다
            </span>
          )}
        </div>
        <button
          onClick={handleRerun}
          disabled={rerunning}
          className="shrink-0 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500
            disabled:bg-slate-700 disabled:text-slate-500
            text-white rounded-lg text-xs font-semibold transition-all"
        >
          {rerunning ? "⏳ 요청 중…" : "🔄 재실행"}
        </button>
      </div>

      {rerunMsg && (
        <div className="px-4 py-2.5 rounded-lg text-xs border bg-indigo-950/60 border-indigo-800/50 text-indigo-200">
          {rerunMsg}
        </div>
      )}

      {/* ── 매수 신호 */}
      <SignalSection
        title="▲ 오늘 매수 신호"
        count={signals.length}
        countColor="bg-emerald-900/60 text-emerald-300"
        badge="T-1 종가 기준 · RSI-2 ≤ 15 + ADX ≥ 30"
        empty={daily ? "오늘 매수 신호 없음" : "신호 데이터 없음 — 재실행 또는 15:00 이후 확인"}
      >
        {signals.map((s, i) => {
          const held = !!holdings[s.code];
          return (
            <div key={i} className="p-4 space-y-2">
              {/* 종목 헤더 */}
              <div className="flex items-center gap-3">
                <span className="px-2.5 py-1 rounded-lg text-xs font-bold
                  bg-emerald-900/60 text-emerald-300 border border-emerald-700/50 shrink-0">
                  ▲ 매수
                </span>
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-slate-200">{s.name}</span>
                  <span className="text-xs text-slate-500 ml-2">{s.code} · 슬롯{s.slot}</span>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-slate-300">
                    ₩{s.price?.toLocaleString()} × {s.qty}주
                  </div>
                  <div className="text-[10px] text-slate-500">
                    = ₩{(s.price * s.qty)?.toLocaleString()}
                  </div>
                </div>
              </div>

              {/* 신호 사유 + 등록 버튼 */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2 py-0.5 rounded bg-slate-700 text-emerald-400 font-mono text-[11px]">
                  RSI-2 = {s.rsi2} ≤ 15 ✓
                </span>
                <span className="px-2 py-0.5 rounded bg-slate-700 text-sky-400 font-mono text-[11px]">
                  ADX = {s.adx} ≥ 30 ✓
                </span>
                <span className="text-[10px] text-slate-600">과매도 + 추세 확인</span>

                {held ? (
                  <span className="ml-auto text-xs text-yellow-400 font-semibold">🟡 보유 중</span>
                ) : (
                  <button
                    onClick={() => {
                      setAddModal(s);
                      setAddForm({
                        entry_price: String(Math.round(s.price)),
                        qty:         String(s.qty),
                      });
                    }}
                    className="ml-auto px-3 py-1 text-xs font-semibold rounded-lg transition-all
                      bg-emerald-800 hover:bg-emerald-700 text-emerald-200"
                  >
                    + 매수 등록
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </SignalSection>

      {/* ── 청산 후보 (보유 종목만) */}
      <SignalSection
        title="⬇ 청산 후보"
        count={heldExits.length}
        countColor="bg-red-900/60 text-red-300"
        badge="RSI-2 ≥ 99 과매수 감지 · 보유 종목만"
        empty="청산 후보 없음"
      >
        {heldExits.map((e, i) => (
          <div key={i} className="p-3 flex items-center gap-3">
            <span className="px-2.5 py-1 rounded-lg text-xs font-bold shrink-0
              bg-red-900/60 text-red-300 border border-red-700/50">
              ⚠ 청산 권고
            </span>
            <div className="flex-1 min-w-0">
              <span className="font-bold text-sm text-slate-200">{e.name}</span>
              <span className="text-xs text-slate-600 ml-2">{e.code}</span>
            </div>
            <span className="font-mono text-[11px] text-red-400 px-2 py-0.5 rounded bg-slate-700 shrink-0">
              RSI-2 = {e.rsi2} ≥ 99
            </span>
            <button
              onClick={() => handleSellClick(e.code)}
              className="px-3 py-1 text-xs font-semibold rounded-lg shrink-0 transition-all
                bg-red-900 hover:bg-red-800 text-red-200"
            >
              매도 완료
            </button>
          </div>
        ))}
      </SignalSection>

      {/* ── 기타 정보 (미보유 과매수 신호) */}
      {otherExits.length > 0 && (
        <SignalSection
          title="ℹ 기타 정보"
          count={otherExits.length}
          countColor="bg-slate-700 text-slate-400"
          badge="미보유 종목 RSI-2 ≥ 99 — 참고용"
          empty=""
        >
          {otherExits.map((e, i) => (
            <div key={i} className="p-3 flex items-center gap-3 opacity-50">
              <span className="px-2.5 py-1 rounded-lg text-xs shrink-0
                bg-slate-700/50 text-slate-500 border border-slate-600/50">
                미보유
              </span>
              <div className="flex-1 min-w-0">
                <span className="font-bold text-sm text-slate-500">{e.name}</span>
                <span className="text-xs text-slate-600 ml-2">{e.code}</span>
              </div>
              <span className="font-mono text-[11px] text-slate-500 px-2 py-0.5 rounded bg-slate-800 shrink-0">
                RSI-2 = {e.rsi2} ≥ 99
              </span>
            </div>
          ))}
        </SignalSection>
      )}

      {/* ── 현재 포트폴리오 */}
      <div className="bg-slate-800 rounded-xl border border-slate-700">
        <div className="flex items-center gap-2 p-4 border-b border-slate-700">
          <span className="text-sm font-bold text-slate-200">💼 현재 포트폴리오</span>
          <span className="ml-1 text-xs bg-indigo-900/60 text-indigo-300 px-2 py-0.5 rounded-full">
            {Object.keys(holdings).length}종목
          </span>
          <span className="ml-auto text-[10px] text-slate-500">
            총 투자금 ₩{
              Object.values(holdings)
                .reduce((sum, h) => sum + (h.entry_price * h.qty || 0), 0)
                .toLocaleString()
            }
          </span>
        </div>

        {Object.keys(holdings).length === 0 ? (
          <div className="p-8 text-center text-slate-600 text-sm">
            보유 종목 없음 — 매수 신호에서 "매수 등록" 클릭 시 추가됩니다
          </div>
        ) : (
          <div className="divide-y divide-slate-700/60">
            {Object.values(holdings).map(h => (
              <div key={h.code} className="p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-slate-200">{h.name}</span>
                    <span className="text-xs text-slate-500">{h.code}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900/50 text-indigo-400">
                      슬롯{h.slot}
                    </span>
                    <span className="text-[10px] text-slate-600">진입 {h.entry_date}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-400 flex items-center gap-3">
                    <span>₩{h.entry_price?.toLocaleString()} × {h.qty}주</span>
                    <span className="text-slate-600">= ₩{(h.entry_price * h.qty)?.toLocaleString()}</span>
                    <span className="font-mono text-[10px] text-slate-600">
                      RSI-2={h.rsi2} ADX={h.adx}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => handleSellClick(h.code)}
                  className="px-3 py-1.5 text-xs rounded-lg shrink-0 transition-all
                    bg-slate-700 hover:bg-red-900 text-slate-400 hover:text-red-200"
                >
                  매도 완료
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── UDB 현황 (소형) */}
      {udbMonths.length > 0 && (
        <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/40">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
            UDB 누적 ({udbMonths.length}개월)
          </p>
          <div className="flex flex-wrap gap-1">
            {udbMonths.map(m => (
              <span key={m.date} className={`text-[10px] px-1.5 py-0.5 rounded ${
                m.r >= 0
                  ? "bg-emerald-900/40 text-emerald-500"
                  : "bg-red-900/40 text-red-500"
              }`}>
                {m.date} {m.r >= 0 ? "+" : ""}{m.r}%
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── 매수 등록 모달 */}
      {addModal && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
          onClick={() => setAddModal(null)}
        >
          <div
            className="bg-slate-800 border border-slate-600 rounded-2xl p-6 w-80 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div>
              <h3 className="font-bold text-slate-200 text-base">매수 등록</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {addModal.name} ({addModal.code}) · 슬롯{addModal.slot}
              </p>
              <div className="mt-1 flex gap-2 text-[11px]">
                <span className="px-1.5 py-0.5 rounded bg-slate-700 text-emerald-400 font-mono">
                  RSI-2 = {addModal.rsi2}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-slate-700 text-sky-400 font-mono">
                  ADX = {addModal.adx}
                </span>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">실제 매수가 (원)</label>
                <input
                  type="number"
                  value={addForm.entry_price}
                  onChange={e => setAddForm(f => ({ ...f, entry_price: e.target.value }))}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2
                    text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                  placeholder={String(Math.round(addModal.price))}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">수량 (주)</label>
                <input
                  type="number"
                  value={addForm.qty}
                  onChange={e => setAddForm(f => ({ ...f, qty: e.target.value }))}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2
                    text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                  placeholder={String(addModal.qty)}
                />
              </div>

              {addForm.entry_price && addForm.qty && (
                <div className="text-xs text-slate-400 bg-slate-700/50 rounded px-3 py-2">
                  총 투자금 ₩{(
                    parseFloat(addForm.entry_price) * parseInt(addForm.qty, 10)
                  ).toLocaleString()}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setAddModal(null)}
                className="flex-1 px-4 py-2 text-sm rounded-lg transition-all
                  bg-slate-700 hover:bg-slate-600 text-slate-300"
              >
                취소
              </button>
              <button
                onClick={handleAddHolding}
                disabled={!addForm.entry_price || !addForm.qty}
                className="flex-1 px-4 py-2 text-sm font-semibold rounded-lg transition-all
                  bg-emerald-700 hover:bg-emerald-600
                  disabled:bg-slate-700 disabled:text-slate-600 text-white"
              >
                등록
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 매도 완료 모달 */}
      {sellModal && (() => {
        const sp = parseFloat(sellForm.sell_price);
        const ret = sp && sellModal.entry_price
          ? +((sp / sellModal.entry_price - 1) * 100 - 0.31).toFixed(2)
          : null;
        return (
          <div
            className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
            onClick={() => setSellModal(null)}
          >
            <div
              className="bg-slate-800 border border-slate-600 rounded-2xl p-6 w-80 space-y-4"
              onClick={e => e.stopPropagation()}
            >
              <div>
                <h3 className="font-bold text-slate-200 text-base">매도 완료 등록</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {sellModal.name} ({sellModal.code}) · 슬롯{sellModal.slot}
                </p>
                <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
                  <span className="px-1.5 py-0.5 rounded bg-slate-700 text-slate-400 font-mono">
                    매수 {sellModal.entry_date}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-700 text-slate-400 font-mono">
                    진입가 ₩{sellModal.entry_price?.toLocaleString()}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-700 text-emerald-400 font-mono">
                    RSI-2={sellModal.rsi2}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-700 text-sky-400 font-mono">
                    ADX={sellModal.adx}
                  </span>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">실제 매도가 (원)</label>
                  <input
                    type="number"
                    value={sellForm.sell_price}
                    onChange={e => setSellForm(f => ({ ...f, sell_price: e.target.value }))}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2
                      text-sm text-slate-200 focus:outline-none focus:border-red-500"
                    placeholder="매도 체결가 입력"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">매도일</label>
                  <input
                    type="date"
                    value={sellForm.sell_date}
                    onChange={e => setSellForm(f => ({ ...f, sell_date: e.target.value }))}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2
                      text-sm text-slate-200 focus:outline-none focus:border-red-500"
                  />
                </div>

                {ret !== null && (
                  <div className={`text-xs bg-slate-700/50 rounded px-3 py-2 font-bold ${
                    ret >= 0 ? "text-emerald-400" : "text-red-400"
                  }`}>
                    예상 실수익률: {ret >= 0 ? "+" : ""}{ret}%
                    &nbsp;·&nbsp;
                    손익: ₩{Math.round(
                      (sp - sellModal.entry_price) * sellModal.qty
                      - sellModal.entry_price * sellModal.qty * 0.0031
                    ).toLocaleString()}
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setSellModal(null)}
                  className="flex-1 px-4 py-2 text-sm rounded-lg transition-all
                    bg-slate-700 hover:bg-slate-600 text-slate-300"
                >
                  취소
                </button>
                <button
                  onClick={handleConfirmSell}
                  disabled={!sellForm.sell_price}
                  className="flex-1 px-4 py-2 text-sm font-semibold rounded-lg transition-all
                    bg-red-700 hover:bg-red-600
                    disabled:bg-slate-700 disabled:text-slate-600 text-white"
                >
                  매도 확정
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── 공용 섹션 컨테이너
function SignalSection({ title, count, countColor, badge, empty, children }) {
  const hasItems = React.Children.count(children) > 0;
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700">
      <div className="flex items-center gap-2 p-4 border-b border-slate-700">
        <span className="text-sm font-bold text-slate-200">{title}</span>
        <span className={`ml-1 text-xs px-2 py-0.5 rounded-full ${countColor}`}>
          {count}건
        </span>
        <span className="ml-auto text-[10px] text-slate-500">{badge}</span>
      </div>

      {!hasItems ? (
        <div className="p-6 text-center text-slate-600 text-sm">{empty}</div>
      ) : (
        <div className="divide-y divide-slate-700/60">{children}</div>
      )}
    </div>
  );
}

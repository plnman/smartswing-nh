// ════════════════════════════════════════════════════════════════════════
// TabStrategy — 전략 세팅 탭 (SmartSwing_Dashboard_v3 Tab3 완전 이식)
// params 슬라이더 + 7개 검증 체크리스트 + 기본값 버튼
// ════════════════════════════════════════════════════════════════════════
import React, { useState } from "react";
import {
  DEFAULT_PARAMS, CAPITAL_PER_SLOT, krw,
} from "../backtest.js";
import { db } from "../firebase.js";
import { doc, setDoc } from "firebase/firestore";

// ── ParamSlider 컴포넌트 (Tab3 외부 정의 — React 안티패턴 방지)
function ParamSlider({ label, val, min, max, step, unit, note, reason, locked, pk, setParams }) {
  const isReadOnly = locked || !pk;
  return (
    <div className={`mb-3 ${isReadOnly ? "opacity-40" : ""}`}>
      <div className="flex justify-between mb-1">
        <span className="text-xs text-slate-300">{label}</span>
        <span className={`text-xs font-bold ${isReadOnly ? "text-slate-500" : "text-indigo-300"}`}>{val}{unit}</span>
      </div>
      {pk ? (
        <input type="range" min={min} max={max} step={step} value={val} disabled={locked}
          onChange={e => setParams(p => ({ ...p, [pk]: +e.target.value }))}
          className="w-full h-1.5 accent-indigo-500 bg-slate-700 rounded-full cursor-pointer disabled:cursor-not-allowed"/>
      ) : (
        <input type="range" min={min} max={max} step={step} defaultValue={val} disabled
          className="w-full h-1.5 accent-indigo-500 bg-slate-700 rounded-full cursor-not-allowed"/>
      )}
      {note   && <p className="text-[10px] text-slate-500 mt-0.5">★ {note}</p>}
      {reason && <p className="text-[10px] text-amber-600/80 mt-0.5 flex items-center gap-1"><span>⚠</span>{reason}</p>}
    </div>
  );
}

// SIM_ATR (실시간 시뮬 탭 ATR 표시용)
const SIM_ATR = {
  "005930": { atr: 1420,  price: 72000,  name: "삼성전자"    },
  "035420": { atr: 4800,  price: 207800, name: "NAVER"       },
  "000660": { atr: 5200,  price: 204200, name: "SK하이닉스"  },
  "051910": { atr: 8500,  price: 312000, name: "LG화학"      },
  "373220": { atr: 3100,  price: 76000,  name: "LG에너지"    },
  "207940": { atr: 12000, price: 810000, name: "삼성바이오"  },
  "005380": { atr: 3200,  price: 218000, name: "현대차"      },
  "066570": { atr: 2100,  price: 91000,  name: "LG전자"      },
  "035720": { atr: 1800,  price: 48000,  name: "카카오"      },
  "096770": { atr: 4300,  price: 168000, name: "SK이노베이션" },
};

// ── 메인 전략 세팅 탭
export default function TabStrategy({ params, setParams, setTab, period, validationResults }) {
  const [saved,        setSaved]       = useState(false);
  const [defaultSaved, setDefaultSaved] = useState(false);
  const [rerunning,    setRerun]        = useState(false);

  const handleSave = () => {
    try { localStorage.setItem("smartswing_params", JSON.stringify(params)); } catch(e) {}
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleRerun = () => {
    setRerun(true);

    // ── Telegram 알림 (재실행 시 시스템 정상 확인용)
    const BOT  = import.meta.env.VITE_TELEGRAM_BOT_TOKEN;
    const CHAT = import.meta.env.VITE_TELEGRAM_CHAT_ID;
    if (BOT && CHAT) {
      const strat5y = validationResults.strat5y ?? "N/A";
      const bh5y    = validationResults.bh5y    ?? "N/A";
      const pass    = validationResults.passCount;
      const total   = validationResults.total;
      const allPass = pass === total;
      const now     = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
      const text = [
        `🔄 SmartSwing 백테스트 재실행`,
        `⏰ ${now}`,
        ``,
        `⚙️ 현재 파라미터 (v11.0 기반)`,
        `• ADX: ${params.adx} | RSI-2 진입: ${params.rsi2Entry}`,
        `• Trailing: ${params.trailing} | Hard Stop: ${params.hardStop}%`,
        `• ATR배수: ${params.atrMult} | L4 슬롯반감 기준: sigThresh×2=${((Math.max(0.8,(params.adx-20)*0.15)*Math.max(0.6,params.zscore*0.35))*2).toFixed(3)}%`,
        ``,
        `📊 5년 백테스트 결과`,
        `• 전략: +${strat5y}% | KOSPI B&H: +${bh5y}%`,
        ``,
        `📋 검증 체크리스트: ${pass}/${total} ${allPass ? "✅ 전항목 통과" : "❌ 미통과 항목 있음"}`,
        ``,
        allPass ? `🟢 시스템 정상 작동 중` : `🔴 파라미터 재검토 필요`,
      ].join("\n");
      fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: CHAT, text }),
      }).catch(() => {});  // 실패해도 UI 차단 없음
    }

    setTimeout(() => { setRerun(false); setTab(0); }, 1200);
  };

  // ── 기본값변경: 현재 params를 "사용자 기본값"으로 등록
  //   1) localStorage → 복원 버튼의 기준값
  //   2) Firebase /config/params → telegram_alert.py가 다음 15:00 실행 시 이 값으로 신호 생성
  const handleSetDefault = async () => {
    // ① localStorage 저장 (복원 기준)
    try { localStorage.setItem("smartswing_user_default", JSON.stringify(params)); } catch(e) {}

    // ② Firebase /config/params 저장 (telegram_alert.py 적용용)
    try {
      await setDoc(doc(db, "config", "params"), {
        // telegram_alert.py PARAMS 키와 매핑
        adx:        params.adx,        // → adxMin
        rsi2Entry:  params.rsi2Entry,
        rsi2Exit:   params.rsi2Exit,
        hardStop:   params.hardStop,
        trailing:   params.trailing,
        // 추가 파라미터 (향후 확장용)
        mlThresh:   params.mlThresh,
        zscore:     params.zscore,
        cvdWin:     params.cvdWin,
        cvdCompare: params.cvdCompare,
        nSlots:     params.nSlots,
        atrMult:    params.atrMult,
        timeCut:    params.timeCut,
        timeCutOn:  params.timeCutOn,
        updatedAt:  new Date().toISOString(),
      });
      console.log("✅ Firebase /config/params 저장 완료");
    } catch(e) {
      console.warn("⚠ Firebase params 저장 실패 (localStorage는 저장됨):", e);
    }

    setDefaultSaved(true);
    setTimeout(() => setDefaultSaved(false), 2500);
  };

  // ── 기본값 복원: 사용자 기본값 → 없으면 빌트인 DEFAULT_PARAMS
  const handleReset = () => {
    try {
      const userDef = localStorage.getItem("smartswing_user_default");
      if (userDef) {
        setParams({ ...DEFAULT_PARAMS, ...JSON.parse(userDef) });
      } else {
        setParams({ ...DEFAULT_PARAMS });
      }
      localStorage.removeItem("smartswing_params");
    } catch(e) {
      setParams({ ...DEFAULT_PARAMS });
    }
  };

  // ── 검증 체크리스트는 App.jsx useMemo에서 계산 후 props로 전달됨
  // (탭 위치 무관하게 params 변경 시 항상 자동 재계산)

  const ps = setParams;

  return (
    <div className="space-y-4">

      {/* 실시간 반영 안내 배너 */}
      <div className="px-4 py-2.5 bg-indigo-900/30 border border-indigo-700/60 rounded-xl text-xs text-indigo-300 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"/>
        파라미터 변경은 <span className="font-bold">즉시 자동 반영</span>됩니다 — 백테스팅 탭에서 실시간 확인 가능
        <span className="ml-auto text-indigo-500 text-[10px]">현재 기간: <span className="text-indigo-300 font-bold">{period}</span></span>
      </div>

      {saved && (
        <div className="px-4 py-2.5 bg-emerald-900/40 border border-emerald-600 rounded-xl text-sm text-emerald-300 flex items-center gap-2 flex-wrap gap-y-1">
          ✅ <span className="font-bold">백테스팅 임시 저장 완료</span>
          <span className="text-[11px] text-emerald-500">
            이 탭에서 슬라이더 조작용 — 매수/매도 신호에 반영하려면 <span className="text-amber-300 font-bold">🎯 기본값변경</span>을 누르세요
          </span>
        </div>
      )}
      {defaultSaved && (
        <div className="px-4 py-2.5 bg-amber-900/40 border border-amber-600 rounded-xl text-sm text-amber-300 flex items-center gap-2 flex-wrap gap-y-1">
          🎯 <span className="font-bold">기본값 변경 완료</span>
          <span className="text-[11px] text-amber-400">
            백테스팅 기준 + <span className="font-bold text-white">매수/매도 신호 생성 파라미터</span> 모두 업데이트됨
            (내일 15:00 실행부터 적용) · 🔁 복원 시 이 값으로 되돌아옴
          </span>
        </div>
      )}

      {/* ── 자금 관리 */}
      <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">자금 관리</p>
        <div className="grid grid-cols-2 gap-6">
          <ParamSlider label="종목당 투자금 (만원)" val={1000} min={500} max={3000} step={100} unit="만" note="고정 슬롯 — ATR 동적 사이징 미사용" setParams={ps}/>
          <ParamSlider label="최대 동시 보유 종목" val={params.nSlots} min={1} max={10} step={1} unit="종목"
            note={`총 최대 투자금 = 1,000만 × ${params.nSlots} = ${(params.nSlots * 1000).toLocaleString()}만원`}
            pk="nSlots" setParams={ps}/>
        </div>
        <div className="mt-2 p-2 bg-indigo-900/20 rounded-lg border border-indigo-800/40 text-[10px] text-indigo-300">
          <span className="font-bold">규칙 5 [v10]</span> 동일 GICS 섹터 최대 2종목 동시 보유
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">

        {/* ── L1 Market Shield */}
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <div className="flex items-center gap-2 mb-3">
            <span className="px-2 py-0.5 bg-indigo-900 text-indigo-200 rounded text-xs font-bold">L1</span>
            <p className="text-xs font-bold text-slate-300">Market Shield</p>
            <span className="ml-auto text-[9px] px-1.5 py-0.5 bg-emerald-900/60 text-emerald-300 rounded border border-emerald-700/50">✅ 실전 작동</span>
          </div>
          <div className="mb-2 p-2 bg-emerald-950/40 border border-emerald-800/40 rounded-lg text-[9px] text-emerald-300 leading-relaxed">
            <span className="font-bold text-emerald-200">v3 실전 작동</span> — 당월 KOSPI200 하락(&lt;-1%) AND 전월수익률/15 &lt; finBertThresh 동시 충족 시 해당 월 신호 전체 차단
          </div>
          <ParamSlider label="finBertThresh (전월 수익률/15 하한)" val={params.finBertThresh} min={-0.5} max={0.5} step={0.05} unit="" note={`전월 KOSPI200 수익률/15 < ${params.finBertThresh} → L1 차단 (당월 하락일 때만)`} pk="finBertThresh" setParams={ps}/>
        </div>

        {/* ── L2 Trend & Pullback */}
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <div className="flex items-center gap-2 mb-3">
            <span className="px-2 py-0.5 bg-blue-900 text-blue-200 rounded text-xs font-bold">L2</span>
            <p className="text-xs font-bold text-slate-300">Trend & Pullback</p>
          </div>
          <ParamSlider label="ADX(14) 최소값" val={params.adx} min={20} max={45} step={5} unit="" note="강한 추세 기준" pk="adx" setParams={ps}/>
          <ParamSlider label="RSI-2 진입 기준 (≤)" val={params.rsi2Entry} min={5} max={25} step={5} unit="" pk="rsi2Entry" setParams={ps}/>
          <ParamSlider label="이격도 하한 SMA20" val={97} min={90} max={100} step={1} unit="%" note="시뮬 미반영 — UI 표시 전용" setParams={ps}/>
        </div>

        {/* ── L3 CVD + sigThresh */}
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <div className="flex items-center gap-2 mb-3">
            <span className="px-2 py-0.5 bg-emerald-900 text-emerald-200 rounded text-xs font-bold">L3</span>
            <p className="text-xs font-bold text-slate-300">CVD + 시장 모멘텀</p>
            <span className="ml-auto text-[9px] px-1.5 py-0.5 bg-emerald-900/60 text-emerald-300 rounded">✅ 실전 작동</span>
          </div>
          <ParamSlider label="Vol Z-Score (sigThresh 인자)" val={params.zscore} min={0.5} max={3.5} step={0.5} unit=""
            note={`sigThresh = max(0.8,(adx-20)×0.15)×max(0.6,zscore×0.35) = ${(Math.max(0.8,(params.adx-20)*0.15)*Math.max(0.6,params.zscore*0.35)).toFixed(3)}`}
            pk="zscore" setParams={ps}/>
          <ParamSlider label="CVD 롤링 윈도우" val={params.cvdWin} min={30} max={90} step={15} unit="일"
            note={`KOSPI200 월별 방향 카운트 기간 → ${Math.max(1,Math.round(params.cvdWin/15))}개월`}
            pk="cvdWin" setParams={ps}/>
          <ParamSlider label="CVD Gate 강도" val={params.cvdCompare} min={3} max={10} step={1} unit=""
            note={`cvdGate = -floor(${params.cvdCompare}/2) = ${-Math.floor(params.cvdCompare/2)}  (netCVD ≤ 이 값 AND 하락 → 차단)`}
            pk="cvdCompare" setParams={ps}/>
        </div>

        {/* ── L4 약한 모멘텀 슬롯 반감 (V3 자동 계산, 파라미터 없음) */}
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <div className="flex items-center gap-2 mb-3">
            <span className="px-2 py-0.5 bg-purple-900 text-purple-200 rounded text-xs font-bold">L4</span>
            <p className="text-xs font-bold text-slate-300">약한 모멘텀 슬롯 반감</p>
            <span className="ml-auto text-[9px] px-1.5 py-0.5 bg-emerald-900/60 text-emerald-300 rounded border border-emerald-700/50">✅ 실전 작동</span>
          </div>
          <div className="p-3 bg-purple-900/20 rounded-lg border border-purple-800/40 text-[10px] text-purple-200 space-y-1.5">
            <div className="font-bold text-purple-300 mb-1">[V3 실제 동작] — 조정 파라미터 없음, 자동 계산</div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">발동 조건</span>
              <span className="font-mono text-slate-200">|KOSPI 당월 수익률| &lt; sigThresh × 2</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">현재 기준값</span>
              <span className="font-mono text-purple-300">
                sigThresh {(Math.max(0.8,(params.adx-20)*0.15)*Math.max(0.6,params.zscore*0.35)).toFixed(3)} × 2 = <span className="text-amber-300">{((Math.max(0.8,(params.adx-20)*0.15)*Math.max(0.6,params.zscore*0.35))*2).toFixed(3)}%</span>
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">발동 시 슬롯</span>
              <span className="font-mono text-amber-300">{params.nSlots}종목 → {Math.max(1,Math.floor(params.nSlots/2))}종목 (nSlots ÷ 2)</span>
            </div>
            <p className="text-[9px] text-slate-500 pt-1.5 border-t border-purple-800/30">
              ★ ADX · zscore 변경 시 sigThresh가 연동되어 기준값 자동 재계산
            </p>
          </div>
        </div>
      </div>

      {/* ── EXIT 전략 */}
      <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">EXIT 전략</p>
        <div className="grid grid-cols-3 gap-5">

          {/* 컬럼 1: Hard Stop + Time-Cut */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs text-slate-300">Hard Stop (%)</span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-indigo-300">{params.hardStop}%</span>
                <span className="text-[9px] text-slate-500 bg-slate-700 px-1.5 py-0.5 rounded">
                  ≈ {krw(-Math.round(CAPITAL_PER_SLOT * params.hardStop / 100))}
                </span>
              </div>
            </div>
            <input type="range" min={1} max={8} step={0.5} value={params.hardStop}
              onChange={e => ps(p => ({ ...p, hardStop: +e.target.value }))}
              className="w-full h-1.5 accent-indigo-500 bg-slate-700 rounded-full cursor-pointer mb-0.5"/>
            <p className="text-[9px] text-emerald-400/90 mb-1 flex items-center gap-1">
              <span>✓</span>종목별 ATR×{params.atrMult} 자동 적용 (UI 슬라이더는 fallback 기준)
            </p>
            <div className="mb-2 px-2 py-1.5 bg-emerald-900/20 border border-emerald-800/40 rounded-lg text-[9px] text-emerald-300 space-y-0.5">
              <div className="font-bold text-emerald-400">✅ ATR 기반 종목별 손절 구현됨</div>
              <div>① yfinance 실제 일봉 → 14일 ATR% (2026-03-20)</div>
              <div>② Hard Stop = ATR × <span className="font-bold text-white">{params.atrMult}</span>  (min 1.5% / max 8.0%)</div>
              <div>③ Look-ahead 없음: 당월 첫 거래일 이전 14일 기준</div>
              <div className="text-slate-400 pt-0.5">삼성전자 ≈{(2.18*params.atrMult).toFixed(1)}% | 하이닉스 ≈{(3.49*params.atrMult).toFixed(1)}% | 카카오 ≈{(3.25*params.atrMult).toFixed(1)}%</div>
            </div>

            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs text-slate-300">ATR 배수 (×)</span>
              <span className="text-xs font-bold text-emerald-300">{params.atrMult}×</span>
            </div>
            <input type="range" min={1.0} max={3.0} step={0.5} value={params.atrMult}
              onChange={e => ps(p => ({ ...p, atrMult: +e.target.value }))}
              className="w-full h-1.5 accent-emerald-500 bg-slate-700 rounded-full cursor-pointer mb-0.5"/>
            <p className="text-[9px] text-slate-500 mb-3">
              ★ 1.0×=타이트 손절  2.0×=표준  3.0×=여유 손절 (노이즈 차단)
            </p>

            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs text-slate-300">Time-Cut (거래일)</span>
              <div className="flex items-center gap-2">
                {params.timeCutOn && (
                  <span className="text-xs font-bold text-indigo-300">{params.timeCut}일</span>
                )}
                <button
                  onClick={() => ps(p => ({ ...p, timeCutOn: !p.timeCutOn }))}
                  className={`relative w-8 h-4 rounded-full transition-colors flex-shrink-0 ${params.timeCutOn ? "bg-indigo-600" : "bg-slate-600"}`}>
                  <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-all ${params.timeCutOn ? "left-4" : "left-0.5"}`}/>
                </button>
              </div>
            </div>
            <input type="range" min={5} max={30} step={1} value={params.timeCut}
              disabled={!params.timeCutOn}
              onChange={e => ps(p => ({ ...p, timeCut: +e.target.value }))}
              className={`w-full h-1.5 accent-indigo-500 bg-slate-700 rounded-full mb-0.5 ${params.timeCutOn ? "cursor-pointer" : "cursor-not-allowed opacity-40"}`}/>
            <p className="text-[9px] text-slate-500 mb-3">
              {params.timeCutOn
                ? `★ 최대 ${params.timeCut}거래일 경과 시 강제 청산`
                : <span className="text-amber-600/80 flex items-center gap-1"><span>⚠</span>OFF — RSI-2·Hard Stop 신호로만 청산</span>
              }
            </p>
          </div>

          {/* 컬럼 2: Trailing — 실전 전용 */}
          <div>
            <div className="mb-2 px-2 py-1 bg-amber-900/20 border border-amber-700/40 rounded-lg text-[9px] text-amber-400 flex items-center gap-1">
              <span>⚡</span> 실전 전용 — 백테스트 수치에 미반영
              <span className="text-slate-500 ml-1">(월별 종가 기준 시뮬 한계)</span>
            </div>
            <ParamSlider label="Trailing 활성 기준" val={+(params.hardStop * 1.4).toFixed(1)}
              min={2} max={10} step={0.5} unit="%"
              reason={`Hard Stop(${params.hardStop}%) × 1.4 자동 산출 — 별도 조정 불가`}
              setParams={ps}/>
            <ParamSlider label="Trailing 폭" val={params.trailing} min={1} max={5} step={0.5} unit="%" pk="trailing" setParams={ps}
              note="고점 대비 이 % 하락 시 telegram_alert.py 청산 신호"/>
          </div>

          {/* 컬럼 3: RSI */}
          <div>
            <ParamSlider label="RSI-2 즉시 청산 (≥)" val={params.rsi2Exit} min={80} max={99} step={5} unit="" pk="rsi2Exit" setParams={ps}
              note="과매수 도달 → 즉시 전량 매도"/>
            {/* RSI-14 분할매도: V3 미구현, 고정값 */}
            <div className="mb-3 opacity-50">
              <div className="flex justify-between mb-1">
                <span className="text-xs text-slate-300">RSI-14 분할매도 (≥)</span>
                <span className="text-xs font-bold text-slate-500">70 (고정)</span>
              </div>
              <input type="range" min={60} max={85} step={5} defaultValue={70} disabled
                className="w-full h-1.5 accent-indigo-500 bg-slate-700 rounded-full cursor-not-allowed"/>
              <p className="text-[9px] text-amber-600/80 mt-0.5 flex items-center gap-1">
                <span>⚠</span>V3 미구현 — 개별 종목 연동 없이 고정값 70 적용 중
              </p>
            </div>
          </div>
        </div>

        {/* 청산 우선순위 */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <div className="grid grid-cols-6 gap-1.5 flex-1 text-[10px] text-center">
            {[
              ["1","Hard Stop","bg-red-900 text-red-300"],
              ["2","갭다운","bg-red-800 text-red-300"],
              ["3",`RSI-2≥${params.rsi2Exit}`,"bg-orange-900 text-orange-300"],
              ["4","Trailing","bg-yellow-900 text-yellow-300"],
              ["5","RSI-14≥70","bg-blue-900 text-blue-300"],
              ["6","Time-Cut", params.timeCutOn ? "bg-slate-700 text-slate-300" : "bg-slate-800 text-slate-600 line-through"],
            ].map(([p,l,c]) => (
              <div key={p} className={`${c} rounded-lg py-1.5`}>
                <div className="opacity-50 text-[9px]">{p}순위</div>
                <div className="font-semibold">{l}</div>
              </div>
            ))}
          </div>
          {!params.timeCutOn && (
            <span className="text-[10px] bg-amber-900/30 text-amber-400 border border-amber-700/50 px-2 py-1 rounded-lg">
              ⚠ Time-Cut OFF
            </span>
          )}
        </div>
      </div>

      {/* ── 실제 사용 지표 전체 목록 (설정 탭에 없는 지표 포함) */}
      <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/50">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm">📐</span>
          <p className="text-xs font-bold text-slate-300 uppercase tracking-wider">실제 사용 지표 전체 목록</p>
          <span className="ml-auto text-[10px] text-slate-600">telegram_alert.py · 매일 15:00 KST 계산</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          {[
            { name:"KOSPI200 시장타이밍", calc:`sigThresh=${(Math.max(0.8,(params.adx-20)*0.15)*Math.max(0.6,params.zscore*0.35)).toFixed(3)} — 당월 수익률 절대값 기준`, setting:"L0: |KOSPI 당월수익률| < sigThresh → 진입 없음", active:true },
            { name:"L1 Market Shield", calc:"당월 하락 + 전월 약세 동시 차단", setting:`finBertThresh=${params.finBertThresh} (전월 수익률/15 하한)`, active:true },
            { name:"L3 CVD Gate", calc:`KOSPI200 최근 ${Math.max(1,Math.round(params.cvdWin/15))}개월 방향 net 카운트`, setting:`cvdGate=${-Math.floor(params.cvdCompare/2)} — 매도 우위 + 하락장 → 차단`, active:true },
            { name:"RSI-2", calc:"최근 2일 Gain/Loss 평균 — 종목 스크리닝", setting:`≤ ${params.rsi2Entry} 진입 (과매도 탐색)  ≥ ${params.rsi2Exit} 청산`, active:true },
            { name:"ADX(14)", calc:"EWM 14일 — 60 거래일 데이터 기반", setting:`≥ ${params.adx} (L2 추세 강도 확인)`, active:true },
            { name:"ATR(14)", calc:"True Range EWM 14일", setting:`hardStop=${params.hardStop}% 손절 기준 (알림 표시용)`, active:true },
            { name:"SMA20 이격도", calc:"종가 / 20일 이동평균", setting:"≥ 97% 기준 — 현재 UI 표시 전용, 신호에 미반영", active:false },
            { name:"약한 모멘텀 슬롯 (L4)", calc:`|KOSPI당월| < sigThresh×2 = ${((Math.max(0.8,(params.adx-20)*0.15)*Math.max(0.6,params.zscore*0.35))*2).toFixed(3)}% 시 자동 발동`, setting:`슬롯 ${params.nSlots}종목 → ${Math.max(1,Math.floor(params.nSlots/2))}종목 (nSlots÷2 고정)`, active:true },
            { name:"Trailing Stop", calc:"고점 대비 하락폭 추적 — 실전 전용", setting:`${params.trailing}% 하락 시 청산 (telegram_alert.py) · 백테스트 미반영`, active:true },
            { name:"Time-Cut", calc:"보유 거래일 카운터", setting:params.timeCutOn ? `${params.timeCut}거래일 초과 시 강제 청산` : "현재 OFF", active:params.timeCutOn },
          ].map(ind => (
            <div key={ind.name} className={`flex gap-2 p-2 rounded-lg border ${
              ind.active
                ? "bg-slate-700/40 border-slate-600/50"
                : "bg-slate-800/40 border-slate-700/30 opacity-60"
            }`}>
              <div className="shrink-0 mt-0.5">
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${ind.active ? "bg-emerald-400" : "bg-slate-600"}`}/>
              </div>
              <div className="min-w-0">
                <div className="font-bold text-slate-200">{ind.name}
                  {!ind.active && <span className="ml-1 text-[9px] text-amber-500 font-normal">미작동</span>}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">{ind.calc}</div>
                <div className="text-[10px] text-indigo-400 mt-0.5">{ind.setting}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 파라미터 변경 검증 체크리스트 */}
      <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm">📋</span>
          <p className="text-xs font-bold text-slate-200 uppercase tracking-wider">파라미터 변경 검증 체크리스트</p>
          <span className={`ml-auto text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
            validationResults.passCount === validationResults.total
              ? "bg-emerald-900/60 text-emerald-300 border-emerald-700"
              : "bg-red-900/60 text-red-300 border-red-700 animate-pulse"
          }`}>
            {validationResults.passCount}/{validationResults.total} PASS
          </span>
        </div>
        <p className="text-[10px] text-slate-500 mb-3">
          설정 저장 전 <span className="text-slate-300 font-bold">상승·하락장 모두</span> 통과해야 합니다 — 파라미터 변경마다 자동 재계산됩니다.
        </p>

        <div className="space-y-1">
          {validationResults.checks.map((c, idx) => {
            const valStr = c.val === null ? "N/A"
              : typeof c.val === "number" && c.label.includes("Sharpe") ? String(c.val)
              : c.val >= 0 ? `+${c.val}%` : `${c.val}%`;
            return (
              <div key={idx} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] transition-colors ${
                c.pass
                  ? "bg-emerald-950/40 border border-emerald-800/30"
                  : "bg-red-950/50 border border-red-700/50"
              }`}>
                <span className="text-sm shrink-0">{c.pass ? "✅" : "❌"}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold shrink-0 ${
                  c.cat.includes("상승") ? "bg-emerald-900/60 text-emerald-400" :
                  c.cat.includes("하락") ? "bg-red-900/60 text-red-400" :
                  "bg-slate-700 text-slate-400"
                }`}>{c.cat}</span>
                <span className="text-slate-300 flex-1 min-w-0 truncate">{c.label}</span>
                <span className={`font-bold shrink-0 ${c.pass ? "text-emerald-300" : "text-red-400"}`}>
                  {valStr}
                </span>
                <span className="text-slate-600 text-[9px] shrink-0 hidden sm:block">{c.desc}</span>
              </div>
            );
          })}
        </div>

        {validationResults.passCount === validationResults.total ? (
          <div className="mt-3 p-2 bg-emerald-950/50 border border-emerald-700/50 rounded-lg text-[10px] text-emerald-300 flex items-center gap-2">
            <span>✅</span>
            <span><span className="font-bold text-emerald-200">전 항목 통과</span> — 상승·하락장 양방향 검증 완료. 설정 저장 가능합니다.</span>
          </div>
        ) : (
          <div className="mt-3 p-2 bg-red-950/60 border border-red-700/50 rounded-lg text-[10px] text-red-300 flex items-center gap-2">
            <span>⚠</span>
            <span><span className="font-bold text-red-200">{validationResults.total - validationResults.passCount}개 항목 미통과</span> — 설정 저장 전 파라미터를 재검토하세요. 상승·하락장 한 쪽이 무너지는 설정입니다.</span>
          </div>
        )}
      </div>

      {/* ── 버튼 행 */}
      <div className="flex gap-3">
        <button onClick={handleRerun} disabled={rerunning}
          className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white text-sm font-semibold rounded-xl flex items-center justify-center gap-2">
          {rerunning
            ? <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4"><circle cx="12" cy="12" r="10" strokeOpacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>재실행 중…</>
            : "🔄 백테스트 재실행"}
        </button>
        <button onClick={handleSave}
          className={`flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all ${saved ? "bg-emerald-700 text-emerald-200" : "bg-slate-700 hover:bg-slate-600 text-slate-200"}`}
          title="현재 파라미터를 저장 (프론트엔드 백테스팅 기준)">
          {saved ? "✅ 저장 완료!" : "💾 설정 저장"}
        </button>
        <button onClick={handleSetDefault}
          className={`flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all border ${
            defaultSaved
              ? "bg-amber-700 text-amber-200 border-amber-600"
              : "bg-slate-800 hover:bg-amber-900/40 hover:border-amber-700/60 hover:text-amber-300 text-slate-300 border-slate-600"
          }`}
          title="현재 파라미터를 '나만의 기본값'으로 등록 — 이후 🔁 기본값 복원 시 이 값으로 리셋됨">
          {defaultSaved ? "🎯 기본값 등록 완료!" : "🎯 기본값변경"}
        </button>
        <button onClick={handleReset}
          className="px-4 py-2.5 bg-slate-800 hover:bg-red-900/50 hover:border-red-700 hover:text-red-300 text-slate-400 text-sm rounded-xl border border-slate-600 transition-all"
          title="나만의 기본값(없으면 빌트인 기본값)으로 복원">
          🔁 복원
        </button>
      </div>

    </div>
  );
}

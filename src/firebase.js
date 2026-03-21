// ════════════════════════════════════════════════════════════════════════
// Firebase 설정 — SmartSwing-NH 전용 앱
// Firebase 프로젝트: aidash-d831b (기존 AIDASH 프로젝트 재사용)
// 앱 이름: SMARTSWING_NH (AI_DASHBOARD 와 완전 별개)
// ════════════════════════════════════════════════════════════════════════
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// ✅ 2026-03-21 SMARTSWING_NH 앱 등록 완료 — config 적용
const firebaseConfig = {
  apiKey:            "AIzaSyCrcfv5AKFmNneeMrNuQpWq79YsEXQJk54",
  authDomain:        "aidash-d831b.firebaseapp.com",
  projectId:         "aidash-d831b",
  storageBucket:     "aidash-d831b.firebasestorage.app",
  messagingSenderId: "718233578258",
  appId:             "1:718233578258:web:35609f5513b306f14021cb",
  measurementId:     "G-YMWR5RV7BH",
};

const app = initializeApp(firebaseConfig, "smartswing-nh"); // 2번째 인자: 앱 이름 (AI_DASHBOARD 와 충돌 방지)
export const db = getFirestore(app);

// ── Firestore 컬렉션 경로 상수 ──────────────────────────────────────────
// UDB  : /udb/{yyyy-mm}          — 신규 월별 KOSPI 데이터 (GDB 이후)
// 신호  : /signals/{yyyymmdd}    — 매일 3시 시뮬 결과 (매수/매도 제안)
// 거래  : /trades/{id}           — 실제 수동 거래 기록 (사용자 입력)
// 포트  : /portfolio/snapshot    — 누적 수익률 스냅샷
export const COL = {
  UDB:      "udb",       // /udb/{yy-mm}          — 월별 KOSPI 집계 (UDB)
  DAILY:    "daily",     // /daily/{YYYYMMDD}      — 일별 실제 pykrx 신호
  HOLDINGS: "holdings",  // /holdings/{code}       — 현재 보유 포지션 (수동 등록)
  SIGNALS:  "signals",   // 구버전 호환 유지
  TRADES:   "trades",    // /trades/{id}           — 거래 기록
};

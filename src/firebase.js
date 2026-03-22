// ════════════════════════════════════════════════════════════════════════
// Firebase 설정 — SmartSwing-NH 전용 앱
// Firebase 프로젝트: smartswing-nh (전용 프로젝트, 2026-03-22 분리)
// ════════════════════════════════════════════════════════════════════════
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// ✅ 2026-03-22 aidash-d831b → smartswing-nh 전용 프로젝트 분리 완료
const firebaseConfig = {
  apiKey:            "AIzaSyB2Rdp_JG9uHUKaMM1yxdx33vYQAovF31Y",
  authDomain:        "smartswing-nh.firebaseapp.com",
  projectId:         "smartswing-nh",
  storageBucket:     "smartswing-nh.firebasestorage.app",
  messagingSenderId: "490550961706",
  appId:             "1:490550961706:web:0b6e249322d95471414553",
  measurementId:     "G-7SB3SYV801",
};

const app = initializeApp(firebaseConfig);
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

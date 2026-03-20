// ════════════════════════════════════════════════════════════════════════
// Firebase 설정 — SmartSwing-NH 전용 앱
// Firebase 프로젝트: aidash-d831b (기존 AIDASH 프로젝트 재사용)
// 앱 이름: SMARTSWING_NH (AI_DASHBOARD 와 완전 별개)
// ════════════════════════════════════════════════════════════════════════
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// ⚠ Firebase 콘솔에서 SMARTSWING_NH 앱 추가 후 아래 값을 교체한다
// Console > aidash-d831b > 프로젝트 설정 > 앱 추가 > 웹
const firebaseConfig = {
  apiKey:            "REPLACE_AFTER_FIREBASE_APP_CREATED",
  authDomain:        "aidash-d831b.firebaseapp.com",
  projectId:         "aidash-d831b",
  storageBucket:     "aidash-d831b.appspot.com",
  messagingSenderId: "REPLACE_AFTER_FIREBASE_APP_CREATED",
  appId:             "REPLACE_AFTER_FIREBASE_APP_CREATED",
};

const app = initializeApp(firebaseConfig, "smartswing-nh"); // 2번째 인자: 앱 이름 (AI_DASHBOARD 와 충돌 방지)
export const db = getFirestore(app);

// ── Firestore 컬렉션 경로 상수 ──────────────────────────────────────────
// UDB  : /udb/{yyyy-mm}          — 신규 월별 KOSPI 데이터 (GDB 이후)
// 신호  : /signals/{yyyymmdd}    — 매일 3시 시뮬 결과 (매수/매도 제안)
// 거래  : /trades/{id}           — 실제 수동 거래 기록 (사용자 입력)
// 포트  : /portfolio/snapshot    — 누적 수익률 스냅샷
export const COL = {
  UDB:       "udb",
  SIGNALS:   "signals",
  TRADES:    "trades",
  PORTFOLIO: "portfolio",
};

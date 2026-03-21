# Firebase UDB 설정 가이드 (10분 완료)

## 개요

매월 마지막 거래일 15:40 KST에 pykrx로 수집한 데이터를 Firebase Firestore에 저장.
GDB(backtest.js, 동결)와 동일한 스키마로 누적 → runBacktest에서 자동 합산.

---

## STEP 1 — Firebase 프로젝트 생성

1. [Firebase Console](https://console.firebase.google.com) → 프로젝트 추가
2. 프로젝트 이름: `smartswing-nh` (임의)
3. Google Analytics: 비활성화 가능

---

## STEP 2 — Firestore 데이터베이스 생성

1. 좌측 메뉴 → **Firestore Database** → 데이터베이스 만들기
2. 시작 모드: **프로덕션 모드**
3. 위치: `asia-northeast3` (서울)

---

## STEP 3 — 서비스 계정 키(JSON) 발급

1. 프로젝트 설정 → **서비스 계정** 탭
2. **새 비공개 키 생성** → JSON 다운로드
3. 파일 내용 전체 복사 (한 줄로 압축)

```bash
# JSON 한 줄로 압축 (Mac/Linux)
cat serviceAccountKey.json | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)))"
```

---

## STEP 4 — GitHub Secret 등록

GitHub 저장소 → `Settings` → `Secrets and variables` → `Actions` → `New repository secret`

| Secret 이름            | 값                          |
|-----------------------|-----------------------------|
| `FIREBASE_CREDENTIALS` | 위에서 압축한 JSON 한 줄 전체 |

---

## STEP 5 — 수동 테스트

GitHub 저장소 → `Actions` 탭 → `Daily Automation (15:00 + 15:40 KST)` → `Run workflow`

성공 시 Firebase Console → Firestore → `udb` 컬렉션에 문서 생성 확인:

```
/udb/26-04
  date:   "26-04"
  label:  "2026-04"
  m:      "4월"
  year:   2026
  month:  4
  r:      2.31
  stocks:
    005930: { close: 78400, atr_pct: 2.1 }
    000660: { close: 198000, atr_pct: 3.4 }
    ...
```

---

## 자동 실행 일정

```
매월 마지막 거래일 15:40 KST
  → GitHub Actions cron: "40 6 * * 1-5" (UTC 06:40)
  → update_udb.py: 마지막 거래일 여부 자동 체크
  → Firebase /udb/{yy-mm} 저장
```

---

## Firestore 보안 규칙

Firebase Console → Firestore → 규칙 탭에서 설정:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // udb 컬렉션: 읽기만 허용 (쓰기는 서비스 계정만)
    match /udb/{document=**} {
      allow read: if true;
      allow write: if false;
    }
  }
}
```

---

## 비용

- **Firebase Spark(무료) 플랜 기준**:
  - Firestore 읽기: 50,000회/일 무료
  - Firestore 쓰기: 20,000회/일 무료
  - UDB: 월 1회 저장 → 완전 무료
- **GitHub Actions**: 공개 저장소 무제한 무료
- **총 비용: $0**

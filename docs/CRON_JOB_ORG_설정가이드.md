# cron-job.org 외부 트리거 설정 가이드

## 왜 필요한가?

GitHub Actions의 schedule(cron)은 정시 실행을 보장하지 않음.
UTC 06:00 피크타임 기준 **1시간 이상 지연** 발생 확인 (2026-03-23).

**해결 구조:**
```
cron-job.org (무료, 외부 서버)
  → 15:00 KST 정각에 GitHub API 호출
    → workflow_dispatch 이벤트 발생
      → GitHub Actions 즉시 실행 (큐 우선처리)
        → 15:02~03 텔레그램 수신
```

---

## Step 1: GitHub PAT 준비

현재 사용 중인 PAT에 `workflow` 권한이 있는지 확인.
`.git/config` URL에 포함된 토큰 사용 가능.

권한 확인:
```
https://github.com/settings/tokens
→ 토큰 클릭 → workflow 체크 여부 확인
```

---

## Step 2: cron-job.org 가입 및 설정

1. https://cron-job.org 접속 → 무료 회원가입

2. **Create cronjob** 클릭

3. 설정 입력:

| 항목 | 값 |
|------|-----|
| Title | SmartSwing 15:00 Alert |
| URL | `https://api.github.com/repos/plnman/smartswing-nh/actions/workflows/daily_alert.yml/dispatches` |
| Request method | **POST** |
| Schedule | 매일 **06:00 UTC** (= KST 15:00) |
| Days | 월~금 (Mon, Tue, Wed, Thu, Fri) |

4. **Headers** 탭:
```
Authorization: Bearer <여기에_GitHub_PAT_입력>
Content-Type: application/json
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
```
> PAT는 GitHub → Settings → Developer settings → Personal access tokens 에서 확인
> 필요 권한: `repo`, `workflow`

5. **Request body** 탭:
```json
{"ref": "main"}
```

6. **Save** 클릭

---

## Step 3: UDB 업데이트 (15:40 KST) 도 동일하게 추가

| 항목 | 값 |
|------|-----|
| Title | SmartSwing 15:40 UDB Update |
| URL | 동일 URL |
| Schedule | 매일 **06:40 UTC** (= KST 15:40) |
| Body | `{"ref": "main", "inputs": {"job": "udb"}}` |

> ※ UDB job은 workflow_dispatch면 두 job 모두 실행됨 (현재 구조).
> 필요 시 `inputs` 파라미터로 분리 가능.

---

## 현재 안전망 구조 (이중화 완료)

```
[1차] cron-job.org  → 15:00 KST 정각  workflow_dispatch
[2차] GitHub cron   → 14:10 KST 예약  (1시간 지연 시 15:10 도착)
```

1차가 성공하면 2차 cron은 14:10에 알림 실행 후 `FORCE_RUN` 없이 평일 체크 통과 → 중복 전송됨.
**→ 중복 방지 필요 시 Firebase에 오늘 발송 기록 저장 후 체크하는 로직 추가 가능.**

---

## 테스트 방법

cron-job.org에서 **Manual execution** 버튼 클릭
→ GitHub Actions 탭에서 즉시 실행 확인
→ 텔레그램 수신 확인

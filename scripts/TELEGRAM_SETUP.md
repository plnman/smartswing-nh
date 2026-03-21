# 텔레그램 알림 설정 가이드 (5분 완료)

## STEP 1 — 봇 생성 (BotFather)

1. Telegram 앱 → 검색창 → `@BotFather` 입력 → 시작
2. `/newbot` 입력
3. 봇 이름 입력 (예: `SmartSwing Alert`)
4. 봇 username 입력 (예: `smartswing_nh_bot`)  ← 끝에 `_bot` 필수
5. BotFather가 **API Token** 을 알려준다:
   ```
   Done! Use this token to access the HTTP API:
   7123456789:AAF_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
   → 이 토큰을 복사해 둔다

---

## STEP 2 — 봇에게 메시지 보내기

- Telegram에서 방금 만든 봇을 검색 (`@smartswing_nh_bot`)
- `/start` 또는 아무 메시지나 전송  ← **반드시 먼저 해야 함**

---

## STEP 3 — chat_id 확인

터미널(Mac/Linux) 또는 PowerShell(Windows)에서:

```bash
# Python 설치 확인
python3 --version

# 의존성 설치
pip install requests

# chat_id 조회
TELEGRAM_BOT_TOKEN="7123456789:AAF_xxx..." python3 scripts/get_chat_id.py
```

출력 예시:
```
chat_id : 987654321
username: @89507
type    : private
```

→ `chat_id` 숫자를 복사

---

## STEP 4 — GitHub Secrets 등록

GitHub 저장소 → `Settings` → `Secrets and variables` → `Actions` → `New repository secret`

| Secret 이름           | 값                                |
|----------------------|----------------------------------|
| `TELEGRAM_BOT_TOKEN` | BotFather 발급 토큰               |
| `TELEGRAM_CHAT_ID`   | get_chat_id.py 로 확인한 숫자 ID  |

---

## STEP 5 — 수동 테스트

GitHub 저장소 → `Actions` 탭 → `Daily Alert (15:00 KST)` → `Run workflow`

성공하면 Telegram에 아래 형식의 메시지 도착:

```
📊 SmartSwing-NH  2026-03-21  15:00

[오늘 신호]
▲ 매수  현대차(005380)  슬롯3  진입가 ₩218,000

[보유 현황]
▼ 매도  SK하이닉스  +6.3%  +63만원  RSI-2≥99

[누적 P&L]
5년 누적  +1,246.5%  |  연환산 +68.2%  |  MDD -1.7%

⚙️ rsi2Exit=99  trailing=4.0%  hardStop=3.5%  adx=30
```

---

## 자동 실행 일정

```
매일(평일) 한국시간 15:00 자동 전송
  → GitHub Actions cron: "0 6 * * 1-5"  (UTC 06:00)
  → 한국 공휴일: 스크립트 내 weekday 체크만 (공휴일 별도 API 추가 가능)
```

---

## 비용

- **GitHub Actions**: 무료 (공개 저장소 무제한 / 비공개 2,000분/월)
- **Telegram Bot API**: 무료 (제한 없음)
- **총 비용: $0**

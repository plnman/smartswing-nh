#!/usr/bin/env python3
"""
chat_id 확인용 스크립트
────────────────────────
사용법:
  1) 터미널에서 실행:
       TELEGRAM_BOT_TOKEN=<your_token> python3 get_chat_id.py
  2) Telegram에서 봇에게 /start 또는 아무 메시지나 먼저 보낸 뒤 실행
  3) 출력된 chat_id를 GitHub Secret TELEGRAM_CHAT_ID 에 저장
"""
import os, requests, json

token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
if not token:
    print("❌  환경변수 TELEGRAM_BOT_TOKEN 을 먼저 설정하세요.")
    exit(1)

url = f"https://api.telegram.org/bot{token}/getUpdates"
r = requests.get(url, timeout=10)
data = r.json()

if not data.get("ok"):
    print("❌  응답 오류:", data)
    exit(1)

results = data.get("result", [])
if not results:
    print("⚠️  업데이트가 없습니다. 봇에게 /start 메시지를 먼저 보내고 다시 실행하세요.")
    exit(1)

for item in results:
    msg  = item.get("message") or item.get("channel_post", {})
    chat = msg.get("chat", {})
    user = msg.get("from", {})
    print(f"chat_id : {chat.get('id')}")
    print(f"username: @{user.get('username','(없음)')}")
    print(f"type    : {chat.get('type')}")
    print("─" * 30)

# subscribe-manager

구독과 생활 기한을 한곳에서 관리하는 웹 서비스입니다.

## Phase 2 개발 환경

- Frontend: React + Vite + TypeScript
- Backend: FastAPI
- Data/Auth/Storage: Supabase

## 로컬 준비

1. `.env.example`을 참고해 루트에 `.env`를 만듭니다.
2. 실제 키와 비밀번호는 `.env`에만 넣고 Git에 추가하지 않습니다.
3. Frontend 의존성은 루트에서 `npm.cmd install`로 설치합니다.
4. Backend는 `.venv`를 만든 뒤 `python -m pip install -e ".\backend[dev]"`로 설치합니다.

## 실행

- Frontend: `npm.cmd run dev:frontend`
- Backend: `.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --reload`

Supabase 프로젝트 값이 없어도 상태 화면과 Backend 단위 테스트는 실행할 수 있습니다. RLS와 Storage 정책은 로컬 Supabase 테스트로 검증할 수 있으며, 실제 외부 프로젝트에 적용한 뒤에는 해당 환경에서도 다시 확인해야 합니다.

## Supabase Auth 외부 설정

1. Supabase Dashboard의 **Authentication > Sign In / Providers > Email**에서 이메일 가입과 이메일 확인을 켭니다.
2. **Authentication > URL Configuration**의 Site URL은 로컬에서 `http://localhost:5173`으로 설정합니다.
3. Redirect URLs에 `http://localhost:5173/auth/callback`과 `http://localhost:5173/reset-password`를 추가합니다. 운영에서는 같은 두 경로를 실제 HTTPS 도메인으로도 추가합니다.
4. 비밀번호 최소 길이는 8자로 맞춥니다. 애플리케이션은 영문과 숫자를 각각 하나 이상 요구합니다.
5. 자체 SMTP를 쓰면 **Project Settings > Authentication > SMTP Settings**에 제공자의 Host, Port, Username, Password, Sender email, Sender name을 입력합니다. 실제 값은 제공자 콘솔에서 확인하고 저장소에는 기록하지 않습니다.
6. 루트 `.env`의 `SUPABASE_SECRET_KEY`에는 서버용 secret key를 넣습니다. 이 값은 FastAPI의 회원 탈퇴 처리에만 쓰며 `VITE_*` 변수에는 넣지 않습니다.

회원 탈퇴는 서버가 삭제 요청을 기록한 뒤 Supabase Auth 사용자를 삭제합니다. 실패하면 계정은 유지되고 `retry_pending` 상태가 남습니다. 성공 후 현재 `profiles`와 Phase 1의 사용자별 데이터는 외래 키 연쇄 삭제되며, 이후 Phase의 이미지·알림 정리는 `AccountDeletionService.run_pre_auth_cleanup_steps`에 연결합니다.

## Phase 5 알림 설정

1. VAPID 키 쌍을 생성해 공개 키는 `VAPID_PUBLIC_KEY`, 비공개 키는 `VAPID_PRIVATE_KEY`에 넣습니다. 두 값과 `NOTIFICATION_CRON_SECRET`은 Backend 전용이며 `VITE_*`에 넣지 않습니다.
2. `VAPID_SUBJECT`에는 운영 연락처 이메일 또는 HTTPS 주소를 설정합니다.
3. 운영 스케줄러에서 `POST /api/v1/notifications/process`를 주기적으로 호출하고 `X-Cron-Secret` 헤더에 Backend의 `NOTIFICATION_CRON_SECRET`과 같은 값을 전달합니다.
4. Web Push는 운영 HTTPS, 브라우저 권한과 일부 모바일 환경의 PWA 설치 조건이 필요합니다. 설정 전이나 미지원 환경에서도 앱 안 알림은 유지됩니다.

## Phase 7 Google Calendar 설정

1. Google Cloud 프로젝트에서 Google Calendar API를 사용 설정하고 OAuth 동의 화면을 구성합니다. 개발 중에는 테스트 사용자를 등록합니다.
2. 웹 애플리케이션 OAuth 클라이언트를 만들고 승인된 redirect URI에 `.env`의 `GOOGLE_OAUTH_REDIRECT_URI`와 정확히 같은 주소를 등록합니다. 로컬 기본값은 `http://localhost:8000/api/v1/google-calendar/callback`입니다.
3. 클라이언트 ID와 비밀키는 Backend 전용 `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`에 넣습니다. `VITE_*` 변수에는 넣지 않습니다.
4. `GOOGLE_TOKEN_ENCRYPTION_KEY`에는 Fernet 키를 설정합니다. 기존 연결 토큰을 복호화해야 하므로 운영 중 임의로 교체하지 않습니다.
5. `FRONTEND_APP_URL`은 OAuth 완료 후 돌아올 프론트엔드 주소로 설정합니다. 운영 환경은 HTTPS 주소를 사용합니다.
6. 운영 스케줄러에서 `POST /api/v1/google-calendar/process`를 주기적으로 호출하고 `X-Cron-Secret`에 `GOOGLE_CALENDAR_CRON_SECRET`을 전달합니다. 내부 캘린더는 외부 동기화 실패와 무관하게 유지됩니다.

요청 권한은 앱이 만든 보조 캘린더와 일정만 관리하는 `calendar.app.created`입니다. 외부 공개 전 Google OAuth 검증 필요 여부와 테스트 모드 refresh token 제한은 실제 Google Cloud 프로젝트에서 확인해야 합니다.

## 검사

- Frontend 타입 검사: `npm.cmd run check:frontend`
- Frontend 테스트: `npm.cmd run test:frontend`
- Frontend 빌드: `npm.cmd run build:frontend`
- Backend 린트: `.\.venv\Scripts\python.exe -m ruff check backend`
- Backend 테스트: `.\.venv\Scripts\python.exe -m pytest backend`
- Supabase DB 테스트: `npx.cmd supabase test db`

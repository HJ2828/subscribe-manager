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

1. Supabase Dashboard의 **Authentication > Sign In / Providers > Email**에서 이메일 가입은 켜고 `Confirm email`은 끕니다.
2. **Authentication > URL Configuration**의 Site URL은 로컬에서 `http://localhost:5173`으로 설정합니다.
3. Redirect URLs에 `http://localhost:5173/reset-password`를 추가합니다. 운영에서는 같은 경로를 실제 HTTPS 도메인으로도 추가합니다.
4. 비밀번호 최소 길이는 8자로 맞춥니다. 애플리케이션은 영문과 숫자를 각각 하나 이상 요구합니다.
5. 자체 SMTP를 쓰면 **Project Settings > Authentication > SMTP Settings**에 제공자의 Host, Port, Username, Password, Sender email, Sender name을 입력합니다. 실제 값은 제공자 콘솔에서 확인하고 저장소에는 기록하지 않습니다.
6. 루트 `.env`의 `SUPABASE_SECRET_KEY`에는 서버용 secret key를 넣습니다. 이 값은 FastAPI의 회원 탈퇴 처리에만 쓰며 `VITE_*` 변수에는 넣지 않습니다.

회원 탈퇴는 서버가 삭제 요청을 기록한 뒤 Supabase Auth 사용자를 삭제합니다. 실패하면 계정은 유지되고 `retry_pending` 상태가 남습니다. 성공 후 현재 `profiles`와 Phase 1의 사용자별 데이터는 외래 키 연쇄 삭제되며, 이후 Phase의 이미지·알림 정리는 `AccountDeletionService.run_pre_auth_cleanup_steps`에 연결합니다.

## Phase 5 알림 설정

1. VAPID 키 쌍을 생성해 공개 키는 `VAPID_PUBLIC_KEY`, 비공개 키는 `VAPID_PRIVATE_KEY`에 넣습니다. 두 값과 `NOTIFICATION_CRON_SECRET`은 Backend 전용이며 `VITE_*`에 넣지 않습니다.
2. `VAPID_SUBJECT`에는 운영 연락처 이메일 또는 HTTPS 주소를 설정합니다.
3. 운영 스케줄러에서 `POST /api/v1/notifications/process`를 주기적으로 호출하고 `X-Cron-Secret` 헤더에 Backend의 `NOTIFICATION_CRON_SECRET`과 같은 값을 전달합니다.
4. Web Push는 운영 HTTPS, 브라우저 권한과 일부 모바일 환경의 PWA 설치 조건이 필요합니다. 설정 전이나 미지원 환경에서도 앱 안 알림은 유지됩니다.

## 이메일 미인증 계정 자동 정리

1. `.env`에 `UNVERIFIED_ACCOUNT_CLEANUP_CRON_SECRET`을 별도 비밀값으로 설정하고, `UNVERIFIED_ACCOUNT_RETENTION_DAYS`로 보존 기간을 설정합니다. 기본값은 7일입니다.
2. 운영 스케줄러에서 `POST /api/v1/auth/cleanup-unverified`를 주기적으로 호출하고 `X-Cron-Secret` 헤더에 같은 비밀값을 전달합니다.
3. 서버가 Supabase Admin API로 조회한 사용자 중 이메일 미인증 상태이며 보존 기간을 지난 계정만 삭제합니다. `profiles`는 외래키 cascade 설정에 따라 함께 삭제됩니다.

## Phase 7 Google Calendar 설정

1. Google Cloud 프로젝트에서 Google Calendar API를 사용 설정하고 OAuth 동의 화면을 구성합니다. 개발 중에는 테스트 사용자를 등록합니다.
2. 웹 애플리케이션 OAuth 클라이언트를 만들고 승인된 redirect URI에 `.env`의 `GOOGLE_OAUTH_REDIRECT_URI`와 정확히 같은 주소를 등록합니다. 로컬 기본값은 `http://localhost:8000/api/v1/google-calendar/callback`입니다.
3. 클라이언트 ID와 비밀키는 Backend 전용 `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`에 넣습니다. `VITE_*` 변수에는 넣지 않습니다.
4. `GOOGLE_TOKEN_ENCRYPTION_KEY`에는 Fernet 키를 설정합니다. 기존 연결 토큰을 복호화해야 하므로 운영 중 임의로 교체하지 않습니다.
5. `FRONTEND_APP_URL`은 OAuth 완료 후 돌아올 프론트엔드 주소로 설정합니다. 운영 환경은 HTTPS 주소를 사용합니다.
6. 운영 스케줄러에서 `POST /api/v1/google-calendar/process`를 주기적으로 호출하고 `X-Cron-Secret`에 `GOOGLE_CALENDAR_CRON_SECRET`을 전달합니다. 내부 캘린더는 외부 동기화 실패와 무관하게 유지됩니다.

요청 권한은 앱이 만든 보조 캘린더와 일정만 관리하는 `calendar.app.created`입니다. 외부 공개 전 Google OAuth 검증 필요 여부와 테스트 모드 refresh token 제한은 실제 Google Cloud 프로젝트에서 확인해야 합니다.

## Phase 8 운영 검수 설정

1. `PHASE8_OPERATOR_USER_IDS`에 운영을 맡을 Supabase Auth 사용자 UUID를 쉼표로 구분해 설정합니다. 이메일이나 브라우저 값으로 운영 권한을 판단하지 않습니다.
2. Phase 8 마이그레이션을 `20261104010000_phase8_news_retention_ott.sql`까지 적용한 뒤 Backend를 재시작합니다.
3. 지정된 운영자는 설정의 `운영자 도구`에서 자동 수집 결과 중 불확실한 자료를 검토하고 전체 사용자 공지사항을 작성할 수 있습니다. 서비스 목록은 활성 반복 구독에서 자동으로 만들어집니다.
4. HTTPS 원문 URL의 호스트와 입력한 출처 도메인이 일치하고 확인일·발표일 또는 적용일이 있어야 공개할 수 있습니다. 도메인이 일치한다는 사실만으로 공식성을 자동 확정하지 않으며 운영자가 원문을 직접 검수합니다.
5. `CONTENT_COLLECTION_CRON_SECRET`을 임의의 긴 비밀값으로 설정하고 운영 스케줄러에서 `POST /api/v1/content/process`를 `X-Cron-Secret` 헤더와 함께 1~6시간마다 호출합니다. DB가 서비스별 72시간 간격·하루 5개 제한을 적용하므로 중복 호출이 유료 검색을 중복 실행하지 않습니다.
6. 자동 수집은 활성 `반복 결제 구독` 서비스 이름만 공통 대상으로 사용합니다. 사용자별로 검색하지 않으며 메모·금액·개인 식별 정보는 검색 요청에 넣지 않습니다.
7. 기본 모델은 `gpt-5.4-mini`, 제한은 하루 US$0.50·개발 누적 US$10·하루 서비스 작업 5개입니다. 기본 16,000 입력 토큰·2,000 출력 토큰·웹 검색 2회를 상한으로 예약하며, 실제 응답 토큰과 청구 검색 수로 정산합니다. 비용을 확인할 수 없는 실패는 무료로 보지 않고 예약액을 유지합니다.
8. `service_collection_sources`에 공식 RSS·Atom·JSON·조건부 페이지를 등록한 서비스는 ETag·Last-Modified와 항목 해시를 먼저 확인합니다. 설정하지 않은 서비스만 제한된 LLM 웹 검색으로 바로 넘어갑니다.

수동 시험 예시:

```powershell
$contentSecret = "CONTENT_COLLECTION_CRON_SECRET 값"
curl.exe -X POST "http://localhost:8000/api/v1/content/process" -H "X-Cron-Secret: $contentSecret"
```

Responses API 웹 검색에서 실제로 인용된 HTTPS 원문만 저장합니다. 공식 출처로 구조화된 결과는 자동 공개하고, 공식성 또는 적용 조건이 불명확한 결과는 운영자 확인 대상으로 남깁니다. 구독 등록·홈/소식 진입·새로고침·더 보기·스크랩은 새 검색을 실행하지 않습니다.

`CONTENT_OTT_EDITORIAL_ENABLED=true`이면 9개 OTT의 공식 공개 예정작을 구독 여부와 관계없이 공통 수집합니다. 이 작업은 별도 무료 작업이 아니라 기존 72시간 주기·하루 5개 서비스·비용 한도를 공유합니다. 일반 소식은 12개월, OTT 편성 소식은 90일 후 보관되며 스크랩되지 않은 보관 소식만 24개월 후 삭제됩니다.

## 검사

- Frontend 타입 검사: `npm.cmd run check:frontend`
- Frontend 테스트: `npm.cmd run test:frontend`
- Frontend 빌드: `npm.cmd run build:frontend`
- Backend 린트: `.\.venv\Scripts\python.exe -m ruff check backend`
- Backend 테스트: `.\.venv\Scripts\python.exe -m pytest backend`
- Supabase DB 테스트: `npx.cmd supabase test db`

# subscribe-manager

구독 결제와 생활 속 기한을 한곳에서 관리하는 React + FastAPI + Supabase 웹 서비스입니다.

반복 결제 구독뿐 아니라 기프티콘·쿠폰·상품권·포인트·제품 보증·보장 서비스의 날짜와 상태를 기록하고, 홈·목록·캘린더·리포트에서 같은 데이터를 다른 관점으로 확인할 수 있습니다.

## 문서

- [제품 요구사항](docs/PRD.md)
- [상세 명세](docs/spec.md)
- [서비스 정의서](docs/service-definition.md)
- [개발 계획](docs/plan.md)
- [진행 기록](docs/progress.md)
- [디자인 시스템](docs/dalli-design-system.md)

## 기술 스택

- Frontend: React, Vite, TypeScript
- Backend: FastAPI, Python
- Data/Auth/Storage: Supabase
- 외부 연동: OpenAI 이미지·소식 처리, Web Push, Google Calendar 단방향 내보내기

## 사전 요구사항

- Node.js와 npm
- Python 3.11 이상 권장
- 선택 사항: Docker와 Supabase CLI

## 로컬 설정

1. 루트의 `.env.example`을 복사해 `.env`를 만듭니다.
2. 실제 API 키·비밀번호·서버용 키는 `.env`에만 입력합니다. `VITE_*`에는 공개해도 되는 값만 넣습니다.
3. Frontend 의존성을 설치합니다.

   ```powershell
   npm.cmd install
   ```

4. Backend 개발 의존성을 설치합니다.

   ```powershell
   python -m pip install -e ".[dev]"
   ```

Supabase 값이 없어도 일부 화면·프론트 빌드·단위 테스트는 실행할 수 있지만, 인증·RLS·Storage·외부 연동의 통합 동작은 연결된 Supabase 프로젝트가 필요합니다.

## 실행

터미널을 두 개 사용합니다.

```powershell
# 터미널 1: Backend
python -m uvicorn app.main:app --app-dir backend --reload

# 터미널 2: Frontend
npm.cmd run dev:frontend
```

기본 주소는 Frontend `http://localhost:5173`, Backend `http://localhost:8000`입니다. `VITE_API_BASE_URL`, `API_CORS_ORIGINS`, `FRONTEND_APP_URL`을 환경에 맞게 설정합니다.

## 검사 명령

```powershell
# Frontend
npm.cmd run check:frontend
npm.cmd run test:frontend
npm.cmd run build:frontend

# Backend
python -m ruff check backend
python -m pytest backend
```

Supabase DB 테스트를 실행할 때는 로컬 Supabase가 실행 중이어야 합니다.

```powershell
npx.cmd supabase test db
```

## Supabase 마이그레이션

현재 마이그레이션은 `supabase/migrations`의 파일명 순서대로 적용합니다. Phase 8 운영 기능을 사용하려면 다음 최신 마이그레이션까지 적용해야 합니다.

```text
20261106030000_phase8_catalog_collection_controls.sql
```

원격 프로젝트에 적용한 뒤에는 Backend를 재시작하고 실제 인증 계정으로 RLS·Storage·CRUD 흐름을 확인합니다. 마이그레이션 파일에 정의된 정책과 운영 환경의 실제 권한을 함께 검증해야 합니다.

## 인증·회원 탈퇴

Supabase Dashboard에서 Email Provider와 Site URL·Redirect URL을 설정합니다. 앱의 회원 탈퇴 API는 서버에서 삭제 요청과 Auth 계정 삭제를 처리하며, 실패 시 계정을 유지하고 재시도 상태를 기록합니다.

필요한 주요 환경변수:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `FRONTEND_APP_URL`

## Web Push

1. VAPID 키를 생성합니다.
2. `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`를 Backend 환경변수에 설정합니다.
3. 운영 스케줄러에서 다음 API를 주기적으로 호출합니다.

```text
POST /api/v1/notifications/process
Header: X-Cron-Secret: <NOTIFICATION_CRON_SECRET>
```

Web Push는 HTTPS·브라우저 권한·기기별 구독이 필요합니다. 지원되지 않거나 권한이 거부된 환경에서도 앱 내 알림은 유지됩니다.

## Google Calendar

Google Cloud에서 Calendar API와 OAuth 동의 화면을 설정한 뒤 다음 값을 Backend에 설정합니다.

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI`
- `GOOGLE_TOKEN_ENCRYPTION_KEY`
- `GOOGLE_CALENDAR_CRON_SECRET`

Redirect URI는 Google Cloud와 `.env`에 정확히 같아야 합니다. 연동은 앱에서 Google Calendar로 내보내는 단방향이며, 내부 일정은 외부 동기화 실패와 무관하게 유지됩니다.

## Phase 8 운영 기능

운영 기능은 일반 사용자 화면과 분리하고 서버에서 운영자 UUID를 다시 확인합니다.

1. `PHASE8_OPERATOR_USER_IDS`에 운영자 Supabase Auth UUID를 쉼표로 설정합니다.
2. `CONTENT_COLLECTION_CRON_SECRET` 등 Phase 8 환경변수를 설정합니다.
3. 최신 마이그레이션을 적용합니다.
4. 운영 스케줄러에서 다음 API를 호출합니다.

```text
POST /api/v1/content/process
Header: X-Cron-Secret: <CONTENT_COLLECTION_CRON_SECRET>
```

전체 소식이 아니라 OTT 공개 예정작만 수집하려면 Backend `.env`에서 다음처럼 설정합니다.

```text
CONTENT_COLLECTION_SCOPE=ott_editorial
CONTENT_OTT_EDITORIAL_ENABLED=true
```

또는 일회성으로 범위를 지정할 수 있습니다.

```text
POST /api/v1/content/process?scope=ott_editorial
```

`all`은 구독 중인 서비스 소식과 OTT 공통 피드를 모두 수집하고, `ott_editorial`은 구독 여부와 관계없이 등록된 OTT 공통 카탈로그의 공개 예정작만 수집합니다. 화면 조회는 기존 `GET /api/v1/content/ott-news`를 사용합니다.

자동 수집은 활성 반복 결제 구독의 서비스명과 공통 카탈로그를 기준으로 동작합니다. 사용자별 메모·금액·개인 식별 정보는 검색 요청에 넣지 않습니다. 공식 HTTPS 출처가 확인된 자료만 자동 공개하고, 적용 조건이나 공식성이 불명확한 결과는 운영자 검토 대상으로 남깁니다.

이메일 미인증 계정 정리는 다음 별도 작업으로 실행합니다.

```text
POST /api/v1/auth/cleanup-unverified
Header: X-Cron-Secret: <UNVERIFIED_ACCOUNT_CLEANUP_CRON_SECRET>
```

보존 기간은 `UNVERIFIED_ACCOUNT_RETENTION_DAYS`로 설정하며 기본값은 7일입니다. 두 Cron secret은 서로 다른 비밀값을 사용합니다.

## 환경변수 원칙

- 비밀값은 코드·문서·Git에 직접 작성하지 않습니다.
- Backend 전용 키(`SUPABASE_SECRET_KEY`, OpenAI·OAuth·Cron secret 등)는 `VITE_*`로 복제하지 않습니다.
- 운영에서는 HTTPS와 실제 도메인을 사용합니다.
- 전체 변수 목록과 기본값은 `.env.example`을 기준으로 확인합니다.

## 범위 밖 기능

MVP는 실제 결제·환불·해지를 실행하지 않습니다. 은행·카드 자동 연동, Google Calendar 양방향 동기화, 환율 API 자동 환산, OTT 전체 편성 보장과 대화형 자동 등록은 현재 범위 밖입니다.

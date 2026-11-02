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

## 검사

- Frontend 타입 검사: `npm.cmd run check:frontend`
- Frontend 테스트: `npm.cmd run test:frontend`
- Frontend 빌드: `npm.cmd run build:frontend`
- Backend 린트: `.\.venv\Scripts\python.exe -m ruff check backend`
- Backend 테스트: `.\.venv\Scripts\python.exe -m pytest backend`
- Supabase DB 테스트: `npx.cmd supabase test db`

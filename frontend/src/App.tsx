import { type FormEvent, type ReactNode, useEffect, useState } from "react";

import brandIcon from "./assets/figma/brand-calendar.svg";
import circleCheckIcon from "./assets/figma/circle-check.svg";
import infoIcon from "./assets/figma/info.svg";
import mailCheckIcon from "./assets/figma/mail-check.svg";
import navCalendarIcon from "./assets/figma/nav-calendar.svg";
import navHomeIcon from "./assets/figma/nav-home.svg";
import navListIcon from "./assets/figma/nav-list.svg";
import navReportIcon from "./assets/figma/nav-report.svg";
import navSettingsIcon from "./assets/figma/nav-settings.svg";
import notificationIcon from "./assets/figma/notification.svg";
import statusAlertIcon from "./assets/figma/status-alert.svg";
import warningIcon from "./assets/figma/warning.svg";
import { useAuth } from "./auth/AuthContext";
import { UnifiedHomePage } from "./home/HomePage";
import { deleteAccount, getHealth } from "./lib/api";
import { publicConfig } from "./lib/config";
import {
  Phase3DetailPage,
  Phase3FormPage,
  Phase3ListPage,
} from "./phase3/Phase3Pages";
import {
  Phase4ImageLibraryPage,
} from "./phase4/Phase4Pages";
import { CalendarPage } from "./phase5/CalendarPage";
import { NotificationsPage } from "./phase5/NotificationsPage";
import "./styles.css";

type Notice = { tone: "success" | "error" | "info"; text: string } | null;
type Profile = {
  country_code: string;
  default_currency: string;
  timezone: string;
  notification_days_before: number[];
  notification_time: string;
  in_app_notifications_enabled: boolean;
};

type SubscriptionItem = {
  id: string;
  user_id: string;
  management_type: "recurring_subscription";
  service_name: string;
  plan_name: string | null;
  amount: number | null;
  currency: string | null;
  billing_cycle: "monthly" | "yearly" | "custom" | null;
  first_billing_date: string | null;
  next_billing_date: string | null;
  actual_status:
    | "in_use"
    | "temporarily_paused"
    | "payment_issue"
    | "ended"
    | "needs_review";
  auto_renewal_status: "on" | "off" | "manual" | "needs_review";
  usage_plan: "scheduled" | "ended" | "needs_review";
  payment_method: string | null;
  category: string | null;
  memo: string | null;
  reminder_days_before: number[];
  reminder_time: string;
  created_at: string;
  updated_at: string;
};

type SubscriptionDraft = Omit<
  SubscriptionItem,
  "id" | "user_id" | "created_at" | "updated_at"
>;

const EMPTY_SUBSCRIPTION: SubscriptionDraft = {
  management_type: "recurring_subscription",
  service_name: "",
  plan_name: "",
  amount: null,
  currency: "KRW",
  billing_cycle: "monthly",
  first_billing_date: "",
  next_billing_date: "",
  actual_status: "in_use",
  auto_renewal_status: "on",
  usage_plan: "scheduled",
  payment_method: "",
  category: "",
  memo: "",
  reminder_days_before: [3, 0],
  reminder_time: "09:00",
};

const DEFAULT_PROFILE: Profile = {
  country_code: "KR",
  default_currency: "KRW",
  timezone: "Asia/Seoul",
  notification_days_before: [3, 0],
  notification_time: "09:00",
  in_app_notifications_enabled: true,
};

function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  return path;
}

function go(path: string, replace = false) {
  window.history[replace ? "replaceState" : "pushState"](null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function AppLink({
  to,
  children,
  className,
  ariaLabel,
}: {
  to: string;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <a
      href={to}
      className={className}
      aria-label={ariaLabel}
      onClick={(event) => {
        if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
          event.preventDefault();
          go(to);
        }
      }}
    >
      {children}
    </a>
  );
}

function Logo() {
  return (
    <AppLink to="/" className="brand" ariaLabel="subscribe-manager 홈">
      <span className="brand-mark">
        <img src={brandIcon} alt="" />
      </span>
      <span>subscribe-manager</span>
    </AppLink>
  );
}

function PublicHeader() {
  return (
    <header className="public-header">
      <Logo />
      <span className="header-context">회원 · 계정</span>
    </header>
  );
}

function NoticeBox({ notice }: { notice: Notice }) {
  if (!notice) return null;
  const icon =
    notice.tone === "success"
      ? circleCheckIcon
      : notice.tone === "error"
        ? statusAlertIcon
        : infoIcon;
  return (
    <div
      className="notice-box"
      data-tone={notice.tone}
      role={notice.tone === "error" ? "alert" : "status"}
    >
      <img src={icon} alt="" />
      <strong>{notice.text}</strong>
    </div>
  );
}

function InfoPanel({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="info-panel">
      <img src={infoIcon} alt="" />
      <div>
        <strong>{title}</strong>
        {children ? <p>{children}</p> : null}
      </div>
    </div>
  );
}

function LoadingScreen({ label = "불러오는 중" }: { label?: string }) {
  return (
    <main className="center-screen" aria-busy="true">
      <div className="spinner" aria-hidden="true" />
      <p>{label}</p>
    </main>
  );
}

function AuthShell({
  title,
  description,
  children,
  wide = false,
}: {
  title: string;
  description: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <main className="auth-page">
      <PublicHeader />
      <section className="auth-content">
        <div className={`auth-flow${wide ? " auth-flow-wide" : ""}`}>
          <header className="page-title">
            <h1>{title}</h1>
            <p>{description}</p>
          </header>
          <div className="auth-card">{children}</div>
        </div>
      </section>
    </main>
  );
}

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field" data-invalid={Boolean(error)}>
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? (
        <p className="field-message error" id={`${id}-error`}>
          {error}
        </p>
      ) : hint ? (
        <p className="field-message" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function MissingConfig() {
  return (
    <AuthShell
      title="인증 연결이 필요해요"
      description="Supabase 공개 프로젝트 값을 설정하면 회원 기능을 사용할 수 있어요."
    >
      <NoticeBox
        notice={{ tone: "info", text: "환경 설정을 확인해 주세요." }}
      />
      <p className="card-copy">
        루트 `.env`의 VITE_SUPABASE_URL과 VITE_SUPABASE_PUBLISHABLE_KEY가
        필요합니다.
      </p>
    </AuthShell>
  );
}

function LoginPage() {
  const { client } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice>(() => {
    const message = sessionStorage.getItem("auth_notice");
    sessionStorage.removeItem("auth_notice");
    return message ? { tone: "success", text: message } : null;
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!/^\S+@\S+\.\S+$/.test(email))
      nextErrors.email = "이메일 주소 형식을 확인해 주세요.";
    if (!password) nextErrors.password = "비밀번호를 입력해 주세요.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setNotice({ tone: "error", text: "필수 항목을 확인해 주세요." });
      return;
    }
    if (!client) return;
    setBusy(true);
    setNotice(null);
    const { error } = await client.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (error) {
      if (/confirm|verified/i.test(error.message)) {
        sessionStorage.setItem("pending_email", email.trim());
        go("/verify-email");
        return;
      }
      setNotice({
        tone: "error",
        text: "이메일 또는 비밀번호가 맞지 않습니다.",
      });
      return;
    }
    sessionStorage.removeItem("pending_email");
    setPassword("");
    go("/", true);
  }

  return (
    <AuthShell title="로그인" description="내 구독과 기한을 이어서 관리하세요.">
      <NoticeBox notice={notice} />
      <form onSubmit={submit} className="form-stack" noValidate>
        <Field id="login-email" label="이메일" error={errors.email}>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "login-email-error" : undefined}
            placeholder="이메일 주소 입력"
          />
        </Field>
        <Field
          id="login-password"
          label="비밀번호"
          error={errors.password}
          hint="입력한 비밀번호는 화면에 표시되지 않아요."
        >
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={Boolean(errors.password)}
            aria-describedby={
              errors.password ? "login-password-error" : "login-password-hint"
            }
            placeholder="비밀번호 입력"
          />
        </Field>
        <button className="button primary full" disabled={busy} type="submit">
          {busy ? (
            <>
              <span className="button-spinner" />
              로그인 중
            </>
          ) : (
            "로그인"
          )}
        </button>
      </form>
      <div className="account-help">
        <AppLink to="/signup">회원가입</AppLink>
        <AppLink to="/forgot-password">비밀번호 재설정</AppLink>
      </div>
      <div className="divider" />
      <p className="card-footnote">
        이메일 확인을 마친 계정만 내 홈과 설정을 이용할 수 있어요.
      </p>
    </AuthShell>
  );
}

function SignupPage() {
  const { client } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!/^\S+@\S+\.\S+$/.test(email))
      nextErrors.email = "이메일 주소 형식을 확인해 주세요.";
    if (
      password.length < 8 ||
      !/[A-Za-z]/.test(password) ||
      !/\d/.test(password)
    )
      nextErrors.password =
        "8자 이상이며 영문과 숫자를 각각 1개 이상 포함해 주세요.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setNotice({ tone: "error", text: "가입 정보를 확인해 주세요." });
      return;
    }
    if (!client) return;
    setBusy(true);
    setNotice(null);
    const { data, error } = await client.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) {
      setNotice({
        tone: "error",
        text: /already|registered|exists/i.test(error.message)
          ? "이미 가입된 이메일이에요."
          : "가입을 완료하지 못했습니다. 다시 시도해 주세요.",
      });
      return;
    }
    if (data.session) {
      go("/", true);
      return;
    }
    sessionStorage.setItem("pending_email", email.trim());
    setPassword("");
    go("/verify-email", true);
  }

  return (
    <AuthShell title="회원가입" description="이메일과 비밀번호로 시작하세요.">
      <NoticeBox notice={notice} />
      <form onSubmit={submit} className="form-stack" noValidate>
        <Field
          id="signup-email"
          label="이메일"
          error={errors.email}
          hint="확인 메일을 받을 이메일을 입력해 주세요."
        >
          <input
            id="signup-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={Boolean(errors.email)}
            placeholder="이메일 주소 입력"
          />
        </Field>
        <Field
          id="signup-password"
          label="비밀번호"
          error={errors.password}
          hint="8자 이상, 영문과 숫자를 포함해 주세요."
        >
          <input
            id="signup-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={Boolean(errors.password)}
            placeholder="비밀번호 입력"
          />
        </Field>
        <button className="button primary full" disabled={busy} type="submit">
          {busy ? (
            <>
              <span className="button-spinner" />
              가입 처리 중
            </>
          ) : (
            "회원가입"
          )}
        </button>
      </form>
      <InfoPanel title="가입 후 이메일 확인이 필요해요">
        확인 메일의 링크를 완료한 뒤 로그인해 주세요.
      </InfoPanel>
      <AppLink to="/login" className="center-link">
        이미 계정이 있나요? 로그인
      </AppLink>
    </AuthShell>
  );
}

function VerifyEmailPage() {
  const { client, session } = useAuth();
  const [email] = useState(
    () =>
      sessionStorage.getItem("pending_email") ||
      session?.user.email ||
      "이메일 확인 필요",
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setInterval(
      () => setCooldown((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [cooldown]);

  async function resend() {
    if (!client || !/^\S+@\S+\.\S+$/.test(email) || cooldown) return;
    setBusy(true);
    setNotice(null);
    const { error } = await client.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) {
      setNotice({
        tone: "error",
        text: /rate/i.test(error.message)
          ? "잠시 후 다시 요청해 주세요."
          : "확인 메일을 보내지 못했습니다.",
      });
      return;
    }
    setCooldown(60);
    setNotice({ tone: "success", text: "확인 메일을 다시 보냈어요." });
  }

  return (
    <AuthShell
      title="이메일을 확인해 주세요"
      description="받은 메일의 확인 링크를 따라가 주세요."
    >
      <img className="mail-check-icon" src={mailCheckIcon} alt="" />
      <NoticeBox notice={notice} />
      <div className="field">
        <span className="field-label">확인할 이메일</span>
        <div className="readonly-value">{email}</div>
      </div>
      <p className="card-copy">
        메일함에 확인 메일이 없다면 스팸함을 확인하거나 확인 메일을 다시 요청해
        주세요.
      </p>
      <InfoPanel title="이메일 확인 전에는 이용할 수 없어요">
        내 홈과 설정은 이메일 확인 완료 후 이용할 수 있어요.
      </InfoPanel>
      <div className="action-stack">
        <button
          className="button primary full"
          type="button"
          onClick={resend}
          disabled={busy || cooldown > 0}
        >
          {busy ? (
            <>
              <span className="button-spinner" />
              발송 중
            </>
          ) : cooldown ? (
            `${cooldown}초 후 다시 보내기`
          ) : (
            "확인 메일 재발송"
          )}
        </button>
        <AppLink to="/login" className="center-link">
          로그인으로 돌아가기
        </AppLink>
      </div>
    </AuthShell>
  );
}

function ForgotPasswordPage() {
  const { client } = useAuth();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setNotice({ tone: "error", text: "이메일 주소 형식을 확인해 주세요." });
      return;
    }
    if (!client) return;
    setBusy(true);
    setNotice(null);
    const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (error) {
      setNotice({
        tone: "error",
        text: /rate/i.test(error.message)
          ? "잠시 후 다시 요청해 주세요."
          : "재설정 메일을 보내지 못했습니다.",
      });
      return;
    }
    setNotice({ tone: "success", text: "비밀번호 재설정 메일을 보냈어요." });
  }

  return (
    <AuthShell
      title="비밀번호 재설정"
      description="가입한 이메일로 재설정 링크를 요청하세요."
    >
      <NoticeBox notice={notice} />
      <form className="form-stack" onSubmit={submit} noValidate>
        <Field id="reset-email" label="이메일">
          <input
            id="reset-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="이메일 주소 입력"
          />
        </Field>
        <p className="card-copy">
          받은 메일의 링크에서 새 비밀번호를 설정할 수 있어요.
        </p>
        <button className="button primary full" disabled={busy} type="submit">
          {busy ? (
            <>
              <span className="button-spinner" />
              요청 중
            </>
          ) : (
            "재설정 메일 요청"
          )}
        </button>
      </form>
      <AppLink to="/login" className="center-link">
        로그인으로 돌아가기
      </AppLink>
    </AuthShell>
  );
}

function ResetPasswordPage() {
  const { client, session, loading } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      password.length < 8 ||
      !/[A-Za-z]/.test(password) ||
      !/\d/.test(password)
    ) {
      setNotice({ tone: "error", text: "비밀번호 조건을 확인해 주세요." });
      return;
    }
    if (!client || !session) return;
    setBusy(true);
    const { error } = await client.auth.updateUser({ password });
    if (error) {
      setBusy(false);
      setNotice({ tone: "error", text: "새 비밀번호를 저장하지 못했습니다." });
      return;
    }
    await client.auth.signOut({ scope: "local" });
    sessionStorage.setItem(
      "auth_notice",
      "새 비밀번호를 저장했어요. 다시 로그인해 주세요.",
    );
    go("/login", true);
  }

  if (loading) return <LoadingScreen label="재설정 링크 확인 중" />;
  if (!session)
    return (
      <AuthShell
        title="재설정 링크가 만료되었어요"
        description="보안을 위해 재설정 링크는 일정 시간이 지나면 사용할 수 없어요."
      >
        <NoticeBox
          notice={{
            tone: "error",
            text: "가장 최근에 받은 링크를 사용해 주세요.",
          }}
        />
        <AppLink to="/forgot-password" className="button primary full">
          새 링크 요청하기
        </AppLink>
      </AuthShell>
    );

  return (
    <AuthShell
      title="새 비밀번호 입력"
      description="앞으로 사용할 비밀번호를 설정해 주세요."
    >
      <NoticeBox notice={notice} />
      <form className="form-stack" onSubmit={submit}>
        <Field
          id="new-password"
          label="새 비밀번호"
          hint="8자 이상, 영문과 숫자를 포함해 주세요."
        >
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="새 비밀번호 입력"
          />
        </Field>
        <p className="card-footnote">
          입력한 비밀번호는 화면에 표시되지 않아요.
        </p>
        <button className="button primary full" disabled={busy} type="submit">
          {busy ? (
            <>
              <span className="button-spinner" />
              저장 중
            </>
          ) : (
            "새 비밀번호 저장"
          )}
        </button>
      </form>
      <AppLink to="/login" className="center-link">
        로그인으로 돌아가기
      </AppLink>
    </AuthShell>
  );
}

function AuthCallbackPage() {
  const { session, loading } = useAuth();
  if (loading) return <LoadingScreen label="이메일 확인 중" />;
  if (!session)
    return (
      <AuthShell
        title="인증 링크를 사용할 수 없어요"
        description="링크가 만료되었거나 이미 사용된 링크일 수 있어요."
      >
        <NoticeBox
          notice={{ tone: "error", text: "새 확인 메일을 요청해 주세요." }}
        />
        <AppLink to="/verify-email" className="button primary full">
          확인 메일 다시 받기
        </AppLink>
      </AuthShell>
    );
  sessionStorage.removeItem("pending_email");
  return (
    <AuthShell
      title="이메일 확인을 마쳤어요"
      description="이제 보호된 화면을 안전하게 이용할 수 있어요."
    >
      <NoticeBox
        notice={{ tone: "success", text: "이메일 확인이 완료됐어요." }}
      />
      <button className="button primary full" onClick={() => go("/", true)}>
        내 홈으로 이동
      </button>
    </AuthShell>
  );
}

const navItems = [
  ["홈", navHomeIcon, "/"],
  ["전체 목록", navListIcon, "/items"],
  ["캘린더", navCalendarIcon, "/calendar"],
  ["리포트", navReportIcon, ""],
  ["설정", navSettingsIcon, "/settings"],
] as const;

function AppNavigation({ active }: { active: "home" | "items" | "calendar" | "settings" | "notifications" }) {
  const { client, session } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  useEffect(() => {
    if (!client || !session || typeof client.from !== "function") return;
    client.from("in_app_notifications").select("id", { count: "exact", head: true }).eq("user_id", session.user.id).is("read_at", null)
      .then(({ count }) => setUnreadCount(count || 0));
  }, [client, session]);
  const activeForLabel = (label: string) =>
    label === "홈" ? "home" : label === "전체 목록" ? "items" : label === "캘린더" ? "calendar" : "settings";
  return (
    <>
      <header className="app-header">
        <Logo />
        <nav className="desktop-nav" aria-label="주요 메뉴">
          {navItems.map(([label, icon, path]) =>
            path ? (
              <AppLink
                key={label}
                to={path}
                className={
                  active === activeForLabel(label) ? "active" : undefined
                }
              >
                <img src={icon} alt="" />
                {label}
              </AppLink>
            ) : (
              <span key={label} aria-disabled="true">
                <img src={icon} alt="" />
                {label}
              </span>
            ),
          )}
        </nav>
        <AppLink
          to="/notifications"
          className={`notification-button${active === "notifications" ? " active" : ""}`}
          aria-label="알림"
        >
          <img src={notificationIcon} alt="" />
          {unreadCount ? <span className="notification-badge">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
        </AppLink>
      </header>
      <nav className="bottom-nav" aria-label="모바일 주요 메뉴">
        {navItems.map(([label, icon, path]) =>
          path ? (
            <AppLink
              key={label}
              to={path}
              className={
                active === activeForLabel(label) ? "active" : undefined
              }
            >
              <img src={icon} alt="" />
              <span>{label}</span>
            </AppLink>
          ) : (
            <span key={label} aria-disabled="true">
              <img src={icon} alt="" />
              <span>{label}</span>
            </span>
          ),
        )}
      </nav>
    </>
  );
}

function Protected({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  useEffect(() => {
    if (loading) return;
    if (!session) {
      sessionStorage.setItem("auth_notice", "계속하려면 로그인해 주세요.");
      go("/login", true);
    } else if (!session.user.email_confirmed_at) {
      if (session.user.email)
        sessionStorage.setItem("pending_email", session.user.email);
      go("/verify-email", true);
    }
  }, [loading, session]);
  if (loading || !session || !session.user.email_confirmed_at)
    return <LoadingScreen label="로그인 정보 확인 중" />;
  return <>{children}</>;
}

function HomePage() {
  const { client, session } = useAuth();
  const [apiState, setApiState] = useState<
    "checking" | "ready" | "unavailable"
  >("checking");
  const [profileSummary, setProfileSummary] = useState("설정 불러오는 중");
  useEffect(() => {
    const controller = new AbortController();
    getHealth(controller.signal)
      .then(() => setApiState("ready"))
      .catch(() => setApiState("unavailable"));
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!client || !session) return;
    client
      .from("profiles")
      .select("country_code,default_currency,timezone")
      .eq("id", session.user.id)
      .single()
      .then(({ data }) => {
        if (!data) {
          setProfileSummary("설정 확인 필요");
          return;
        }
        setProfileSummary(
          `${data.country_code === "KR" ? "대한민국" : data.country_code} · ${data.default_currency} · ${data.timezone}`,
        );
      });
  }, [client, session]);
  return (
    <div className="app-shell">
      <AppNavigation active="home" />
      <main className="dashboard">
        <section className="welcome-card">
          <div>
            <p className="section-kicker">통합 홈</p>
            <h1>
              오늘도 일정을
              <br />
              준비해 볼까요?
            </h1>
            <p>{session?.user.email} 계정으로 로그인되어 있어요.</p>
          </div>
          <div className="calendar-art">
            <span>{new Date().getDate()}</span>
          </div>
        </section>
        <section className="dashboard-grid">
          <article className="dashboard-card">
            <p>계정 상태</p>
            <h2>이메일 확인 완료</h2>
            <span>보호된 화면을 사용할 수 있어요.</span>
          </article>
          <article className="dashboard-card">
            <p>기본 설정</p>
            <h2>{profileSummary}</h2>
            <AppLink to="/settings">설정 확인하기</AppLink>
          </article>
          <article className="dashboard-card">
            <p>API 연결</p>
            <h2>
              {apiState === "checking"
                ? "확인 중"
                : apiState === "ready"
                  ? "정상 연결"
                  : "연결 필요"}
            </h2>
            <span>Phase 2 계정 기능이 준비되었어요.</span>
          </article>
        </section>
      </main>
    </div>
  );
}

function formatItemAmount(item: Pick<SubscriptionItem, "amount" | "currency">) {
  if (item.amount === null || item.amount === undefined)
    return "금액 확인 필요";
  return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(item.amount)}${item.currency === "KRW" ? "원" : ` ${item.currency}`}`;
}

function formatItemDate(value: string | null) {
  if (!value) return "날짜 확인 필요";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "날짜 확인 필요";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .replace(/\.$/, "");
}

function cycleLabel(cycle: SubscriptionItem["billing_cycle"]) {
  return cycle === "yearly"
    ? "매년"
    : cycle === "custom"
      ? "기타 주기"
      : "매월";
}

function itemStatusLabel(status: SubscriptionItem["actual_status"]) {
  return (
    {
      in_use: "이용 중",
      temporarily_paused: "일시 중지",
      payment_issue: "결제 확인",
      ended: "이용 종료",
      needs_review: "확인 필요",
    } as const
  )[status];
}

function ItemListPage() {
  const { client, session } = useAuth();
  const [items, setItems] = useState<SubscriptionItem[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("date");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    if (!client || !session) return;
    let active = true;
    client
      .from("items")
      .select("*")
      .eq("user_id", session.user.id)
      .eq("management_type", "recurring_subscription")
      .order("next_billing_date", { ascending: true, nullsFirst: false })
      .then(({ data, error }) => {
        if (!active) return;
        if (error)
          setNotice({
            tone: "error",
            text: "관리 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
          });
        setItems((data || []) as SubscriptionItem[]);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, session]);

  const filtered = items
    .filter((item) => {
      const matchesQuery =
        !query.trim() ||
        `${item.service_name} ${item.plan_name || ""}`
          .toLowerCase()
          .includes(query.trim().toLowerCase());
      return (
        matchesQuery && (status === "all" || item.actual_status === status)
      );
    })
    .sort((a, b) => {
      if (sort === "name")
        return a.service_name.localeCompare(b.service_name, "ko");
      if (sort === "amount") return (b.amount || 0) - (a.amount || 0);
      return (a.next_billing_date || "9999-12-31").localeCompare(
        b.next_billing_date || "9999-12-31",
      );
    });

  if (loading) return <LoadingScreen label="관리 목록을 불러오는 중" />;
  return (
    <div className="app-shell items-shell">
      <AppNavigation active="items" />
      <main className="items-page">
        <header className="items-title">
          <h1>관리 목록</h1>
          <p>구독부터 생활 기한까지, 등록한 항목을 함께 관리하세요.</p>
          <small>
            기준 ·{" "}
            {new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(
              new Date(),
            )}{" "}
            · {Intl.DateTimeFormat().resolvedOptions().timeZone}
          </small>
        </header>
        <div className="items-actions">
          <AppLink to="/items/new" className="button primary">
            ＋ 직접 등록
          </AppLink>
        </div>
        {notice ? <NoticeBox notice={notice} /> : null}
        <section className="filter-card">
          <Field id="item-search" label="이름 검색">
            <input
              id="item-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="항목 이름으로 검색"
            />
          </Field>
          <div className="filter-row">
            <label>
              <span>상태</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="all">상태 전체</option>
                <option value="in_use">이용 중</option>
                <option value="temporarily_paused">일시 중지</option>
                <option value="payment_issue">결제 확인</option>
                <option value="ended">이용 종료</option>
                <option value="needs_review">확인 필요</option>
              </select>
            </label>
            <label>
              <span>정렬</span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value)}
              >
                <option value="date">정렬 · 날짜</option>
                <option value="name">정렬 · 이름</option>
                <option value="amount">정렬 · 금액</option>
              </select>
            </label>
          </div>
          <p className="filter-help">
            유형·카테고리·정보 지원 필터는 다른 관리 유형이 추가될 때 같은
            패널로 확장됩니다.
          </p>
        </section>
        <section className="items-card">
          <div className="items-card-heading">
            <div>
              <h2>전체 항목 · {filtered.length}건</h2>
              <p>
                날짜순 · 미정은 뒤에 표시 · 실제 결제 여부를 의미하지 않아요.
              </p>
            </div>
          </div>
          {filtered.length ? (
            <div
              className="items-table"
              role="table"
              aria-label="관리 항목 목록"
            >
              <div className="items-table-head" role="row">
                <span>이름 / 유형</span>
                <span>금액 / 단위</span>
                <span>기한</span>
                <span>상태</span>
              </div>
              {filtered.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="item-row"
                  onClick={() => go(`/items/${item.id}`)}
                >
                  <span>
                    <strong>{item.service_name}</strong>
                    <small>반복 구독 · {item.plan_name || "플랜 미정"}</small>
                  </span>
                  <strong>{formatItemAmount(item)}</strong>
                  <span>
                    {formatItemDate(item.next_billing_date)} ·{" "}
                    {cycleLabel(item.billing_cycle)}
                  </span>
                  <em data-status={item.actual_status}>
                    {itemStatusLabel(item.actual_status)}
                  </em>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <strong>
                {items.length
                  ? "검색 결과가 없어요"
                  : "등록된 관리 항목이 없어요"}
              </strong>
              <p>
                {items.length
                  ? "검색어나 상태 필터를 바꿔 보세요."
                  : "첫 번째 반복 결제 구독을 직접 등록해 보세요."}
              </p>
              {!items.length ? (
                <AppLink to="/items/new" className="button primary">
                  구독 직접 등록
                </AppLink>
              ) : null}
            </div>
          )}
        </section>
        <InfoPanel title="모르는 정보는 그대로 남겨요">
          0원은 확인한 금액이에요. 금액 확인 필요와 구분하고, 날짜가 없으면 임의
          날짜로 바꾸지 않아요.
        </InfoPanel>
      </main>
    </div>
  );
}

function SubscriptionFormPage({ itemId }: { itemId?: string }) {
  const { client, session } = useAuth();
  const editing = Boolean(itemId);
  const [draft, setDraft] = useState<SubscriptionDraft>(EMPTY_SUBSCRIPTION);
  const [loading, setLoading] = useState(editing);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!editing || !client || !session || !itemId) return;
    client
      .from("items")
      .select("*")
      .eq("id", itemId)
      .eq("user_id", session.user.id)
      .single()
      .then(({ data, error }) => {
        if (error || !data)
          setNotice({
            tone: "error",
            text: "이 구독을 불러오지 못했어요. 목록에서 다시 선택해 주세요.",
          });
        else setDraft({ ...EMPTY_SUBSCRIPTION, ...(data as SubscriptionItem) });
        setLoading(false);
      });
  }, [client, editing, itemId, session]);

  function update<K extends keyof SubscriptionDraft>(
    key: K,
    value: SubscriptionDraft[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!draft.service_name.trim())
      nextErrors.service_name = "서비스 이름을 입력해 주세요.";
    if (
      draft.amount !== null &&
      (Number.isNaN(Number(draft.amount)) || Number(draft.amount) < 0)
    )
      nextErrors.amount = "금액은 0 이상으로 입력해 주세요.";
    if (draft.amount !== null && !draft.currency)
      nextErrors.currency = "금액의 실제 청구 통화를 선택해 주세요.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setNotice({ tone: "error", text: "입력 항목을 확인해 주세요." });
      return;
    }
    if (!client || !session) return;
    setBusy(true);
    setNotice({
      tone: "info",
      text: editing ? "구독을 저장하고 있어요." : "구독을 등록하고 있어요.",
    });
    const payload = {
      ...draft,
      service_name: draft.service_name.trim(),
      plan_name: draft.plan_name?.trim() || null,
      amount: draft.amount === null ? null : Number(draft.amount),
      first_billing_date: draft.first_billing_date || null,
      next_billing_date: draft.next_billing_date || null,
      payment_method: draft.payment_method?.trim() || null,
      category: draft.category?.trim() || null,
      memo: draft.memo?.trim() || null,
      user_id: session.user.id,
    };
    const result =
      editing && itemId
        ? await client
            .from("items")
            .update(payload)
            .eq("id", itemId)
            .eq("user_id", session.user.id)
            .select()
            .single()
        : await client.from("items").insert(payload).select().single();
    setBusy(false);
    if (result.error || !result.data) {
      setNotice({
        tone: "error",
        text: "저장하지 못했어요. 입력값과 연결 상태를 확인해 주세요.",
      });
      return;
    }
    setNotice({
      tone: "success",
      text: editing ? "구독을 저장했어요." : "구독을 등록했어요.",
    });
    go(`/items/${(result.data as SubscriptionItem).id}`, true);
  }

  if (loading) return <LoadingScreen label="구독 정보를 불러오는 중" />;
  return (
    <div className="app-shell items-shell">
      <AppNavigation active="items" />
      <main className="subscription-page">
        <header className="items-title">
          <h1>{editing ? "구독 수정" : "반복 구독 등록"}</h1>
          <p>
            확인한 정보만 입력하세요. 모르는 금액과 날짜는 나중에 채울 수
            있어요.
          </p>
          <small>
            기준 ·{" "}
            {new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(
              new Date(),
            )}{" "}
            · {Intl.DateTimeFormat().resolvedOptions().timeZone}
          </small>
        </header>
        <form onSubmit={save} className="subscription-layout">
          <section className="subscription-main">
            <div className="form-card">
              <h2>구독 정보</h2>
              <div className="form-grid">
                <Field
                  id="subscription-service"
                  label="서비스 이름"
                  error={errors.service_name}
                >
                  <input
                    id="subscription-service"
                    value={draft.service_name}
                    onChange={(event) =>
                      update("service_name", event.target.value)
                    }
                    placeholder="서비스 이름 입력"
                  />
                </Field>
                <Field id="subscription-plan" label="플랜">
                  <input
                    id="subscription-plan"
                    value={draft.plan_name || ""}
                    onChange={(event) =>
                      update("plan_name", event.target.value)
                    }
                    placeholder="예: 프리미엄"
                  />
                </Field>
                <Field
                  id="subscription-amount"
                  label="금액"
                  error={errors.amount}
                  hint="0 이상 · 금액 미정도 저장 가능 · 환율 변환 없음"
                >
                  <input
                    id="subscription-amount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={draft.amount ?? ""}
                    onChange={(event) =>
                      update(
                        "amount",
                        event.target.value === ""
                          ? null
                          : Number(event.target.value),
                      )
                    }
                    placeholder="금액 확인 필요"
                  />
                </Field>
                <Field
                  id="subscription-currency"
                  label="실제 청구 통화"
                  error={errors.currency}
                >
                  <select
                    id="subscription-currency"
                    value={draft.currency || ""}
                    onChange={(event) => update("currency", event.target.value)}
                  >
                    <option value="">금액 미정</option>
                    <option value="KRW">KRW · 원화</option>
                    <option value="USD">USD · 달러</option>
                    <option value="JPY">JPY · 엔화</option>
                    <option value="EUR">EUR · 유로</option>
                  </select>
                </Field>
                <Field id="subscription-cycle" label="결제 주기">
                  <select
                    id="subscription-cycle"
                    value={draft.billing_cycle || ""}
                    onChange={(event) =>
                      update(
                        "billing_cycle",
                        event.target
                          .value as SubscriptionDraft["billing_cycle"],
                      )
                    }
                  >
                    <option value="monthly">매월</option>
                    <option value="yearly">매년</option>
                    <option value="custom">기타 주기</option>
                  </select>
                </Field>
                <Field id="subscription-payment" label="결제 경로">
                  <input
                    id="subscription-payment"
                    value={draft.payment_method || ""}
                    onChange={(event) =>
                      update("payment_method", event.target.value)
                    }
                    placeholder="예: 공식 웹"
                  />
                </Field>
                <Field
                  id="subscription-first-date"
                  label="최초 가입일"
                  hint="월 단위 · D-day 없음 · 연·월만 아는 경우 그대로 저장해요."
                >
                  <input
                    id="subscription-first-date"
                    type="date"
                    value={draft.first_billing_date || ""}
                    onChange={(event) =>
                      update("first_billing_date", event.target.value)
                    }
                  />
                </Field>
                <Field
                  id="subscription-next-date"
                  label="확인한 다음 결제일"
                  hint="일 단위 · 연·월만 아는 경우 그대로 저장해요."
                >
                  <input
                    id="subscription-next-date"
                    type="date"
                    value={draft.next_billing_date || ""}
                    onChange={(event) =>
                      update("next_billing_date", event.target.value)
                    }
                  />
                </Field>
              </div>
              <Field id="subscription-date-note" label="예상 날짜 · 제안값">
                <input
                  id="subscription-date-note"
                  value={
                    draft.next_billing_date
                      ? "확정 날짜가 있어 제안하지 않음"
                      : "확정 날짜가 없어 제안하지 않음"
                  }
                  readOnly
                />
              </Field>
              <InfoPanel title="예상 날짜는 확정 날짜와 달라요">
                확정일이 없으면 예상 날짜로 구분해요. 연·월만 아는 날짜를 임의의
                일자로 바꾸지 않아요.
              </InfoPanel>
              <div className="form-grid">
                <Field id="subscription-actual-status" label="실제 이용 상태">
                  <select
                    id="subscription-actual-status"
                    value={draft.actual_status}
                    onChange={(event) =>
                      update(
                        "actual_status",
                        event.target
                          .value as SubscriptionDraft["actual_status"],
                      )
                    }
                  >
                    <option value="in_use">이용 중</option>
                    <option value="temporarily_paused">일시 중지</option>
                    <option value="payment_issue">결제 확인</option>
                    <option value="ended">이용 종료</option>
                    <option value="needs_review">확인 필요</option>
                  </select>
                </Field>
                <Field id="subscription-auto-renewal" label="자동 갱신">
                  <select
                    id="subscription-auto-renewal"
                    value={draft.auto_renewal_status}
                    onChange={(event) =>
                      update(
                        "auto_renewal_status",
                        event.target
                          .value as SubscriptionDraft["auto_renewal_status"],
                      )
                    }
                  >
                    <option value="on">켜짐</option>
                    <option value="off">꺼짐</option>
                    <option value="manual">수동 갱신</option>
                    <option value="needs_review">확인 필요</option>
                  </select>
                </Field>
                <Field id="subscription-plan-status" label="나의 계획">
                  <select
                    id="subscription-plan-status"
                    value={draft.usage_plan}
                    onChange={(event) =>
                      update(
                        "usage_plan",
                        event.target.value as SubscriptionDraft["usage_plan"],
                      )
                    }
                  >
                    <option value="scheduled">유지 예정</option>
                    <option value="ended">이용 종료 예정</option>
                    <option value="needs_review">확인 필요</option>
                  </select>
                </Field>
                <Field id="subscription-review" label="나의 검토일 · 선택">
                  <select
                    value={
                      draft.usage_plan === "needs_review"
                        ? "needs_review"
                        : "none"
                    }
                    onChange={(event) =>
                      update(
                        "usage_plan",
                        event.target.value === "needs_review"
                          ? "needs_review"
                          : "scheduled",
                      )
                    }
                  >
                    <option value="none">확인 필요 없음</option>
                    <option value="needs_review">확인 필요</option>
                  </select>
                </Field>
              </div>
            </div>
            <div className="form-card">
              <h2>분류와 메모</h2>
              <Field id="subscription-category" label="카테고리">
                <select
                  id="subscription-category"
                  value={draft.category || ""}
                  onChange={(event) => update("category", event.target.value)}
                >
                  <option value="">카테고리 선택</option>
                  <option value="영상·콘텐츠·OTT">영상·콘텐츠·OTT</option>
                  <option value="AI·생산성">AI·생산성</option>
                  <option value="디자인·소프트웨어">디자인·소프트웨어</option>
                  <option value="음악·오디오">음악·오디오</option>
                  <option value="독서·교육">독서·교육</option>
                  <option value="게임">게임</option>
                  <option value="쇼핑·배달">쇼핑·배달</option>
                  <option value="식품·카페·외식">식품·카페·외식</option>
                  <option value="정기배송">정기배송</option>
                  <option value="가전·생활관리">가전·생활관리</option>
                  <option value="통신·클라우드">통신·클라우드</option>
                  <option value="건강·운동">건강·운동</option>
                  <option value="라이프·기록">라이프·기록</option>
                  <option value="기타">기타</option>
                </select>
              </Field>
              <Field id="subscription-memo" label="메모">
                <textarea
                  id="subscription-memo"
                  value={draft.memo || ""}
                  onChange={(event) => update("memo", event.target.value)}
                  placeholder="메모를 입력해 주세요."
                  rows={3}
                />
              </Field>
              <div className="form-actions">
                <button
                  className="button primary"
                  type="submit"
                  disabled={busy}
                >
                  {busy ? (
                    <>
                      <span className="button-spinner" />
                      저장 중
                    </>
                  ) : editing ? (
                    "수정 저장"
                  ) : (
                    "구독 저장"
                  )}
                </button>
                <AppLink
                  to={editing && itemId ? `/items/${itemId}` : "/items"}
                  className="button secondary"
                >
                  취소
                </AppLink>
              </div>
            </div>
          </section>
          <aside className="subscription-side">
            {" "}
            <InfoPanel title="날짜가 지나도 결제 실패가 아니에요">
              실제 이용 상태, 자동 갱신, 나의 계획은 독립적으로 관리해요.
              예정일과 실제 상태를 자동 판단하지 않아요.
            </InfoPanel>
            <section className="help-card">
              <h2>저장 전 확인</h2>
              <p>
                금액을 입력했다면 실제 청구 통화를 선택하세요. 기본 통화로
                추정하지 않아요.
              </p>
              <p>
                날짜 미정은 D-day·정확한 일정에서 제외돼요. 금액 미정은 합계에서
                제외돼요.
              </p>
              <p>
                이름 등 식별 정보의 필수 여부·길이는 확인 필요 상태로
                처리했어요.
              </p>
            </section>
          </aside>
        </form>
      </main>
    </div>
  );
}

function SubscriptionDetailPage({ itemId }: { itemId: string }) {
  const { client, session } = useAuth();
  const [item, setItem] = useState<SubscriptionItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    if (!client || !session) return;
    client
      .from("items")
      .select("*")
      .eq("id", itemId)
      .eq("user_id", session.user.id)
      .single()
      .then(({ data, error }) => {
        if (error || !data)
          setNotice({ tone: "error", text: "이 항목을 찾을 수 없어요." });
        else setItem(data as SubscriptionItem);
        setLoading(false);
      });
  }, [client, itemId, session]);
  async function remove() {
    if (!client || !session || !item || deleting) return;
    setDeleting(true);
    setNotice({ tone: "info", text: "구독을 삭제하고 있어요." });
    const { error } = await client
      .from("items")
      .delete()
      .eq("id", item.id)
      .eq("user_id", session.user.id);
    if (error) {
      setDeleting(false);
      setNotice({
        tone: "error",
        text: "삭제하지 못했어요. 항목은 그대로 유지돼요.",
      });
      return;
    }
    go("/items", true);
  }
  if (loading) return <LoadingScreen label="구독 상세를 불러오는 중" />;
  if (!item)
    return (
      <div className="app-shell">
        <AppNavigation active="items" />
        <main className="items-page">
          <NoticeBox
            notice={
              notice || { tone: "error", text: "이 항목을 찾을 수 없어요." }
            }
          />
          <AppLink to="/items" className="button secondary">
            관리 목록으로
          </AppLink>
        </main>
      </div>
    );
  return (
    <div className="app-shell items-shell">
      <AppNavigation active="items" />
      <main className="detail-page">
        <header className="items-title">
          <h1>구독 상세</h1>
          <p>
            {item.service_name} · {item.plan_name || "플랜 미정"} · 반복 구독
          </p>
          <small>
            기준 ·{" "}
            {new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(
              new Date(),
            )}{" "}
            · {Intl.DateTimeFormat().resolvedOptions().timeZone}
          </small>
        </header>
        <div className="items-actions">
          <AppLink to={`/items/${item.id}/edit`} className="button primary">
            수정
          </AppLink>
          <button
            type="button"
            className="button secondary danger-text"
            onClick={() => setDeleteConfirm((value) => !value)}
            disabled={deleting}
          >
            삭제
          </button>
        </div>
        {notice ? <NoticeBox notice={notice} /> : null}
        {deleteConfirm ? (
          <div className="delete-confirm" role="alert">
            <strong>이 구독을 삭제할까요?</strong>
            <p>
              과거 기록과 미래 예상 일정에서 이 항목이 제외됩니다. 삭제한 항목은
              이번 단계에서 복구할 수 없어요.
            </p>
            <div>
              <button
                type="button"
                className="button danger-button"
                onClick={remove}
                disabled={deleting}
              >
                {deleting ? "삭제 중" : "삭제 확인"}
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => setDeleteConfirm(false)}
              >
                취소
              </button>
            </div>
          </div>
        ) : null}
        <div className="detail-layout">
          <section className="detail-main">
            <section className="detail-card next-payment">
              <h2>다음 결제 예정</h2>
              <span className="status-badge">
                {item.next_billing_date
                  ? `확인한 날짜 · ${item.next_billing_date === new Date().toISOString().slice(0, 10) ? "오늘" : formatItemDate(item.next_billing_date)}`
                  : "날짜 확인 필요"}
              </span>
              <strong className="detail-amount">
                {formatItemAmount(item)}
              </strong>
              <dl>
                <div>
                  <dt>다음 결제일 / 주기</dt>
                  <dd>
                    {formatItemDate(item.next_billing_date)} ·{" "}
                    {cycleLabel(item.billing_cycle)}
                  </dd>
                </div>
                <div>
                  <dt>실제 청구 통화 / 결제 경로</dt>
                  <dd>
                    {item.currency || "통화 확인 필요"} ·{" "}
                    {item.payment_method || "결제 경로 확인 필요"}
                  </dd>
                </div>
                <div>
                  <dt>최초 가입일</dt>
                  <dd>{formatItemDate(item.first_billing_date)}</dd>
                </div>
                <div>
                  <dt>해지 기한 / 나의 검토일</dt>
                  <dd>
                    {item.auto_renewal_status === "off"
                      ? "자동 갱신 꺼짐"
                      : "확인 필요"}{" "}
                    /{" "}
                    {item.usage_plan === "needs_review"
                      ? "확인 필요"
                      : "확인 필요 없음"}
                  </dd>
                </div>
              </dl>
              <InfoPanel title="실제 결제 여부 미확인">
                이 화면은 등록한 예정 정보를 보여줘요. 날짜가 지나도 결제 완료나
                결제 문제로 바뀌지 않아요.
              </InfoPanel>
            </section>
            <section className="detail-card">
              <h2>독립적으로 관리하는 상태</h2>
              <dl>
                <div>
                  <dt>실제 이용 상태</dt>
                  <dd>{itemStatusLabel(item.actual_status)}</dd>
                </div>
                <div>
                  <dt>자동 갱신</dt>
                  <dd>
                    {item.auto_renewal_status === "on"
                      ? "켜짐"
                      : item.auto_renewal_status === "off"
                        ? "꺼짐"
                        : item.auto_renewal_status === "manual"
                          ? "수동 갱신"
                          : "확인 필요"}
                  </dd>
                </div>
                <div>
                  <dt>나의 계획</dt>
                  <dd>
                    {item.usage_plan === "scheduled"
                      ? "유지 예정"
                      : item.usage_plan === "ended"
                        ? "이용 종료 예정"
                        : "확인 필요"}
                  </dd>
                </div>
              </dl>
            </section>
            <section className="detail-card">
              <h2>묶음·포함 관계</h2>
              <dl>
                <div>
                  <dt>비용 소유자</dt>
                  <dd>{item.service_name} · 직접 결제</dd>
                </div>
              </dl>
              <p className="detail-muted">
                연결된 부모·포함 혜택 없음 · 이 항목은 한 번만 계산해요.
              </p>
              <button type="button" className="button primary" disabled>
                관계 등록·수정
              </button>
              <small className="detail-muted">
                관계 입력은 공통 변형 패널로 확장할 수 있어요.
              </small>
            </section>
          </section>
          <aside className="detail-side">
            <section className="detail-card">
              <h2>알림</h2>
              <dl>
                <div>
                  <dt>기본 알림</dt>
                  <dd>
                    {(item.reminder_days_before || [3, 0]).join("일 전 + ")}일{" "}
                    {item.reminder_time}
                  </dd>
                </div>
              </dl>
              <p className="detail-muted">
                {Intl.DateTimeFormat().resolvedOptions().timeZone} · 앱 내 기록
                유지 · 미래·미발송 알림만 변경
              </p>
            </section>
            <section className="detail-card screenshot-placeholder">
              <h2>보관 스크린샷</h2>
              <div className="empty-state">
                <strong>등록된 스크린샷이 없어요</strong>
                <p>이미지 등록은 다음 구현 범위에서 연결할 예정이에요.</p>
              </div>
            </section>
            <section className="detail-card">
              <h2>정보 지원</h2>
              <dl>
                <div>
                  <dt>내 구독 소식</dt>
                  <dd>이번 단계 미지원</dd>
                </div>
                <div>
                  <dt>해지 안내</dt>
                  <dd>이번 단계 미지원</dd>
                </div>
              </dl>
              <div className="form-actions">
                <button type="button" className="button primary" disabled>
                  내 구독 소식
                </button>
                <button type="button" className="button secondary" disabled>
                  해지 안내
                </button>
              </div>
              <p className="detail-muted">
                소식 지원과 해지 안내 지원은 별개예요.
              </p>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}

function SettingsPage() {
  const { client, session } = useAuth();
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [storageBytes, setStorageBytes] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    if (!client || !session) return;
    let active = true;
    Promise.all([
      client
        .from("profiles")
        .select(
          "country_code,default_currency,timezone,notification_days_before,notification_time,in_app_notifications_enabled",
        )
        .eq("id", session.user.id)
        .single(),
      client.rpc("get_my_storage_usage"),
    ]).then(([profileResult, storageResult]) => {
      if (!active) return;
      if (profileResult.data)
        setProfile({
          ...DEFAULT_PROFILE,
          ...profileResult.data,
          notification_time: String(profileResult.data.notification_time).slice(
            0,
            5,
          ),
        } as Profile);
      if (typeof storageResult.data === "number")
        setStorageBytes(storageResult.data);
      if (profileResult.error)
        setNotice({ tone: "error", text: "설정을 불러오지 못했습니다." });
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [client, session]);

  function toggleDay(day: number) {
    setProfile((current) => ({
      ...current,
      notification_days_before: current.notification_days_before.includes(day)
        ? current.notification_days_before.filter((value) => value !== day)
        : [...current.notification_days_before, day].sort((a, b) => b - a),
    }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!client || !session || profile.notification_days_before.length === 0) {
      setNotice({
        tone: "error",
        text: "알림 시점을 하나 이상 선택해 주세요.",
      });
      return;
    }
    setBusy(true);
    setNotice({ tone: "info", text: "설정을 저장하고 있어요." });
    const { error } = await client
      .from("profiles")
      .update(profile)
      .eq("id", session.user.id);
    setBusy(false);
    setNotice(
      error
        ? { tone: "error", text: "설정을 저장하지 못했습니다." }
        : { tone: "success", text: "설정을 저장했어요." },
    );
  }

  async function logout() {
    if (!client || logoutBusy) return;
    setLogoutBusy(true);
    const { error } = await client.auth.signOut();
    if (error) await client.auth.signOut({ scope: "local" });
    sessionStorage.removeItem("pending_email");
    go("/login", true);
  }

  if (loading) return <LoadingScreen label="설정 불러오는 중" />;
  const storageMb = storageBytes / 1024 / 1024;
  return (
    <div className="app-shell settings-shell">
      <AppNavigation active="settings" />
      <main className="settings-page">
        <header className="settings-title">
          <h1>사용자 기본 설정</h1>
          <p>내 계정과 구독 관리의 기본값을 확인하세요.</p>
        </header>
        <NoticeBox notice={notice} />
        <form onSubmit={save} className="settings-layout">
          <section className="settings-card settings-primary">
            <div className="section-header">
              <h2>기본값</h2>
              <p>현재 적용 가능한 설정이에요.</p>
            </div>
            <Field id="country" label="국가">
              <select
                id="country"
                value={profile.country_code}
                onChange={(event) =>
                  setProfile({ ...profile, country_code: event.target.value })
                }
              >
                <option value="KR">대한민국</option>
                <option value="US">미국</option>
                <option value="JP">일본</option>
                <option value="GB">영국</option>
                <option value="CA">캐나다</option>
                <option value="SG">싱가포르</option>
              </select>
            </Field>
            <Field id="currency" label="기본 통화">
              <select
                id="currency"
                value={profile.default_currency}
                onChange={(event) =>
                  setProfile({
                    ...profile,
                    default_currency: event.target.value,
                  })
                }
              >
                <option value="KRW">원화 (KRW)</option>
                <option value="USD">달러 (USD)</option>
                <option value="JPY">엔화 (JPY)</option>
                <option value="EUR">유로 (EUR)</option>
                <option value="GBP">파운드 (GBP)</option>
              </select>
            </Field>
            <Field id="timezone" label="시간대">
              <select
                id="timezone"
                value={profile.timezone}
                onChange={(event) =>
                  setProfile({ ...profile, timezone: event.target.value })
                }
              >
                <option value="Asia/Seoul">Asia/Seoul</option>
                <option value="Asia/Tokyo">Asia/Tokyo</option>
                <option value="Asia/Singapore">Asia/Singapore</option>
                <option value="America/New_York">America/New_York</option>
                <option value="America/Los_Angeles">America/Los_Angeles</option>
                <option value="Europe/London">Europe/London</option>
                <option value="UTC">UTC</option>
              </select>
            </Field>
            <div className="settings-subsection">
              <h3>알림 기본값</h3>
              <p>새 일정에 적용할 기본 시점과 시각이에요.</p>
              <div className="chip-group">
                <button
                  type="button"
                  className="choice-chip"
                  aria-pressed={profile.notification_days_before.includes(3)}
                  onClick={() => toggleDay(3)}
                >
                  3일 전
                </button>
                <button
                  type="button"
                  className="choice-chip"
                  aria-pressed={profile.notification_days_before.includes(0)}
                  onClick={() => toggleDay(0)}
                >
                  당일
                </button>
              </div>
              <div className="notification-row">
                <Field id="notification-time" label="기본 알림 시각">
                  <input
                    id="notification-time"
                    type="time"
                    value={profile.notification_time}
                    onChange={(event) =>
                      setProfile({
                        ...profile,
                        notification_time: event.target.value,
                      })
                    }
                  />
                </Field>
                <label className="toggle-row">
                  <span>
                    <strong>앱 안 알림</strong>
                    <small>앱에서 알림 기록을 확인해요.</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={profile.in_app_notifications_enabled}
                    onChange={(event) =>
                      setProfile({
                        ...profile,
                        in_app_notifications_enabled: event.target.checked,
                      })
                    }
                  />
                  <span className="toggle" />
                </label>
              </div>
            </div>
            <InfoPanel title="통화별 금액은 그대로 유지돼요">
              기본 통화를 바꿔도 구독의 원래 금액은 환산하지 않아요.
            </InfoPanel>
            <button
              className="button primary full"
              disabled={busy}
              type="submit"
            >
              {busy ? (
                <>
                  <span className="button-spinner" />
                  설정 저장 중
                </>
              ) : (
                "설정 저장"
              )}
            </button>
          </section>
          <aside className="account-column">
            <section className="settings-card account-card">
              <h2>계정</h2>
              <Field id="account-email" label="이메일 · 읽기 전용">
                <div id="account-email" className="readonly-value">
                  {session?.user.email}
                </div>
              </Field>
              <InfoPanel title="이메일 확인 완료" />
              <div className="storage-summary">
                <span>저장 공간</span>
                <strong>
                  {storageMb.toFixed(storageMb > 0 ? 1 : 0)}MB / 100MB
                </strong>
              </div>
              <button
                className="button secondary full"
                type="button"
                onClick={logout}
                disabled={logoutBusy}
              >
                {logoutBusy ? "로그아웃 중" : "로그아웃"}
              </button>
            </section>
            <section className="settings-card deletion-card">
              <h2>회원 탈퇴</h2>
              <p>
                탈퇴하면 즉시 로그아웃되고 계정에 접근할 수 없어요. 계속하기
                전에 처리 범위를 확인해 주세요.
              </p>
              <AppLink
                to="/delete-account"
                className="button danger-outline full"
              >
                탈퇴 안내 및 최종 확인
              </AppLink>
            </section>
          </aside>
        </form>
      </main>
    </div>
  );
}

function DeleteAccountPage() {
  const { client, session } = useAuth();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  async function remove() {
    if (!client || !session || busy) return;
    setBusy(true);
    setNotice({ tone: "info", text: "회원 탈퇴를 처리하고 있어요." });
    try {
      await deleteAccount(session.access_token);
      await client.auth.signOut({ scope: "local" });
      sessionStorage.clear();
      go("/account-deleted", true);
    } catch (error) {
      setBusy(false);
      setNotice({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "회원 탈퇴를 완료하지 못했습니다.",
      });
    }
  }

  return (
    <main className="auth-page">
      <PublicHeader />
      <section className="auth-content destructive-content">
        <div className="auth-flow auth-flow-wide">
          <header className="page-title">
            <h1>탈퇴 최종 확인</h1>
            <p>계정 이용 종료와 개인정보 삭제 범위를 확인해 주세요.</p>
          </header>
          <div className="auth-card destructive-card">
            <NoticeBox notice={notice} />
            <div className="warning-panel">
              <img src={warningIcon} alt="" />
              <div>
                <strong>탈퇴하면 계정에 접근할 수 없어요</strong>
                <p>요청이 접수되면 즉시 로그아웃되고 계정 접근이 차단돼요.</p>
              </div>
            </div>
            <section className="deletion-scope">
              <h2>탈퇴 후 처리되는 내용</h2>
              <div>
                <h3>계정 이용과 개인화 처리 종료</h3>
                <p>계정 접근, 알림 대상, 사용자별 소식 처리가 중단됩니다.</p>
              </div>
              <div>
                <h3>개인정보 삭제 · 요청 후 24시간 이내 목표</h3>
                <p>
                  개인 이미지, 관리 이력, 추출 초안과 관심 정보를 삭제 대상으로
                  처리합니다. 즉시 삭제 완료를 보장하지 않아요.
                </p>
              </div>
              <div>
                <h3>별도로 유지될 수 있는 정보</h3>
                <p>
                  공통 소식과 해지 안내는 남을 수 있어요. 외부 제공자의 기록과
                  백업은 삭제 범위가 다를 수 있습니다.
                </p>
              </div>
            </section>
            <div className="action-stack destructive-actions">
              <AppLink to="/settings" className="button secondary full">
                취소하고 설정으로 돌아가기
              </AppLink>
              <button
                type="button"
                className="button danger-outline full"
                disabled={busy}
                onClick={remove}
              >
                {busy ? (
                  <>
                    <span className="button-spinner danger-spinner" />
                    탈퇴 처리 중
                  </>
                ) : (
                  "탈퇴 요청 확정"
                )}
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function AccountDeletedPage() {
  return (
    <main className="completion-page">
      <section className="completion-content">
        <h1>회원 탈퇴가 완료되었어요</h1>
        <p>
          계정 이용과 알림이 중단되었어요. 개인 자료는 24시간 이내 삭제를 목표로
          처리돼요.
        </p>
        <AppLink to="/login" className="button primary completion-button">
          시작 화면으로
        </AppLink>
      </section>
    </main>
  );
}

export default function App() {
  const path = usePath();
  if (!publicConfig.isSupabaseConfigured) return <MissingConfig />;
  if (path === "/login") return <LoginPage />;
  if (path === "/signup") return <SignupPage />;
  if (path === "/verify-email") return <VerifyEmailPage />;
  if (path === "/forgot-password") return <ForgotPasswordPage />;
  if (path === "/reset-password") return <ResetPasswordPage />;
  if (path === "/auth/callback") return <AuthCallbackPage />;
  if (path === "/account-deleted") return <AccountDeletedPage />;
  if (path === "/images/new")
    return (
      <Protected>
        <Phase3FormPage navigation={<AppNavigation active="items" />} />
      </Protected>
    );
  if (path === "/images")
    return (
      <Protected>
        <Phase4ImageLibraryPage navigation={<AppNavigation active="items" />} />
      </Protected>
    );
  if (path === "/items/new")
    return (
      <Protected>
        <Phase3FormPage navigation={<AppNavigation active="items" />} />
      </Protected>
    );
  if (path.endsWith("/edit") && path.startsWith("/items/"))
    return (
      <Protected>
        <Phase3FormPage
          navigation={<AppNavigation active="items" />}
          itemId={path.split("/")[2]}
        />
      </Protected>
    );
  if (path.startsWith("/items/") && path.split("/").length === 3)
    return (
      <Protected>
        <Phase3DetailPage
          navigation={<AppNavigation active="items" />}
          itemId={path.split("/")[2]}
        />
      </Protected>
    );
  if (path === "/items")
    return (
      <Protected>
        <Phase3ListPage navigation={<AppNavigation active="items" />} />
      </Protected>
    );
  if (path === "/calendar")
    return (
      <Protected>
        <CalendarPage navigation={<AppNavigation active="calendar" />} />
      </Protected>
    );
  if (path === "/notifications")
    return (
      <Protected>
        <NotificationsPage navigation={<AppNavigation active="notifications" />} />
      </Protected>
    );
  if (path === "/settings")
    return (
      <Protected>
        <SettingsPage />
      </Protected>
    );
  if (path === "/delete-account")
    return (
      <Protected>
        <DeleteAccountPage />
      </Protected>
    );
  return (
    <Protected>
      <UnifiedHomePage navigation={<AppNavigation active="home" />} />
    </Protected>
  );
}

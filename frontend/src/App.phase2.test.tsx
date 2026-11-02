import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";

const authMock = vi.hoisted(() => ({
  client: {
    auth: {
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      resend: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
      signOut: vi.fn(),
    },
  },
  session: null as null | {
    user: { id: string; email: string; email_confirmed_at: string };
  },
  loading: false,
}));

vi.mock("./auth/AuthContext", () => ({ useAuth: () => authMock }));
vi.mock("./lib/config", () => ({
  publicConfig: {
    apiBaseUrl: "http://localhost:8000",
    isSupabaseConfigured: true,
    supabaseUrl: "https://example.supabase.co",
    supabasePublishableKey: "public-test-value",
  },
}));

describe("Phase 2 account screens", () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, "", "/login");
  });

  afterEach(() => {
    cleanup();
    authMock.session = null;
    vi.clearAllMocks();
  });

  it("validates login fields before sending a request", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));
    expect(
      screen.getByText("이메일 주소 형식을 확인해 주세요."),
    ).toBeInTheDocument();
    expect(screen.getByText("비밀번호를 입력해 주세요.")).toBeInTheDocument();
    expect(authMock.client.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("shows the required account deletion completion wording", () => {
    window.history.replaceState(null, "", "/account-deleted");
    render(<App />);
    expect(
      screen.getByRole("heading", { name: "회원 탈퇴가 완료되었어요" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/24시간 이내 삭제를 목표/)).toBeInTheDocument();
    expect(screen.queryByText(/모든 자료가 즉시 삭제/)).not.toBeInTheDocument();
  });

  it.each([
    ["/signup", "회원가입"],
    ["/verify-email", "이메일을 확인해 주세요"],
    ["/forgot-password", "비밀번호 재설정"],
    ["/reset-password", "재설정 링크가 만료되었어요"],
  ])("renders the public Phase 2 screen at %s", (path, heading) => {
    window.history.replaceState(null, "", path);
    render(<App />);
    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
  });

  it("renders the shared recurring subscription form for an authenticated user", () => {
    authMock.session = {
      user: {
        id: "user-phase3",
        email: "member@example.com",
        email_confirmed_at: "2026-11-02T00:00:00Z",
      },
    };
    window.history.replaceState(null, "", "/items/new");

    render(<App />);

    expect(
      screen.getByRole("heading", { name: "반복 구독 등록" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("서비스명")).toBeInTheDocument();
    expect(screen.getByLabelText("실제 통화")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "반복 구독 저장" }),
    ).toBeEnabled();
  });

  it("renders the gifticon form variant without recurring subscription fields", () => {
    authMock.session = {
      user: {
        id: "user-phase3",
        email: "member@example.com",
        email_confirmed_at: "2026-11-02T00:00:00Z",
      },
    };
    window.history.replaceState(null, "", "/items/new?type=gifticon");

    render(<App />);

    expect(
      screen.getByRole("heading", { name: "기프티콘 등록" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("사용처")).toBeInTheDocument();
    expect(screen.getByLabelText("유효기간 정밀도")).toBeInTheDocument();
    expect(screen.getByLabelText("사용 상태")).toBeInTheDocument();
    expect(screen.queryByLabelText("결제 주기")).not.toBeInTheDocument();
  });

  it("starts with KRW and requires a currency even when a zero amount is confirmed", () => {
    authMock.session = {
      user: {
        id: "user-phase3",
        email: "member@example.com",
        email_confirmed_at: "2026-11-02T00:00:00Z",
      },
    };
    window.history.replaceState(null, "", "/items/new");
    render(<App />);

    fireEvent.change(screen.getByLabelText("서비스명"), {
      target: { value: "직접 입력 서비스" },
    });
    fireEvent.change(screen.getByLabelText("금액"), {
      target: { value: "0" },
    });
    expect(screen.getByLabelText("실제 통화")).toHaveValue("KRW");
    fireEvent.change(screen.getByLabelText("실제 통화"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "반복 구독 저장" }));

    expect(
      screen.getByText("금액의 실제 통화를 선택해 주세요."),
    ).toBeInTheDocument();
  });
});

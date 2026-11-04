import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useAuth } from "../auth/AuthContext";
import {
  analyzeImage,
  changeImageLifecycle,
  confirmImage,
  getGoogleCalendarStatus,
  syncGoogleCalendar,
} from "../lib/api";
import {
  applyImageExtraction,
  canStartImageAnalysis,
  retargetImageDraft,
  type ImageExtraction,
} from "../phase4/imageDraft";
import { ItemSupportContent } from "../phase8/Phase8Pages";
import { PageHeader } from "../components/ui";
import galleryIcon from "../assets/figma/gallery.svg";
import {
  CATEGORY_OPTIONS,
  TYPE_OPTIONS,
  buildManagedItemPayload,
  canMarkUsed,
  createEmptyDraft,
  dateInputType,
  displayDate,
  formatDday,
  isPastDate,
  itemStatusValue,
  isMoneyType,
  isPaymentScheduleType,
  proposeNextRecurringDate,
  targetSortValue,
  typeLabel,
  validateManagedItemDraft,
  type DatePrecision,
  type LifecycleStatus,
  type ManagedItem,
  type ManagedItemDraft,
  type ManagementType,
  type SupportScope,
} from "./model";
import "./phase3.css";

type Notice = { tone: "success" | "error" | "info"; text: string } | null;
type PageProps = { navigation: ReactNode };
type ItemImage = {
  id: string;
  storage_path: string;
  mime_type: string;
  created_at: string;
  signed_url: string | null;
};

function navigate(path: string, replace = false) {
  window.history[replace ? "replaceState" : "pushState"](null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function Link({
  to,
  className,
  children,
}: {
  to: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
          event.preventDefault();
          navigate(to);
        }
      }}
    >
      {children}
    </a>
  );
}

function Field({
  id,
  label,
  error,
  hint,
  imageFilled = false,
  required = false,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  imageFilled?: boolean;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="field"
      data-invalid={error ? "true" : undefined}
      data-image-filled={imageFilled ? "true" : undefined}
    >
      <div className="field-label-heading">
        <label htmlFor={id}>{label}</label>
        {required ? (
          <span className="required-mark" aria-hidden="true">
            *
          </span>
        ) : null}
        {imageFilled ? <small className="image-filled-badge">이미지에서 입력됨</small> : null}
      </div>
      {children}
      {error ? (
        <small className="field-error" role="alert">
          {error}
        </small>
      ) : hint ? (
        <small>{hint}</small>
      ) : null}
    </div>
  );
}

function NoticeBox({ notice }: { notice: Notice }) {
  return notice ? (
    <div
      className={`notice ${notice.tone}`}
      role={notice.tone === "error" ? "alert" : "status"}
    >
      {notice.text}
    </div>
  ) : null;
}

function Info({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="info-panel">
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}

function PageLoading({ label }: { label: string }) {
  return (
    <main className="loading-screen">
      <span className="button-spinner" />
      <p>{label}</p>
    </main>
  );
}

function formatAmount(item: ManagedItem) {
  if (item.amount === null) return "금액 확인 필요";
  if (item.management_type === "points")
    return `${new Intl.NumberFormat("ko-KR").format(item.amount)} ${item.unit_name || "포인트"}`;
  if (!item.currency)
    return `${new Intl.NumberFormat("ko-KR").format(item.amount)} · 통화 확인 필요`;
  return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(item.amount)} ${item.currency}`;
}

function statusLabel(item: ManagedItem) {
  if (isPaymentScheduleType(item.management_type)) {
    return (
      {
        in_use: "이용 중",
        temporarily_paused: "일시 중지",
        payment_issue: "결제 확인",
        ended: "이용 종료",
        needs_review: "확인 필요",
      } as const
    )[item.actual_status];
  }
  return (
    {
      active: "유효",
      unused: "미사용",
      used: "사용 완료",
      ended: "종료",
      expired: "기한 만료",
      needs_review: "확인 필요",
      in_use: "이용 중",
      temporarily_paused: "일시 중지",
      payment_issue: "결제 확인",
    } as const
  )[itemStatusValue(item)];
}

function itemDate(item: ManagedItem) {
  return displayDate(
    item.target_date_value || item.next_billing_date,
    item.target_date_precision || (item.next_billing_date ? "day" : null),
  );
}

function ItemDdayBadge({ item }: { item: ManagedItem }) {
  const value = item.target_date_value || item.next_billing_date;
  const precision = item.target_date_value
    ? item.target_date_precision
    : item.next_billing_date
      ? "day"
      : null;
  const dday = formatDday(value, precision);
  return dday ? <span className={`item-row-dday ${dday.tone}`}>{dday.label}</span> : null;
}

function itemHasPastDate(item: ManagedItem) {
  const value = item.target_date_value || item.next_billing_date;
  const precision = item.target_date_value
    ? item.target_date_precision
    : item.next_billing_date
      ? "day"
      : null;
  return isPastDate(value, precision);
}

function isDueMatch(item: ManagedItem, filter: string) {
  const value = targetSortValue(item);
  if (filter === "all") return true;
  if (filter === "unknown") return value === "9999-12-31";
  if (value === "9999-12-31") return false;
  const today = new Date();
  const todayText = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (filter === "past")
    return value.length === 7
      ? value < todayText.slice(0, 7)
      : value < todayText;
  if (filter === "next30") {
    const end = new Date(today);
    end.setDate(end.getDate() + 30);
    const endText = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
    return value.length === 10 && value >= todayText && value <= endText;
  }
  return true;
}

export function Phase3ListPage({ navigation }: PageProps) {
  const { client, session } = useAuth();
  const [items, setItems] = useState<ManagedItem[]>([]);
  const [imageItemIds, setImageItemIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"all" | ManagementType>("all");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [hidePastDates, setHidePastDates] = useState(true);
  const [support, setSupport] = useState<"all" | SupportScope>("all");
  const [sort, setSort] = useState("date");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(() => {
    const deletionResult = sessionStorage.getItem("phase3-delete-result");
    if (!deletionResult) return null;
    sessionStorage.removeItem("phase3-delete-result");
    return { tone: "success", text: deletionResult };
  });

  useEffect(() => {
    if (!client || !session) return;
    let active = true;
    Promise.all([
      client.from("items").select("*").eq("user_id", session.user.id).order("created_at", { ascending: false }),
      client.from("image_assets").select("item_id,lifecycle_status").eq("user_id", session.user.id).eq("lifecycle_status", "active").not("item_id", "is", null),
    ]).then(([itemsResult, imagesResult]) => {
        if (!active) return;
        if (itemsResult.error)
          setNotice({
            tone: "error",
            text: "관리 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
          });
        const loaded = (itemsResult.data || []) as ManagedItem[];
        setImageItemIds(new Set((imagesResult.data || []).map((image) => image.item_id).filter(Boolean) as string[]));
        const expiredIds = loaded
          .filter(
            (item) =>
              !isPaymentScheduleType(item.management_type) &&
              item.lifecycle_status !== "expired" &&
              itemStatusValue(item) === "expired",
          )
          .map((item) => item.id);
        setItems(
          loaded.map((item) =>
            expiredIds.includes(item.id)
              ? { ...item, lifecycle_status: "expired" }
              : item,
          ),
        );
        if (expiredIds.length) {
          void client
            .from("items")
            .update({ lifecycle_status: "expired" })
            .eq("user_id", session.user.id)
            .in("id", expiredIds)
            .then(() => undefined);
        }
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, session]);

  const filtered = useMemo(
    () =>
      items
        .filter((item) => {
          const searchText =
            `${item.service_name} ${item.plan_name || ""} ${item.provider_name || ""} ${item.category || ""}`.toLowerCase();
          const currentStatus = itemStatusValue(item);
          return (
            (!query.trim() ||
              searchText.includes(query.trim().toLowerCase())) &&
            (type === "all" || item.management_type === type) &&
            (category === "all" || item.category === category) &&
            (status === "all" || currentStatus === status) &&
            isDueMatch(item, dateFilter) &&
            (!hidePastDates || !itemHasPastDate(item)) &&
            (support === "all" || item.support_scope === support)
          );
        })
        .sort((a, b) => {
          if (sort === "name")
            return a.service_name.localeCompare(b.service_name, "ko");
          if (sort === "amount") return (b.amount ?? -1) - (a.amount ?? -1);
          return targetSortValue(a).localeCompare(targetSortValue(b));
        }),
    [items, query, type, category, status, dateFilter, hidePastDates, support, sort],
  );

  if (loading) return <PageLoading label="관리 목록을 불러오는 중" />;
  return (
    <div className="app-shell items-shell">
      {navigation}
      <main className="items-page phase3-page">
        <PageHeader eyebrow="내 관리 항목" title="구독과 생활 기한" description="구독과 생활 기한을 한곳에서 관리하세요." actions={<div className="items-actions"><Link to="/items/new" className="button primary">＋ 등록</Link><Link to="/images" className="button secondary"><img className="button-icon" src={galleryIcon} alt="" />이미지 관리</Link></div>} />
        <NoticeBox notice={notice} />
        <section className="filter-card phase3-filter">
          <div className="filter-card-header">
            <Field id="item-search" label="항목 검색">
              <input id="item-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="서비스명, 사용처 또는 카테고리" />
            </Field>
            <button type="button" className="filter-reset" onClick={() => { setQuery(""); setType("all"); setCategory("all"); setStatus("all"); setDateFilter("all"); setHidePastDates(true); setSupport("all"); setSort("date"); }}>필터 초기화</button>
          </div>
          <div className="filter-grid">
            <label>
              <span>유형</span>
              <select
                value={type}
                onChange={(event) =>
                  setType(event.target.value as "all" | ManagementType)
                }
              >
                <option value="all">유형 전체</option>
                {TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>카테고리</span>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="all">카테고리 전체</option>
                {CATEGORY_OPTIONS.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
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
                <option value="ended">종료</option>
                <option value="unused">미사용</option>
                <option value="used">사용 완료</option>
                <option value="active">유효</option>
                <option value="expired">기한 만료</option>
                <option value="needs_review">확인 필요</option>
              </select>
            </label>
            <label>
              <span>날짜</span>
              <select
                value={dateFilter}
                onChange={(event) => {
                  const value = event.target.value;
                  setDateFilter(value);
                  if (value === "past") setHidePastDates(false);
                }}
              >
                <option value="all">날짜 전체</option>
                <option value="next30">30일 이내</option>
                <option value="past">지난 날짜</option>
                <option value="unknown">날짜 미확인</option>
              </select>
            </label>
            <label>
              <span>정보 지원</span>
              <select
                value={support}
                onChange={(event) =>
                  setSupport(event.target.value as "all" | SupportScope)
                }
              >
                <option value="all">지원 범위 전체</option>
                <option value="none">지원 없음</option>
                <option value="news">소식 지원</option>
                <option value="cancellation">해지 안내 지원</option>
                <option value="both">소식·해지 지원</option>
              </select>
            </label>
            <label>
              <span>정렬</span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value)}
              >
                <option value="date">날짜순</option>
                <option value="name">이름순</option>
                <option value="amount">금액순</option>
              </select>
            </label>
          </div>
        </section>
        <section className="items-card">
          <div className="items-card-heading">
            <div>
              <h2>전체 항목 · {filtered.length}건</h2>
            </div>
            <div className="items-card-tools">
              <label className="items-hide-expired"><input type="checkbox" checked={hidePastDates} onChange={(event) => setHidePastDates(event.target.checked)} /> 만료 기한 숨기기</label>
              <small className="items-image-legend"><i aria-hidden="true" /> 이미지 저장한 항목</small>
            </div>
          </div>
          {filtered.length ? (
            <div
              className="items-table"
              role="table"
              aria-label="관리 항목 목록"
            >
              <div className="items-table-head" role="row">
                <span>D-day</span>
                <span>이름 / 유형</span>
                <span>금액 / 단위</span>
                <span>기한</span>
                <span>상태</span>
                <span aria-hidden="true" />
              </div>
              {filtered.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="item-row"
                  onClick={() => navigate(`/items/${item.id}`)}
                >
                  <span className="item-row-dday-cell"><ItemDdayBadge item={item} /></span>
                  <span className="item-row-name">
                    <span className="item-row-copy">
                      <span className="item-row-title"><i className="item-row-icon" aria-hidden="true">{item.service_name.trim().slice(0, 1).toUpperCase() || "?"}</i><strong>{item.service_name || "이름 확인 필요"}</strong>{imageItemIds.has(item.id) ? <i className="item-image-dot" aria-label="이미지 저장됨" /> : null}</span>
                      <small>{typeLabel(item.management_type, true)} · {item.category || "카테고리 미정"}</small>
                    </span>
                  </span>
                  <strong>{formatAmount(item)}</strong>
                  <span>{itemDate(item)}</span>
                  <em data-status={itemStatusValue(item)}>
                    {statusLabel(item)}
                  </em>
                  <span className="item-row-arrow" aria-hidden="true">›</span>
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
                  ? "검색어나 필터를 바꿔 보세요."
                  : "첫 번째 구독이나 생활 기한을 직접 등록해 보세요."}
              </p>
              {!items.length ? (
                <Link to="/items/new" className="button primary">
                  직접 등록
                </Link>
              ) : null}
            </div>
          )}
        </section>
        <Info title="모르는 정보는 그대로 남겨요">
          0원과 금액 미확인을 구분하고, 연·월만 확인된 날짜에 임의의 일자를
          만들지 않아요.
        </Info>
      </main>
    </div>
  );
}

function DateField({
  prefix,
  label,
  value,
  precision,
  onValue,
  onPrecision,
  error,
  hint,
  imageFilled = false,
}: {
  prefix: string;
  label: string;
  value: string | null;
  precision: DatePrecision | null;
  onValue: (value: string | null) => void;
  onPrecision: (value: DatePrecision) => void;
  error?: string;
  hint: string;
  imageFilled?: boolean;
}) {
  const currentPrecision = precision || "day";
  return (
    <div className="date-field" data-image-filled={imageFilled ? "true" : undefined}>
      <div className="date-field-heading">
        <label htmlFor={`${prefix}-value`}>
          <span>{label}</span>
          {imageFilled ? <small className="image-filled-badge">이미지에서 입력됨</small> : null}
        </label>
        <select
          aria-label={`${label} 정밀도`}
          value={currentPrecision}
          onChange={(event) => {
            onPrecision(event.target.value as DatePrecision);
            onValue(null);
          }}
        >
          <option value="day">일자</option>
          <option value="month">연·월</option>
        </select>
      </div>
      <input
        id={`${prefix}-value`}
        type={dateInputType(currentPrecision)}
        value={value || ""}
        onChange={(event) => onValue(event.target.value || null)}
      />
      {error ? (
        <small className="field-error" role="alert">
          {error}
        </small>
      ) : (
        <small>{hint}</small>
      )}
    </div>
  );
}

function TypeSpecificFields({
  draft,
  update,
  errors,
  imageFilledFields = new Set<keyof ManagedItemDraft>(),
}: {
  draft: ManagedItemDraft;
  update: <K extends keyof ManagedItemDraft>(
    key: K,
    value: ManagedItemDraft[K],
  ) => void;
  errors: Record<string, string>;
  imageFilledFields?: ReadonlySet<keyof ManagedItemDraft>;
}) {
  const recurring = draft.management_type === "recurring_subscription";
  const paymentSchedule = isPaymentScheduleType(draft.management_type);
  const fixed = draft.management_type === "fixed_term_membership";
  const consumable = canMarkUsed(draft.management_type);
  const points = draft.management_type === "points";
  const warranty = draft.management_type === "warranty";
  const proposed = paymentSchedule
    ? proposeNextRecurringDate(
        draft.start_date_value,
        draft.start_date_precision,
        draft.billing_cycle,
      )
    : null;
  const imageFilled = (...keys: Array<keyof ManagedItemDraft>) =>
    keys.some((key) => imageFilledFields.has(key));
  return (
    <>
      <div className="form-grid">
        {recurring || fixed ? (
          <Field id="item-plan" label="요금제" imageFilled={imageFilled("plan_name")}>
            <input
              id="item-plan"
              value={draft.plan_name || ""}
              onChange={(event) => update("plan_name", event.target.value)}
            />
          </Field>
        ) : null}
        {consumable || points || warranty ? (
          <Field
            id="item-provider"
            imageFilled={imageFilled("provider_name")}
            label={
              warranty
                ? "보장 서비스명"
                : consumable || points
                  ? "사용처"
                  : "서비스명 보조 정보"
            }
          >
            <input
              id="item-provider"
              value={draft.provider_name || ""}
              onChange={(event) => update("provider_name", event.target.value)}
            />
          </Field>
        ) : null}
        {isMoneyType(draft.management_type) ? (
          <>
            <Field
              id="item-amount"
              label={
                draft.management_type === "coupon" ? "할인액·표시 금액" : "금액"
              }
              error={errors.amount}
              imageFilled={imageFilled("amount")}
              hint="확인한 0원과 금액 미확인을 구분해요."
            >
              <input
                id="item-amount"
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
              id="item-currency"
              label="실제 통화"
              error={errors.currency}
              imageFilled={imageFilled("currency")}
              required={draft.amount !== null}
            >
              <select
                id="item-currency"
                value={draft.currency || ""}
                onChange={(event) =>
                  update("currency", event.target.value || null)
                }
              >
                <option value="">통화 확인 필요</option>
                <option value="KRW">KRW · 원화</option>
                <option value="USD">USD · 달러</option>
                <option value="JPY">JPY · 엔화</option>
                <option value="EUR">EUR · 유로</option>
              </select>
            </Field>
          </>
        ) : points ? (
          <>
            <Field id="item-amount" label="포인트·금액" error={errors.amount} imageFilled={imageFilled("amount")}>
              <input
                id="item-amount"
                type="number"
                min="0"
                step="1"
                value={draft.amount ?? ""}
                onChange={(event) =>
                  update(
                    "amount",
                    event.target.value === ""
                      ? null
                      : Number(event.target.value),
                  )
                }
                placeholder="수량 확인 필요"
              />
            </Field>
            <Field
              id="item-unit"
              label="단위"
              error={errors.unit_name}
              imageFilled={imageFilled("unit_name")}
              required={draft.amount !== null}
            >
              <input
                id="item-unit"
                value={draft.unit_name || ""}
                onChange={(event) => update("unit_name", event.target.value)}
                placeholder="예: P, 마일"
              />
            </Field>
          </>
        ) : null}
        {paymentSchedule ? (
          <Field id="item-cycle" label="결제 주기" imageFilled={imageFilled("billing_cycle")}>
            <select
              id="item-cycle"
              value={draft.billing_cycle || ""}
              onChange={(event) =>
                update(
                  "billing_cycle",
                  (event.target.value ||
                    null) as ManagedItemDraft["billing_cycle"],
                )
              }
            >
              <option value="">주기 확인 필요</option>
              <option value="monthly">매월</option>
              <option value="yearly">매년</option>
              <option value="custom">기타 주기</option>
            </select>
          </Field>
        ) : null}
        {paymentSchedule ? (
          <Field id="item-payment" label="결제 경로" imageFilled={imageFilled("payment_method")}>
            <select
              id="item-payment"
              value={draft.payment_method || ""}
              onChange={(event) => update("payment_method", event.target.value)}
            >
              <option value="">경로 확인 필요</option>
              <option value="official_web">공식 웹</option>
              <option value="apple">Apple</option>
              <option value="google">Google</option>
              <option value="carrier">통신사</option>
              <option value="partner">제휴</option>
              <option value="tosspay">토스페이</option>
              <option value="kakaopay">카카오페이</option>
              <option value="naverpay">네이버페이</option>
              <option value="card_company">카드사</option>
              <option value="bank_transfer">계좌 이체</option>
              <option value="other">기타</option>
            </select>
          </Field>
        ) : null}
      </div>
      {paymentSchedule || fixed || warranty ? (
        <DateField
          prefix="item-start"
          label={
            draft.management_type === "other_payment_deadline"
              ? "최초 결제일"
              : paymentSchedule
                ? "최초 가입일"
                : "시작일"
          }
          value={draft.start_date_value}
          precision={draft.start_date_precision}
          onValue={(value) => update("start_date_value", value)}
          onPrecision={(value) => update("start_date_precision", value)}
          error={errors.start_date}
          imageFilled={imageFilled("start_date_value", "start_date_precision")}
          hint="확인된 일자 또는 연·월을 그대로 저장해요."
        />
      ) : null}
      <DateField
        prefix="item-target"
        label={
          paymentSchedule
            ? "확인한 다음 결제일"
            : fixed
              ? "갱신일·종료일"
              : warranty
                ? "종료일"
                : consumable
                  ? "유효기한"
                  : points
                    ? "만료일"
                    : "날짜"
        }
        value={draft.target_date_value}
        precision={draft.target_date_precision}
        onValue={(value) => update("target_date_value", value)}
        onPrecision={(value) => update("target_date_precision", value)}
        error={errors.target_date}
        imageFilled={imageFilled("target_date_value", "target_date_precision")}
        hint="날짜가 없어도 저장할 수 있고, 연·월에는 D-day를 만들지 않아요."
      />
      {paymentSchedule ? (
        <div className="proposal-panel">
          <strong>예상 날짜 · 제안값</strong>
          <p>
            {draft.target_date_value
              ? "확인한 다음 결제일이 저장돼 있어요."
              : proposed
                ? `${displayDate(proposed, "day")} · 사용자 확인 전에는 확정하지 않아요.`
                : "정확한 가입일과 지원 주기가 있어야 제안할 수 있어요."}
          </p>
          {!draft.target_date_value && proposed ? (
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                update("target_date_precision", "day");
                update("target_date_value", proposed);
              }}
            >
              제안값 확인 후 사용
            </button>
          ) : null}
        </div>
      ) : null}
      {consumable || points || warranty ? (
        <Field
          id="item-conditions"
          label={warranty ? "확인할 내용" : "이용 조건"}
          imageFilled={imageFilled("conditions")}
        >
          <textarea
            id="item-conditions"
            rows={3}
            value={draft.conditions || ""}
            onChange={(event) => update("conditions", event.target.value)}
          />
        </Field>
      ) : null}
      {consumable ? (
        <Field id="item-lifecycle" label="사용 상태" imageFilled={imageFilled("lifecycle_status")}>
          <select
            id="item-lifecycle"
            value={draft.lifecycle_status}
            onChange={(event) =>
              update("lifecycle_status", event.target.value as LifecycleStatus)
            }
          >
            <option value="unused">미사용</option>
            <option value="used">사용 완료</option>
            <option value="needs_review">확인 필요</option>
          </select>
        </Field>
      ) : !paymentSchedule && !fixed ? (
        <Field id="item-lifecycle" label="상태" imageFilled={imageFilled("lifecycle_status")}>
          <select
            id="item-lifecycle"
            value={draft.lifecycle_status}
            onChange={(event) =>
              update("lifecycle_status", event.target.value as LifecycleStatus)
            }
          >
            <option value="active">유효</option>
            <option value="ended">종료</option>
            <option value="expired">기한 만료</option>
            <option value="needs_review">확인 필요</option>
          </select>
        </Field>
      ) : null}
      {paymentSchedule || fixed ? (
        <div className="form-grid">
          <Field id="item-actual" label="실제 이용 상태" imageFilled={imageFilled("actual_status")}>
            <select
              id="item-actual"
              value={draft.actual_status}
              onChange={(event) =>
                update(
                  "actual_status",
                  event.target.value as ManagedItemDraft["actual_status"],
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
          <Field id="item-renewal" label="자동 갱신" imageFilled={imageFilled("auto_renewal_status")}>
            <select
              id="item-renewal"
              value={draft.auto_renewal_status}
              onChange={(event) =>
                update(
                  "auto_renewal_status",
                  event.target.value as ManagedItemDraft["auto_renewal_status"],
                )
              }
            >
              <option value="on">켜짐</option>
              <option value="off">꺼짐</option>
              <option value="manual">수동 갱신</option>
              <option value="needs_review">확인 필요</option>
            </select>
          </Field>
          <Field id="item-plan-status" label="사용자 계획" imageFilled={imageFilled("usage_plan")}>
            <select
              id="item-plan-status"
              value={draft.usage_plan}
              onChange={(event) =>
                update(
                  "usage_plan",
                  event.target.value as ManagedItemDraft["usage_plan"],
                )
              }
            >
              <option value="scheduled">유지 예정</option>
              <option value="ended">이용 종료 예정</option>
              <option value="needs_review">확인 필요</option>
            </select>
          </Field>
        </div>
      ) : null}
    </>
  );
}

export function ManagedItemFormFields({
  draft,
  update,
  changeType,
  errors,
  typeDisabled = false,
  typeHelp,
  imageFilledFields = new Set<keyof ManagedItemDraft>(),
  actions,
}: {
  draft: ManagedItemDraft;
  update: <K extends keyof ManagedItemDraft>(
    key: K,
    value: ManagedItemDraft[K],
  ) => void;
  changeType: (type: ManagementType) => void | Promise<void>;
  errors: Record<string, string>;
  typeDisabled?: boolean;
  typeHelp?: ReactNode;
  imageFilledFields?: ReadonlySet<keyof ManagedItemDraft>;
  actions: ReactNode;
}) {
  const imageFilled = (key: keyof ManagedItemDraft) =>
    imageFilledFields.has(key);
  return (
    <>
      <div className="form-card">
        <h2>관리 유형</h2>
        <Field id="item-type" label="유형" required>
          <select
            id="item-type"
            required
            value={draft.management_type}
            disabled={typeDisabled}
            onChange={(event) =>
              changeType(event.target.value as ManagementType)
            }
          >
            {TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        {typeHelp ? <small className="detail-muted">{typeHelp}</small> : null}
      </div>
      <div className="form-card">
        <h2>{typeLabel(draft.management_type, true)} 정보</h2>
        <Field
          id="item-name"
          label={
            draft.management_type === "warranty"
              ? "제품명"
              : draft.management_type === "other_payment_deadline"
                ? "결제 이름"
              : draft.management_type === "recurring_subscription" ||
                  draft.management_type === "fixed_term_membership" ||
                  draft.management_type === "points"
                ? "서비스명"
                : "이름"
          }
          error={errors.service_name}
          imageFilled={imageFilled("service_name")}
          required
        >
          <input
            id="item-name"
            required
            value={draft.service_name}
            maxLength={120}
            onChange={(event) => update("service_name", event.target.value)}
          />
        </Field>
        <TypeSpecificFields
          draft={draft}
          update={update}
          errors={errors}
          imageFilledFields={imageFilledFields}
        />
      </div>
      <div className="form-card">
        <h2>분류와 메모</h2>
        <div className="form-grid">
          <Field
            id="item-category"
            label="카테고리"
            imageFilled={imageFilled("category")}
          >
            <input
              id="item-category"
              list="category-options"
              value={draft.category || ""}
              onChange={(event) => update("category", event.target.value)}
              placeholder="직접 입력 또는 선택"
            />
            <datalist id="category-options">
              {CATEGORY_OPTIONS.map((value) => (
                <option value={value} key={value} />
              ))}
            </datalist>
          </Field>
          <Field id="item-reminder" label="알림">
            <select
              id="item-reminder"
              value={draft.reminder_days_before.join(",") || "none"}
              disabled={!draft.target_date_value}
              onChange={(event) =>
                update(
                  "reminder_days_before",
                  event.target.value === "none"
                    ? []
                    : event.target.value.split(",").map(Number),
                )
              }
            >
              <option value="none">알림 없음</option>
              <option value="0">당일</option>
              <option value="1,0">1일 전·당일</option>
              <option value="3,0">3일 전·당일</option>
              <option value="7,3,0">7일 전·3일 전·당일</option>
            </select>
          </Field>
          <Field id="item-reminder-time" label="알림 시각">
            <input
              id="item-reminder-time"
              type="time"
              value={draft.reminder_time || "09:00"}
              disabled={!draft.target_date_value || draft.reminder_days_before.length === 0}
              onChange={(event) => update("reminder_time", event.target.value)}
            />
          </Field>
        </div>
        <Field
          id="item-memo"
          label="메모"
          imageFilled={imageFilled("memo")}
        >
          <textarea
            id="item-memo"
            rows={3}
            maxLength={1000}
            value={draft.memo || ""}
            onChange={(event) => update("memo", event.target.value)}
          />
        </Field>
        {actions}
      </div>
    </>
  );
}

export function Phase3FormPage({
  navigation,
  itemId,
}: PageProps & { itemId?: string }) {
  const { client, session } = useAuth();
  const editing = Boolean(itemId);
  const initialType =
    (new URLSearchParams(window.location.search).get(
      "type",
    ) as ManagementType | null) || "recurring_subscription";
  const [draft, setDraft] = useState<ManagedItemDraft>(() =>
    createEmptyDraft(initialType),
  );
  const [loading, setLoading] = useState(editing);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [imageMode, setImageMode] = useState(
    () =>
      window.location.pathname === "/images/new" ||
      new URLSearchParams(window.location.search).get("image") === "1",
  );
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState("");
  const [keepOriginal, setKeepOriginal] = useState(true);
  const [imageConsent, setImageConsent] = useState(false);
  const [assetId, setAssetId] = useState("");
  const [savedItemId, setSavedItemId] = useState("");
  const [extraction, setExtraction] = useState<ImageExtraction | null>(null);
  const [imageFilledFields, setImageFilledFields] = useState<
    Set<keyof ManagedItemDraft>
  >(new Set());
  const [dirtyFields, setDirtyFields] = useState<Set<keyof ManagedItemDraft>>(
    new Set(),
  );
  const [attachedImages, setAttachedImages] = useState<ItemImage[]>([]);

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
            text: "이 항목을 불러오지 못했어요. 목록에서 다시 선택해 주세요.",
          });
        else {
          const item = data as ManagedItem;
          setDraft({
            ...createEmptyDraft(item.management_type),
            ...item,
            start_date_value: item.start_date_value || item.first_billing_date,
            start_date_precision:
              item.start_date_precision ||
              (item.first_billing_date ? "day" : "day"),
            target_date_value: item.target_date_value || item.next_billing_date,
            target_date_precision:
              item.target_date_precision ||
              (item.next_billing_date ? "day" : "day"),
          });
        }
        setLoading(false);
      });
  }, [client, editing, itemId, session]);

  useEffect(() => {
    if (!editing || !itemId || !client || !session) return;
    let active = true;
    client
      .from("image_assets")
      .select("id,storage_path,mime_type,created_at")
      .eq("item_id", itemId)
      .eq("user_id", session.user.id)
      .eq("lifecycle_status", "active")
      .eq("original_status", "kept")
      .order("created_at", { ascending: false })
      .then(async ({ data }) => {
        const resolved = await Promise.all(
          (data || []).map(async (image) => {
            const preview = await client.storage
              .from("user-images")
              .createSignedUrl(image.storage_path, 300);
            return {
              ...image,
              signed_url: preview.error ? null : preview.data.signedUrl,
            } as ItemImage;
          }),
        );
        if (!active) return;
        setAttachedImages(resolved);
        if (resolved.length) setImageMode(true);
      });
    return () => {
      active = false;
    };
  }, [client, editing, itemId, session]);

  function update<K extends keyof ManagedItemDraft>(
    key: K,
    value: ManagedItemDraft[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
    if (imageMode) {
      setDirtyFields((current) => new Set(current).add(key));
      setImageFilledFields((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }
  async function changeType(type: ManagementType) {
    if (busy) return;
    if (imageMode && extraction) {
      if (client && session && assetId) {
        setBusy(true);
        const changed = await client
          .from("image_assets")
          .update({
            management_type: type,
            extraction_json: { ...extraction, management_type: type },
          })
          .eq("id", assetId)
          .eq("user_id", session.user.id);
        setBusy(false);
        if (changed.error) {
          setNotice({ tone: "error", text: "이미지의 관리 유형을 바꾸지 못했어요." });
          return;
        }
      }
      const retargeted = retargetImageDraft(draft, type);
      setDraft(retargeted.draft);
      setImageFilledFields(
        new Set([...imageFilledFields].filter((key) => retargeted.retainedFields.has(key))),
      );
      setDirtyFields(
        new Set([...dirtyFields].filter((key) => retargeted.retainedFields.has(key))),
      );
      setExtraction({ ...extraction, management_type: type });
    } else {
      setDraft((current) => ({
        ...createEmptyDraft(type),
        service_name: current.service_name,
        category: current.category,
        memo: current.memo,
      }));
    }
    setErrors({});
  }

  function chooseImage(next: File | null) {
    setNotice(null);
    setImageFile(next);
    setAssetId("");
    setExtraction(null);
    setImageFilledFields(new Set());
    if (!next) {
      setImagePreview("");
      return;
    }
    if (
      !/^(image\/jpeg|image\/png|image\/webp)$/.test(next.type) ||
      next.size > 10 * 1024 * 1024
    ) {
      setImageFile(null);
      setImagePreview("");
      setNotice({
        tone: "error",
        text: "JPEG, PNG, WebP 형식의 10MB 이하 파일만 등록할 수 있어요.",
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImagePreview(String(reader.result));
    reader.readAsDataURL(next);
  }

  async function ensureImageAsset() {
    if (assetId) return assetId;
    if (!client || !session || !imageFile) throw new Error("이미지를 선택해 주세요.");
    const path = `${session.user.id}/${crypto.randomUUID()}-${imageFile.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const uploaded = await client.storage
      .from("user-images")
      .upload(path, imageFile, { contentType: imageFile.type, upsert: false });
    if (uploaded.error) throw uploaded.error;
    const inserted = await client
      .from("image_assets")
      .insert({
        user_id: session.user.id,
        management_type: draft.management_type,
        storage_path: path,
        mime_type: imageFile.type,
        size_bytes: imageFile.size,
        original_keep: keepOriginal,
      })
      .select("id")
      .single();
    if (inserted.error || !inserted.data) throw inserted.error;
    setAssetId(inserted.data.id);
    return inserted.data.id as string;
  }

  async function analyzeSelectedImage() {
    if (!session || !imageFile || !imageConsent) return;
    if (
      extraction &&
      dirtyFields.size > 0 &&
      !window.confirm("다시 분석하면 직접 작성하거나 수정한 값을 덮어쓸 수 있어요. 계속할까요?")
    )
      return;
    setBusy(true);
    setNotice({ tone: "info", text: "이미지에서 확인 가능한 정보를 분석하고 있어요." });
    try {
      const id = await ensureImageAsset();
      const analyzed = await analyzeImage(session.access_token, id);
      const nextExtraction = analyzed.extraction as ImageExtraction;
      const mapped = applyImageExtraction(draft, nextExtraction);
      setDraft(mapped.draft);
      setImageFilledFields(mapped.filledFields);
      setDirtyFields(new Set());
      setExtraction(nextExtraction);
      setNotice({
        tone: "success",
        text: mapped.filledFields.size
          ? `${mapped.filledFields.size}개 입력란을 이미지에서 채웠어요.`
          : "확인 가능한 값을 찾지 못했어요. 폼에 직접 입력해 주세요.",
      });
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "이미지 분석에 실패했어요.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const nextErrors = validateManagedItemDraft(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setNotice({ tone: "error", text: "입력 항목을 확인해 주세요." });
      return;
    }
    if (!client || !session) return;
    setBusy(true);
    setNotice({ tone: "info", text: "항목을 저장하고 있어요." });
    try {
      let nextAssetId = assetId;
      if (imageMode && imageFile && !nextAssetId) nextAssetId = await ensureImageAsset();
      const payload = buildManagedItemPayload(draft, session.user.id);
      const targetItemId = editing ? itemId : savedItemId;
      const result = targetItemId
        ? await client
            .from("items")
            .update(payload)
            .eq("id", targetItemId)
            .eq("user_id", session.user.id)
            .select()
            .single()
        : await client.from("items").insert(payload).select().single();
      if (result.error || !result.data) throw result.error;
      const persistedId = (result.data as ManagedItem).id;
      setSavedItemId(persistedId);
      if (imageMode && nextAssetId)
        await confirmImage(session.access_token, nextAssetId, persistedId, keepOriginal);
      navigate(`/items/${persistedId}`, true);
    } catch (error) {
      setNotice({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "저장하지 못했어요. 입력값과 연결 상태를 확인해 주세요.",
      });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <PageLoading label="관리 항목을 불러오는 중" />;
  const title = `${typeLabel(draft.management_type, true)} ${editing ? "수정" : "등록"}`;
  return (
    <div className="app-shell items-shell">
      {navigation}
      <main className="subscription-page phase3-page">
        <PageHeader className="form-page-heading" eyebrow={editing ? "항목 수정" : "새 항목"} title={title} description="확인한 정보부터 입력하세요. 모르는 금액과 날짜는 비워 둘 수 있어요." />
        <NoticeBox notice={notice} />
        <form onSubmit={save} className="subscription-layout">
          <section className="subscription-main">
            <ManagedItemFormFields
              draft={draft}
              update={update}
              changeType={changeType}
              errors={errors}
              typeDisabled={editing}
              typeHelp={
                editing
                  ? "저장된 항목의 유형은 수정 중 바꾸지 않아요. 다른 유형은 새 항목으로 등록해 주세요."
                  : undefined
              }
              imageFilledFields={imageFilledFields}
              actions={
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
                      `${typeLabel(draft.management_type, true)} 저장`
                    )}
                  </button>
                  <Link
                    to={editing && itemId ? `/items/${itemId}` : "/items"}
                    className="button secondary"
                  >
                    취소
                  </Link>
                </div>
              }
            />
          </section>
          <aside className="subscription-side">
            <section className="help-card integrated-image-card">
              <div className="integrated-image-toggle-row">
                <div>
                  <h2>이미지 함께 등록</h2>
                  <p>
                    {editing
                      ? "새 원본 이미지를 이 관리 항목에 보관할 수 있어요."
                      : `이미지를 분석한 뒤 ${typeLabel(draft.management_type, true)} 직접 등록 폼에서 확인하고 저장하세요.`}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={imageMode}
                  className={`image-mode-switch${imageMode ? " active" : ""}`}
                  onClick={() => setImageMode((value) => !value)}
                  disabled={busy}
                >
                  <span />
                </button>
              </div>
              {imageMode ? (
                <div className="integrated-image-panel">
                  {editing && attachedImages.length ? (
                    <div className="attached-image-section">
                      <strong>현재 보관 중인 이미지</strong>
                      <div className="detail-image-grid">
                        {attachedImages.map((image) =>
                          image.signed_url ? (
                            <a
                              key={image.id}
                              href={image.signed_url}
                              target="_blank"
                              rel="noreferrer"
                              className="detail-image-preview"
                            >
                              <img src={image.signed_url} alt="현재 보관 중인 원본" />
                            </a>
                          ) : (
                            <div key={image.id} className="detail-image-preview unavailable">
                              미리보기를 불러올 수 없어요.
                            </div>
                          ),
                        )}
                      </div>
                    </div>
                  ) : null}
                  <label className="upload-box compact-upload-box">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(event) => chooseImage(event.target.files?.[0] || null)}
                    />
                    {imagePreview ? (
                      <img src={imagePreview} alt="선택한 원본 미리보기" />
                    ) : (
                      <span>JPEG, PNG, WebP 이미지 선택<br />최대 10MB</span>
                    )}
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={keepOriginal}
                      onChange={(event) => setKeepOriginal(event.target.checked)}
                    />
                    {editing ? "새 원본 이미지를 보관할게요" : "원본 이미지를 보관할게요"}
                  </label>
                  {!editing ? (
                    <>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={imageConsent}
                          onChange={(event) => setImageConsent(event.target.checked)}
                        />
                        분석을 위해 이미지가 AI 처리 서버로 전송되는 것에 동의해요
                      </label>
                      <button
                        className="button primary"
                        type="button"
                        disabled={!canStartImageAnalysis(Boolean(imageFile), imageConsent, busy)}
                        onClick={analyzeSelectedImage}
                      >
                        {busy ? "처리 중…" : extraction ? "AI 다시 분석" : "AI 분석 시작"}
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </section>
            <Info title="확인 필요로 저장할 수 있어요">
              정확한 금액·날짜가 없으면 집계와 일정에서 제외되지만 등록을 막지
              않아요.
            </Info>
            <section className="help-card">
              <h2>날짜 정밀도</h2>
              <p>
                연·월만 아는 날짜는 월 단위로 저장하고 특정 일자로 바꾸지
                않아요.
              </p>
              <p>
                반복 구독의 계산 날짜는 제안일 뿐이며, 사용자가 선택해야 확인한
                날짜로 저장돼요.
              </p>
            </section>
          </aside>
        </form>
      </main>
    </div>
  );
}

export function Phase3DetailPage({
  navigation,
  itemId,
}: PageProps & { itemId: string }) {
  const { client, session } = useAuth();
  const [item, setItem] = useState<ManagedItem | null>(null);
  const [images, setImages] = useState<ItemImage[]>([]);
  const [imagesLoading, setImagesLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [relationships, setRelationships] = useState<Array<{
    id: string;
    parent_item_id: string;
    child_item_id: string;
    relationship_type: "included_benefit" | "additional_charge" | "unknown_cost";
    cost_item_id: string | null;
    parent: { service_name: string } | null;
    child: { service_name: string } | null;
  }>>([]);

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
          setNotice({
            tone: "error",
            text: "항목을 불러오지 못했어요. 다른 사용자의 항목에는 접근할 수 없어요.",
          });
        else setItem(data as ManagedItem);
        setLoading(false);
      });
  }, [client, itemId, session]);

  useEffect(() => {
    if (!client || !session) return;
    client
      .from("subscription_relationships")
      .select("id,parent_item_id,child_item_id,relationship_type,cost_item_id,parent:items!subscription_relationships_parent_item_id_fkey(service_name),child:items!subscription_relationships_child_item_id_fkey(service_name)")
      .eq("user_id", session.user.id)
      .or(`parent_item_id.eq.${itemId},child_item_id.eq.${itemId}`)
      .then(({ data }) => setRelationships((data || []) as unknown as typeof relationships));
  }, [client, itemId, session]);

  useEffect(() => {
    if (!client || !session) return;
    let active = true;
    setImagesLoading(true);
    client
      .from("image_assets")
      .select("id,storage_path,mime_type,created_at")
      .eq("item_id", itemId)
      .eq("user_id", session.user.id)
      .eq("lifecycle_status", "active")
      .eq("original_status", "kept")
      .order("created_at", { ascending: false })
      .then(async ({ data, error }) => {
        if (!active) return;
        if (error) {
          setImages([]);
          setImagesLoading(false);
          return;
        }
        const resolved = await Promise.all(
          (data || []).map(async (image) => {
            try {
              const preview = await client.storage
                .from("user-images")
                .createSignedUrl(image.storage_path, 300);
              if (preview.error) throw preview.error;
              return { ...image, signed_url: preview.data.signedUrl } as ItemImage;
            } catch {
              return { ...image, signed_url: null } as ItemImage;
            }
          }),
        );
        if (!active) return;
        setImages(resolved);
        setImagesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, itemId, session]);

  async function markUsed() {
    if (!client || !session || !item || completing) return;
    setCompleting(true);
    const result = await client
      .from("items")
      .update({
        lifecycle_status: "used",
        completed_at: new Date().toISOString(),
      })
      .eq("id", item.id)
      .eq("user_id", session.user.id)
      .select()
      .single();
    if (result.error || !result.data) {
      setCompleting(false);
      setNotice({
        tone: "error",
        text: "사용 완료 상태를 저장하지 못했어요. 기존 상태는 유지됐어요.",
      });
    } else {
      const linked = await client
        .from("image_assets")
        .select("id")
        .eq("item_id", item.id)
        .eq("user_id", session.user.id)
        .eq("lifecycle_status", "active")
        .eq("original_status", "kept");
      const moved = linked.error
        ? []
        : await Promise.allSettled(
            (linked.data || []).map((image) =>
              changeImageLifecycle(session.access_token, image.id, "trash"),
            ),
          );
      const imageMoveFailed =
        Boolean(linked.error) || moved.some((entry) => entry.status === "rejected");
      const movedIds = new Set(
        moved.flatMap((entry, index) =>
          entry.status === "fulfilled" && linked.data?.[index]?.id
            ? [linked.data[index].id]
            : [],
        ),
      );
      setCompleting(false);
      setItem(result.data as ManagedItem);
      setImages((current) => current.filter((image) => !movedIds.has(image.id)));
      setNotice({
        tone: imageMoveFailed ? "info" : "success",
        text: imageMoveFailed
          ? "사용 완료로 저장했지만 일부 이미지는 휴지통으로 옮기지 못했어요. 이미지 관리에서 다시 시도해 주세요."
          : moved.length
            ? "사용 완료로 저장하고 연결된 이미지를 휴지통으로 옮겼어요."
            : "사용 완료로 저장했어요.",
      });
    }
  }

  async function remove() {
    if (!client || !session || !item || deleting) return;
    if (relationships.length) {
      setNotice({
        tone: "error",
        text: "결합 관계가 남아 있어 삭제하지 않았어요. 리포트에서 연결을 먼저 해제해 주세요.",
      });
      setDeleteConfirm(false);
      return;
    }
    setDeleting(true);
    setNotice({ tone: "info", text: "내부 항목 삭제를 처리하고 있어요." });
    const linkedImages = await client
      .from("image_assets")
      .select("id,lifecycle_status")
      .eq("item_id", item.id)
      .eq("user_id", session.user.id)
      .neq("original_status", "deleted");
    if (linkedImages.error) {
      setDeleting(false);
      setNotice({
        tone: "error",
        text: "연결 이미지를 확인하지 못해 항목을 삭제하지 않았어요. 다시 시도해 주세요.",
      });
      return;
    }
    const imagesToTrash = (linkedImages.data || []).filter(
      (image) => image.lifecycle_status !== "trash",
    );
    const googleStatus = await getGoogleCalendarStatus(session.access_token).catch(() => null);
    const googleCleanupExpected = googleStatus?.status === "connected" || googleStatus?.status === "sync_delayed";
    const job = await client
      .from("item_deletion_jobs")
      .insert({
        user_id: session.user.id,
        item_id: item.id,
        item_name: item.service_name,
        management_type: item.management_type,
        internal_status: "pending",
        image_cleanup_status: imagesToTrash.length ? "pending" : "not_applicable",
        calendar_cleanup_status: googleCleanupExpected ? "pending" : "not_applicable",
        relationship_cleanup_status: relationships.length ? "pending" : "not_applicable",
      })
      .select()
      .single();
    if (job.error || !job.data) {
      setDeleting(false);
      setNotice({
        tone: "error",
        text: "삭제 처리 기록을 만들지 못해 항목을 삭제하지 않았어요. 다시 시도해 주세요.",
      });
      return;
    }
    const result = await client
      .from("items")
      .delete()
      .eq("id", item.id)
      .eq("user_id", session.user.id)
      .select("id")
      .single();
    if (result.error || !result.data) {
      await client
        .from("item_deletion_jobs")
        .update({
          internal_status: "failed",
          retry_count: 1,
          last_error: "internal_delete_failed",
        })
        .eq("id", job.data.id)
        .eq("user_id", session.user.id);
      setDeleting(false);
      setNotice({
        tone: "error",
        text: "내부 삭제에 실패했어요. 항목은 그대로 유지되며 삭제 완료로 표시하지 않았어요.",
      });
      return;
    }
    const imageMoves = await Promise.allSettled(
      imagesToTrash.map((image) =>
        changeImageLifecycle(session.access_token, image.id, "trash"),
      ),
    );
    const imageCleanupFailed = imageMoves.some(
      (entry) => entry.status === "rejected",
    );
    const googleCleanupFailed = googleCleanupExpected
      ? await syncGoogleCalendar(session.access_token).then((sync) => sync.failed > 0).catch(() => true)
      : false;
    const finalized = await client
      .from("item_deletion_jobs")
      .update({
        internal_status: "deleted",
        item_id: null,
        image_cleanup_status: imagesToTrash.length
          ? imageCleanupFailed
            ? "failed"
            : "completed"
          : "not_applicable",
        calendar_cleanup_status: googleCleanupExpected
          ? googleCleanupFailed ? "failed" : "completed"
          : "not_applicable",
        last_error: imageCleanupFailed
          ? "image_trash_failed"
          : googleCleanupFailed ? "google_calendar_cleanup_failed" : null,
      })
      .eq("id", job.data.id)
      .eq("user_id", session.user.id);
    sessionStorage.setItem(
      "phase3-delete-result",
      finalized.error
        ? "항목 삭제 완료 · 삭제 상태 기록 갱신 실패"
        : imageCleanupFailed || googleCleanupFailed
          ? imageCleanupFailed && googleCleanupFailed
            ? "항목 삭제 완료 · 이미지 및 Google 일정 정리 실패"
            : googleCleanupFailed
              ? "항목 삭제 완료 · Google 일정 정리 실패"
              : "항목 삭제 완료 · 일부 이미지는 휴지통 이동 실패"
          : imagesToTrash.length
            ? "항목 삭제 완료 · 연결 이미지를 휴지통으로 이동"
            : "항목 삭제 완료 · 연결된 이미지 없음",
    );
    navigate("/items", true);
  }

  if (loading) return <PageLoading label="관리 항목을 불러오는 중" />;
  if (!item)
    return (
      <div className="app-shell items-shell">
        {navigation}
        <main className="detail-page phase3-page">
          <NoticeBox notice={notice} />
          <Link to="/items" className="button secondary">
            목록으로
          </Link>
        </main>
      </div>
    );
  const recurring =
    isPaymentScheduleType(item.management_type) ||
    item.management_type === "fixed_term_membership";
  const target = item.target_date_value || item.next_billing_date;
  const targetPrecision =
    item.target_date_precision || (item.next_billing_date ? "day" : null);
  return (
    <div className="app-shell items-shell">
      {navigation}
      <main className="detail-page phase3-page">
        <PageHeader className="detail-page-heading" eyebrow={`${recurring ? "구독" : "생활 기한"} · ${typeLabel(item.management_type, true)}`} title={item.service_name || "이름 확인 필요"} description={item.plan_name || item.provider_name || "등록한 핵심 정보와 연결 상태를 확인하세요."} actions={<div className="items-actions">{canMarkUsed(item.management_type) && item.lifecycle_status !== "used" ? <button type="button" className="button primary" onClick={markUsed} disabled={completing}>{completing ? "저장 중" : "사용 완료"}</button> : null}<Link to={`/items/${item.id}/edit`} className="button secondary">수정</Link><button type="button" className="button secondary danger-text" onClick={() => setDeleteConfirm((value) => !value)} disabled={deleting}>삭제</button></div>} />
        <NoticeBox notice={notice} />
        {deleteConfirm ? (
          <section
            className="delete-confirm phase3-delete"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-title"
          >
            <h2 id="delete-title">이 항목을 삭제할까요?</h2>
            <ul>
              <li>현재 항목은 내부 목록과 상세에서 삭제됩니다.</li>
              <li>
                미래 내부 일정과 미발송 알림은 항목과 함께 정리됩니다.
              </li>
              <li>
                연결 이미지는 휴지통으로 이동합니다. Google 일정은 아직 연결되지
                않았어요.
              </li>
              <li>
                결합 관계가 있는 항목은 삭제되지 않아요. 리포트에서 관계를 먼저
                해제해야 합니다.
              </li>
            </ul>
            <p>현재 항목 삭제는 되돌릴 수 없어요.</p>
            <div>
              <button
                type="button"
                className="button danger-button"
                onClick={remove}
                disabled={deleting}
              >
                {deleting ? "삭제 중" : "내부 항목 삭제"}
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => setDeleteConfirm(false)}
                disabled={deleting}
              >
                취소
              </button>
            </div>
          </section>
        ) : null}
        <div className="detail-layout">
          <section className="detail-main">
            <section className="detail-card">
              <h2>{target ? "확인한 기한" : "기한 확인 필요"}</h2>
              <span className="status-badge">{statusLabel(item)}</span>
              <strong className="detail-amount">
                {target
                  ? displayDate(target, targetPrecision)
                  : "날짜 확인 필요"}
              </strong>
              <dl>
                <div>
                  <dt>
                    {item.management_type === "points"
                      ? "포인트·단위"
                      : "금액·실제 통화"}
                  </dt>
                  <dd>{formatAmount(item)}</dd>
                </div>
                {item.provider_name ? (
                  <div>
                    <dt>
                      {item.management_type === "warranty"
                        ? "보장 서비스"
                        : "사용처"}
                    </dt>
                    <dd>{item.provider_name}</dd>
                  </div>
                ) : null}
                {item.plan_name ? (
                  <div>
                    <dt>요금제</dt>
                    <dd>{item.plan_name}</dd>
                  </div>
                ) : null}
                {item.start_date_value ? (
                  <div>
                    <dt>시작·가입일</dt>
                    <dd>
                      {displayDate(
                        item.start_date_value,
                        item.start_date_precision,
                      )}
                    </dd>
                  </div>
                ) : null}
                {item.conditions ? (
                  <div>
                    <dt>
                      {item.management_type === "warranty"
                        ? "확인할 내용"
                        : "이용 조건"}
                    </dt>
                    <dd>{item.conditions}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>카테고리</dt>
                  <dd>{item.category || "카테고리 미정"}</dd>
                </div>
              </dl>
              {targetPrecision === "month" ? (
                <Info title="월 단위 날짜예요">
                  특정 일자를 추정하지 않아 D-day와 일 단위 알림에서 제외돼요.
                </Info>
              ) : !target ? (
                <Info title="날짜가 없어도 저장돼요">
                  D-day·알림·캘린더에는 날짜를 확인할 수 없는 이유가 표시돼요.
                </Info>
              ) : null}
            </section>
            {recurring ? (
              <section className="detail-card">
                <h2>독립적으로 관리하는 상태</h2>
                <dl>
                  <div>
                    <dt>실제 이용 상태</dt>
                    <dd>{statusLabel(item)}</dd>
                  </div>
                  <div>
                    <dt>자동 갱신</dt>
                    <dd>
                      {
                        (
                          {
                            on: "켜짐",
                            off: "꺼짐",
                            manual: "수동 갱신",
                            needs_review: "확인 필요",
                          } as const
                        )[item.auto_renewal_status]
                      }
                    </dd>
                  </div>
                  <div>
                    <dt>사용자 계획</dt>
                    <dd>
                      {
                        (
                          {
                            scheduled: "유지 예정",
                            ended: "이용 종료 예정",
                            needs_review: "확인 필요",
                          } as const
                        )[item.usage_plan]
                      }
                    </dd>
                  </div>
                </dl>
              </section>
            ) : null}
            <section className="detail-card">
              <h2>결합 구독</h2>
              {relationships.length ? (
                <dl>
                  {relationships.map((relationship) => {
                    const isParent = relationship.parent_item_id === item.id;
                    const relatedName = isParent
                      ? relationship.child?.service_name
                      : relationship.parent?.service_name;
                    const label = relationship.relationship_type === "included_benefit"
                      ? "포함된 혜택"
                      : relationship.relationship_type === "additional_charge"
                        ? "추가 요금"
                        : "금액 미확인 연결";
                    return (
                      <div key={relationship.id}>
                        <dt>{isParent ? "이용 서비스" : "상위 구독"}</dt>
                        <dd>{relatedName || "연결 항목"} · {label}</dd>
                      </div>
                    );
                  })}
                </dl>
              ) : <p>연결된 구독 관계가 없어요.</p>}
              <Link to="/reports" className="button secondary detail-image-manage">
                결합 관계 관리
              </Link>
            </section>
            <section className="detail-card">
              <h2>메모</h2>
              <p>{item.memo || "저장된 메모가 없어요."}</p>
            </section>
          </section>
          <aside className="detail-side">
            <section className="detail-card">
              <h2>알림</h2>
              <p>
                {target
                  ? (item.reminder_days_before || []).length
                    ? `${item.reminder_days_before.join("일 전 · ")}일 · ${item.reminder_time.slice(0, 5)}`
                    : "알림 없음"
                  : "날짜 미확인 · 알림 없음"}
              </p>
            </section>
            <section className="detail-card">
              <h2>보관 이미지</h2>
              {imagesLoading ? (
                <p className="detail-muted">이미지를 불러오는 중…</p>
              ) : images.length ? (
                <div className="detail-image-grid">
                  {images.map((image) =>
                    image.signed_url ? (
                      <a
                        key={image.id}
                        href={image.signed_url}
                        target="_blank"
                        rel="noreferrer"
                        className="detail-image-preview"
                      >
                        <img src={image.signed_url} alt="보관된 원본 이미지" />
                      </a>
                    ) : (
                      <div key={image.id} className="detail-image-preview unavailable">
                        미리보기를 불러올 수 없어요.
                      </div>
                    ),
                  )}
                </div>
              ) : (
                <div className="empty-state compact">
                  <strong>보관된 이미지가 없어요</strong>
                  <p>직접 등록했거나 원본 보관을 선택하지 않은 항목이에요.</p>
                </div>
              )}
              <Link to="/images" className="button secondary detail-image-manage">
                이미지 관리·휴지통
              </Link>
            </section>
            <ItemSupportContent itemId={item.id} />
          </aside>
        </div>
      </main>
    </div>
  );
}

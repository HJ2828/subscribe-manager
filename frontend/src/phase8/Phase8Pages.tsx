import { type FormEvent, type ReactNode, useEffect, useState } from "react";

import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/ui";
import {
  createCancellationGuide,
  addNewsScrap,
  createAnnouncement,
  createCatalog,
  createServiceNews,
  getItemContent,
  getCollectionStatus,
  getRelevantNews,
  getOttNews,
  getNewsScraps,
  getReviewData,
  reviewContent,
  reviewAnnouncement,
  removeNewsScrap,
  type ItemContent,
  type CollectionStatus,
  type ServiceNews,
  type SupportStatus,
} from "../lib/api";
import "./phase8.css";

function go(path: string) {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function date(value: string | null | undefined) {
  return value ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(new Date(`${value.slice(0, 10)}T00:00:00`)) : "확인되지 않음";
}

const supportLabels: Record<SupportStatus, string> = {
  management_only: "직접 관리만 가능", collecting: "자료 수집 중", needs_information: "정보 확인 필요",
  verifying: "검증 중", supported: "지원", unsupported: "지원하지 않음",
};

function countryName(code: string | null) {
  if (!code) return "글로벌";
  try { return new Intl.DisplayNames(["ko"], { type: "region" }).of(code) || code; } catch { return code; }
}

function languageName(code: string | null) {
  return code === "ko" ? "한국어" : code === "en" ? "영어" : code || "언어 미확인";
}

const newsTypeLabels: Record<string, string> = { content: "콘텐츠", feature: "주요 기능", limit: "이용 한도", price: "가격·요금제", benefit: "혜택", ending: "제공 종료", other: "기타" };

function NewsRow({ news, onScrap }: { news: ServiceNews; onScrap: (news: ServiceNews) => void }) {
  return (
    <article className="news-row" id={`news-${news.id}`}>
      <div className="news-row-main"><div className="news-row-meta"><span>{newsTypeLabels[news.news_type] || news.news_type}</span><time>{date(news.announced_on)}</time></div><h3>{news.title}</h3><p>{news.summary}</p></div>
      <button className={`scrap-button${news.is_scrapped ? " active" : ""}`} onClick={() => onScrap(news)} aria-label={news.is_scrapped ? `${news.title} 스크랩 해제` : `${news.title} 스크랩` } aria-pressed={Boolean(news.is_scrapped)}>{news.is_scrapped ? "★ 스크랩됨" : "☆ 스크랩"}</button>
      <details className="news-details"><summary>상세 보기</summary><div className="news-details-body"><p><b>내 구독 관련성</b>{news.relevance_summary || news.impact_summary || "등록한 서비스와 관련된 공식 소식이에요."}</p><dl className="source-meta"><div><dt>적용일</dt><dd>{date(news.applies_on)}</dd></div><div><dt>마지막 확인일</dt><dd>{date(news.last_verified_at || news.checked_at)}</dd></div></dl><a href={news.source_url} target="_blank" rel="noreferrer">공식 출처 · {news.source_title}<small>{countryName(news.source_country_code)} · {languageName(news.source_language)}</small></a>{news.applicability_status === "needs_confirmation" ? <span className="review-warning">국가·요금제 적용 조건 확인 필요</span> : null}</div></details>
    </article>
  );
}

export function NewsPage({ navigation }: { navigation: ReactNode }) {
  const { session } = useAuth();
  const [news, setNews] = useState<ServiceNews[]>([]);
  const [ottNews, setOttNews] = useState<ServiceNews[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [collection, setCollection] = useState<CollectionStatus | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!session) return;
    Promise.all([getRelevantNews(session.access_token), getOttNews(session.access_token), getCollectionStatus(session.access_token)]).then(([rows, ottRows, status]) => { setNews(rows); setOttNews(ottRows); setCollection(status); setState("ready"); }).catch(() => setState("error"));
  }, [session]);
  async function toggleScrap(entry: ServiceNews) { if (!session) return; try { if (entry.is_scrapped) await removeNewsScrap(session.access_token, entry.id); else await addNewsScrap(session.access_token, entry.id); const update = (rows: ServiceNews[]) => rows.map((row) => row.id === entry.id ? { ...row, is_scrapped: !entry.is_scrapped } : row); setNews(update); setOttNews(update); } catch { setState("error"); } }
  const grouped = news.reduce<Record<string, ServiceNews[]>>((result, entry) => { const key = entry.service_name || "서비스"; (result[key] ||= []).push(entry); return result; }, {});
  const ottByService = new Map<string, ServiceNews>();
  ottNews.forEach((entry) => {
    const key = entry.service_name || entry.catalog_id;
    if (!ottByService.has(key)) ottByService.set(key, entry);
  });
  const ottRepresentatives = [...ottByService.values()];
  return <div className="app-shell">{navigation}<main className="phase8-page">
    <PageHeader eyebrow="소식" title="최신 소식" description="내 구독과 관련된 중요한 소식을 확인하세요." actions={<button className="button secondary" onClick={() => go("/scraps")}>스크랩</button>} />
    {state === "ready" ? <section className="ott-editorial-section"><header><div><span>공통 OTT 편성</span><h2>OTT 공개 예정작</h2><p>구독 여부와 관계없이 국내 공식 발표를 우선해 서비스별 대표 편성 소식을 보여드려요.</p></div></header>{ottRepresentatives.length ? <div className="ott-editorial-grid">{ottRepresentatives.map((entry) => <article className="phase8-card ott-editorial-card" key={entry.id}><div className="ott-card-heading"><span>{entry.service_name}</span><time>{date(entry.announced_on)}</time></div><h3>{entry.title}</h3><p>{entry.summary}</p><div className="ott-card-actions"><button className={`scrap-button${entry.is_scrapped ? " active" : ""}`} onClick={() => toggleScrap(entry)} aria-label={entry.is_scrapped ? `${entry.title} 스크랩 해제` : `${entry.title} 스크랩`}>{entry.is_scrapped ? "★ 스크랩됨" : "☆ 스크랩"}</button><a href={entry.source_url} target="_blank" rel="noreferrer">공식 출처</a></div></article>)}</div> : <div className="ott-editorial-empty">공식 공개 예정작 소식을 수집 중이에요. 일부 확인 결과를 전체 편성표처럼 표시하지 않습니다.</div>}</section> : null}
    <div className="news-section-heading"><h2>내 구독의 최신 소식</h2><p>국가·요금제와 연결되는 가격, 혜택, 기능과 콘텐츠 변경이에요.</p></div>
    {state === "loading" ? <div className="phase8-empty">소식을 불러오는 중…</div> : state === "error" ? <div className="notice error">소식을 불러오지 못했어요. 기존 관리 기능은 그대로 사용할 수 있어요.</div> : news.length ? <div className="service-news-list">{Object.entries(grouped).map(([service, entries]) => { const visible = expanded[service] ? entries : entries.slice(0, 2); return <section className="phase8-card service-news-group" key={service}><header><div><h2>{service}</h2><p>현재 표시 대상 {entries.length}건</p></div></header><div>{visible.map((entry) => <NewsRow key={entry.id} news={entry} onScrap={toggleScrap} />)}</div>{entries.length > 2 ? <button className="service-more" onClick={() => setExpanded((value) => ({ ...value, [service]: !value[service] }))}>{expanded[service] ? "접기" : `저장된 소식 ${entries.length - 2}건 더 보기`}</button> : null}</section>; })}</div> : <div className="phase8-empty"><strong>{collection?.status === "no_subscriptions" ? "수집할 반복 구독이 없어요" : collection?.status === "no_new_content" || collection?.status === "unchanged" ? "확인한 범위에서 새 소식이 없어요" : collection?.status === "precheck_failed" ? "공식 출처의 변경 여부를 확인하지 못했어요" : collection?.status === "search_failed" ? "소식 검색에 실패했어요" : collection?.status === "source_failed" ? "공식 원문을 확인하지 못했어요" : collection?.status === "budget_limited" ? "예산으로 이번 수집을 진행하지 못했어요" : collection?.configured ? "첫 소식 수집을 기다리고 있어요" : "자동 소식 수집 설정이 필요해요"}</strong><p>{collection?.last_checked_at ? `마지막 확인 ${date(collection.last_checked_at)}` : "반복 구독 서비스별 공통 수집이 실행되면 결과가 표시돼요."}</p></div>}
  </main></div>;
}

export function ScrapsPage({ navigation }: { navigation: ReactNode }) {
  const { session } = useAuth(); const [rows, setRows] = useState<ServiceNews[]>([]); const [state, setState] = useState<"loading" | "ready" | "error">("loading"); const [service, setService] = useState("all"); const [kind, setKind] = useState("all");
  useEffect(() => { if (!session) return; getNewsScraps(session.access_token).then((value) => { setRows(value); setState("ready"); }).catch(() => setState("error")); }, [session]);
  async function remove(entry: ServiceNews) { if (!session) return; try { await removeNewsScrap(session.access_token, entry.id); setRows((value) => value.filter((row) => row.id !== entry.id)); } catch { setState("error"); } }
  const services = [...new Set(rows.filter((row) => row.is_available !== false).map((row) => row.service_name).filter(Boolean))] as string[];
  const filtered = rows.filter((row) => (service === "all" || row.service_name === service) && (kind === "all" || row.news_type === kind));
  return <div className="app-shell">{navigation}<main className="phase8-page"><header className="items-title news-page-title"><div><h1>스크랩한 소식</h1><p>구독을 종료해도 저장한 공통 소식은 내 계정에 남아요.</p></div><button className="button secondary" onClick={() => go("/news")}>최신 소식으로</button></header><div className="scrap-filters"><label>서비스<select value={service} onChange={(event) => setService(event.target.value)}><option value="all">전체</option>{services.map((value) => <option key={value}>{value}</option>)}</select></label><label>소식 종류<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">전체</option>{Object.entries(newsTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>{state === "loading" ? <div className="phase8-empty">스크랩을 불러오는 중…</div> : state === "error" ? <div className="notice error">스크랩을 불러오지 못했어요.</div> : !filtered.length ? <div className="phase8-empty"><strong>조건에 맞는 스크랩이 없어요</strong><p>최신 소식에서 필요한 글을 저장해 보세요.</p></div> : <div className="scrap-list">{filtered.map((entry) => entry.is_available === false ? <article className="phase8-card unavailable-news" key={entry.id}><h2>현재 제공되지 않는 소식</h2><p>오류 또는 근거 부족으로 비공개되어 기존 본문을 표시하지 않아요.</p><button className="button secondary" onClick={() => remove(entry)}>스크랩 해제</button></article> : <section className="phase8-card service-news-group" key={entry.id}><header><div><h2>{entry.service_name}</h2><p>{entry.is_archived ? "보관된 소식 · " : ""}스크랩 {date(entry.scrapped_at)}</p></div></header><NewsRow news={entry} onScrap={remove} /></section>)}</div>}</main></div>;
}

export function ItemSupportContent({ itemId }: { itemId: string }) {
  const { session } = useAuth();
  const [content, setContent] = useState<ItemContent | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!session) return;
    getItemContent(session.access_token, itemId).then(setContent).catch(() => setFailed(true));
  }, [itemId, session]);
  if (failed) return <section className="detail-card"><h2>정보 지원</h2><p>지원 정보를 불러오지 못했어요. 관리 항목에는 영향이 없어요.</p></section>;
  if (!content) return <section className="detail-card"><h2>정보 지원</h2><p>공식 자료를 확인하는 중…</p></section>;
  return <>
    <section className="detail-card support-summary"><h2>정보 지원</h2><p>해지 안내 · {supportLabels[content.support.cancellation]}</p><p>최신 소식 · {supportLabels[content.support.news]}</p>{!content.catalog ? <small>카탈로그 밖 서비스도 직접 관리는 계속할 수 있어요.</small> : content.payment_path_needed ? <small>결제 경로를 입력하면 해당 경로와 일치하는 공식 해지 안내만 보여드려요.</small> : null}</section>
    {content.guides.length ? <section className="detail-card cancellation-content"><h2>공식 해지 안내</h2><p className="detail-muted">실제 해지는 외부 서비스에서 직접 진행해 주세요.</p>{content.guides.map((guide) => <article key={guide.id}>
      <div className="phase8-card-top"><b>{guide.payment_path}</b><span>{guide.country_code}{guide.plan_scope ? ` · ${guide.plan_scope}` : ""}</span></div>
      <h3>{guide.title}</h3>{guide.status === "recheck_required" ? <span className="review-warning">재확인 필요 · 확인되지 않은 단계는 제공하지 않아요.</span> : <ol>{guide.steps.map((step, index) => <li key={`${guide.id}-${index}`}>{step}</li>)}</ol>}
      {guide.conditions ? <p><b>조건</b> {guide.conditions}</p> : null}{guide.access_after_cancel ? <p><b>해지 후 이용</b> {guide.access_after_cancel}</p> : null}
      <small>마지막 확인일 {date(guide.checked_at)}</small><a href={guide.source_url} target="_blank" rel="noreferrer">공식 출처 · {guide.source_title}</a>
    </article>)}</section> : null}
    {content.news.length ? <section className="detail-card"><h2>관련 최신 소식</h2>{content.news.slice(0, 2).map((entry) => <button className="detail-news-link" key={entry.id} onClick={() => go("/news")}><b>{entry.title}</b><small>{date(entry.applies_on || entry.announced_on)}</small></button>)}</section> : null}
  </>;
}

export function OperationsPage({ navigation }: { navigation: ReactNode }) {
  const { session } = useAuth();
  const [data, setData] = useState<any>(null); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [catalogName, setCatalogName] = useState(""); const [aliases, setAliases] = useState("");
  const [kind, setKind] = useState<"news" | "cancellation_guide">("news");
  const [announcement, setAnnouncement] = useState({ title: "", body: "" });
  const [form, setForm] = useState({ catalog_id: "", title: "", summary: "", source_title: "", source_url: "", source_domain: "", checked_at: new Date().toISOString().slice(0, 10), announced_on: "", applies_on: "", payment_path: "공식 웹사이트", steps: "" });
  const load = () => {
    if (!session) return;
    void getReviewData(session.access_token).then(setData).catch((reason) => setError(reason instanceof Error ? reason.message : "검수 자료를 불러오지 못했어요."));
  };
  useEffect(() => { load(); }, [session]);
  async function addCatalog(event: FormEvent) { event.preventDefault(); if (!session) return; setError(""); try { await createCatalog(session.access_token, { display_name: catalogName, match_names: aliases.split(",").map((v) => v.trim()).filter(Boolean) }); setCatalogName(""); setAliases(""); setMessage("카탈로그를 등록했어요."); load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "등록하지 못했어요."); } }
  async function addContent(event: FormEvent) { event.preventDefault(); if (!session) return; setError(""); try {
    const common = { catalog_id: form.catalog_id, title: form.title, source_title: form.source_title, source_url: form.source_url, source_domain: form.source_domain, checked_at: new Date(`${form.checked_at}T00:00:00Z`).toISOString(), status: "pending_review" };
    if (kind === "news") await createServiceNews(session.access_token, { ...common, news_type: "other", summary: form.summary, announced_on: form.announced_on || null, applies_on: form.applies_on || null, applicability_status: "needs_confirmation" });
    else await createCancellationGuide(session.access_token, { ...common, payment_path: form.payment_path, country_code: "KR", steps: form.steps.split("\n").map((v) => v.trim()).filter(Boolean) });
    setMessage("공식 출처 기반 검수 대기 자료를 등록했어요."); load();
  } catch (reason) { setError(reason instanceof Error ? reason.message : "등록하지 못했어요."); } }
  async function change(entity: "news" | "cancellation_guide", id: string, status: string) { if (!session) return; const reason = window.prompt("변경 이유를 입력해 주세요."); if (!reason?.trim()) return; try { await reviewContent(session.access_token, entity, id, status, reason.trim()); setMessage("검수 상태를 변경하고 이력을 남겼어요."); load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "상태를 변경하지 못했어요."); } }
  async function addAnnouncement(event: FormEvent) { event.preventDefault(); if (!session) return; try { await createAnnouncement(session.access_token, announcement); setAnnouncement({ title: "", body: "" }); setMessage("공지 초안을 저장했어요. 공개 버튼을 누르면 모든 사용자 홈에 표시돼요."); load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "공지를 저장하지 못했어요."); } }
  async function changeAnnouncement(id: string, status: "published" | "hidden") { if (!session) return; const reason = window.prompt(status === "published" ? "공개 이유를 입력해 주세요." : "비공개 이유를 입력해 주세요."); if (!reason?.trim()) return; try { await reviewAnnouncement(session.access_token, id, status, reason.trim()); setMessage(status === "published" ? "모든 사용자에게 공지를 공개했어요." : "공지를 비공개했어요."); load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "공지 상태를 변경하지 못했어요."); } }
  return <div className="app-shell">{navigation}<main className="phase8-page operations-page"><header className="items-title"><h1>운영자 도구</h1><p>자동 수집 결과 중 불확실한 정보만 검토하고, 전체 사용자 공지사항을 관리해요.</p></header>
    {error ? <div className="notice error">{error}</div> : null}{message ? <div className="notice success">{message}</div> : null}
    {!data ? <div className="phase8-empty">운영 권한과 자료를 확인하는 중…</div> : <>
      <section id="announcements" className="announcement-admin"><form className="phase8-card" onSubmit={addAnnouncement}><h2>공지사항 작성</h2><p>공개하면 로그인한 모든 사용자의 홈에 표시돼요.</p><label>제목<input required maxLength={160} value={announcement.title} onChange={(e) => setAnnouncement({ ...announcement, title: e.target.value })} /></label><label>내용<textarea required maxLength={5000} value={announcement.body} onChange={(e) => setAnnouncement({ ...announcement, body: e.target.value })} /></label><button className="button primary">공지 초안 저장</button></form><div className="phase8-card"><h2>공지 목록</h2>{data.announcements.length ? data.announcements.map((row: any) => <article key={row.id}><div className="phase8-card-top"><b>{row.title}</b><span>{row.status}</span></div><p>{row.body}</p><div className="review-actions"><button className="button primary" onClick={() => changeAnnouncement(row.id, "published")}>전체 공개</button><button className="button secondary" onClick={() => changeAnnouncement(row.id, "hidden")}>비공개</button></div></article>) : <p>작성한 공지가 없어요.</p>}</div></section>
      <details className="advanced-content-tools"><summary>자동 수집 보완용 직접 등록</summary><div className="operations-forms"><form className="phase8-card" onSubmit={addCatalog}><h2>소식 수집 서비스 추가</h2><p>반복 구독 등록 시 자동으로 추가되므로 이름 보정이 필요할 때만 사용해요.</p><label>서비스명<input required value={catalogName} onChange={(e) => setCatalogName(e.target.value)} /></label><label>같은 서비스 이름<input value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="쉼표로 구분" /></label><button className="button secondary">서비스 추가</button></form>
      <form className="phase8-card" onSubmit={addContent}><h2>공식 자료 직접 추가</h2><p>자동 검색이 놓친 공식 원문을 보완할 때만 사용해요.</p><label>자료 종류<select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option value="news">최신 소식</option><option value="cancellation_guide">해지 안내</option></select></label><label>서비스<select required value={form.catalog_id} onChange={(e) => setForm({ ...form, catalog_id: e.target.value })}><option value="">선택</option>{data.catalogs.map((c: any) => <option key={c.id} value={c.id}>{c.display_name}</option>)}</select></label><label>제목<input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>{kind === "news" ? <><label>요약<textarea required value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></label><div className="two-fields"><label>발표일<input type="date" value={form.announced_on} onChange={(e) => setForm({ ...form, announced_on: e.target.value })} /></label><label>적용일<input type="date" value={form.applies_on} onChange={(e) => setForm({ ...form, applies_on: e.target.value })} /></label></div></> : <><label>결제 경로<input required value={form.payment_path} onChange={(e) => setForm({ ...form, payment_path: e.target.value })} /></label><label>확인한 단계<textarea required value={form.steps} onChange={(e) => setForm({ ...form, steps: e.target.value })} placeholder="한 줄에 한 단계" /></label></>}<label>공식 출처명<input required value={form.source_title} onChange={(e) => setForm({ ...form, source_title: e.target.value })} /></label><label>공식 HTTPS URL<input required type="url" value={form.source_url} onChange={(e) => setForm({ ...form, source_url: e.target.value })} /></label><label>출처 도메인<input required value={form.source_domain} onChange={(e) => setForm({ ...form, source_domain: e.target.value })} placeholder="help.example.com" /></label><label>확인일<input required type="date" value={form.checked_at} onChange={(e) => setForm({ ...form, checked_at: e.target.value })} /></label><button className="button secondary">검수 대기로 등록</button></form></div></details>
      <section className="review-queue"><h2>검수 목록</h2>{[...data.guides.map((row: any) => ({ ...row, entity: "cancellation_guide" })), ...data.news.map((row: any) => ({ ...row, entity: "news" }))].map((row: any) => <article className="phase8-card" key={`${row.entity}-${row.id}`}><div className="phase8-card-top"><span>{row.entity === "news" ? "소식" : "해지 안내"}</span><b>{row.status}</b></div><h3>{row.title}</h3><a href={row.source_url} target="_blank" rel="noreferrer">{row.source_domain} 공식 원문 열기</a><small>확인일 {date(row.checked_at)}</small><div className="review-actions"><button onClick={() => change(row.entity, row.id, "published")} className="button primary">공개</button>{row.entity === "cancellation_guide" ? <button onClick={() => change(row.entity, row.id, "recheck_required")} className="button secondary">재확인 필요</button> : null}<button onClick={() => change(row.entity, row.id, "hidden")} className="button secondary">비공개</button></div></article>)}</section>
      <section className="audit-list"><h2>최근 변경 이력</h2>{data.audit.length ? data.audit.map((row: any) => <div key={row.id}><span>{row.entity_type} · {row.action}</span><b>{row.reason}</b><small>{date(row.created_at)}</small></div>) : <p>아직 변경 이력이 없어요.</p>}</section>
      <section className="audit-list"><h2>최근 수집 결과</h2>{data.runs.length ? data.runs.map((row: any) => <div key={row.id}><span>{row.content_kind}</span><b>{row.outcome}</b><small>{date(row.checked_at)}</small></div>) : <p>자동 수집은 아직 연결되지 않았어요. 새 소식 없음과 검색 실패를 임의로 만들지 않습니다.</p>}</section>
    </>}
  </main></div>;
}

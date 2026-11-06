import { type FormEvent, type ReactNode, useEffect, useState } from "react";

import { useAuth } from "../auth/AuthContext";
import { BrandIcon } from "../brand/brand";
import { PageHeader } from "../components/ui";
import bookmarkIcon from "../assets/figma/bookmark.svg";
import aiNewsIcon from "../assets/figma/ai-news.svg";
import ailenMascot from "../assets/brand/ailen_remove_bg.png";
import {
  createCancellationGuide,
  addNewsScrap,
  createAnnouncement,
  createCatalog,
  deleteAnnouncement,
  deleteCatalog,
  createServiceNews,
  getItemContent,
  getCollectionStatus,
  getRelevantNews,
  getOttNews,
  getNewsScraps,
  getReviewData,
  reviewContent,
  setCatalogCollection,
  updateCollectionSettings,
  reviewAnnouncement,
  removeNewsScrap,
  type ItemContent,
  type CollectionStatus,
  type ServiceNews,
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
      <button className={`scrap-button${news.is_scrapped ? " active" : ""}`} onClick={() => onScrap(news)} aria-label={news.is_scrapped ? `${news.title} 스크랩 해제` : `${news.title} 스크랩` } aria-pressed={Boolean(news.is_scrapped)}>{news.is_scrapped ? "★ 스크랩" : "☆ 스크랩"}</button>
      <details className="news-details"><summary>상세 보기</summary><div className="news-details-body"><div className="news-relevance-row"><p><b>내 구독 관련성</b>{news.relevance_summary || news.impact_summary || "등록한 서비스와 관련된 공식 소식이에요."}</p></div><dl className="source-meta"><div><dt>적용일</dt><dd>{date(news.applies_on)}</dd></div><div><dt>마지막 확인일</dt><dd>{date(news.last_verified_at || news.checked_at)}</dd></div></dl><a className="news-source-link" href={news.source_url} target="_blank" rel="noreferrer">공식 출처 · {news.source_title}<small>{countryName(news.source_country_code)} · {languageName(news.source_language)}</small></a>{news.applicability_status === "needs_confirmation" ? <span className="review-warning news-condition-warning">국가·요금제 적용 조건 확인 필요</span> : null}</div></details>
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
    <PageHeader eyebrow="소식" title="최신 소식" description="AI 요약을 통해 내 구독과 관련된 중요한 소식을 확인하세요." actions={<button className="button secondary news-scrap-library-button" onClick={() => go("/scraps")}><img src={bookmarkIcon} alt="" aria-hidden="true" />스크랩 보관함</button>} />
    {state === "ready" ? <section className="ott-editorial-section"><header><div><span>공통 OTT 편성</span><h2>OTT 공개 예정작</h2><p>구독 여부와 관계없이 국내 공식 발표를 우선해 서비스별 대표 편성 소식을 보여드려요.</p></div></header>{ottRepresentatives.length ? <div className="ott-editorial-grid">{ottRepresentatives.map((entry) => <article className="phase8-card ott-editorial-card" key={entry.id}><div className="ott-card-heading"><span className="news-service-name"><BrandIcon name={entry.service_name || "서비스"} tone="subscription" className="news-service-icon" />{entry.service_name}</span><time>{date(entry.announced_on)}</time></div><h3>{entry.title}</h3><p>{entry.summary}</p><div className="ott-card-actions"><button className={`scrap-button${entry.is_scrapped ? " active" : ""}`} onClick={() => toggleScrap(entry)} aria-label={entry.is_scrapped ? `${entry.title} 스크랩 해제` : `${entry.title} 스크랩`}>{entry.is_scrapped ? "★ 스크랩" : "☆ 스크랩"}</button><a href={entry.source_url} target="_blank" rel="noreferrer">공식 출처</a></div></article>)}</div> : <div className="ott-editorial-empty"><img className="phase8-state-mascot" src={ailenMascot} alt="" aria-hidden="true" /><span>공식 공개 예정작 소식을 수집 중이에요. 일부 확인 결과를 전체 편성표처럼 표시하지 않습니다.</span></div>}</section> : null}
    <div className="news-section-heading"><h2>내 구독의 최신 소식</h2><p>국가·요금제와 연결되는 가격, 혜택, 기능, 콘텐츠 정보를 확인하세요.</p></div>
    {state === "loading" ? <div className="phase8-empty"><img className="phase8-state-mascot" src={ailenMascot} alt="" aria-hidden="true" /><span>소식을 불러오는 중…</span></div> : state === "error" ? <div className="phase8-empty news-load-error"><img className="phase8-state-mascot" src={ailenMascot} alt="" aria-hidden="true" /><span>소식을 불러오지 못했어요. 기존 관리 기능은 그대로 사용할 수 있어요.</span></div> : news.length ? <div className="service-news-list">{Object.entries(grouped).map(([service, entries]) => { const visible = expanded[service] ? entries : entries.slice(0, 2); return <section className="phase8-card service-news-group" key={service}><header><div><h2 className="news-service-name"><BrandIcon name={service} className="news-service-icon" />{service}</h2><p>현재 표시 대상 {entries.length}건</p></div></header><div>{visible.map((entry) => <NewsRow key={entry.id} news={entry} onScrap={toggleScrap} />)}</div>{entries.length > 2 ? <button className="service-more" onClick={() => setExpanded((value) => ({ ...value, [service]: !value[service] }))}>{expanded[service] ? "접기" : `저장된 소식 ${entries.length - 2}건 더 보기`}</button> : null}</section>; })}</div> : <div className="phase8-empty"><strong>{collection?.status === "no_subscriptions" ? "수집할 반복 구독이 없어요" : collection?.status === "no_new_content" || collection?.status === "unchanged" ? "확인한 범위에서 새 소식이 없어요" : collection?.status === "precheck_failed" ? "공식 출처의 변경 여부를 확인하지 못했어요" : collection?.status === "search_failed" ? "소식 검색에 실패했어요" : collection?.status === "source_failed" ? "공식 원문을 확인하지 못했어요" : collection?.status === "budget_limited" ? "예산으로 이번 수집을 진행하지 못했어요" : collection?.configured ? "첫 소식 수집을 기다리고 있어요" : "자동 소식 수집 설정이 필요해요"}</strong><p>{collection?.last_checked_at ? `마지막 확인 ${date(collection.last_checked_at)}` : "반복 구독 서비스별 공통 수집이 실행되면 결과가 표시돼요."}</p></div>}
  </main></div>;
}

export function ScrapsPage({ navigation }: { navigation: ReactNode }) {
  const { session } = useAuth(); const [rows, setRows] = useState<ServiceNews[]>([]); const [state, setState] = useState<"loading" | "ready" | "error">("loading"); const [service, setService] = useState("all"); const [kind, setKind] = useState("all");
  useEffect(() => { if (!session) return; getNewsScraps(session.access_token).then((value) => { setRows(value); setState("ready"); }).catch(() => setState("error")); }, [session]);
  async function remove(entry: ServiceNews) { if (!session) return; try { await removeNewsScrap(session.access_token, entry.id); setRows((value) => value.filter((row) => row.id !== entry.id)); } catch { setState("error"); } }
  const services = [...new Set(rows.filter((row) => row.is_available !== false).map((row) => row.service_name).filter(Boolean))] as string[];
  const filtered = rows.filter((row) => (service === "all" || row.service_name === service) && (kind === "all" || row.news_type === kind));
  return <div className="app-shell">{navigation}<main className="phase8-page">
    <PageHeader eyebrow="스크랩 보관함" title="스크랩한 소식" description="구독을 종료해도 저장한 공통 소식은 내 계정에 남아요." actions={<button className="button secondary news-scrap-library-button" onClick={() => go("/news")}><img src={aiNewsIcon} alt="" aria-hidden="true" />최신 소식으로</button>} />
    <div className="scrap-filters"><label>서비스<select value={service} onChange={(event) => setService(event.target.value)}><option value="all">전체</option>{services.map((value) => <option key={value}>{value}</option>)}</select></label><label>소식 종류<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">전체</option>{Object.entries(newsTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>{state === "loading" ? <div className="phase8-empty scrap-empty-state"><span>스크랩을 불러오는 중…</span></div> : state === "error" ? <div className="phase8-empty scrap-empty-state scrap-load-error"><img className="phase8-state-mascot" src={ailenMascot} alt="" aria-hidden="true" /><span>스크랩을 불러오지 못했어요.</span></div> : !filtered.length ? <div className="phase8-empty scrap-empty-state"><img className="phase8-state-mascot" src={ailenMascot} alt="" aria-hidden="true" /><strong>조건에 맞는 스크랩이 없어요</strong><p>최신 소식에서 필요한 글을 저장해 보세요.</p></div> : <div className="scrap-list">{filtered.map((entry) => entry.is_available === false ? <article className="phase8-card unavailable-news" key={entry.id}><h2>현재 제공되지 않는 소식</h2><p>오류 또는 근거 부족으로 비공개되어 기존 본문을 표시하지 않아요.</p><button className="button secondary" onClick={() => remove(entry)}>스크랩 해제</button></article> : <section className="phase8-card service-news-group" key={entry.id}><header><div><h2 className="news-service-name"><BrandIcon name={entry.service_name || "서비스"} className="news-service-icon" />{entry.service_name}</h2><p>{entry.is_archived ? "보관된 소식 · " : ""}스크랩 {date(entry.scrapped_at)}</p></div></header><NewsRow news={entry} onScrap={remove} /></section>)}</div>}
  </main></div>;
}

export function ItemSupportContent({ itemId }: { itemId: string }) {
  const { session } = useAuth();
  const [content, setContent] = useState<ItemContent | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!session) return;
    getItemContent(session.access_token, itemId).then(setContent).catch(() => setFailed(true));
  }, [itemId, session]);
  if (failed || !content) return null;
  return <>
    {content.guides.length ? <section className="detail-card cancellation-content"><h2>공식 해지 안내</h2><p className="detail-muted">실제 해지는 외부 서비스에서 직접 진행해 주세요.</p>{content.guides.map((guide) => <article key={guide.id}>
      <div className="phase8-card-top"><b>{guide.payment_path}</b><span>{guide.country_code}{guide.plan_scope ? ` · ${guide.plan_scope}` : ""}</span></div>
      <h3>{guide.title}</h3>{guide.status === "recheck_required" ? <span className="review-warning">재확인 필요 · 확인되지 않은 단계는 제공하지 않아요.</span> : <ol>{guide.steps.map((step, index) => <li key={`${guide.id}-${index}`}>{step}</li>)}</ol>}
      {guide.conditions ? <p><b>조건</b> {guide.conditions}</p> : null}{guide.access_after_cancel ? <p><b>해지 후 이용</b> {guide.access_after_cancel}</p> : null}
      <small>마지막 확인일 {date(guide.checked_at)}</small><a href={guide.source_url} target="_blank" rel="noreferrer">공식 출처 · {guide.source_title}</a>
    </article>)}</section> : null}
    {content.news.length ? <section className="detail-card"><h2>관련 최신 소식</h2>{content.news.slice(0, 2).map((entry) => <button className="detail-news-link" key={entry.id} onClick={() => go("/news")}><b>{entry.title}</b><small>{date(entry.applies_on || entry.announced_on)}</small></button>)}</section> : null}
  </>;
}

function LegacyOperationsPage({ navigation }: { navigation: ReactNode }) {
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

const collectionOutcomeLabels: Record<string, string> = {
  new_content: "새 소식 있음",
  no_new_content: "새 소식 없음",
  search_failed: "검색 실패",
  source_failed: "출처 확인 실패",
  precheck_failed: "사전 확인 실패",
  unchanged: "변경 없음",
  budget_limited: "예산 제한",
};

export function OperationsPage({ navigation }: { navigation: ReactNode }) {
  const { session } = useAuth();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [announcement, setAnnouncement] = useState({ title: "", body: "" });
  const [activeTab, setActiveTab] = useState<"announcements" | "collection">("collection");
  const [servicePage, setServicePage] = useState(0);
  const [reviewPage, setReviewPage] = useState(0);
  const [runPage, setRunPage] = useState(0);

  const load = () => {
    if (!session) return;
    void getReviewData(session.access_token)
      .then(setData)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "운영 자료를 불러오지 못했어요."));
  };
  useEffect(() => { load(); }, [session]);

  async function change(entity: "news" | "cancellation_guide", id: string, status: string) {
    if (!session) return;
    const reason = window.prompt("변경 이유를 입력해 주세요.");
    if (!reason?.trim()) return;
    try {
      await reviewContent(session.access_token, entity, id, status, reason.trim());
      setMessage("검수 상태를 변경하고 이력을 남겼어요.");
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "상태를 변경하지 못했어요.");
    }
  }

  async function addAnnouncement(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    try {
      await createAnnouncement(session.access_token, announcement);
      setAnnouncement({ title: "", body: "" });
      setMessage("공지 초안을 저장했어요.");
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "공지를 저장하지 못했어요.");
    }
  }

  async function changeAnnouncement(id: string, status: "published" | "hidden") {
    if (!session) return;
    try {
      await reviewAnnouncement(session.access_token, id, status);
      setMessage(status === "published" ? "공지를 공개했어요." : "공지를 비공개했어요.");
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "공지 상태를 변경하지 못했어요.");
    }
  }

  async function toggleCatalogCollection(service: any) {
    if (!session) return;
    const enabled = service.collection_enabled === false;
    try {
      await setCatalogCollection(session.access_token, service.id, enabled);
      setMessage(enabled ? "서비스 자동 수집을 재개했어요." : "서비스 자동 수집을 중지했어요.");
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "서비스 수집 설정을 변경하지 못했어요.");
    }
  }

  async function removeAnnouncement(id: string) {
    if (!session) return;
    if (!window.confirm("이 공지사항을 삭제할까요?")) return;
    try {
      await deleteAnnouncement(session.access_token, id);
      setMessage("공지사항을 삭제했어요.");
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "공지사항을 삭제하지 못했어요.");
    }
  }

  async function removeCatalog(service: any) {
    if (!session) return;
    if (!window.confirm(`${service.display_name} 카탈로그와 저장된 소식·수집 기록을 삭제할까요?`)) return;
    try {
      await deleteCatalog(session.access_token, service.id);
      setMessage("서비스 카탈로그를 삭제했어요.");
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "서비스 카탈로그를 삭제하지 못했어요.");
    }
  }

  async function saveCollectionSettings(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const enabled = data.get("collection_enabled") === "on";
    const intervalHours = Number(data.get("interval_hours"));
    try {
      await updateCollectionSettings(session.access_token, { enabled, interval_hours: intervalHours });
      setMessage("전체 자동 수집 설정을 저장했어요.");
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "전체 자동 수집 설정을 저장하지 못했어요.");
    }
  }

  const reviewRows = [
    ...(data?.guides || []).map((row: any) => ({ ...row, entity: "cancellation_guide" })),
    ...(data?.news || []).filter((row: any) => row.status !== "published")
      .map((row: any) => ({ ...row, entity: "news" })),
  ];
  const pageSize = 6;
  const collectionServices = data?.collection_services || [];
  const collectionRuns = data?.runs || [];
  const servicePageCount = Math.max(1, Math.ceil(collectionServices.length / pageSize));
  const reviewPageCount = Math.max(1, Math.ceil(reviewRows.length / pageSize));
  const runPageCount = Math.max(1, Math.ceil(collectionRuns.length / pageSize));
  const currentServicePage = Math.min(servicePage, servicePageCount - 1);
  const currentReviewPage = Math.min(reviewPage, reviewPageCount - 1);
  const currentRunPage = Math.min(runPage, runPageCount - 1);
  const visibleServices = collectionServices.slice(currentServicePage * pageSize, (currentServicePage + 1) * pageSize);
  const visibleReviewRows = reviewRows.slice(currentReviewPage * pageSize, (currentReviewPage + 1) * pageSize);
  const visibleRuns = collectionRuns.slice(currentRunPage * pageSize, (currentRunPage + 1) * pageSize);

  return <div className="app-shell">{navigation}<main className="phase8-page operations-page">
    <header className="items-title"><h1>운영자 도구</h1><p>자동 수집 상태, 발견된 소식, 검수 대기 자료를 확인하고 공개 여부를 관리해요.</p></header>
    {error ? <div className="notice error">{error}</div> : null}
    {message ? <div className="notice success">{message}</div> : null}
    <div className="operator-tabs" role="tablist" aria-label="운영자 도구 메뉴">
      <button type="button" role="tab" aria-selected={activeTab === "announcements"} className={activeTab === "announcements" ? "active" : ""} onClick={() => setActiveTab("announcements")}>공지사항</button>
      <button type="button" role="tab" aria-selected={activeTab === "collection"} className={activeTab === "collection" ? "active" : ""} onClick={() => setActiveTab("collection")}>수집</button>
    </div>
    {!data ? <div className="phase8-empty">운영 자료를 불러오는 중…</div> : <>
      {activeTab === "collection" ? <>
      <section className="operator-summary-grid">
        <div className="phase8-card"><span>수집 대상 서비스</span><strong>{data.collection?.service_count || 0}개</strong></div>
        <div className="phase8-card"><span>검수 대기 소식</span><strong>{(data.news || []).filter((row: any) => row.status === "pending_review").length}건</strong></div>
        <div className="phase8-card"><span>최근 수집 확인</span><strong>{date(data.collection?.last_checked_at)}</strong></div>
      </section>

      <section className="phase8-card operator-collection-controls">
        <div className="operator-section-heading"><div><h2>전체 자동 수집 설정</h2><p>전체 중단은 서비스별 수집 상태를 바꾸지 않고, 예약된 자동 수집 실행만 일시 중지해요.</p></div></div>
        <form className="operator-collection-controls-form" onSubmit={saveCollectionSettings}>
          <label className="operator-toggle"><input type="checkbox" name="collection_enabled" defaultChecked={data.collection_settings?.collection_enabled !== false} /><span>전체 자동 수집 허용</span></label>
          <label>자동 수집 기간(시간)<input name="interval_hours" type="number" min="1" max="720" step="1" defaultValue={data.collection_settings?.interval_hours || 72} required /></label>
          <button type="submit" className="button primary">설정 저장</button>
        </form>
      </section>

      <section className="operator-collection-section">
        <div className="operator-section-heading"><div><h2>서비스별 자동 수집 결과</h2><p>이번에 검색했는지, 새 소식이 저장됐는지, 사용자 구독과 연결 가능한지 확인합니다.</p></div></div>
        <div className="operator-service-list">{visibleServices.map((service: any) => {
          const run = service.latest_run;
          const serviceNews = service.latest_news || [];
          return <article className="phase8-card operator-service-card" key={service.id}>
            <div className="phase8-card-top"><b>{service.display_name}</b><span>{service.collection_enabled === false ? "수집 중지" : run ? (collectionOutcomeLabels[run.outcome] || run.outcome) : "수집 기록 없음"}</span></div>
            <p className="operator-service-meta">활성 구독 {service.active_subscriber_count || 0}개 · 공개 {service.published_news_count}건 · 검수 대기 {service.pending_review_news_count}건</p>
            <dl className="source-meta"><div><dt>마지막 수집</dt><dd>{date(service.last_news_check_at || run?.checked_at)}</dd></div><div><dt>다음 수집</dt><dd>{date(service.next_news_check_at)}</dd></div><div><dt>매칭 이름</dt><dd>{(service.match_names || []).join(", ") || "없음"}</dd></div></dl>
            {serviceNews.length ? <div className="operator-service-news"><b>최근 저장 소식</b>{serviceNews.map((row: any) => <div key={row.id}><span>{row.status === "published" ? "공개" : "검수 대기"}</span><a href={row.source_url} target="_blank" rel="noreferrer">{row.title}</a></div>)}</div> : <p className="operator-muted">아직 저장된 소식이 없습니다.</p>}
            <div className="operator-service-actions"><button type="button" className="button secondary" onClick={() => toggleCatalogCollection(service)}>{service.collection_enabled === false ? "수집 재개" : "수집 중지"}</button><button type="button" className="button danger-outline" onClick={() => removeCatalog(service)}>삭제</button></div>
          </article>;
        })}</div>
      <div className="operator-pagination operator-pagination-inline" aria-label="서비스 수집 결과 페이지 이동"><span>{servicePageCount > 1 ? `${currentServicePage + 1} / ${servicePageCount}` : ""}</span><button type="button" className="button secondary" aria-label="이전 서비스 수집 결과" disabled={currentServicePage === 0} onClick={() => setServicePage((page) => Math.max(0, page - 1))}>←</button><button type="button" className="button secondary" aria-label="다음 서비스 수집 결과" disabled={currentServicePage >= servicePageCount - 1} onClick={() => setServicePage((page) => Math.min(servicePageCount - 1, page + 1))}>→</button></div>
      </section>

      <section className="review-queue"><h2>검수 대기 자료</h2>{reviewRows.length ? visibleReviewRows.map((row: any) => <article className="phase8-card" key={`${row.entity}-${row.id}`}><div className="phase8-card-top"><span>{row.entity === "news" ? "소식" : "해지 안내"}</span><b>{row.status}</b></div><h3>{row.title}</h3>{row.catalog_name ? <p className="operator-muted">서비스: {row.catalog_name}</p> : null}<a href={row.source_url} target="_blank" rel="noreferrer">{row.source_domain} 공식 원문 열기</a><small>확인일 {date(row.checked_at)}</small><div className="review-actions"><button onClick={() => change(row.entity, row.id, "published")} className="button primary">공개</button>{row.entity === "cancellation_guide" ? <button onClick={() => change(row.entity, row.id, "recheck_required")} className="button secondary">재확인 필요</button> : null}<button onClick={() => change(row.entity, row.id, "hidden")} className="button secondary">비공개</button></div></article>) : <p className="operator-muted">현재 검수 대기 자료가 없습니다.</p>}</section><div className="operator-pagination operator-pagination-inline" aria-label="검수 대기 자료 페이지 이동"><span>{reviewPageCount > 1 ? `${currentReviewPage + 1} / ${reviewPageCount}` : ""}</span><button type="button" className="button secondary" aria-label="이전 검수 자료" disabled={currentReviewPage === 0} onClick={() => setReviewPage((page) => Math.max(0, page - 1))}>←</button><button type="button" className="button secondary" aria-label="다음 검수 자료" disabled={currentReviewPage >= reviewPageCount - 1} onClick={() => setReviewPage((page) => Math.min(reviewPageCount - 1, page + 1))}>→</button></div>

      <section className="audit-list"><h2>최근 수집 실행</h2>{collectionRuns.length ? visibleRuns.map((row: any) => <div key={row.id}><span>{row.catalog_name || "공통 서비스"} · {row.content_kind}</span><b>{collectionOutcomeLabels[row.outcome] || row.outcome}</b><small>{date(row.checked_at)}{row.details ? ` · ${row.details}` : ""}</small></div>) : <p>자동 수집 실행 기록이 없습니다.</p>}</section><div className="operator-pagination operator-pagination-inline" aria-label="최근 수집 실행 페이지 이동"><span>{runPageCount > 1 ? `${currentRunPage + 1} / ${runPageCount}` : ""}</span><button type="button" className="button secondary" aria-label="이전 수집 실행" disabled={currentRunPage === 0} onClick={() => setRunPage((page) => Math.max(0, page - 1))}>←</button><button type="button" className="button secondary" aria-label="다음 수집 실행" disabled={currentRunPage >= runPageCount - 1} onClick={() => setRunPage((page) => Math.min(runPageCount - 1, page + 1))}>→</button></div>
      <section className="audit-list"><h2>최근 검수 이력</h2>{data.audit?.length ? data.audit.map((row: any) => <div key={row.id}><span>{row.entity_type} · {row.action}</span><b>{row.reason}</b><small>{date(row.created_at)}</small></div>) : <p>아직 검수 이력이 없습니다.</p>}</section>

      <div className="operator-pagination" aria-label="수집 결과 페이지 이동">
        <div><span>서비스 결과 {servicePageCount > 1 ? `${currentServicePage + 1} / ${servicePageCount}` : ""}</span><button type="button" className="button secondary" disabled={currentServicePage === 0} onClick={() => setServicePage((page) => Math.max(0, page - 1))}>이전</button><button type="button" className="button secondary" disabled={currentServicePage >= servicePageCount - 1} onClick={() => setServicePage((page) => Math.min(servicePageCount - 1, page + 1))}>다음</button></div>
        <div><span>검수 자료 {reviewPageCount > 1 ? `${currentReviewPage + 1} / ${reviewPageCount}` : ""}</span><button type="button" className="button secondary" disabled={currentReviewPage === 0} onClick={() => setReviewPage((page) => Math.max(0, page - 1))}>이전</button><button type="button" className="button secondary" disabled={currentReviewPage >= reviewPageCount - 1} onClick={() => setReviewPage((page) => Math.min(reviewPageCount - 1, page + 1))}>다음</button></div>
      </div>
      </> : null}
      {activeTab === "announcements" ? <section id="announcements" className="announcement-admin"><form className="phase8-card" onSubmit={addAnnouncement}><h2>공지사항 작성</h2><p>모든 로그인 사용자에게 표시할 공지를 작성합니다.</p><label>제목<input required maxLength={160} value={announcement.title} onChange={(event) => setAnnouncement({ ...announcement, title: event.target.value })} /></label><label>내용<textarea required maxLength={5000} value={announcement.body} onChange={(event) => setAnnouncement({ ...announcement, body: event.target.value })} /></label><button className="button primary">공지 초안 저장</button></form><div className="phase8-card"><h2>공지 목록</h2>{data.announcements?.length ? data.announcements.map((row: any) => <details className="announcement-item" key={row.id}><summary><b>{row.title}</b><span>{row.status === "published" ? "공개" : "비공개"}</span></summary><div className="announcement-item-body"><p>{row.body}</p><div className="review-actions"><button type="button" className="button primary announcement-status-button" onClick={() => changeAnnouncement(row.id, row.status === "published" ? "hidden" : "published")}>{row.status === "published" ? "비공개" : "전체 공개"}</button><button type="button" className="button danger-outline announcement-delete-button" onClick={() => removeAnnouncement(row.id)}>삭제</button></div></div></details>) : <p>작성한 공지가 없습니다.</p>}</div></section> : null}
    </>}
  </main></div>;
}

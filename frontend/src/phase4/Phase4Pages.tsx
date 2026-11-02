import { useState, type FormEvent, type ReactNode } from "react";

import { useAuth } from "../auth/AuthContext";
import { analyzeImage, confirmImage } from "../lib/api";
import { ManagedItemFormFields } from "../phase3/Phase3Pages";
import {
  buildManagedItemPayload,
  type ManagedItem,
  type ManagedItemDraft,
  type ManagementType,
  typeLabel,
  validateManagedItemDraft,
} from "../phase3/model";
import {
  applyImageExtraction,
  canStartImageAnalysis,
  createImageDraft,
  retargetImageDraft,
  type ImageExtraction,
} from "./imageDraft";
import "./phase4.css";

type Notice = { tone: "success" | "error" | "info"; text: string } | null;

function navigate(path: string) {
  window.history.replaceState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message === "Failed to fetch")
    return "저장 서비스에 연결하지 못했어요. 연결 설정을 확인해 주세요.";
  return error instanceof Error ? error.message : fallback;
}

export function Phase4ImagePage({ navigation }: { navigation: ReactNode }) {
  const { client, session } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [keep, setKeep] = useState(true);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [draft, setDraft] = useState<ManagedItemDraft>(() =>
    createImageDraft("recurring_subscription"),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [imageFilledFields, setImageFilledFields] = useState<
    Set<keyof ManagedItemDraft>
  >(new Set());
  const [dirtyFields, setDirtyFields] = useState<Set<keyof ManagedItemDraft>>(
    new Set(),
  );
  const [assetId, setAssetId] = useState("");
  const [savedItemId, setSavedItemId] = useState("");
  const [extraction, setExtraction] = useState<ImageExtraction | null>(null);

  function update<K extends keyof ManagedItemDraft>(
    key: K,
    value: ManagedItemDraft[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirtyFields((current) => new Set(current).add(key));
    setImageFilledFields((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }

  async function changeType(type: ManagementType) {
    if (type === draft.management_type || busy) return;
    if (!assetId) {
      setDraft(createImageDraft(type));
      setErrors({});
      setDirtyFields(new Set());
      setImageFilledFields(new Set());
      setExtraction(null);
      return;
    }
    if (!client || !session) return;
    setBusy(true);
    try {
      const nextExtraction = extraction
        ? { ...extraction, management_type: type }
        : null;
      const changed = await client
        .from("image_assets")
        .update({
          management_type: type,
          extraction_json: nextExtraction || {},
        })
        .eq("id", assetId)
        .eq("user_id", session.user.id);
      if (changed.error) throw changed.error;

      const retargeted = retargetImageDraft(draft, type);
      setDraft(retargeted.draft);
      setErrors({});
      setImageFilledFields(
        new Set(
          [...imageFilledFields].filter((key) =>
            retargeted.retainedFields.has(key),
          ),
        ),
      );
      setDirtyFields(
        new Set(
          [...dirtyFields].filter((key) => retargeted.retainedFields.has(key)),
        ),
      );
      setExtraction(nextExtraction);
      setNotice({
        tone: "info",
        text: `${typeLabel(type, true)} 폼으로 바꿨어요. 새 폼에도 있는 분석값과 수정값은 그대로 유지했어요.`,
      });
    } catch (error) {
      setNotice({
        tone: "error",
        text: errorMessage(error, "관리 유형을 변경하지 못했어요."),
      });
    } finally {
      setBusy(false);
    }
  }

  function choose(next: File | null) {
    setNotice(null);
    setFile(next);
    setAssetId("");
    setSavedItemId("");
    setExtraction(null);
    setImageFilledFields(new Set());
    if (!next) {
      setPreview("");
      return;
    }
    if (
      !/^(image\/jpeg|image\/png|image\/webp)$/.test(next.type) ||
      next.size > 10 * 1024 * 1024
    ) {
      setFile(null);
      setPreview("");
      setNotice({
        tone: "error",
        text: "JPEG, PNG, WebP 형식의 10MB 이하 파일만 등록할 수 있어요.",
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPreview(String(reader.result));
    reader.readAsDataURL(next);
  }

  async function ensureAsset() {
    if (assetId) return assetId;
    if (!client || !session || !file) throw new Error("이미지를 선택해 주세요.");
    const path = `${session.user.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const uploaded = await client.storage
      .from("user-images")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (uploaded.error) throw uploaded.error;
    const inserted = await client
      .from("image_assets")
      .insert({
        user_id: session.user.id,
        management_type: draft.management_type,
        storage_path: path,
        mime_type: file.type,
        size_bytes: file.size,
        original_keep: keep,
      })
      .select("id")
      .single();
    if (inserted.error || !inserted.data) throw inserted.error;
    setAssetId(inserted.data.id);
    return inserted.data.id as string;
  }

  async function analyze() {
    if (!client || !session || !file || !consent) {
      setNotice({ tone: "error", text: "파일과 AI 전송 동의를 확인해 주세요." });
      return;
    }
    if (
      extraction &&
      dirtyFields.size > 0 &&
      !window.confirm(
        "다시 분석하면 이미지에서 확인된 항목은 새 분석값으로 바뀔 수 있어요. 직접 작성하거나 수정한 값을 덮어쓸까요?",
      )
    )
      return;
    setBusy(true);
    setNotice({ tone: "info", text: "이미지에서 확인 가능한 정보를 분석하고 있어요." });
    try {
      const id = await ensureAsset();
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
          ? `${mapped.filledFields.size}개 입력란을 이미지에서 채웠어요. 나머지 항목도 확인해 주세요.`
          : "확인 가능한 입력값을 찾지 못했어요. 같은 폼에서 직접 입력할 수 있어요.",
      });
    } catch (error) {
      setNotice({
        tone: "error",
        text: `${errorMessage(error, "이미지 처리에 실패했어요.")} 같은 폼에서 직접 입력을 계속할 수 있어요.`,
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
    if (!client || !session || !assetId) {
      setNotice({
        tone: "error",
        text: "이미지를 업로드한 뒤 분석을 실행해 주세요. 분석에 실패해도 업로드가 끝났다면 직접 입력해 저장할 수 있어요.",
      });
      return;
    }
    setBusy(true);
    setNotice({ tone: "info", text: "확인한 내용으로 관리 항목을 저장하고 있어요." });
    let persistedItemId = savedItemId;
    try {
      const payload = buildManagedItemPayload(draft, session.user.id);
      const result = savedItemId
        ? await client
            .from("items")
            .update(payload)
            .eq("id", savedItemId)
            .eq("user_id", session.user.id)
            .select("id")
            .single()
        : await client.from("items").insert(payload).select("id").single();
      if (result.error || !result.data) throw result.error;
      const itemId = (result.data as Pick<ManagedItem, "id">).id;
      persistedItemId = itemId;
      setSavedItemId(itemId);
      await confirmImage(session.access_token, assetId, itemId, keep);
      navigate(`/items/${itemId}`);
    } catch (error) {
      setNotice({
        tone: "error",
        text: persistedItemId
          ? `관리 항목은 저장됐지만 이미지 확정을 완료하지 못했어요. 다시 저장해 주세요. ${errorMessage(error, "")}`
          : errorMessage(error, "저장에 실패했어요."),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-shell">
      {navigation}
      <main className="phase4-page phase3-page">
        <header className="items-title">
          <h1>이미지로 등록</h1>
          <p>
            이미지를 분석한 뒤 {typeLabel(draft.management_type, true)} 직접 등록
            폼에서 확인하고 저장하세요.
          </p>
        </header>
        {notice ? (
          <div
            className={`notice ${notice.tone}`}
            role={notice.tone === "error" ? "alert" : "status"}
          >
            {notice.text}
          </div>
        ) : null}
        <form onSubmit={save} className="phase4-review-layout">
          <aside className="phase4-image-column">
            <section className="phase4-card phase4-upload-card">
              <h2>원본 이미지</h2>
              <label className="upload-box">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => choose(event.target.files?.[0] || null)}
                />
                {preview ? (
                  <img src={preview} alt="선택한 이미지 미리보기" />
                ) : (
                  <span>이미지를 선택해 주세요 (JPEG, PNG, WebP · 최대 10MB)</span>
                )}
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={keep}
                  onChange={(event) => setKeep(event.target.checked)}
                />
                원본 이미지를 보관할게요
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                분석을 위해 이미지가 AI 처리 서버로 전송되는 것에 동의해요
              </label>
              <button
                className="button primary"
                type="button"
                disabled={!canStartImageAnalysis(Boolean(file), consent, busy)}
                onClick={analyze}
              >
                {busy ? "처리 중…" : extraction ? "AI 다시 분석" : "AI 분석 시작"}
              </button>
              <small>
                분석 전에는 관리 항목을 만들지 않으며, 분석 실패 후에도 오른쪽
                폼을 직접 작성할 수 있어요.
              </small>
            </section>
          </aside>
          <section className="subscription-main phase4-form-column">
            <ManagedItemFormFields
              draft={draft}
              update={update}
              changeType={changeType}
              errors={errors}
              typeDisabled={busy}
              typeHelp={
                assetId
                  ? "분석 후에도 유형을 바꿀 수 있어요. 유형별 값은 새 폼에 맞게 정리되며 다시 분석할 수 있어요."
                  : "이미지에 맞는 유형을 먼저 선택해 주세요."
              }
              imageFilledFields={imageFilledFields}
              actions={
                <div className="form-actions">
                  <button className="button primary" type="submit" disabled={busy}>
                    {busy ? "저장 중" : "확인하고 목록에 저장"}
                  </button>
                  <a className="button secondary" href="/items">
                    취소
                  </a>
                </div>
              }
            />
          </section>
        </form>
      </main>
    </div>
  );
}

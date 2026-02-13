"use client";

import NextImage from "next/image";
import { useEffect, useMemo, useState } from "react";

const CATEGORY_OPTIONS = [
  { id: "comedy", label: "コメディ" },
  { id: "conversation", label: "会話劇" },
  { id: "musical", label: "ミュージカル" },
  { id: "classic", label: "古典・時代劇" },
  { id: "dance", label: "ダンス" },
  { id: "student", label: "学生演劇" },
  { id: "conte", label: "コント" },
  { id: "experimental", label: "実験的" },
  { id: "other", label: "その他" },
];

const FLYER_BUCKET = "flyers-public";
const CREATE_STEPS = [
  "画像",
  "基本",
  "日程・会場",
  "詳細・公開",
] as const;

type FormState = {
  category: string;
  slug: string;
  title: string;
  description: string;
  publish_at: string;
  start_date: string;
  end_date: string;
  reservation_start_at: string;
  reservation_label: string;
  venue: string;
  venue_address: string;
  price_general: string;
  price_student: string;
  ticket_url: string;
  tags: string;
  cast: string;
  flyer_url: string;
  image_url: string;
  ai_confidence: string;
  status: "draft" | "published" | "archived";
};

type EventData = {
  category?: string | null;
  slug?: string | null;
  title?: string | null;
  description?: string | null;
  publish_at?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  reservation_start_at?: string | null;
  reservation_label?: string | null;
  venue?: string | null;
  venue_address?: string | null;
  price_general?: number | null;
  price_student?: number | null;
  ticket_url?: string | null;
  tags?: string[] | null;
  cast?: unknown[] | null;
  flyer_url?: string | null;
  image_url?: string | null;
  ai_confidence?: number | null;
  status?: "draft" | "published" | "archived" | null;
};

const buildInitialState = (data?: EventData | null): FormState => ({
  category: data?.category ?? "comedy",
  slug: data?.slug ?? "",
  title: data?.title ?? "",
  description: data?.description ?? "",
  publish_at: data?.publish_at ?? "",
  start_date: data?.start_date ?? "",
  end_date: data?.end_date ?? "",
  reservation_start_at: data?.reservation_start_at ?? "",
  reservation_label: data?.reservation_label ?? "",
  venue: data?.venue ?? "",
  venue_address: data?.venue_address ?? "",
  price_general:
    data?.price_general !== null && data?.price_general !== undefined
      ? String(data.price_general)
      : "",
  price_student:
    data?.price_student !== null && data?.price_student !== undefined
      ? String(data.price_student)
      : "",
  ticket_url: data?.ticket_url ?? "",
  tags: Array.isArray(data?.tags) ? data.tags.join(", ") : "",
  cast: Array.isArray(data?.cast) ? JSON.stringify(data.cast, null, 2) : "",
  flyer_url: data?.flyer_url ?? "",
  image_url: data?.image_url ?? "",
  ai_confidence:
    data?.ai_confidence !== null && data?.ai_confidence !== undefined
      ? String(data.ai_confidence)
      : "",
  status: data?.status ?? "draft",
});

const loadImage = (file: File) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("IMAGE_LOAD_FAILED"));
    };
    img.src = url;
  });

const sanitizeImage = async (file: File) => {
  const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const ext = outputType === "image/png" ? "png" : "jpg";
  const img = await loadImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { blob: file, ext };
  }
  ctx.drawImage(img, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, outputType, outputType === "image/jpeg" ? 0.92 : 1)
  );
  if (!blob) {
    return { blob: file, ext };
  }
  return { blob, ext };
};

type Props = {
  mode: "create" | "edit";
  eventId?: string;
  initialData?: EventData | null;
  onSaved?: () => void;
};

export default function EventForm({
  mode,
  eventId,
  initialData,
  onSaved,
}: Props) {
  const [form, setForm] = useState<FormState>(buildInitialState(initialData));
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [promotionPlatforms, setPromotionPlatforms] = useState<string[]>([
    "twitter",
    "instagram",
    "facebook",
  ]);
  const [promotionLoading, setPromotionLoading] = useState(false);
  const [promotionMessage, setPromotionMessage] = useState<string | null>(null);
  const [promotions, setPromotions] = useState<
    { platform: string; text: string; hashtags: string[] }[]
  >([]);
  const [createStep, setCreateStep] = useState(0);

  useEffect(() => {
    setForm(buildInitialState(initialData));
  }, [initialData]);

  useEffect(() => {
    if (mode === "create") setCreateStep(0);
  }, [mode]);

  const flyerPreview = useMemo(
    () => form.flyer_url || form.image_url,
    [form.flyer_url, form.image_url]
  );
  const effectiveEventId = useMemo(
    () => eventId ?? createdId,
    [eventId, createdId]
  );

  const updateField = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const togglePlatform = (platform: string) => {
    setPromotionPlatforms((prev) =>
      prev.includes(platform)
        ? prev.filter((item) => item !== platform)
        : [...prev, platform]
    );
  };

  const uploadFlyer = async (file: File) => {
    setUploading(true);
    setMessage(null);
    try {
      const { blob, ext } = await sanitizeImage(file);
      const formData = new FormData();
      formData.append("file", blob, `flyer.${ext}`);
      formData.append("ext", ext);
      const res = await fetch("/api/storage/flyers", {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage(json?.error?.message ?? "アップロードに失敗しました");
        return;
      }
      const url = json?.data?.public_url;
      if (!url) {
        setMessage("画像URLの取得に失敗しました");
        return;
      }
      setForm((prev) => ({
        ...prev,
        flyer_url: url,
        image_url: prev.image_url || url,
      }));
      setMessage(`アップロード完了（${FLYER_BUCKET}）`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "アップロードに失敗しました"
      );
    } finally {
      setUploading(false);
    }
  };

  const runAnalyze = async () => {
    if (!form.flyer_url) {
      setMessage("先にチラシ画像をアップロードしてください");
      return;
    }
    setAnalyzing(true);
    setMessage(null);
    try {
      const res = await fetch("/api/ai/analyze-flyer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flyer_url: form.flyer_url }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage(json?.error?.message ?? "AI解析に失敗しました");
        return;
      }
      const result = json?.data?.result ?? {};
      setForm((prev) => ({
        ...prev,
        title: result.title ?? prev.title,
        description: result.description ?? prev.description,
        start_date: result.start_date ?? prev.start_date,
        end_date: result.end_date ?? prev.end_date,
        venue: result.venue ?? prev.venue,
        venue_address: result.venue_address ?? prev.venue_address,
        price_general:
          result.price_general !== null && result.price_general !== undefined
            ? String(result.price_general)
            : prev.price_general,
        price_student:
          result.price_student !== null && result.price_student !== undefined
            ? String(result.price_student)
            : prev.price_student,
        category: result.category ?? prev.category,
        tags: Array.isArray(result.tags)
          ? result.tags.join(", ")
          : prev.tags,
        cast: Array.isArray(result.cast)
          ? JSON.stringify(result.cast, null, 2)
          : prev.cast,
        ai_confidence:
          result.ai_confidence !== null && result.ai_confidence !== undefined
            ? String(result.ai_confidence)
            : prev.ai_confidence,
      }));
      setMessage("AI解析が完了しました。内容を確認してください。");
    } finally {
      setAnalyzing(false);
    }
  };

  const parseCast = () => {
    if (!form.cast.trim()) return [];
    const parsed = JSON.parse(form.cast);
    if (!Array.isArray(parsed)) {
      throw new Error("キャストは配列で入力してください");
    }
    return parsed;
  };

  const submit = async () => {
    setSaving(true);
    setMessage(null);
    setCreatedId(null);
    let cast: unknown[] | null = null;
    try {
      cast = parseCast();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "キャストの形式が不正です"
      );
      setSaving(false);
      return;
    }

    const payload = {
      category: form.category,
      slug: form.slug,
      title: form.title,
      publish_at: form.publish_at || null,
      start_date: form.start_date,
      end_date: form.end_date || null,
      reservation_start_at: form.reservation_start_at || null,
      reservation_label: form.reservation_label || null,
      venue: form.venue || null,
      venue_address: form.venue_address || null,
      price_general: form.price_general ? Number(form.price_general) : null,
      price_student: form.price_student ? Number(form.price_student) : null,
      ticket_url: form.ticket_url || null,
      description: form.description || null,
      tags: form.tags || null,
      status: form.status,
      flyer_url: form.flyer_url || null,
      image_url: form.image_url || null,
      ai_confidence: form.ai_confidence ? Number(form.ai_confidence) : null,
      cast,
    };

    const res = await fetch(
      mode === "create"
        ? "/api/theater/events"
        : `/api/theater/events/${eventId}`,
      {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const json = await res.json();
    if (!res.ok) {
      setMessage(json?.error?.message ?? "保存に失敗しました");
      setSaving(false);
      return;
    }
    if (mode === "create") {
      const id = json?.data?.event?.id;
      setCreatedId(id ?? null);
      setMessage("公演を作成しました。");
    } else {
      setMessage("更新しました。");
    }
    onSaved?.();
    setSaving(false);
  };

  const buildPromotionText = (promotion: {
    text: string;
    hashtags: string[];
  }) => {
    const hash = promotion.hashtags.length
      ? `\n\n${promotion.hashtags
          .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`))
          .join(" ")}`
      : "";
    return `${promotion.text}${hash}`;
  };

  const copyText = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setPromotionMessage("コピーしました。");
  };

  const generatePromotion = async () => {
    if (!effectiveEventId) {
      setPromotionMessage("先に公演を保存してください。");
      return;
    }
    if (promotionPlatforms.length === 0) {
      setPromotionMessage("対象SNSを1つ以上選択してください。");
      return;
    }
    setPromotionLoading(true);
    setPromotionMessage(null);
    try {
      const res = await fetch("/api/ai/generate-promotion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: effectiveEventId,
          platforms: promotionPlatforms,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setPromotionMessage(json?.error?.message ?? "生成に失敗しました。");
        return;
      }
      setPromotions(json?.data?.promotions ?? []);
      setPromotionMessage("宣伝文を生成しました。");
    } catch (error) {
      setPromotionMessage(
        error instanceof Error ? error.message : "生成に失敗しました。"
      );
    } finally {
      setPromotionLoading(false);
    }
  };

  const isWizard = mode === "create";
  const isLastCreateStep = createStep >= CREATE_STEPS.length - 1;
  const canContinueStep = (() => {
    if (!isWizard) return true;
    if (createStep === 1) {
      return Boolean(form.slug.trim() && form.title.trim());
    }
    if (createStep === 2) {
      return Boolean(form.start_date.trim());
    }
    return true;
  })();

  return (
    <div className="card-retro p-6">
      <h2 className="font-display text-xl">
        {mode === "create" ? "新規公演作成" : "公演編集"}
      </h2>
      <p className="mt-2 text-sm text-zinc-700">
        チラシ画像アップロード → AI解析 → 内容確認の流れです。
      </p>
      {form.ai_confidence && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="badge-retro bg-secondary shadow-hard-sm">
            AI信頼度: {form.ai_confidence}
          </span>
        </div>
      )}

      {isWizard && (
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          {CREATE_STEPS.map((label, index) => (
            <button
              key={label}
              type="button"
              onClick={() => setCreateStep(index)}
              className={`badge-retro justify-center py-2 text-center transition-opacity ${
                createStep === index
                  ? "bg-pop-yellow opacity-100"
                  : "bg-surface opacity-75"
              }`}
            >
              {index + 1}. {label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 grid gap-3 text-sm">
        {(!isWizard || createStep === 0) && (
          <>
            <label className="text-xs font-black tracking-wide text-zinc-700">
              チラシ画像
            </label>
            <input
              type="file"
              accept="image/*"
              className="input-retro"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadFlyer(file);
              }}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={runAnalyze}
                disabled={analyzing || !form.flyer_url}
                className="btn-retro btn-surface text-xs disabled:opacity-50"
              >
                {analyzing ? "AI解析中..." : "AI解析を実行"}
              </button>
              <input
                className="input-retro flex-1"
                placeholder="flyer_url（自動入力）"
                value={form.flyer_url}
                onChange={(e) => updateField("flyer_url", e.target.value)}
              />
            </div>
            {flyerPreview && (
              <NextImage
                src={flyerPreview}
                alt="flyer preview"
                width={800}
                height={600}
                unoptimized
                className="max-h-64 rounded-2xl border-2 border-ink bg-surface object-contain shadow-hard-sm"
              />
            )}
            {uploading && <p className="text-xs text-zinc-600">アップロード中...</p>}
            <label className="text-xs font-black tracking-wide text-zinc-700">
              OGP画像URL（任意）
            </label>
            <input
              className="input-retro"
              placeholder="image_url"
              value={form.image_url}
              onChange={(e) => updateField("image_url", e.target.value)}
            />
          </>
        )}

        {(!isWizard || createStep === 1) && (
          <>
            <label className="text-xs font-black tracking-wide text-zinc-700">
              カテゴリ
            </label>
            <select
              className="input-retro"
              value={form.category}
              onChange={(e) => updateField("category", e.target.value)}
            >
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.id}（{option.label}）
                </option>
              ))}
            </select>

            <label className="text-xs font-black tracking-wide text-zinc-700">
              slug
            </label>
            <input
              className="input-retro"
              placeholder="nights-coffee"
              value={form.slug}
              onChange={(e) => updateField("slug", e.target.value)}
            />

            <label className="text-xs font-black tracking-wide text-zinc-700">
              公演タイトル
            </label>
            <input
              className="input-retro"
              placeholder="夜明けのコーヒー"
              value={form.title}
              onChange={(e) => updateField("title", e.target.value)}
            />
          </>
        )}

        {(!isWizard || createStep === 2) && (
          <>
            <label className="text-xs font-black tracking-wide text-zinc-700">
              情報公開日時（任意）
            </label>
            <input
              className="input-retro"
              placeholder="2026-02-01T10:00:00+09:00"
              value={form.publish_at}
              onChange={(e) => updateField("publish_at", e.target.value)}
            />

            <label className="text-xs font-black tracking-wide text-zinc-700">
              開始日時
            </label>
            <input
              className="input-retro"
              placeholder="2026-02-01T19:00:00+09:00"
              value={form.start_date}
              onChange={(e) => updateField("start_date", e.target.value)}
            />

            <label className="text-xs font-black tracking-wide text-zinc-700">
              終了日時（任意）
            </label>
            <input
              className="input-retro"
              placeholder="2026-02-03T21:00:00+09:00"
              value={form.end_date}
              onChange={(e) => updateField("end_date", e.target.value)}
            />

            <label className="text-xs font-black tracking-wide text-zinc-700">
              会場名（任意）
            </label>
            <input
              className="input-retro"
              placeholder="ぽんプラザホール"
              value={form.venue}
              onChange={(e) => updateField("venue", e.target.value)}
            />

            <label className="text-xs font-black tracking-wide text-zinc-700">
              会場住所（任意）
            </label>
            <input
              className="input-retro"
              placeholder="福岡市..."
              value={form.venue_address}
              onChange={(e) => updateField("venue_address", e.target.value)}
            />

            <label className="text-xs font-black tracking-wide text-zinc-700">
              一般料金（円・任意）
            </label>
            <input
              className="input-retro"
              placeholder="2500"
              value={form.price_general}
              onChange={(e) => updateField("price_general", e.target.value)}
            />

            <label className="text-xs font-black tracking-wide text-zinc-700">
              学生料金（円・任意）
            </label>
            <input
              className="input-retro"
              placeholder="2000"
              value={form.price_student}
              onChange={(e) => updateField("price_student", e.target.value)}
            />

            <label className="text-xs font-black tracking-wide text-zinc-700">
              予約開始日時（任意）
            </label>
            <input
              className="input-retro"
              placeholder="2026-01-20T10:00:00+09:00"
              value={form.reservation_start_at}
              onChange={(e) => updateField("reservation_start_at", e.target.value)}
            />

            <label className="text-xs font-black tracking-wide text-zinc-700">
              予約受付先（任意）
            </label>
            <input
              className="input-retro"
              placeholder="チケットぴあ / 劇団公式サイト"
              value={form.reservation_label}
              onChange={(e) => updateField("reservation_label", e.target.value)}
            />

            <label className="text-xs font-black tracking-wide text-zinc-700">
              予約ページURL（任意）
            </label>
            <input
              className="input-retro"
              placeholder="https://..."
              value={form.ticket_url}
              onChange={(e) => updateField("ticket_url", e.target.value)}
            />
          </>
        )}

        {(!isWizard || createStep === 3) && (
          <>
            <label className="text-xs font-black tracking-wide text-zinc-700">
              あらすじ（任意）
            </label>
            <textarea
              className="textarea-retro"
              placeholder="あらすじ..."
              value={form.description}
              onChange={(e) => updateField("description", e.target.value)}
            />

            <label className="text-xs font-black tracking-wide text-zinc-700">
              タグ（カンマ区切り）
            </label>
            <input
              className="input-retro"
              placeholder="学生歓迎, 感動"
              value={form.tags}
              onChange={(e) => updateField("tags", e.target.value)}
            />

            <label className="text-xs font-black tracking-wide text-zinc-700">
              キャスト（JSON配列）
            </label>
            <textarea
              className="textarea-retro font-mono text-xs"
              rows={4}
              placeholder='[{"name":"山田太郎","role":"主演","image_url":""}]'
              value={form.cast}
              onChange={(e) => updateField("cast", e.target.value)}
            />

            <label className="text-xs font-black tracking-wide text-zinc-700">
              ステータス
            </label>
            <select
              className="input-retro"
              value={form.status}
              onChange={(e) =>
                updateField("status", e.target.value as FormState["status"])
              }
            >
              <option value="draft">draft</option>
              <option value="published">published</option>
              <option value="archived">archived</option>
            </select>
          </>
        )}
      </div>

      {isWizard ? (
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setCreateStep((prev) => Math.max(prev - 1, 0))}
            disabled={createStep === 0}
            className="btn-retro btn-surface disabled:opacity-50"
          >
            前へ
          </button>
          {isLastCreateStep ? (
            <button
              onClick={submit}
              disabled={saving}
              className="btn-retro btn-ink disabled:opacity-50"
            >
              {saving ? "保存中..." : "公演を作成"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (!canContinueStep) {
                  setMessage("必須項目を入力してから次へ進んでください。");
                  return;
                }
                setMessage(null);
                setCreateStep((prev) =>
                  Math.min(prev + 1, CREATE_STEPS.length - 1)
                );
              }}
              className="btn-retro btn-ink"
            >
              次へ
            </button>
          )}
        </div>
      ) : (
        <button
          onClick={submit}
          disabled={saving}
          className="btn-retro btn-ink mt-4 w-full disabled:opacity-50"
        >
          {saving ? "保存中..." : "変更を保存"}
        </button>
      )}

      {createdId && (
        <p className="mt-2 text-xs text-zinc-700">
          作成後の編集はこちら: /events/{form.category}/{form.slug}/edit
        </p>
      )}
      {message && <p className="mt-2 text-xs text-zinc-700">{message}</p>}

      <div className="mt-6 rounded-2xl border-2 border-ink bg-surface-muted p-4 shadow-hard-sm">
        <h3 className="text-sm font-black">SNS宣伝文生成</h3>
        <p className="mt-1 text-xs text-zinc-700">
          公演情報をもとに宣伝文を自動生成します（保存後に利用可能）。
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-xs">
          {["twitter", "instagram", "facebook"].map((platform) => (
            <label key={platform} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={promotionPlatforms.includes(platform)}
                onChange={() => togglePlatform(platform)}
              />
              {platform}
            </label>
          ))}
        </div>
        <button
          type="button"
          onClick={generatePromotion}
          disabled={promotionLoading}
          className="btn-retro btn-ink mt-3 text-xs disabled:opacity-50"
        >
          {promotionLoading ? "生成中..." : "宣伝文を生成する"}
        </button>
        {promotionMessage && (
          <p className="mt-2 text-xs text-zinc-700">{promotionMessage}</p>
        )}
        {promotions.length > 0 && (
          <div className="mt-4 space-y-3">
            {promotions.map((promotion) => {
              const text = buildPromotionText(promotion);
              return (
                <div
                  key={promotion.platform}
                  className="rounded-2xl border-2 border-ink bg-surface p-3 shadow-hard-sm"
                >
                  <div className="flex items-center justify-between text-xs text-zinc-600">
                    <span>{promotion.platform}</span>
                    <button
                      type="button"
                      className="link-retro text-xs"
                      onClick={() => copyText(text)}
                    >
                      コピー
                    </button>
                  </div>
                  <pre className="mt-2 whitespace-pre-wrap text-xs text-zinc-800">
                    {text}
                  </pre>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

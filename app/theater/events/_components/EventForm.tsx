"use client";

import Image from "next/image";
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

type FormState = {
  category: string;
  slug: string;
  title: string;
  description: string;
  start_date: string;
  end_date: string;
  venue: string;
  venue_address: string;
  price_general: string;
  price_student: string;
  ticket_url: string;
  tags: string;
  cast: string;
  flyer_url: string;
  image_url: string;
  status: "draft" | "published" | "archived";
};

type EventData = {
  category?: string | null;
  slug?: string | null;
  title?: string | null;
  description?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  venue?: string | null;
  venue_address?: string | null;
  price_general?: number | null;
  price_student?: number | null;
  ticket_url?: string | null;
  tags?: string[] | null;
  cast?: unknown[] | null;
  flyer_url?: string | null;
  image_url?: string | null;
  status?: "draft" | "published" | "archived" | null;
};

const buildInitialState = (data?: EventData | null): FormState => ({
  category: data?.category ?? "comedy",
  slug: data?.slug ?? "",
  title: data?.title ?? "",
  description: data?.description ?? "",
  start_date: data?.start_date ?? "",
  end_date: data?.end_date ?? "",
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

  useEffect(() => {
    setForm(buildInitialState(initialData));
  }, [initialData]);

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
      start_date: form.start_date,
      end_date: form.end_date || null,
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

  return (
    <div className="rounded-xl border border-zinc-200 p-6">
      <h2 className="text-lg font-semibold">
        {mode === "create" ? "新規公演作成" : "公演編集"}
      </h2>
      <p className="mt-2 text-sm text-zinc-600">
        チラシ画像アップロード → AI解析 → 内容確認の流れです。
      </p>

      <div className="mt-4 grid gap-3 text-sm">
        <label className="text-xs text-zinc-600">チラシ画像</label>
        <input
          type="file"
          accept="image/*"
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
            className="rounded-md border border-zinc-200 px-3 py-2 text-sm disabled:opacity-50"
          >
            {analyzing ? "AI解析中..." : "AI解析を実行"}
          </button>
          <input
            className="flex-1 rounded-md border border-zinc-200 px-3 py-2"
            placeholder="flyer_url（自動入力）"
            value={form.flyer_url}
            onChange={(e) => updateField("flyer_url", e.target.value)}
          />
        </div>
        {flyerPreview && (
          <Image
            src={flyerPreview}
            alt="flyer preview"
            width={800}
            height={600}
            unoptimized
            className="max-h-64 rounded-md border border-zinc-200 object-contain"
          />
        )}
        {uploading && <p className="text-xs text-zinc-600">アップロード中...</p>}

        <label className="text-xs text-zinc-600">OGP画像URL（任意）</label>
        <input
          className="rounded-md border border-zinc-200 px-3 py-2"
          placeholder="image_url"
          value={form.image_url}
          onChange={(e) => updateField("image_url", e.target.value)}
        />

        <label className="text-xs text-zinc-600">カテゴリ</label>
        <select
          className="rounded-md border border-zinc-200 px-3 py-2"
          value={form.category}
          onChange={(e) => updateField("category", e.target.value)}
        >
          {CATEGORY_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.id}（{option.label}）
            </option>
          ))}
        </select>

        <label className="text-xs text-zinc-600">slug</label>
        <input
          className="rounded-md border border-zinc-200 px-3 py-2"
          placeholder="nights-coffee"
          value={form.slug}
          onChange={(e) => updateField("slug", e.target.value)}
        />

        <label className="text-xs text-zinc-600">公演タイトル</label>
        <input
          className="rounded-md border border-zinc-200 px-3 py-2"
          placeholder="夜明けのコーヒー"
          value={form.title}
          onChange={(e) => updateField("title", e.target.value)}
        />

        <label className="text-xs text-zinc-600">開始日時</label>
        <input
          className="rounded-md border border-zinc-200 px-3 py-2"
          placeholder="2026-02-01T19:00:00+09:00"
          value={form.start_date}
          onChange={(e) => updateField("start_date", e.target.value)}
        />

        <label className="text-xs text-zinc-600">終了日時（任意）</label>
        <input
          className="rounded-md border border-zinc-200 px-3 py-2"
          placeholder="2026-02-03T21:00:00+09:00"
          value={form.end_date}
          onChange={(e) => updateField("end_date", e.target.value)}
        />

        <label className="text-xs text-zinc-600">会場名（任意）</label>
        <input
          className="rounded-md border border-zinc-200 px-3 py-2"
          placeholder="ぽんプラザホール"
          value={form.venue}
          onChange={(e) => updateField("venue", e.target.value)}
        />

        <label className="text-xs text-zinc-600">会場住所（任意）</label>
        <input
          className="rounded-md border border-zinc-200 px-3 py-2"
          placeholder="福岡市..."
          value={form.venue_address}
          onChange={(e) => updateField("venue_address", e.target.value)}
        />

        <label className="text-xs text-zinc-600">一般料金（円・任意）</label>
        <input
          className="rounded-md border border-zinc-200 px-3 py-2"
          placeholder="2500"
          value={form.price_general}
          onChange={(e) => updateField("price_general", e.target.value)}
        />

        <label className="text-xs text-zinc-600">学生料金（円・任意）</label>
        <input
          className="rounded-md border border-zinc-200 px-3 py-2"
          placeholder="2000"
          value={form.price_student}
          onChange={(e) => updateField("price_student", e.target.value)}
        />

        <label className="text-xs text-zinc-600">チケットURL（任意）</label>
        <input
          className="rounded-md border border-zinc-200 px-3 py-2"
          placeholder="https://..."
          value={form.ticket_url}
          onChange={(e) => updateField("ticket_url", e.target.value)}
        />

        <label className="text-xs text-zinc-600">あらすじ（任意）</label>
        <textarea
          className="rounded-md border border-zinc-200 px-3 py-2"
          placeholder="あらすじ..."
          value={form.description}
          onChange={(e) => updateField("description", e.target.value)}
        />

        <label className="text-xs text-zinc-600">タグ（カンマ区切り）</label>
        <input
          className="rounded-md border border-zinc-200 px-3 py-2"
          placeholder="学生歓迎, 感動"
          value={form.tags}
          onChange={(e) => updateField("tags", e.target.value)}
        />

        <label className="text-xs text-zinc-600">キャスト（JSON配列）</label>
        <textarea
          className="rounded-md border border-zinc-200 px-3 py-2 font-mono text-xs"
          rows={4}
          placeholder='[{"name":"山田太郎","role":"主演","image_url":""}]'
          value={form.cast}
          onChange={(e) => updateField("cast", e.target.value)}
        />

        <label className="text-xs text-zinc-600">ステータス</label>
        <select
          className="rounded-md border border-zinc-200 px-3 py-2"
          value={form.status}
          onChange={(e) =>
            updateField("status", e.target.value as FormState["status"])
          }
        >
          <option value="draft">draft</option>
          <option value="published">published</option>
          <option value="archived">archived</option>
        </select>
      </div>

      <button
        onClick={submit}
        disabled={saving}
        className="mt-4 w-full rounded-md border border-zinc-900 bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {saving ? "保存中..." : mode === "create" ? "公演を作成" : "変更を保存"}
      </button>

      {createdId && (
        <p className="mt-2 text-xs text-zinc-600">
          作成後の編集はこちら: /theater/events/{createdId}
        </p>
      )}
      {message && <p className="mt-2 text-xs text-zinc-600">{message}</p>}

      <div className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <h3 className="text-sm font-semibold">SNS宣伝文生成</h3>
        <p className="mt-1 text-xs text-zinc-600">
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
          className="mt-3 rounded-md border border-zinc-900 bg-zinc-900 px-3 py-2 text-xs text-white disabled:opacity-50"
        >
          {promotionLoading ? "生成中..." : "宣伝文を生成する"}
        </button>
        {promotionMessage && (
          <p className="mt-2 text-xs text-zinc-600">{promotionMessage}</p>
        )}
        {promotions.length > 0 && (
          <div className="mt-4 space-y-3">
            {promotions.map((promotion) => {
              const text = buildPromotionText(promotion);
              return (
                <div key={promotion.platform} className="rounded-md border p-3">
                  <div className="flex items-center justify-between text-xs text-zinc-500">
                    <span>{promotion.platform}</span>
                    <button
                      type="button"
                      className="text-xs text-zinc-900 underline"
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

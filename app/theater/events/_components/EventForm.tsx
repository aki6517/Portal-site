"use client";

import NextImage from "next/image";
import { useEffect, useMemo, useState } from "react";

const CATEGORY_OPTIONS = [
  { id: "comedy", label: "コメディ" },
  { id: "conversation", label: "会話劇" },
  { id: "musical", label: "ミュージカル" },
  { id: "classic", label: "古典・時代劇" },
  { id: "action", label: "アクション" },
  { id: "serious", label: "シリアス" },
  { id: "drama", label: "ドラマ" },
  { id: "dance", label: "ダンス" },
  { id: "student", label: "学生演劇" },
  { id: "conte", label: "コント" },
  { id: "experimental", label: "実験的" },
  { id: "other", label: "その他" },
] as const;

const STATUS_OPTIONS = [
  { value: "published", label: "公開" },
  { value: "draft", label: "下書き" },
  { value: "archived", label: "非公開" },
] as const;

const FLYER_BUCKET = "flyers-public";
const CREATE_STEPS = ["画像", "基本", "日程・会場", "詳細・公開"] as const;

type CastMember = {
  name: string;
  role: string;
  image_url: string;
};

type ScheduleTime = {
  start_date: string;
  label: string;
};

type ReservationLink = {
  label: string;
  url: string;
};

type FormState = {
  categories: string[];
  slug: string;
  title: string;
  description: string;
  publish_at: string;
  schedule_times: ScheduleTime[];
  reservation_start_at: string;
  reservation_links: ReservationLink[];
  venue: string;
  venue_address: string;
  price_general: string;
  price_student: string;
  tags: string;
  cast: CastMember[];
  flyer_url: string;
  image_url: string;
  ai_confidence: string;
  status: "draft" | "published" | "archived";
};

type TextFieldKey = {
  [K in keyof FormState]: FormState[K] extends string ? K : never;
}[keyof FormState];

type EventData = {
  category?: string | null;
  categories?: string[] | null;
  slug?: string | null;
  title?: string | null;
  description?: string | null;
  publish_at?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  reservation_start_at?: string | null;
  reservation_label?: string | null;
  reservation_links?: { label?: string | null; url?: string | null }[] | null;
  schedule_times?: { start_date?: string | null; end_date?: string | null; label?: string | null }[] | null;
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

const emptyCastMember = (): CastMember => ({
  name: "",
  role: "",
  image_url: "",
});

const emptyScheduleTime = (): ScheduleTime => ({
  start_date: "",
  label: "",
});

const emptyReservationLink = (): ReservationLink => ({
  label: "",
  url: "",
});

const normalizeText = (value?: string | null) => (value ?? "").trim();

const normalizeCastMembers = (input?: unknown[] | null) => {
  if (!Array.isArray(input)) return [emptyCastMember()];
  const rows = input
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      return {
        name: normalizeText(String(record.name ?? "")),
        role: normalizeText(String(record.role ?? "")),
        image_url: normalizeText(String(record.image_url ?? "")),
      } satisfies CastMember;
    })
    .filter((item): item is CastMember => Boolean(item));
  return rows.length > 0 ? rows : [emptyCastMember()];
};

const toTokyoDateTimeInput = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return formatter.format(date).replace(" ", "T");
};

const toJstIso = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
    return `${trimmed}:00+09:00`;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(trimmed)) {
    return trimmed;
  }
  return trimmed;
};

const formatJapaneseDateTime = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}年${pick("month")}/${pick("day")}(${pick("weekday")})${pick("hour")}:${pick("minute")}〜`;
};

const normalizeScheduleTimes = (
  scheduleTimes?: { start_date?: string | null; end_date?: string | null; label?: string | null }[] | null,
  fallbackStartDate?: string | null
) => {
  const fromSchedule = Array.isArray(scheduleTimes)
    ? scheduleTimes
        .map((item) => ({
          start_date: toTokyoDateTimeInput(item.start_date ?? ""),
          label: normalizeText(item.label),
        }))
        .filter((item) => item.start_date)
    : [];

  if (fromSchedule.length > 0) return fromSchedule;
  if (!fallbackStartDate) return [emptyScheduleTime()];
  const fallback = toTokyoDateTimeInput(fallbackStartDate);
  return fallback ? [{ start_date: fallback, label: "" }] : [emptyScheduleTime()];
};

const normalizeReservationLinks = (data?: EventData | null) => {
  const fromArray = Array.isArray(data?.reservation_links)
    ? data.reservation_links
        .map((item) => ({
          label: normalizeText(item?.label),
          url: normalizeText(item?.url),
        }))
        .filter((item) => item.label || item.url)
    : [];

  if (fromArray.length > 0) return fromArray;

  const legacy = {
    label: normalizeText(data?.reservation_label),
    url: normalizeText(data?.ticket_url),
  };

  if (legacy.label || legacy.url) return [legacy];
  return [emptyReservationLink()];
};

const normalizeCategories = (data?: EventData | null) => {
  const list = Array.isArray(data?.categories)
    ? data.categories.map((item) => normalizeText(item))
    : [];
  const primary = normalizeText(data?.category);
  const merged = [...(primary ? [primary] : []), ...list].filter(Boolean);
  const unique = Array.from(new Set(merged));
  if (unique.length > 0) return unique;
  return ["comedy"];
};

const buildInitialState = (data?: EventData | null): FormState => ({
  categories: normalizeCategories(data),
  slug: data?.slug ?? "",
  title: data?.title ?? "",
  description: data?.description ?? "",
  publish_at: toTokyoDateTimeInput(data?.publish_at),
  schedule_times: normalizeScheduleTimes(data?.schedule_times, data?.start_date),
  reservation_start_at: toTokyoDateTimeInput(data?.reservation_start_at),
  reservation_links: normalizeReservationLinks(data),
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
  tags: Array.isArray(data?.tags) ? data.tags.join(", ") : "",
  cast: normalizeCastMembers(data?.cast),
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

  const updateField = (key: TextFieldKey, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const toggleCategory = (categoryId: string) => {
    setForm((prev) => {
      const exists = prev.categories.includes(categoryId);
      if (exists) {
        const next = prev.categories.filter((item) => item !== categoryId);
        return { ...prev, categories: next.length > 0 ? next : prev.categories };
      }
      return { ...prev, categories: [...prev.categories, categoryId] };
    });
  };

  const updateScheduleTime = (
    index: number,
    key: keyof ScheduleTime,
    value: string
  ) => {
    setForm((prev) => ({
      ...prev,
      schedule_times: prev.schedule_times.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [key]: value } : row
      ),
    }));
  };

  const addScheduleTime = () => {
    setForm((prev) => ({
      ...prev,
      schedule_times: [...prev.schedule_times, emptyScheduleTime()],
    }));
  };

  const removeScheduleTime = (index: number) => {
    setForm((prev) => {
      if (prev.schedule_times.length <= 1) return prev;
      return {
        ...prev,
        schedule_times: prev.schedule_times.filter((_, rowIndex) => rowIndex !== index),
      };
    });
  };

  const updateCast = (
    index: number,
    key: keyof CastMember,
    value: string
  ) => {
    setForm((prev) => ({
      ...prev,
      cast: prev.cast.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [key]: value } : row
      ),
    }));
  };

  const addCast = () => {
    setForm((prev) => ({
      ...prev,
      cast: [...prev.cast, emptyCastMember()],
    }));
  };

  const removeCast = (index: number) => {
    setForm((prev) => {
      if (prev.cast.length <= 1) return prev;
      return {
        ...prev,
        cast: prev.cast.filter((_, rowIndex) => rowIndex !== index),
      };
    });
  };

  const updateReservationLink = (
    index: number,
    key: keyof ReservationLink,
    value: string
  ) => {
    setForm((prev) => ({
      ...prev,
      reservation_links: prev.reservation_links.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [key]: value } : row
      ),
    }));
  };

  const addReservationLink = () => {
    setForm((prev) => ({
      ...prev,
      reservation_links: [...prev.reservation_links, emptyReservationLink()],
    }));
  };

  const removeReservationLink = (index: number) => {
    setForm((prev) => {
      if (prev.reservation_links.length <= 1) return prev;
      return {
        ...prev,
        reservation_links: prev.reservation_links.filter((_, rowIndex) => rowIndex !== index),
      };
    });
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
      setForm((prev) => {
        const aiCategory = normalizeText(result.category);
        const nextCategories = aiCategory
          ? [aiCategory, ...prev.categories.filter((item) => item !== aiCategory)]
          : prev.categories;
        const aiStartDate = toTokyoDateTimeInput(result.start_date ?? "");

        return {
          ...prev,
          title: result.title ?? prev.title,
          description: result.description ?? prev.description,
          schedule_times:
            aiStartDate && prev.schedule_times.every((item) => !item.start_date)
              ? [{ start_date: aiStartDate, label: "" }]
              : prev.schedule_times,
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
          categories: nextCategories,
          tags: Array.isArray(result.tags)
            ? result.tags.join(", ")
            : prev.tags,
          cast: Array.isArray(result.cast)
            ? normalizeCastMembers(result.cast)
            : prev.cast,
          ai_confidence:
            result.ai_confidence !== null && result.ai_confidence !== undefined
              ? String(result.ai_confidence)
              : prev.ai_confidence,
        };
      });
      setMessage("AI解析が完了しました。内容を確認してください。");
    } finally {
      setAnalyzing(false);
    }
  };

  const submit = async () => {
    const normalizedCategories = Array.from(
      new Set(form.categories.map((item) => normalizeText(item)).filter(Boolean))
    );
    if (normalizedCategories.length === 0) {
      setMessage("カテゴリを1つ以上選択してください。");
      return;
    }
    if (!form.slug.trim() || !form.title.trim()) {
      setMessage("URL用英字名と公演タイトルは必須です。");
      return;
    }

    const scheduleTimes = form.schedule_times
      .map((item) => ({
        start_date: toJstIso(item.start_date),
        end_date: null,
        label: normalizeText(item.label),
      }))
      .filter((item) => item.start_date)
      .sort((a, b) => a.start_date.localeCompare(b.start_date));

    if (scheduleTimes.length === 0) {
      setMessage("公演開始日時を1つ以上入力してください。");
      return;
    }

    const cast = form.cast
      .map((member) => ({
        name: normalizeText(member.name),
        role: normalizeText(member.role),
        image_url: normalizeText(member.image_url),
      }))
      .filter((member) => member.name || member.role || member.image_url);

    const reservationLinks = form.reservation_links
      .map((item) => ({
        label: normalizeText(item.label),
        url: normalizeText(item.url),
      }))
      .filter((item) => item.label || item.url);

    const primaryCategory = normalizedCategories[0] ?? "other";
    const firstReservation = reservationLinks[0] ?? null;

    setSaving(true);
    setMessage(null);
    setCreatedId(null);

    const payload = {
      category: primaryCategory,
      categories: normalizedCategories,
      slug: form.slug.trim(),
      title: form.title.trim(),
      publish_at: form.publish_at ? toJstIso(form.publish_at) : null,
      start_date: scheduleTimes[0].start_date,
      end_date: null,
      schedule_times: scheduleTimes,
      reservation_start_at: form.reservation_start_at
        ? toJstIso(form.reservation_start_at)
        : null,
      reservation_label: firstReservation?.label || null,
      reservation_links: reservationLinks,
      venue: form.venue || null,
      venue_address: form.venue_address || null,
      price_general: form.price_general ? Number(form.price_general) : null,
      price_student: form.price_student ? Number(form.price_student) : null,
      ticket_url: firstReservation?.url || null,
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
      return Boolean(
        form.slug.trim() && form.title.trim() && form.categories.length > 0
      );
    }
    if (createStep === 2) {
      return form.schedule_times.some((item) => item.start_date.trim().length > 0);
    }
    return true;
  })();

  const selectedCategoryLabels = form.categories.map((id) => {
    const found = CATEGORY_OPTIONS.find((item) => item.id === id);
    return found ? `${found.label} (${found.id})` : id;
  });

  const primaryCategory = form.categories[0] ?? "other";

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
              カテゴリ（複数選択）
            </label>
            <div className="rounded-2xl border-2 border-ink bg-surface p-3 shadow-hard-sm">
              <div className="grid gap-2 sm:grid-cols-2">
                {CATEGORY_OPTIONS.map((option) => {
                  const checked = form.categories.includes(option.id);
                  return (
                    <label
                      key={option.id}
                      className="flex items-center gap-2 rounded-lg border-2 border-ink/20 bg-white px-3 py-2 text-xs font-semibold"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCategory(option.id)}
                      />
                      <span>{option.label}</span>
                      <span className="text-zinc-500">({option.id})</span>
                    </label>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-zinc-600">
                先頭のカテゴリが公開URLに使われます。
              </p>
              <p className="mt-1 text-xs text-zinc-700">
                選択中: {selectedCategoryLabels.join(" / ")}
              </p>
            </div>

            <label className="text-xs font-black tracking-wide text-zinc-700">
              URL用英字名（スラッグ）
            </label>
            <input
              className="input-retro"
              placeholder="nights-coffee"
              value={form.slug}
              onChange={(e) => updateField("slug", e.target.value)}
            />
            <p className="text-xs text-zinc-600">
              公開URL: /events/{primaryCategory}/{form.slug || "your-slug"}
            </p>

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
              type="datetime-local"
              className="input-retro"
              value={form.publish_at}
              onChange={(e) => updateField("publish_at", e.target.value)}
            />

            <label className="text-xs font-black tracking-wide text-zinc-700">
              公演開始日時（複数）
            </label>
            <div className="space-y-3 rounded-2xl border-2 border-ink bg-surface p-3 shadow-hard-sm">
              {form.schedule_times.map((item, index) => {
                const iso = toJstIso(item.start_date);
                const preview = formatJapaneseDateTime(iso);
                return (
                  <div
                    key={`schedule-${index}`}
                    className="rounded-xl border-2 border-ink/20 bg-white p-3"
                  >
                    <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto] md:items-end">
                      <div>
                        <label className="text-[11px] font-bold text-zinc-700">
                          日時
                        </label>
                        <input
                          type="datetime-local"
                          className="input-retro"
                          value={item.start_date}
                          onChange={(e) =>
                            updateScheduleTime(index, "start_date", e.target.value)
                          }
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-bold text-zinc-700">
                          ラベル（任意）
                        </label>
                        <input
                          className="input-retro"
                          placeholder="昼公演 / 千秋楽"
                          value={item.label}
                          onChange={(e) =>
                            updateScheduleTime(index, "label", e.target.value)
                          }
                        />
                      </div>
                      <button
                        type="button"
                        className="btn-retro btn-surface h-11 border-red-500 text-red-700 disabled:opacity-40"
                        disabled={form.schedule_times.length <= 1}
                        onClick={() => removeScheduleTime(index)}
                      >
                        削除
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-zinc-700">
                      {preview || "例: 2026年2/10(火)10:00〜"}
                    </p>
                  </div>
                );
              })}
              <button
                type="button"
                className="btn-retro btn-surface text-xs"
                onClick={addScheduleTime}
              >
                公演日時を追加
              </button>
            </div>

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
              type="datetime-local"
              className="input-retro"
              value={form.reservation_start_at}
              onChange={(e) => updateField("reservation_start_at", e.target.value)}
            />

            <label className="text-xs font-black tracking-wide text-zinc-700">
              予約窓口（複数）
            </label>
            <div className="space-y-3 rounded-2xl border-2 border-ink bg-surface p-3 shadow-hard-sm">
              {form.reservation_links.map((item, index) => (
                <div
                  key={`reservation-${index}`}
                  className="rounded-xl border-2 border-ink/20 bg-white p-3"
                >
                  <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto] md:items-end">
                    <div>
                      <label className="text-[11px] font-bold text-zinc-700">
                        予約受付先
                      </label>
                      <input
                        className="input-retro"
                        placeholder="チケットぴあ / 劇団公式サイト"
                        value={item.label}
                        onChange={(e) =>
                          updateReservationLink(index, "label", e.target.value)
                        }
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-bold text-zinc-700">
                        予約ページURL
                      </label>
                      <input
                        className="input-retro"
                        placeholder="https://..."
                        value={item.url}
                        onChange={(e) =>
                          updateReservationLink(index, "url", e.target.value)
                        }
                      />
                    </div>
                    <button
                      type="button"
                      className="btn-retro btn-surface h-11 border-red-500 text-red-700 disabled:opacity-40"
                      disabled={form.reservation_links.length <= 1}
                      onClick={() => removeReservationLink(index)}
                    >
                      削除
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="btn-retro btn-surface text-xs"
                onClick={addReservationLink}
              >
                予約窓口を追加
              </button>
            </div>
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
              キャスト
            </label>
            <div className="space-y-3 rounded-2xl border-2 border-ink bg-surface p-3 shadow-hard-sm">
              {form.cast.map((member, index) => (
                <div
                  key={`cast-${index}`}
                  className="rounded-xl border-2 border-ink/20 bg-white p-3"
                >
                  <div className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
                    <div>
                      <label className="text-[11px] font-bold text-zinc-700">
                        名前
                      </label>
                      <input
                        className="input-retro"
                        placeholder="山田太郎"
                        value={member.name}
                        onChange={(e) => updateCast(index, "name", e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-bold text-zinc-700">
                        役柄（任意）
                      </label>
                      <input
                        className="input-retro"
                        placeholder="主演"
                        value={member.role}
                        onChange={(e) => updateCast(index, "role", e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-bold text-zinc-700">
                        画像URL（任意）
                      </label>
                      <input
                        className="input-retro"
                        placeholder="https://..."
                        value={member.image_url}
                        onChange={(e) => updateCast(index, "image_url", e.target.value)}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn-retro btn-surface h-11 border-red-500 text-red-700 disabled:opacity-40"
                      disabled={form.cast.length <= 1}
                      onClick={() => removeCast(index)}
                    >
                      削除
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="btn-retro btn-surface text-xs"
                onClick={addCast}
              >
                キャストを追加
              </button>
            </div>

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
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
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
          作成後の編集はこちら: /events/{primaryCategory}/{form.slug}/edit
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

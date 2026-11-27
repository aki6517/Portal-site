import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

// 劇団向けの画面は応答の error.message をそのまま表示するので、message は劇団の人が読んで次に何をすれば
// いいか分かる日本語にする（error.code と HTTP ステータスは機械が読む値なので変えない）。
// DB などのエラー文は応答に出さず、サーバーのログ（console.error）に code・message を残す。
const LOGIN_REQUIRED_MESSAGE =
  "ログインが必要です。ログインし直してから、もう一度お試しください。";
const RATE_LIMITED_MESSAGE =
  "短い時間に何度も送られました。1分ほど待ってから、もう一度お試しください。";
const INVALID_FORM_MESSAGE =
  "送られたファイルを読み取れませんでした。画像を選び直してから、もう一度お試しください。";
const FILE_REQUIRED_MESSAGE =
  "アップロードする画像を選んでください。";
const FILE_TOO_LARGE_MESSAGE =
  "画像は5MB以下にしてください。";
const UNSUPPORTED_TYPE_MESSAGE =
  "画像は jpg・png・webp のどれかにしてください。";
const UPLOAD_FAILED_MESSAGE =
  "画像を保存できませんでした。時間をおいてもう一度お試しください。続く場合は福岡アクトポータル運営にお問い合わせください。";

export const runtime = "nodejs";

const PRIMARY_BUCKET = "flyers-public";
const BUCKET_CANDIDATES = Array.from(
  new Set([PRIMARY_BUCKET, "flyers"])
).filter(Boolean);
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const toNumericStatusCode = (value?: string | number | null) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const isBucketNotFound = (message?: string | null) =>
  typeof message === "string" &&
  /bucket.*not.*found|not\s+found/i.test(message);

const isAlreadyExistsError = (message?: string | null) =>
  typeof message === "string" && /(already exists|duplicate)/i.test(message);

const ensureBucketReady = async (
  serviceClient: ReturnType<typeof createSupabaseServiceClient>,
  bucket: string
) => {
  const { data, error } = await serviceClient.storage.getBucket(bucket);
  if (!error && data) {
    if (data.public) return;
    const updated = await serviceClient.storage.updateBucket(bucket, {
      public: true,
    });
    if (updated.error) {
      console.error("[storage/flyers] updateBucket failed", {
        bucket,
        message: updated.error.message,
      });
    }
    return;
  }

  if (!isBucketNotFound(error?.message)) {
    if (error) {
      console.error("[storage/flyers] getBucket failed", {
        bucket,
        message: error.message,
      });
    }
    return;
  }

  const created = await serviceClient.storage.createBucket(bucket, {
    public: true,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    fileSizeLimit: "5MB",
  });
  if (created.error && !isAlreadyExistsError(created.error.message)) {
    console.error("[storage/flyers] createBucket failed", {
      bucket,
      message: created.error.message,
    });
  }
};

const getClientKey = (req: Request, userId: string) => {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const ip =
    forwarded.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  return `${userId}:${ip}`;
};

const checkRateLimit = (key: string) => {
  const now = Date.now();
  const existing = rateLimitStore.get(key);
  if (!existing || existing.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { ok: true, retryAfter: 0 };
  }
  if (existing.count >= RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((existing.resetAt - now) / 1000);
    return { ok: false, retryAfter };
  }
  existing.count += 1;
  rateLimitStore.set(key, existing);
  return { ok: true, retryAfter: 0 };
};

export async function POST(req: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: LOGIN_REQUIRED_MESSAGE } },
        { status: 401 }
      );
    }

    const rateKey = getClientKey(req, user.id);
    const limit = checkRateLimit(rateKey);
    if (!limit.ok) {
      return NextResponse.json(
        {
          error: {
            code: "RATE_LIMITED",
            message: RATE_LIMITED_MESSAGE,
          },
        },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
      );
    }

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json(
        { error: { code: "INVALID_FORM", message: INVALID_FORM_MESSAGE } },
        { status: 400 }
      );
    }

    const file = formData.get("file");
    const isBlobLike =
      !!file &&
      typeof file === "object" &&
      "arrayBuffer" in file &&
      "size" in file &&
      "type" in file;

    if (!isBlobLike) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: FILE_REQUIRED_MESSAGE } },
        { status: 400 }
      );
    }
    const uploadFile = file as Blob & { name?: string };

    if (uploadFile.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        {
          error: {
            code: "FILE_TOO_LARGE",
            message: FILE_TOO_LARGE_MESSAGE,
          },
        },
        { status: 413 }
      );
    }

    let ext = uploadFile.type ? EXT_BY_CONTENT_TYPE[uploadFile.type] : undefined;
    if (!ext) {
      const guessed = (uploadFile.name ?? "").split(".").pop()?.toLowerCase() ?? "";
      if (guessed && CONTENT_TYPE_BY_EXT[guessed]) {
        ext = guessed === "jpeg" ? "jpg" : guessed;
      }
    }

    if (!ext) {
      return NextResponse.json(
        {
          error: {
            code: "UNSUPPORTED_TYPE",
            message: UNSUPPORTED_TYPE_MESSAGE,
          },
        },
        { status: 400 }
      );
    }

    const safeExt = ext.replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `flyers/${crypto.randomUUID()}.${safeExt}`;
    const contentType =
      EXT_BY_CONTENT_TYPE[uploadFile.type] ??
      CONTENT_TYPE_BY_EXT[safeExt] ??
      "image/jpeg";

    const serviceClient = process.env.SUPABASE_SERVICE_ROLE_KEY
      ? createSupabaseServiceClient()
      : null;
    if (serviceClient) {
      for (const bucket of BUCKET_CANDIDATES) {
        await ensureBucketReady(serviceClient, bucket);
      }
    }
    const clients = serviceClient ? [serviceClient, supabase] : [supabase];
    const uploadBuckets = serviceClient ? BUCKET_CANDIDATES : [PRIMARY_BUCKET];

    const uploadErrors: Array<{
      bucket: string;
      statusCode?: string | number;
      message?: string;
    }> = [];

    for (const bucket of uploadBuckets) {
      for (const client of clients) {
        try {
          const { error } = await client.storage.from(bucket).upload(path, uploadFile, {
            contentType,
            upsert: false,
          });
          if (!error) {
            const { data } = client.storage.from(bucket).getPublicUrl(path);
            return NextResponse.json({
              data: {
                bucket,
                path,
                public_url: data.publicUrl,
              },
            });
          }
          uploadErrors.push({
            bucket,
            statusCode: error.statusCode,
            message: error.message,
          });
        } catch (error) {
          uploadErrors.push({
            bucket,
            message: error instanceof Error ? error.message : "unknown upload error",
          });
        }
      }
    }

    const lastError = uploadErrors.at(-1) ?? null;
    const statusCode = toNumericStatusCode(lastError?.statusCode);
    const status =
      statusCode === 409
        ? 409
        : statusCode === 400
          ? 400
          : statusCode === 404
            ? 404
            : statusCode === 413
              ? 413
              : statusCode === 429
                ? 429
          : statusCode === 401 || statusCode === 403
            ? 403
            : 500;

    // 保存先の設定の手がかり（英語）は、応答ではなくサーバーのログに残す
    const missingBucketHint =
      status === 404
        ? serviceClient
          ? "Storage bucket not found. Confirm bucket configuration in Supabase."
          : "Storage bucket not found. Configure SUPABASE_SERVICE_ROLE_KEY or create bucket flyers-public."
        : null;

    console.error("[storage/flyers] upload failed", {
      path,
      statusCode: lastError?.statusCode,
      message: lastError?.message,
      hint: missingBucketHint,
      attempts: uploadErrors,
    });

    return NextResponse.json(
      {
        error: {
          code: "STORAGE_ERROR",
          message: UPLOAD_FAILED_MESSAGE,
          status_code: statusCode,
        },
      },
      { status }
    );
  } catch (error) {
    console.error("[storage/flyers] fatal error", error);
    return NextResponse.json(
      {
        error: {
          code: "STORAGE_FATAL",
          message: UPLOAD_FAILED_MESSAGE,
        },
      },
      { status: 500 }
    );
  }
}

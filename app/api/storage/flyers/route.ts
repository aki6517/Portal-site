import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const BUCKET = "flyers-public";
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
        { error: { code: "UNAUTHORIZED", message: "Login required" } },
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
            message: "Too many requests",
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
        { error: { code: "INVALID_FORM", message: "Invalid form data" } },
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
        { error: { code: "VALIDATION_ERROR", message: "file is required" } },
        { status: 400 }
      );
    }
    const uploadFile = file as Blob & { name?: string };

    if (uploadFile.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        {
          error: {
            code: "FILE_TOO_LARGE",
            message: "file size must be 5MB or less",
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
            message: "Only jpg, png, webp files are allowed",
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
    const buffer = Buffer.from(await uploadFile.arrayBuffer());

    const clients = [supabase];
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      clients.unshift(createSupabaseServiceClient());
    }

    let uploadError:
      | { statusCode?: string | number; message?: string }
      | null = null;

    for (const client of clients) {
      const { error } = await client.storage
        .from(BUCKET)
        .upload(path, buffer, { contentType, upsert: false });
      if (!error) {
        const { data } = client.storage.from(BUCKET).getPublicUrl(path);
        return NextResponse.json({
          data: {
            bucket: BUCKET,
            path,
            public_url: data.publicUrl,
          },
        });
      }
      uploadError = { statusCode: error.statusCode, message: error.message };
    }

    const statusCode = toNumericStatusCode(uploadError?.statusCode);
    const status =
      statusCode === 409
        ? 409
        : statusCode === 400
          ? 400
          : statusCode === 401 || statusCode === 403
            ? 403
            : 500;

    console.error("[storage/flyers] upload failed", {
      statusCode: uploadError?.statusCode,
      message: uploadError?.message,
    });

    return NextResponse.json(
      {
        error: {
          code: "STORAGE_ERROR",
          message:
            uploadError?.message ??
            "Storage upload failed. Check bucket name/policy/env settings.",
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
          message: error instanceof Error ? error.message : "Unexpected storage error",
        },
      },
      { status: 500 }
    );
  }
}

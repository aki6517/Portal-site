import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

const getClientIp = (req: Request) => {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  return (
    forwarded.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
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

const isValidEmail = (email: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export async function POST(req: Request) {
  let payload: {
    name?: string;
    email?: string;
    message?: string;
    recaptcha_token?: string;
  };
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Request body is invalid" } },
      { status: 400 }
    );
  }

  const name = payload.name?.trim();
  const email = payload.email?.trim();
  const message = payload.message?.trim();
  const recaptchaToken = payload.recaptcha_token?.trim();

  if (!name || !email || !message || !recaptchaToken) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "name, email, message, recaptcha_token are required",
        },
      },
      { status: 400 }
    );
  }

  if (!isValidEmail(email)) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "email format is invalid",
        },
      },
      { status: 400 }
    );
  }

  if (message.length > 4000) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "message is too long",
        },
      },
      { status: 400 }
    );
  }

  const ip = getClientIp(req);
  const limit = checkRateLimit(ip);
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

  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) {
    return NextResponse.json(
      {
        error: {
          code: "SERVER_CONFIG_ERROR",
          message: "RECAPTCHA_SECRET_KEY is not set",
        },
      },
      { status: 500 }
    );
  }

  try {
    const body = new URLSearchParams({
      secret,
      response: recaptchaToken,
      remoteip: ip,
    });

    const verifyRes = await fetch(
      "https://www.google.com/recaptcha/api/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      }
    );

    if (!verifyRes.ok) {
      const text = await verifyRes.text();
      return NextResponse.json(
        { error: { code: "RECAPTCHA_ERROR", message: text } },
        { status: 500 }
      );
    }

    const data = (await verifyRes.json()) as {
      success?: boolean;
      score?: number;
      action?: string;
    };

    if (!data.success || (data.score ?? 0) < 0.5) {
      return NextResponse.json(
        {
          error: {
            code: "RECAPTCHA_FAILED",
            message: "reCAPTCHA verification failed",
          },
        },
        { status: 400 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: "RECAPTCHA_ERROR",
          message:
            error instanceof Error ? error.message : "reCAPTCHA error",
        },
      },
      { status: 500 }
    );
  }

  const service = createSupabaseServiceClient();
  const { data: saved, error: insertError } = await service
    .from("contact_messages")
    .insert({
      name,
      email,
      message,
      ip,
      user_agent: req.headers.get("user-agent"),
      status: "new",
    })
    .select("id")
    .single();

  if (insertError || !saved) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: insertError?.message } },
      { status: 500 }
    );
  }

  const resendKey = process.env.RESEND_API_KEY;
  const contactTo = process.env.CONTACT_TO_EMAIL;
  const contactFrom = process.env.CONTACT_FROM_EMAIL;

  if (!resendKey || !contactTo || !contactFrom) {
    return NextResponse.json({
      data: { ok: true, contact_id: saved.id, email_sent: false },
    });
  }

  const emailText = [
    "お問い合わせを受け付けました。",
    "",
    `名前: ${name}`,
    `メール: ${email}`,
    `内容: ${message}`,
    "",
    `IP: ${ip}`,
    `User-Agent: ${req.headers.get("user-agent") ?? ""}`,
    `ID: ${saved.id}`,
    `日時: ${new Date().toISOString()}`,
  ].join("\n");

  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: contactFrom,
      to: contactTo,
      subject: `【Fukuoka Stage】お問い合わせ: ${name}`,
      text: emailText,
    }),
  });

  if (!emailRes.ok) {
    const text = await emailRes.text();
    console.warn("[contact] email send failed", { contact_id: saved.id, text });
    return NextResponse.json({
      data: { ok: true, contact_id: saved.id, email_sent: false },
    });
  }

  return NextResponse.json({
    data: { ok: true, contact_id: saved.id, email_sent: true },
  });
}

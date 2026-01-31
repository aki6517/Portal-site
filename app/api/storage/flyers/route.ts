import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const BUCKET = "flyers-public";

export async function POST(req: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
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
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "file is required" } },
      { status: 400 }
    );
  }

  const requestedExt = formData.get("ext");
  const ext =
    typeof requestedExt === "string" && requestedExt.trim()
      ? requestedExt.trim().toLowerCase()
      : file.name.split(".").pop()?.toLowerCase() || "jpg";
  const safeExt = ext.replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `flyers/${crypto.randomUUID()}.${safeExt}`;
  const contentType = file.type || "image/jpeg";

  const buffer = Buffer.from(await file.arrayBuffer());
  const service = createSupabaseServiceClient();
  const { error } = await service.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType, upsert: false });

  if (error) {
    const status = error.statusCode === "409" ? 409 : 500;
    return NextResponse.json(
      { error: { code: "STORAGE_ERROR", message: error.message } },
      { status }
    );
  }

  const { data } = service.storage.from(BUCKET).getPublicUrl(path);

  return NextResponse.json({
    data: {
      bucket: BUCKET,
      path,
      public_url: data.publicUrl,
    },
  });
}

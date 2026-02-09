import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const emptyData = {
  head_tag: null as string | null,
  body_start_tag: null as string | null,
  body_end_tag: null as string | null,
  updated_at: null as string | null,
};

export async function GET() {
  try {
    const service = createSupabaseServiceClient();
    const { data, error } = await service
      .from("site_settings")
      .select("head_tag, body_start_tag, body_end_tag, updated_at")
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { data: emptyData },
        {
          headers: {
            "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
          },
        }
      );
    }

    return NextResponse.json(
      { data: data ?? emptyData },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      }
    );
  } catch {
    return NextResponse.json(
      { data: emptyData },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      }
    );
  }
}

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Login required" } },
      { status: 401 }
    );
  }

  const { data: member, error: memberError } = await supabase
    .from("theater_members")
    .select("theater_id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (memberError) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: memberError.message } },
      { status: 500 }
    );
  }

  if (!member) {
    return NextResponse.json({ data: { theater: null, member: null } });
  }

  const { data: theater, error: theaterError } = await supabase
    .from("theaters")
    .select("id, name, status")
    .eq("id", member.theater_id)
    .single();

  if (theaterError) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: theaterError.message } },
      { status: 500 }
    );
  }

  return NextResponse.json({ data: { theater, member } });
}

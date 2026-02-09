import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveActiveTheater } from "@/lib/theater/activeTheater";

type InvitePayload = {
  email?: string;
  inviteId?: string;
};

const isValidEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export async function POST(req: Request) {
  let payload: InvitePayload;
  try {
    payload = (await req.json()) as InvitePayload;
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Request body is invalid" } },
      { status: 400 }
    );
  }

  const email = payload.email?.trim().toLowerCase();
  if (!email || !isValidEmail(email)) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "email is required",
        },
      },
      { status: 400 }
    );
  }

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

  const service = createSupabaseServiceClient();
  const resolved = await resolveActiveTheater(user.id);
  const member = resolved.activeMembership;

  if (!member) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Not a theater member" } },
      { status: 403 }
    );
  }

  if (member.role !== "owner") {
    return NextResponse.json(
      {
        error: { code: "FORBIDDEN", message: "Owner only" },
      },
      { status: 403 }
    );
  }

  const { count: memberCount } = await service
    .from("theater_members")
    .select("*", { count: "exact", head: true })
    .eq("theater_id", member.theater_id);

  const { count: inviteCount } = await service
    .from("theater_invites")
    .select("*", { count: "exact", head: true })
    .eq("theater_id", member.theater_id)
    .eq("status", "pending");

  if ((memberCount ?? 0) + (inviteCount ?? 0) >= 2) {
    return NextResponse.json(
      {
        error: {
          code: "LIMIT_REACHED",
          message: "この劇団に登録できるメールは最大2件までです",
        },
      },
      { status: 409 }
    );
  }

  const { error: inviteError } = await service
    .from("theater_invites")
    .insert({
      theater_id: member.theater_id,
      email,
      status: "pending",
    })
    .select("id")
    .single();

  if (inviteError) {
    if (inviteError.code === "23505") {
      return NextResponse.json(
        {
          error: {
            code: "ALREADY_EXISTS",
            message: "このメールはすでに追加されています",
          },
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      {
        error: {
          code: "DB_ERROR",
          message: inviteError.message,
        },
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ data: { email } }, { status: 201 });
}

export async function DELETE(req: Request) {
  let payload: InvitePayload;
  try {
    payload = (await req.json()) as InvitePayload;
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Request body is invalid" } },
      { status: 400 }
    );
  }

  const inviteId = payload.inviteId;
  if (!inviteId) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "inviteId is required" } },
      { status: 400 }
    );
  }

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

  const service = createSupabaseServiceClient();
  const resolved = await resolveActiveTheater(user.id);
  const member = resolved.activeMembership;

  if (!member || member.role !== "owner") {
    return NextResponse.json(
      {
        error: { code: "FORBIDDEN", message: "Owner only" },
      },
      { status: 403 }
    );
  }

  const { error: delError } = await service
    .from("theater_invites")
    .delete()
    .eq("id", inviteId)
    .eq("theater_id", member.theater_id);

  if (delError) {
    return NextResponse.json(
      {
        error: {
          code: "DB_ERROR",
          message: delError.message,
        },
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ data: { deleted: true } }, { status: 200 });
}

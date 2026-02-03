import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

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

  const service = createSupabaseServiceClient();

  const { data: member, error: memberError } = await service
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

  let resolvedMember = member;
  let pendingInvite: { id: string; theater_id: string } | null = null;
  let joinedFromInvite = false;

  if (!resolvedMember && user.email) {
    const { data: invite } = await service
      .from("theater_invites")
      .select("id, theater_id, status")
      .ilike("email", user.email)
      .eq("status", "pending")
      .maybeSingle();

    if (invite) {
      pendingInvite = { id: invite.id, theater_id: invite.theater_id };
      const { count: memberCount } = await service
        .from("theater_members")
        .select("*", { count: "exact", head: true })
        .eq("theater_id", invite.theater_id);
      const { count: inviteCount } = await service
        .from("theater_invites")
        .select("*", { count: "exact", head: true })
        .eq("theater_id", invite.theater_id)
        .eq("status", "pending");

      const total = (memberCount ?? 0) + (inviteCount ?? 0);
      if (total <= 2) {
        const { data: insertedMember, error: insertError } = await service
          .from("theater_members")
          .insert({
            theater_id: invite.theater_id,
            user_id: user.id,
            role: "editor",
          })
          .select("theater_id, role")
          .maybeSingle();

        if (!insertError && insertedMember) {
          await service
            .from("theater_invites")
            .update({ status: "accepted" })
            .eq("id", invite.id);
          resolvedMember = insertedMember;
          joinedFromInvite = true;
        }
      }
    }
  }

  if (!resolvedMember) {
    return NextResponse.json({
      data: { theater: null, member: null, pendingInvite },
    });
  }

  const { data: theater, error: theaterError } = await supabase
    .from("theaters")
    .select("id, name, status")
    .eq("id", resolvedMember.theater_id)
    .single();

  if (theaterError) {
    return NextResponse.json(
      { error: { code: "DB_ERROR", message: theaterError.message } },
      { status: 500 }
    );
  }

  const [{ count: memberCount }, { count: inviteCount }] = await Promise.all([
    service
      .from("theater_members")
      .select("*", { count: "exact", head: true })
      .eq("theater_id", resolvedMember.theater_id),
    service
      .from("theater_invites")
      .select("*", { count: "exact", head: true })
      .eq("theater_id", resolvedMember.theater_id)
      .eq("status", "pending"),
  ]);

  const { data: invites } = await service
    .from("theater_invites")
    .select("id, email, status, created_at")
    .eq("theater_id", resolvedMember.theater_id)
    .order("created_at", { ascending: false });

  return NextResponse.json({
    data: {
      theater,
      member: resolvedMember,
      stats: {
        memberCount: memberCount ?? 0,
        inviteCount: inviteCount ?? 0,
        totalAllowed: 2,
      },
      invites: invites ?? [],
      joinedFromInvite,
      pendingInvite,
    },
  });
}

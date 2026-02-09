import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveActiveTheater } from "@/lib/theater/activeTheater";

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
  let pendingInvite: { id: string; theater_id: string } | null = null;
  let joinedFromInvite = false;

  const initialResolved = await resolveActiveTheater(user.id);

  if (user.email) {
    const { data: invite } = await service
      .from("theater_invites")
      .select("id, theater_id, status")
      .ilike("email", user.email)
      .eq("status", "pending")
      .maybeSingle();

    if (invite) {
      pendingInvite = { id: invite.id, theater_id: invite.theater_id };
      const alreadyMember = initialResolved.memberships.some(
        (member) => member.theater_id === invite.theater_id
      );
      if (!alreadyMember) {
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
          const { error: insertError } = await service
            .from("theater_members")
            .insert({
              theater_id: invite.theater_id,
              user_id: user.id,
              role: "editor",
            })
            .select("theater_id, role")
            .maybeSingle();

          if (!insertError) {
            await service
              .from("theater_invites")
              .update({ status: "accepted" })
              .eq("id", invite.id);
            joinedFromInvite = true;
          }
        }
      }
    }
  }

  const resolved = await resolveActiveTheater(user.id);

  if (!resolved.activeMembership || !resolved.activeTheaterId) {
    return NextResponse.json({
      data: {
        theater: null,
        member: null,
        pendingInvite,
        theaters: [],
        active_theater_id: null,
      },
    });
  }

  const activeTheater =
    resolved.activeMembership.theater ??
    (await supabase
      .from("theaters")
      .select("id, name, status")
      .eq("id", resolved.activeTheaterId)
      .single()).data;

  const [{ count: memberCount }, { count: inviteCount }] = await Promise.all([
    service
      .from("theater_members")
      .select("*", { count: "exact", head: true })
      .eq("theater_id", resolved.activeTheaterId),
    service
      .from("theater_invites")
      .select("*", { count: "exact", head: true })
      .eq("theater_id", resolved.activeTheaterId)
      .eq("status", "pending"),
  ]);

  const { data: invites } = await service
    .from("theater_invites")
    .select("id, email, status, created_at")
    .eq("theater_id", resolved.activeTheaterId)
    .order("created_at", { ascending: false });

  return NextResponse.json({
    data: {
      theater: activeTheater ?? null,
      member: resolved.activeMembership,
      theaters: resolved.theaters,
      active_theater_id: resolved.activeTheaterId,
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

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveActiveTheater } from "@/lib/theater/activeTheater";

// 同じメール宛ての保留中の招待を、1 回の呼び出しで何件まで見るか
const MAX_PENDING_INVITES_TO_CHECK = 10;

const isValidCount = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

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

  // 招待は作成時（app/api/theater/invite）に trim().toLowerCase() で保存している。
  // ilike は「_」「%」をワイルドカードにして別人のメールにも一致するため、正規化して完全一致で照合する。
  const normalizedEmail = user.email?.trim().toLowerCase();

  if (normalizedEmail) {
    // 同じメール宛ての保留中の招待は、古い順（created_at → id）に少数だけ取って順に見る。
    // 本人が所属済みの劇団・定員を超える劇団の招待は飛ばし、受諾できる最初の 1 件だけを受諾する。
    // 飛ばした招待・ほかの招待は保留のまま残す（書き換えない）。
    const { data: invites } = await service
      .from("theater_invites")
      .select("id, theater_id, status")
      .eq("email", normalizedEmail)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(MAX_PENDING_INVITES_TO_CHECK);

    const candidates: { id: string; theater_id: string }[] = invites ?? [];
    const isMemberOf = (theaterId: string) =>
      initialResolved.memberships.some(
        (member) => member.theater_id === theaterId
      );
    let acceptedInvite: { id: string; theater_id: string } | null = null;

    for (const invite of candidates) {
      if (isMemberOf(invite.theater_id)) continue;

      const { count: memberCount, error: memberCountError } = await service
        .from("theater_members")
        .select("*", { count: "exact", head: true })
        .eq("theater_id", invite.theater_id);
      const { count: inviteCount, error: inviteCountError } = await service
        .from("theater_invites")
        .select("*", { count: "exact", head: true })
        .eq("theater_id", invite.theater_id)
        .eq("status", "pending");

      // 件数が取れないと定員を確かめられないので、所属を足さずにここで打ち切る（0 件扱いにしない）。
      // error が無くても、Content-Range が無いと count は null、"*" だと NaN になるため、0 以上の整数だけを信じる
      if (
        memberCountError ||
        inviteCountError ||
        !isValidCount(memberCount) ||
        !isValidCount(inviteCount)
      ) {
        break;
      }

      const total = memberCount + inviteCount;
      if (total > 2) continue;

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
        acceptedInvite = invite;
      }
      // 1 回の呼び出しで足す所属は 1 件まで（追加に失敗しても次の招待は試さない）
      break;
    }

    // pendingInvite は「このメール宛てで対象にした保留中の招待」: 受諾したもの → 本人がまだ所属していない最も古いもの → 最も古いもの
    // （招待が 1 件だけのときは以前と同じ値になる。画面 app/register は所属が無いときの「有効化しています」表示にだけ使う）
    const targetInvite =
      acceptedInvite ??
      candidates.find((invite) => !isMemberOf(invite.theater_id)) ??
      candidates[0] ??
      null;
    if (targetInvite) {
      pendingInvite = { id: targetInvite.id, theater_id: targetInvite.theater_id };
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

import { createSupabaseServiceClient } from "@/lib/supabase/service";

type TheaterInfo = {
  id: string;
  name: string;
  status: string;
};

export type TheaterMembership = {
  theater_id: string;
  role: string;
  created_at?: string | null;
  theater?: TheaterInfo | null;
};

type ActiveTheaterResult = {
  activeTheaterId: string | null;
  activeMembership: TheaterMembership | null;
  theaters: Array<{
    id: string;
    name: string;
    status: string;
    role: string;
  }>;
  memberships: TheaterMembership[];
};

const fetchMemberships = async (userId: string) => {
  const service = createSupabaseServiceClient();
  const { data } = await service
    .from("theater_members")
    .select("theater_id, role, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  return (data ?? []) as TheaterMembership[];
};

const attachTheaters = async (memberships: TheaterMembership[]) => {
  if (memberships.length === 0) return [];
  const service = createSupabaseServiceClient();
  const theaterIds = Array.from(
    new Set(memberships.map((member) => member.theater_id))
  );
  const { data: theaters } = await service
    .from("theaters")
    .select("id, name, status")
    .in("id", theaterIds);
  const theaterMap = new Map(
    (theaters ?? []).map((theater) => [theater.id, theater])
  );
  return memberships.map((member) => ({
    ...member,
    theater: theaterMap.get(member.theater_id) ?? null,
  }));
};

const getActiveTheaterSetting = async (userId: string) => {
  try {
    const service = createSupabaseServiceClient();
    const { data } = await service
      .from("user_settings")
      .select("active_theater_id")
      .eq("user_id", userId)
      .maybeSingle();
    return data?.active_theater_id ?? null;
  } catch {
    return null;
  }
};

const upsertActiveTheaterSetting = async (
  userId: string,
  activeTheaterId: string
) => {
  try {
    const service = createSupabaseServiceClient();
    await service
      .from("user_settings")
      .upsert(
        {
          user_id: userId,
          active_theater_id: activeTheaterId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
  } catch {
    // ignore
  }
};

export const resolveActiveTheater = async (
  userId: string
): Promise<ActiveTheaterResult> => {
  const membershipsRaw = await fetchMemberships(userId);
  const memberships = await attachTheaters(membershipsRaw);
  if (memberships.length === 0) {
    return {
      activeTheaterId: null,
      activeMembership: null,
      theaters: [],
      memberships: [],
    };
  }

  const storedActiveId = await getActiveTheaterSetting(userId);
  const activeId =
    storedActiveId &&
    memberships.some((member) => member.theater_id === storedActiveId)
      ? storedActiveId
      : memberships[0].theater_id;

  if (!storedActiveId || storedActiveId !== activeId) {
    await upsertActiveTheaterSetting(userId, activeId);
  }

  const activeMembership =
    memberships.find((member) => member.theater_id === activeId) ?? null;
  const theaters = memberships.map((member) => ({
    id: member.theater_id,
    name: member.theater?.name ?? "未設定",
    status: member.theater?.status ?? "pending",
    role: member.role,
  }));

  return {
    activeTheaterId: activeId,
    activeMembership,
    theaters,
    memberships,
  };
};

export const setActiveTheaterForUser = async (
  userId: string,
  theaterId: string
) => {
  const service = createSupabaseServiceClient();
  const { data: member } = await service
    .from("theater_members")
    .select("theater_id, role")
    .eq("user_id", userId)
    .eq("theater_id", theaterId)
    .maybeSingle();

  if (!member) {
    return { ok: false, error: "FORBIDDEN" as const };
  }

  await upsertActiveTheaterSetting(userId, theaterId);
  return { ok: true, member };
};

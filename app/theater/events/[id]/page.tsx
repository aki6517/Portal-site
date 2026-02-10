"use client";

import { useParams } from "next/navigation";
import EditEventScreen from "../_components/EditEventScreen";

const pickParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default function EditEventPage() {
  const params = useParams<{ id: string | string[] }>();
  const eventId = pickParam(params?.id);

  if (!eventId) {
    return (
      <div className="card-retro p-6 text-sm text-zinc-700">読み込み中...</div>
    );
  }

  return <EditEventScreen eventId={eventId} />;
}

"use client";

import { useCallback, useEffect, useState } from "react";
import EventForm from "../_components/EventForm";

type EventData = {
  id: string;
  title: string;
  slug: string;
  category: string;
  status: "draft" | "published" | "archived";
  description?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  venue?: string | null;
  venue_address?: string | null;
  price_general?: number | null;
  price_student?: number | null;
  ticket_url?: string | null;
  tags?: string[] | null;
  cast?: unknown[] | null;
  flyer_url?: string | null;
  image_url?: string | null;
};

export default function EditEventPage({ params }: { params: { id: string } }) {
  const [event, setEvent] = useState<EventData | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchEvent = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/theater/events/${params.id}`, {
      cache: "no-store",
    });
    if (res.ok) {
      const json = await res.json();
      setEvent(json.data?.event);
    }
    setLoading(false);
  }, [params.id]);

  useEffect(() => {
    fetchEvent();
  }, [fetchEvent]);

  const deleteEvent = async () => {
    if (!confirm("完全削除します。よろしいですか？")) return;
    const res = await fetch(`/api/theater/events/${params.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const json = await res.json();
      setMessage(json?.error?.message ?? "削除に失敗しました");
      return;
    }
    setMessage("削除しました。/theater に戻ってください。");
  };

  return (
    <div className="space-y-6">
      {loading && <p className="text-sm text-zinc-600">読み込み中...</p>}
      {event && (
        <EventForm
          mode="edit"
          eventId={params.id}
          initialData={event}
          onSaved={fetchEvent}
        />
      )}

      <div className="rounded-xl border border-zinc-200 p-6">
        <h3 className="text-sm font-semibold text-zinc-800">削除</h3>
        <p className="mt-2 text-xs text-zinc-600">
          完全削除すると元に戻せません。
        </p>
        <button
          className="mt-3 rounded-md border border-red-500 px-3 py-2 text-sm text-red-600"
          onClick={deleteEvent}
        >
          完全削除
        </button>
        {message && <p className="mt-2 text-xs text-zinc-600">{message}</p>}
      </div>
    </div>
  );
}

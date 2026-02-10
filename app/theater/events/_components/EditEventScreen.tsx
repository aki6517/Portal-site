"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import EventForm from "./EventForm";

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

type Props = {
  eventId: string;
};

export default function EditEventScreen({ eventId }: Props) {
  const [event, setEvent] = useState<EventData | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusUpdating, setStatusUpdating] = useState<
    "published" | "draft" | "archived" | null
  >(null);
  const [deleting, setDeleting] = useState(false);

  const fetchEvent = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/theater/events/${eventId}`, {
      cache: "no-store",
    });
    if (res.ok) {
      const json = await res.json();
      setEvent(json.data?.event);
    }
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    fetchEvent();
  }, [fetchEvent]);

  const updateStatus = async (next: "published" | "draft" | "archived") => {
    setStatusUpdating(next);
    setMessage(null);
    const res = await fetch(`/api/theater/events/${eventId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setMessage(json?.error?.message ?? "ステータス変更に失敗しました");
      setStatusUpdating(null);
      return;
    }
    await fetchEvent();
    setMessage("更新しました。");
    setStatusUpdating(null);
  };

  const deleteEvent = async () => {
    if (!confirm("完全削除します。よろしいですか？")) return;
    setDeleting(true);
    const res = await fetch(`/api/theater/events/${eventId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const json = await res.json();
      setMessage(json?.error?.message ?? "削除に失敗しました");
      setDeleting(false);
      return;
    }
    setMessage("削除しました。/theater に戻ってください。");
    setDeleting(false);
  };

  return (
    <div className="space-y-6">
      {loading && (
        <div className="card-retro p-6 text-sm text-zinc-700">読み込み中...</div>
      )}
      {event && (
        <div className="space-y-4">
          <div className="card-retro p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="text-xs font-black tracking-wide text-zinc-700">
                  編集中の公演
                </div>
                <div className="mt-1 text-lg font-black">{event.title}</div>
                <div className="mt-2 text-xs text-zinc-700">
                  現在の状態:{" "}
                  <span className="badge-retro bg-surface shadow-hard-sm">
                    {event.status === "published"
                      ? "公開中"
                      : event.status === "draft"
                        ? "下書き"
                        : "非公開"}
                  </span>
                </div>
                <div className="text-anywhere mt-2 text-xs text-zinc-600">
                  {`URL: /events/${event.category}/${event.slug}`}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {event.status !== "published" && (
                  <button
                    className="btn-retro btn-ink disabled:opacity-50"
                    disabled={statusUpdating !== null}
                    onClick={() => updateStatus("published")}
                  >
                    {statusUpdating === "published" ? "公開中..." : "公開する"}
                  </button>
                )}
                {event.status === "published" && (
                  <button
                    className="btn-retro btn-surface disabled:opacity-50"
                    disabled={statusUpdating !== null}
                    onClick={() => updateStatus("archived")}
                  >
                    {statusUpdating === "archived" ? "更新中..." : "非公開にする"}
                  </button>
                )}
                {event.status === "archived" && (
                  <button
                    className="btn-retro btn-surface disabled:opacity-50"
                    disabled={statusUpdating !== null}
                    onClick={() => updateStatus("draft")}
                  >
                    {statusUpdating === "draft" ? "更新中..." : "下書きに戻す"}
                  </button>
                )}
                {event.status === "published" && (
                  <Link
                    className="btn-retro btn-surface"
                    href={`/events/${encodeURIComponent(
                      event.category
                    )}/${encodeURIComponent(event.slug)}`}
                    target="_blank"
                  >
                    公開ページ
                  </Link>
                )}
              </div>
            </div>
          </div>

          <EventForm
            mode="edit"
            eventId={eventId}
            initialData={event}
            onSaved={fetchEvent}
          />
        </div>
      )}

      <div className="card-retro p-6">
        <h3 className="font-display text-lg">削除</h3>
        <p className="mt-2 text-sm text-zinc-700">
          完全削除すると元に戻せません。必要な場合のみ実行してください。
        </p>
        <button
          className="btn-retro btn-surface mt-3 border-red-600 text-red-700 disabled:opacity-50"
          onClick={deleteEvent}
          disabled={deleting}
        >
          {deleting ? "削除中..." : "完全削除"}
        </button>
        {message && <p className="mt-3 text-sm text-zinc-700">{message}</p>}
      </div>
    </div>
  );
}

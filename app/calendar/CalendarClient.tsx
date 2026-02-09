"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import jaLocale from "@fullcalendar/core/locales/ja";
import type { EventInput, EventSourceFunc } from "@fullcalendar/core";
import "./calendar.css";

type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end?: string | null;
  url?: string;
};

export default function CalendarClient() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  // Load FullCalendar styles from CDN (node_modules does not ship CSS in this build)
  useEffect(() => {
    const links = [
      {
        id: "fc-core-css",
        href: "https://cdn.jsdelivr.net/npm/@fullcalendar/core@6.1.20/index.global.min.css",
      },
      {
        id: "fc-daygrid-css",
        href: "https://cdn.jsdelivr.net/npm/@fullcalendar/daygrid@6.1.20/index.global.min.css",
      },
    ];
    const added: HTMLLinkElement[] = [];
    links.forEach(({ id, href }) => {
      if (document.getElementById(id)) return;
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = href;
      document.head.appendChild(link);
      added.push(link);
    });
    return () => {
      // keep styles for navigation; do not remove to avoid flicker
      // (leave attached)
    };
  }, []);

  const loadEvents = useCallback<EventSourceFunc>(
    async (info, success, failure) => {
      setError(null);
      try {
        const params = new URLSearchParams({
          start: info.startStr,
          end: info.endStr,
        });
        const res = await fetch(`/api/calendar?${params.toString()}`, {
          cache: "no-store",
        });
        const json = (await res.json().catch(() => null)) as
          | { data?: { events?: CalendarEvent[] }; error?: { message?: string } }
          | null;
        if (!res.ok) {
          const message =
            json?.error?.message ?? "カレンダーの取得に失敗しました。";
          setError(message);
          failure(new Error(message));
          return;
        }
        const eventInputs: EventInput[] = (json?.data?.events ?? []).map(
          (item) => ({
            ...item,
            end: item.end ?? undefined,
          })
        );
        success(eventInputs);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "カレンダーの取得に失敗しました。";
        setError(message);
        failure(err as Error);
      }
    },
    []
  );

  return (
    <div className="card-retro p-4 md:p-6">
      {error && <p className="mb-3 text-xs text-red-700">{error}</p>}
      <FullCalendar
        plugins={[dayGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        height="auto"
        locale={jaLocale}
        firstDay={1}
        dayMaxEvents={3}
        events={loadEvents}
        eventClick={(info) => {
          if (info.event.url) {
            info.jsEvent.preventDefault();
            router.push(info.event.url);
          }
        }}
      />
    </div>
  );
}

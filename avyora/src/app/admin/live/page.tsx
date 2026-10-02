"use client";

import { fetchJson } from "@/lib/api-client";
import { useEffect, useState } from "react";

type LiveEvent = {
  id: string;
  title: string;
  status: string;
  scheduledAt?: string | null;
};

export default function LiveEventsAdmin() {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetchJson<LiveEvent[]>("/api/admin/live-events");
      if (cancelled) return;
      if (res.ok) {
        setEvents(Array.isArray(res.data) ? res.data : []);
        setOffline(false);
      } else if (res.offline) {
        setOffline(true);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h1 className="text-3xl font-medium tracking-tight">Live events</h1>
      <p className="mt-1 text-sm text-ink-soft">Scheduled live shopping and atelier broadcasts.</p>

      {offline && (
        <p className="mt-6 border border-line bg-ivory/70 px-4 py-3 text-sm text-ink-soft">
          Live event schedule syncs when the database is online.
        </p>
      )}

      {loading ? (
        <p className="mt-8 text-sm text-ink-soft">Loading events…</p>
      ) : events.length ? (
        <div className="mt-8 space-y-3">
          {events.map((event) => (
            <div key={event.id} className="border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{event.title}</p>
                <span className="text-xs tracking-widest uppercase text-ink-soft">{event.status}</span>
              </div>
              {event.scheduledAt && (
                <p className="mt-1 text-xs text-ink-soft">{new Date(event.scheduledAt).toLocaleString("en-IN")}</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-8 border border-line p-8 text-center">
          <p className="text-sm text-ink-soft">No live events scheduled.</p>
          <p className="mt-2 text-xs text-ink-soft">Upcoming broadcasts will appear here once configured.</p>
        </div>
      )}
    </div>
  );
}

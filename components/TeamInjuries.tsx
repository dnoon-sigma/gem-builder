"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { createBrowserSupabase } from "@/lib/supabase/browser";

type Props = {
  abbr: string;
  name: string;
  logo?: string;
  record?: string;
  side: "away" | "home";
};

type Report = {
  id: number;
  designation: string;
  practice: "full" | "limited" | "dnp" | "unknown";
  injury: string | null;
  notes: string | null;
  source_url: string | null;
  source_event_id: string | null;
  reported_at: string;
  player: { id: number; full_name: string; position: string | null } | null;
};

const LABEL: Record<string, string> = {
  healthy: "Healthy",
  probable: "Probable",
  questionable: "Questionable",
  doubtful: "Doubtful",
  out: "Out",
  injured_reserve: "IR",
  pup: "PUP",
  suspended: "Suspended",
  no_designation: "No designation yet",
};

const BADGE: Record<string, string> = {
  out: "bg-red-400/15 text-red-300",
  injured_reserve: "bg-red-400/15 text-red-300",
  pup: "bg-red-400/15 text-red-300",
  suspended: "bg-red-400/15 text-red-300",
  doubtful: "bg-orange-400/15 text-orange-300",
  questionable: "bg-amber-400/15 text-amber-300",
  probable: "bg-emerald-400/15 text-emerald-300",
  healthy: "bg-emerald-400/15 text-emerald-300",
  no_designation: "bg-white/10 text-gray-300",
};

const PRACTICE: Record<string, string> = {
  full: "Full practice",
  limited: "Limited practice",
  dnp: "Did not practice",
};

const PRACTICE_TONE: Record<string, string> = {
  full: "text-emerald-300",
  limited: "text-amber-300",
  dnp: "text-red-300",
};

// Most severe first, then newest.
const SEVERITY: Record<string, number> = {
  out: 0,
  injured_reserve: 0,
  pup: 0,
  suspended: 0,
  doubtful: 1,
  questionable: 2,
  no_designation: 3,
  probable: 4,
  healthy: 5,
};

function ago(iso: string) {
  const m = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

export default function TeamInjuries({ abbr, name, logo, record, side }: Props) {
  const [open, setOpen] = useState(false);
  const [reports, setReports] = useState<Report[] | null>(null);
  const [error, setError] = useState(false);
  const [sort, setSort] = useState<"recent" | "severity">("recent");

  const sorted = useMemo(() => {
    // Updates our monitors reported come first, newest first. The starting
    // baseline (loaded in bulk, so all stamped about the same time) follows.
    const isBaseline = (r: Report) => r.source_event_id?.startsWith("baseline-") ?? false;
    const byTime = (a: Report, b: Report) => +new Date(b.reported_at) - +new Date(a.reported_at);
    const bySeverity = (a: Report, b: Report) =>
      (SEVERITY[a.designation] ?? 9) - (SEVERITY[b.designation] ?? 9);
    return [...(reports ?? [])].sort(
      sort === "recent"
        ? (a, b) =>
            Number(isBaseline(a)) - Number(isBaseline(b)) ||
            (isBaseline(a) ? bySeverity(a, b) || byTime(a, b) : byTime(a, b))
        : (a, b) => bySeverity(a, b) || byTime(a, b),
    );
  }, [reports, sort]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";

    (async () => {
      const db = createBrowserSupabase();
      const { data, error } = await db
        .from("injury_reports")
        .select(
          "id, designation, practice, injury, notes, source_url, source_event_id, reported_at, player:players(id, full_name, position), team:teams!inner(abbr)",
        )
        .eq("team.abbr", abbr)
        .order("reported_at", { ascending: false })
        .limit(300)
        .returns<Report[]>();
      if (cancelled) return;
      if (error) return setError(true);
      // Keep only each player's most recent report.
      const seen = new Set<number>();
      const latest = (data ?? []).filter((r) => {
        if (!r.player || seen.has(r.player.id)) return false;
        seen.add(r.player.id);
        return true;
      });
      setReports(latest);
    })();

    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, abbr]);

  const close = () => {
    setOpen(false);
    setReports(null);
    setError(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`${name} injury report`}
        className="flex min-w-0 cursor-pointer flex-col items-center gap-0.5 rounded-lg px-2 py-1 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {logo && <img src={logo} alt="" className="h-10 w-10 object-contain" />}
        <span className="text-base font-semibold leading-none">{abbr}</span>
        <span className="text-[11px] leading-none text-gray-500">
          {record ? `${record} · ` : ""}
          {side}
        </span>
      </button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={close}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`${name} injury report`}
              onClick={(e) => e.stopPropagation()}
              className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl border border-white/10 bg-[#11161d] shadow-2xl"
            >
              <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {logo && <img src={logo} alt="" className="h-9 w-9 object-contain" />}
                <div className="flex-1">
                  <h2 className="font-semibold leading-tight">{name}</h2>
                  <p className="text-xs text-gray-500">Injury report</p>
                </div>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close"
                  className="rounded-md px-2 py-1 text-gray-400 hover:bg-white/10 hover:text-white"
                >
                  ✕
                </button>
              </div>

              {reports && reports.length > 1 && (
                <div className="flex items-center gap-2 border-b border-white/10 px-5 py-2 text-xs">
                  <span className="text-gray-500">Sort by</span>
                  {(
                    [
                      ["recent", "Most recent"],
                      ["severity", "Most severe"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSort(key)}
                      className={`rounded-full px-2.5 py-1 ${
                        sort === key
                          ? "bg-white/15 text-white"
                          : "text-gray-400 hover:bg-white/10 hover:text-gray-200"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              <div className="overflow-y-auto">
                {error && <p className="p-5 text-sm text-red-300">Couldn&apos;t load the report.</p>}
                {!error && reports === null && <p className="p-5 text-sm text-gray-500">Loading…</p>}
                {reports?.length === 0 && (
                  <p className="p-5 text-sm leading-relaxed text-gray-500">
                    No injury updates have been reported for the {name} yet.
                  </p>
                )}
                <ul className="divide-y divide-white/5">
                  {sorted.map((r) => (
                    <li key={r.id} className="px-5 py-3.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <span className="font-medium">{r.player?.full_name}</span>
                          {r.player?.position && (
                            <span className="ml-2 text-xs text-gray-500">{r.player.position}</span>
                          )}
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[r.designation] ?? ""}`}
                        >
                          {LABEL[r.designation] ?? r.designation}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-gray-400">
                        {r.injury && <span>{r.injury}</span>}
                        {PRACTICE[r.practice] && (
                          <span className={PRACTICE_TONE[r.practice]}>{PRACTICE[r.practice]}</span>
                        )}
                        <span className="text-gray-500">Updated {ago(r.reported_at)}</span>
                      </div>
                      {r.notes && <p className="mt-1 text-xs leading-relaxed text-gray-500">{r.notes}</p>}
                      {r.source_url && (
                        <a
                          href={r.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-block text-xs text-sky-400 hover:underline"
                        >
                          Source
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

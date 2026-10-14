"use client";

import { useEffect, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

type Row = {
  id: number;
  created_at: string;
  previous_designation: string | null;
  new_designation: string;
  impact: "high" | "medium" | "low";
  impact_reason: string | null;
  team: { abbr: string } | null;
  player: { full_name: string; position: string | null } | null;
  replacement: { full_name: string } | null;
  report: { injury: string | null; notes: string | null; source_url: string | null } | null;
  game: { kickoff_at: string } | null;
};

const SELECT = `
  id, created_at, previous_designation, new_designation, impact, impact_reason,
  team:teams(abbr),
  player:players!alerts_player_id_fkey(full_name, position),
  replacement:players!alerts_replacement_player_id_fkey(full_name),
  report:injury_reports(injury, notes, source_url),
  game:games(kickoff_at)
`;

const LABEL: Record<string, string> = {
  healthy: "Healthy",
  probable: "Probable",
  questionable: "Questionable",
  doubtful: "Doubtful",
  out: "Out",
  injured_reserve: "IR",
  pup: "PUP",
  suspended: "Suspended",
};

const TONE: Record<string, string> = {
  out: "text-red-300",
  injured_reserve: "text-red-300",
  pup: "text-red-300",
  suspended: "text-red-300",
  doubtful: "text-orange-300",
  questionable: "text-amber-300",
  probable: "text-emerald-300",
  healthy: "text-emerald-300",
};

const IMPACT: Record<Row["impact"], string> = {
  high: "bg-red-400",
  medium: "bg-amber-400",
  low: "bg-gray-500",
};

const logoUrl = (abbr: string) =>
  `https://a.espncdn.com/i/teamlogos/nfl/500/${abbr.toLowerCase()}.png`;

function ago(iso: string) {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function InjuryFeed() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    const db = createBrowserSupabase();
    const load = async () => {
      const { data, error } = await db
        .from("alerts")
        .select(SELECT)
        .order("created_at", { ascending: false })
        .limit(50)
        .returns<Row[]>();
      if (error) setError(true);
      else {
        setError(false);
        setRows(data);
      }
    };
    load();

    // New alerts arrive live; refetch so we get the joined player/team names.
    const channel = db
      .channel("alerts-feed")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "alerts" }, load)
      .subscribe();
    const clock = setInterval(() => tick((n) => n + 1), 60_000);

    return () => {
      clearInterval(clock);
      db.removeChannel(channel);
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline justify-between border-b border-white/10 px-4 py-3">
        <h2 className="text-sm font-semibold">Injury updates</h2>
        <span className="flex items-center gap-1.5 text-[11px] text-gray-500">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Live
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {error && <p className="p-4 text-sm text-red-300">Couldn&apos;t load updates.</p>}
        {!error && rows === null && <p className="p-4 text-sm text-gray-500">Loading…</p>}
        {rows?.length === 0 && (
          <p className="p-4 text-sm leading-relaxed text-gray-500">
            No injury updates yet. Teams are checked daily, and more often in the 36 hours before
            kickoff. New designations will appear here as they&apos;re reported.
          </p>
        )}

        <ul className="divide-y divide-white/5">
          {rows?.map((r) => (
            <li key={r.id} className="px-4 py-3">
              <div className="flex items-start gap-2.5">
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${IMPACT[r.impact]}`}
                  title={`${r.impact} impact`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {r.team && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={logoUrl(r.team.abbr)}
                          alt=""
                          title={r.team.abbr}
                          className="h-5 w-5 shrink-0 object-contain"
                        />
                      )}
                      <span className="truncate text-sm font-medium">
                        {r.player?.full_name ?? "Unknown player"}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] text-gray-500">{ago(r.created_at)}</span>
                  </div>
                  <div className="text-xs text-gray-500">
                    {r.team?.abbr}
                    {r.player?.position ? ` · ${r.player.position}` : ""}
                  </div>
                  <div className="mt-1 text-sm">
                    {r.previous_designation && (
                      <>
                        <span className="text-gray-500">{LABEL[r.previous_designation]}</span>
                        <span className="px-1.5 text-gray-600">→</span>
                      </>
                    )}
                    <span className={`font-medium ${TONE[r.new_designation] ?? ""}`}>
                      {LABEL[r.new_designation] ?? r.new_designation}
                    </span>
                    {r.report?.injury && (
                      <span className="text-gray-400"> · {r.report.injury}</span>
                    )}
                  </div>
                  {r.replacement && (
                    <div className="mt-0.5 text-xs text-gray-400">
                      Replacement: <span className="text-gray-200">{r.replacement.full_name}</span>
                    </div>
                  )}
                  {r.impact_reason && (
                    <div className="mt-0.5 text-xs text-gray-500">{r.impact_reason}</div>
                  )}
                  {r.report?.source_url && (
                    <a
                      href={r.report.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block text-[11px] text-sky-400 hover:underline"
                    >
                      Source
                    </a>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

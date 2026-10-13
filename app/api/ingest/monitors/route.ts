import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { desiredFrequency, monitorQuery } from "@/lib/monitors";
import { createMonitor, parallelEnabled, updateMonitorFrequency } from "@/lib/parallel";

export const maxDuration = 120;

// Creates a monitor for each team that lacks one, and moves each team's
// monitor between the daily and fast cadence depending on how close its next
// kickoff is.
//   ?team=KC   only this team (use for a first test)
//   ?dry=1     show what would change without calling Parallel
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const only = url.searchParams.get("team")?.toUpperCase();
  const dry = url.searchParams.get("dry") === "1";

  if (!dry && !parallelEnabled()) {
    return NextResponse.json({ error: "PARALLEL_ENABLED is not true" }, { status: 409 });
  }
  const appUrl = process.env.APP_URL;
  if (!dry && !appUrl) return NextResponse.json({ error: "APP_URL is not set" }, { status: 500 });

  const db = createAdminClient();
  const now = new Date();

  const [{ data: teams }, { data: games }, { data: monitors }] = await Promise.all([
    db.from("teams").select("id, abbr, name"),
    db
      .from("games")
      .select("home_team_id, away_team_id, kickoff_at")
      .gt("kickoff_at", now.toISOString())
      .order("kickoff_at", { ascending: true }),
    db.from("monitors").select("team_id, parallel_monitor_id, frequency"),
  ]);

  const nextKickoff = new Map<number, Date>();
  for (const g of games ?? []) {
    for (const id of [g.home_team_id, g.away_team_id]) {
      if (!nextKickoff.has(id)) nextKickoff.set(id, new Date(g.kickoff_at));
    }
  }
  const existing = new Map((monitors ?? []).map((m) => [m.team_id, m]));

  const report: Record<string, unknown>[] = [];
  for (const team of (teams ?? []).filter((t) => !only || t.abbr === only)) {
    const frequency = desiredFrequency(nextKickoff.get(team.id), now);
    const current = existing.get(team.id);
    const action = !current ? "create" : current.frequency !== frequency ? "update" : "none";
    const row = { team: team.abbr, action, frequency, from: current?.frequency };

    if (!dry && action === "create") {
      const m = await createMonitor({
        query: monitorQuery(team.name),
        frequency,
        webhookUrl: `${appUrl}/api/webhooks/parallel`,
        metadata: { team: team.abbr },
      });
      await db.from("monitors").insert({
        team_id: team.id,
        parallel_monitor_id: m.monitor_id,
        frequency,
      });
    } else if (!dry && action === "update") {
      await updateMonitorFrequency(current!.parallel_monitor_id, frequency);
      await db
        .from("monitors")
        .update({ frequency, last_synced_at: now.toISOString() })
        .eq("team_id", team.id);
    }
    report.push(row);
  }

  return NextResponse.json({ ok: true, dry, report });
}

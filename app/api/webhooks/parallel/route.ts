import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyInjuryUpdate, type InjuryUpdate } from "@/lib/injuries";
import { fetchEventGroup } from "@/lib/parallel";
import { verifyWebhook } from "@/lib/webhook";

export const maxDuration = 60;

type Payload = {
  type: string;
  data: {
    monitor_id: string;
    event?: { event_group_id?: string; error?: string };
  };
};

export async function POST(request: Request) {
  const secret = process.env.PARALLEL_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "webhook secret not configured" }, { status: 500 });

  // Signature is computed over the exact raw body, so read it as text.
  const raw = await request.text();
  if (!verifyWebhook(request.headers, raw, secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const payload = JSON.parse(raw) as Payload;
  const db = createAdminClient();

  const { data: monitor } = await db
    .from("monitors")
    .select("team_id")
    .eq("parallel_monitor_id", payload.data.monitor_id)
    .maybeSingle();
  if (!monitor) return NextResponse.json({ ok: true, ignored: "unknown monitor" });

  if (payload.type === "monitor.execution.failed") {
    await db.from("ingestion_runs").insert({
      kind: "monitor",
      status: "error",
      error: payload.data.event?.error ?? "monitor execution failed",
      finished_at: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true });
  }

  if (payload.type !== "monitor.event.detected" || !payload.data.event?.event_group_id) {
    return NextResponse.json({ ok: true, ignored: payload.type });
  }

  const events = await fetchEventGroup(payload.data.monitor_id, payload.data.event.event_group_id);
  const results = [];
  for (const e of events) {
    if (e.event_type !== "event_stream" || e.output?.type !== "json") continue;
    const content = e.output.content as InjuryUpdate;
    if (!content?.player_name || !content?.designation) continue;
    results.push(
      await applyInjuryUpdate(db, {
        teamId: monitor.team_id,
        update: content,
        eventId: e.event_id,
        sourceUrl: e.output.basis?.[0]?.citations?.[0]?.url,
      }),
    );
  }
  return NextResponse.json({ ok: true, results });
}

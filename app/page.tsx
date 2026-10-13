import { fetchUpcomingWeek, type Matchup, type TeamLine } from "@/lib/espn";
import { lopsided, winProb } from "@/lib/odds";

// Odds move, so re-fetch from ESPN at most every hour.
export const revalidate = 3600;

const TZ = "America/New_York";

const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));

const timeLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));

function TeamRow({ t, favorite }: { t: TeamLine; favorite: boolean }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3" title={t.name}>
      <div className="flex min-w-0 items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {t.logo && <img src={t.logo} alt="" className="h-7 w-7 shrink-0 object-contain" />}
        <span className={`font-semibold ${favorite ? "text-white" : "text-gray-300"}`}>
          {t.abbr}
        </span>
        {t.record && <span className="text-xs text-gray-500">{t.record}</span>}
      </div>
      <div className="w-20 text-right tabular-nums">
        <span className="font-medium">{t.spread ?? "—"}</span>
        {t.spreadOdds && <span className="ml-1 text-[11px] text-gray-500">{t.spreadOdds}</span>}
      </div>
      <div className="w-14 text-right font-medium tabular-nums">{t.moneyline ?? "—"}</div>
    </div>
  );
}

function GameCard({ g }: { g: Matchup }) {
  const p = winProb(g);
  const skew = lopsided(g, p);
  const awayFav = p ? p.away >= p.home : false;

  return (
    <article
      className={`rounded-xl border p-3.5 ${
        skew ? "border-amber-400/40 bg-amber-400/[0.05]" : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <div className="mb-2.5 flex items-center justify-between text-xs">
        <span className="text-gray-400">{timeLabel(g.kickoff)} ET</span>
        {skew ? (
          <span className="rounded-full bg-amber-400/15 px-2 py-0.5 font-medium text-amber-300">
            ▲ Lopsided · {skew.team} {Math.round(skew.prob * 100)}%
          </span>
        ) : (
          g.total != null && <span className="text-gray-500">O/U {g.total}</span>
        )}
      </div>

      <div className="space-y-2">
        <TeamRow t={g.away} favorite={awayFav} />
        <TeamRow t={g.home} favorite={!awayFav} />
      </div>

      {p && (
        <div
          className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-white/10"
          title={`${g.away.abbr} ${Math.round(p.away * 100)}% · ${g.home.abbr} ${Math.round(p.home * 100)}%`}
        >
          <div
            className={skew ? "bg-amber-400" : "bg-sky-400/70"}
            style={{ width: `${p.away * 100}%` }}
          />
        </div>
      )}
    </article>
  );
}

export default async function Home() {
  const { week, season, matchups } = await fetchUpcomingWeek();

  const byDay = new Map<string, Matchup[]>();
  for (const m of matchups) {
    const key = dayLabel(m.kickoff);
    byDay.set(key, [...(byDay.get(key) ?? []), m]);
  }
  const book = matchups.find((m) => m.book)?.book;

  return (
    <main className="mx-auto max-w-[1800px] px-6 py-5">
      <header className="mb-4 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Week {week} matchups</h1>
        <p className="text-xs text-gray-500">
          {season} season · ET{book ? ` · odds from ${book}` : ""} · bar shows win probability
        </p>
      </header>

      {matchups.length === 0 ? (
        <p className="text-gray-400">No games scheduled.</p>
      ) : (
        <div className="space-y-5">
          {[...byDay].map(([day, games]) => (
            <section key={day}>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                {day}
              </h2>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {games.map((g) => (
                  <GameCard key={g.id} g={g} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <footer className="mt-4 text-[11px] text-gray-600">
        Odds are informational and may change. 21+. Gambling problem? Call 1-800-GAMBLER.
      </footer>
    </main>
  );
}

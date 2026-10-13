import { fetchUpcomingWeek, type Matchup, type TeamLine } from "@/lib/espn";

// Odds move, so re-fetch from ESPN at most every hour.
export const revalidate = 3600;

const TZ = "America/New_York";

const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));

const timeLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));

const num = "px-2 py-1 text-right tabular-nums";

function TeamCell({ t }: { t: TeamLine }) {
  return (
    <td className="px-2 py-1" title={`${t.name}${t.record ? ` (${t.record})` : ""}`}>
      <div className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {t.logo && <img src={t.logo} alt="" className="h-5 w-5 object-contain" />}
        <span className="font-medium">{t.abbr}</span>
        {t.record && <span className="text-xs text-gray-500">{t.record}</span>}
      </div>
    </td>
  );
}

function Side({ t }: { t: TeamLine }) {
  return (
    <>
      <TeamCell t={t} />
      <td className={num}>
        {t.spread ?? "—"}
        {t.spreadOdds && <span className="ml-1 text-xs text-gray-500">{t.spreadOdds}</span>}
      </td>
      <td className={num}>{t.moneyline ?? "—"}</td>
    </>
  );
}

function Row({ g }: { g: Matchup }) {
  return (
    <tr className="border-t border-white/5 hover:bg-white/[0.03]">
      <td className="whitespace-nowrap px-2 py-1 text-gray-400">{timeLabel(g.kickoff)}</td>
      <Side t={g.away} />
      <td className="px-1 text-center text-gray-600">@</td>
      <Side t={g.home} />
      <td className={`${num} text-gray-300`}>{g.total ?? "—"}</td>
    </tr>
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
    <main className="mx-auto max-w-5xl px-4 py-3 text-sm">
      <header className="mb-2 flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Week {week} matchups</h1>
        <p className="text-xs text-gray-500">
          {season} · ET{book ? ` · odds from ${book}` : ""}
        </p>
      </header>

      {matchups.length === 0 ? (
        <p className="text-gray-400">No games scheduled.</p>
      ) : (
        <table className="w-full border-collapse">
          <thead className="text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-2 py-1 text-left font-medium">Time</th>
              <th className="px-2 py-1 text-left font-medium">Away</th>
              <th className="px-2 py-1 text-right font-medium">Spread</th>
              <th className="px-2 py-1 text-right font-medium">ML</th>
              <th />
              <th className="px-2 py-1 text-left font-medium">Home</th>
              <th className="px-2 py-1 text-right font-medium">Spread</th>
              <th className="px-2 py-1 text-right font-medium">ML</th>
              <th className="px-2 py-1 text-right font-medium">O/U</th>
            </tr>
          </thead>
          {[...byDay].map(([day, games]) => (
            <tbody key={day}>
              <tr>
                <td
                  colSpan={9}
                  className="bg-white/5 px-2 py-0.5 text-xs font-medium text-gray-300"
                >
                  {day}
                </td>
              </tr>
              {games.map((g) => (
                <Row key={g.id} g={g} />
              ))}
            </tbody>
          ))}
        </table>
      )}

      <footer className="mt-2 text-[11px] text-gray-600">
        Odds are informational and may change. 21+. Gambling problem? Call 1-800-GAMBLER.
      </footer>
    </main>
  );
}

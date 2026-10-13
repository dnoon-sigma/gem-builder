import { fetchUpcomingWeek, type Matchup, type TeamLine } from "@/lib/espn";
import { lopsided, winProb } from "@/lib/odds";
import InjuryFeed from "@/components/InjuryFeed";

// Odds move, so re-fetch from ESPN at most every hour.
export const revalidate = 3600;

const TZ = "America/New_York";

const kickoffLabel = (iso: string) => {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
  return `${day} ${time} ET`;
};

function Team({ t, side }: { t: TeamLine; side: "away" | "home" }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-0.5" title={t.name}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {t.logo && <img src={t.logo} alt="" className="h-10 w-10 object-contain" />}
      <span className="text-base font-semibold leading-none">{t.abbr}</span>
      <span className="text-[11px] leading-none text-gray-500">
        {t.record ? `${t.record} · ` : ""}
        {side}
      </span>
    </div>
  );
}

function Odds({ ml, prob }: { ml?: string; prob?: number }) {
  return (
    <div className="flex w-16 flex-col items-center leading-tight">
      <span className="text-sm font-semibold tabular-nums">{ml ?? "—"}</span>
      {prob != null && (
        <span className="text-[11px] tabular-nums text-gray-500">{Math.round(prob * 100)}%</span>
      )}
    </div>
  );
}

function GameCard({ g }: { g: Matchup }) {
  const p = winProb(g);
  const skew = lopsided(g, p);
  const awayFav = p ? p.away >= p.home : true;

  // Favorite on the left, underdog on the right.
  const fav = awayFav ? g.away : g.home;
  const dog = awayFav ? g.home : g.away;
  const favSide = awayFav ? "away" : "home";
  const dogSide = awayFav ? "home" : "away";
  const favProb = p ? (awayFav ? p.away : p.home) : undefined;
  const dogProb = p ? (awayFav ? p.home : p.away) : undefined;

  return (
    <article
      className={`rounded-xl border p-3.5 ${
        skew ? "border-amber-400/40 bg-amber-400/[0.05]" : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="text-gray-400">{kickoffLabel(g.kickoff)}</span>
        {skew ? (
          <span className="rounded-full bg-amber-400/15 px-2 py-0.5 font-medium text-amber-300">
            ▲ Lopsided
          </span>
        ) : (
          g.total != null && <span className="text-gray-500">O/U {g.total}</span>
        )}
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center">
        <Team t={fav} side={favSide} />
        <div className="px-2 text-center">
          <div className="text-2xl font-semibold tabular-nums leading-none">
            {fav.spread ?? "—"}
          </div>
          {fav.spreadOdds && (
            <div className="mt-1 text-[11px] tabular-nums text-gray-500">{fav.spreadOdds}</div>
          )}
        </div>
        <Team t={dog} side={dogSide} />
      </div>

      <div className="mt-3 flex items-start justify-between gap-2">
        <Odds ml={fav.moneyline} prob={favProb} />
        {favProb != null ? (
          <div
            className="mt-1.5 h-2 flex-1 overflow-hidden rounded-full bg-white/10"
            title={`${fav.abbr} ${Math.round(favProb * 100)}% · ${dog.abbr} ${Math.round((dogProb ?? 0) * 100)}%`}
          >
            <div
              className={`h-full ${skew ? "bg-amber-400" : "bg-sky-400/80"}`}
              style={{ width: `${favProb * 100}%` }}
            />
          </div>
        ) : (
          <div className="flex-1" />
        )}
        <Odds ml={dog.moneyline} prob={dogProb} />
      </div>
    </article>
  );
}

export default async function Home() {
  const { week, season, matchups } = await fetchUpcomingWeek();

  const book = matchups.find((m) => m.book)?.book;

  return (
    <div className="lg:flex">
    <main className="min-w-0 flex-1 px-6 py-5">
      <header className="mb-4 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Week {week} matchups</h1>
        <p className="text-xs text-gray-500">
          {season} season · ET{book ? ` · odds from ${book}` : ""} · favorite on the left · bar shows win probability
        </p>
      </header>

      {matchups.length === 0 ? (
        <p className="text-gray-400">No games scheduled.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {matchups.map((g) => (
            <GameCard key={g.id} g={g} />
          ))}
        </div>
      )}

      <footer className="mt-4 text-[11px] text-gray-600">
        Odds are informational and may change. 21+. Gambling problem? Call 1-800-GAMBLER.
      </footer>
    </main>
    <aside className="border-t border-white/10 lg:sticky lg:top-0 lg:h-screen lg:w-80 lg:shrink-0 lg:border-l lg:border-t-0">
      <InjuryFeed />
    </aside>
    </div>
  );
}

import { useState } from 'react';
import { useTeams } from '@/lib/queries';
import { usePosts, type Post } from '@/lib/news';
import { teamName } from '@/lib/format';
import { useT } from '@/i18n';
import { Button, Card, Face, PersonFace } from '@/ui';

/** Moves a team announces itself (its account, no face); the league insider posts the rest. */
const TEAM_POSTS = new Set(['player.signed', 'contract.extended', 'player.drafted']);

/** The league news tab: the feed as posts, all of it or your team's. */
export function News() {
  const t = useT();
  const { data: teams = [] } = useTeams();
  const { posts, names, ages } = usePosts(300);
  const [yoursOnly, setYoursOnly] = useState(false);
  const yours = new Set(teams.filter((x) => x.userControlled).map((x) => x.id as string));
  const shown = yoursOnly
    ? posts.filter((p) => p.event.teamIds.some((id) => yours.has(id)))
    : posts;
  return (
    <div className="max-w-2xl space-y-3">
      <div className="flex gap-2">
        {([false, true] as const).map((v) => (
          <Button
            key={String(v)}
            variant={yoursOnly === v ? 'primary' : 'ghost'}
            onClick={() => setYoursOnly(v)}
          >
            {t(v ? 'news.yours' : 'news.all')}
          </Button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted">{t('home.feedEmpty')}</p>
      ) : (
        shown.map((post) => <PostCard key={post.event.id} post={post} names={names} ages={ages} />)
      )}
    </div>
  );
}

function PostCard({
  post,
  names,
  ages,
}: {
  post: Post;
  names: Record<string, string>;
  ages: Record<string, number>;
}) {
  const t = useT();
  const { data: teams = [] } = useTeams();
  const { event, text, player, by } = post;
  // A person speaking posts as himself, a team's own move as the team, the rest as the insider.
  const teamId = TEAM_POSTS.has(event.kind) ? event.teamIds[0] : undefined;
  const abbr = teams.find((x) => x.id === (teamId ?? event.teamIds[0]))?.abbreviation;
  return (
    <Card>
      <div className="flex gap-3">
        {by ? (
          <PersonFace role={by.role} name={by.name} size={40} />
        ) : teamId ? (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-card)] bg-[var(--team-primary)] text-xs font-semibold text-bg">
            {abbr}
          </div>
        ) : (
          <Face seed="insider" age={45} size={40} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-semibold">
              {by ? by.name : teamId ? teamName(teams, teamId) : t('news.insider')}
            </span>
            <span className="text-xs text-muted">
              {by
                ? `${t(`team.${by.role}`)}${abbr ? `, ${abbr}` : ''}`
                : teamId
                  ? `@${abbr}`
                  : t('news.insiderHandle')}{' '}
              · {t('news.date', { day: event.date.day, season: event.date.season })}
            </span>
          </div>
          <p className="mt-1 text-sm">{text}</p>
          {player && ages[player] !== undefined && (
            <div className="mt-2 flex items-center text-xs text-muted">
              <Face seed={player} age={ages[player]!} size={22} />
              {names[player]}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

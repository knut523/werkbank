// Roadmap-Überblick (Plan Heute + Review-Schlange, S5): je Thema vier Felder in der Reihenfolge
// Wartet auf dich → In Arbeit → Als Nächstes → Erledigt. Rein, ohne React — läuft auch in den Tests.

export interface BucketSpec { path: string; name: string; title: string; topic: string; state: string; rank?: number | null; open: number; tickets: { key: string; status: string | null }[]; prLive?: any[]; verified?: string | null }
export interface Decision { path: string; spec?: string; title?: string; topic: string; question?: string }
export interface TopicBuckets {
  topic: string;
  waiting: { count: number; items: Decision[] };
  inWork: { count: number; items: (BucketSpec & { agent?: string | null })[] };
  next: { count: number; items: BucketSpec[] };
  done: { count: number; items: BucketSpec[] };
  best: number;
}

const DONE = /^(done|erledigt|geschlossen|closed)$/i;
const ACTIVE = /^(in progress|in arbeit|in review|review)$/i;
const byRank = (a: BucketSpec, b: BucketSpec) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.title.localeCompare(b.title, 'de');

export function topicBuckets(topics: { name: string; states: Record<string, BucketSpec[]> }[], decisions: Decision[], agents: Record<string, string> = {}): TopicBuckets[] {
  return topics.map((t) => {
    const specs = Object.values(t.states).flat().filter(Boolean);
    const agentOf = (s: BucketSpec) => s.tickets.map((x) => agents[x.key]).find(Boolean) ?? null;
    const waiting = decisions.filter((d) => d.topic === t.name);
    const inWork = specs.filter((s) => s.state === '4-Review' || (s.state !== '5-Live' && agentOf(s))).sort(byRank).map((s) => ({ ...s, agent: agentOf(s) }));
    const next = specs.filter((s) => (s.state === '3-Plan' || s.state === '2-Pre-Plan') && !agentOf(s) && !s.tickets.some((x) => DONE.test(x.status ?? '') || ACTIVE.test(x.status ?? '')))
      .sort((a, b) => (a.state === b.state ? 0 : a.state === '3-Plan' ? -1 : 1) || byRank(a, b));
    const done = specs.filter((s) => s.state === '5-Live').sort((a, b) => String(b.verified ?? '').localeCompare(String(a.verified ?? '')) || byRank(a, b));
    return {
      topic: t.name,
      waiting: { count: waiting.length, items: waiting.slice(0, 2) },
      inWork: { count: inWork.length, items: inWork.slice(0, 3) },
      next: { count: next.length, items: next.slice(0, 3) },
      done: { count: done.length, items: done.slice(0, 3) },
      best: Math.min(1e9, ...specs.map((s) => s.rank ?? 1e9)),
    };
  }).sort((a, b) => b.waiting.count - a.waiting.count || a.best - b.best || a.topic.localeCompare(b.topic, 'de'));
}

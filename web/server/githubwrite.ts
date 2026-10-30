// Der EINZIGE Schreibweg des Web-Servers zu GitHub (Plan 157, Ergänzung A, von Knut am 13.10.2026 freigegeben):
// ein Review an genau einen PR — POST /repos/{owner}/{repo}/pulls/{n}/reviews mit commit_id = reviewter Kopf.
// Automatisch nur event COMMENT; APPROVE/REQUEST_CHANGES nur nach Knuts Klick in der Review-Ansicht (Route prüft Admin).
// Token: WERKBANK_GITHUB_WRITE_TOKEN (Tests/Notfall), sonst das Push-Token über den Credential-Helper (`git credential
// fill`, ohne GIT_VW_READ) — nur im Speicher dieses Aufrufs, nie im Log, nie im Frontend.
// Dazu (Knut 17.10.2026, Release 17c): EINE Statuszeile je Auto-Review als Issue-Kommentar am PR, die danach nur bearbeitet
// wird (POST …/issues/{n}/comments, PATCH …/issues/comments/{id}).
// Not-Aus: WERKBANK_GITHUB_KOMMENTAR=off (alles, auch der `@fix`-Push), WERKBANK_REVIEW_STATUS=off (nur die Statuszeile, prreview.ts).
// Zweiter Schreibweg (Knut 21.10.2026, Plan 286): `@fix`-Push auf den Kopf-Zweig eines PRs — siehe prfix.ts (pushVia).

import { execFile } from 'node:child_process';

export type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';
const API = () => (process.env.WERKBANK_GITHUB_API || 'https://api.github.com').replace(/\/$/, '');
const REPO_RE = /^[\w.-]{1,100}\/[\w.-]{1,100}$/;

export const schreibenAus = (env = process.env) => env.WERKBANK_GITHUB_KOMMENTAR === 'off';

// Plan 286: auch der `@fix`-Push (prfix.ts, nur WirStrom1 nach pushPruefung) holt sein Token hier — nur im Speicher.
export function writeToken(repo: string): Promise<string | null> {
  if (process.env.WERKBANK_GITHUB_WRITE_TOKEN) return Promise.resolve(process.env.WERKBANK_GITHUB_WRITE_TOKEN);
  const env: Record<string, string | undefined> = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/bin/false' };
  delete env.GIT_VW_READ;
  // Asynchron: der Helper fragt Vaultwarden (bis zu 20 s) — der Web-Server bleibt bedienbar.
  return new Promise((resolve) => {
    const c = execFile('git', ['-c', 'credential.useHttpPath=true', '-c', 'credential.interactive=never', 'credential', 'fill'], { env, timeout: 20_000, encoding: 'utf8' },
      (err, out) => resolve(err ? null : /^password=(.+)$/m.exec(String(out))?.[1]?.trim() || null));
    c.stdin?.end(`protocol=https\nhost=github.com\npath=${repo}.git\n\n`);
  });
}

export async function postReview(r: { repo: string; number: number; head: string }, body: string, event: ReviewEvent): Promise<{ url: string | null }> {
  if (schreibenAus()) throw new Error('GitHub-Schreiben ist aus (WERKBANK_GITHUB_KOMMENTAR=off).');
  if (!REPO_RE.test(r.repo) || !Number.isInteger(r.number) || r.number < 1 || !/^[0-9a-f]{40}$/.test(r.head)) throw new Error('PR-Angaben ungültig.');
  if (!['COMMENT', 'APPROVE', 'REQUEST_CHANGES'].includes(event)) throw new Error('Unbekannte Review-Art.');
  if (!body.trim()) throw new Error('Kein Text.');
  const token = await writeToken(r.repo);
  if (!token) throw new Error('Kein Schreibtoken für dieses Repo (Credential-Helper antwortet nicht).');
  const res = await fetch(`${API()}/repos/${r.repo}/pulls/${r.number}/reviews`, {
    method: 'POST', signal: AbortSignal.timeout(30_000), redirect: 'error',
    headers: { authorization: `bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'olaf-werkbank' },
    body: JSON.stringify({ commit_id: r.head, body, event }),
  });
  if (!res.ok) throw new Error(`GitHub antwortet mit ${res.status}${res.status === 422 ? ' (Stand passt nicht mehr oder eigener PR)' : res.status === 403 || res.status === 404 ? ' (keine Schreibrechte auf dieses Repo)' : ''}`);
  const j: any = await res.json().catch(() => ({}));
  return { url: typeof j.html_url === 'string' ? j.html_url : null };
}

/** Statuszeile: id = null → Kommentar anlegen, sonst genau diesen Kommentar ersetzen. */
export async function statusKommentar(r: { repo: string; number: number }, body: string, id: number | null): Promise<{ id: number; url: string | null }> {
  if (schreibenAus()) throw new Error('GitHub-Schreiben ist aus (WERKBANK_GITHUB_KOMMENTAR=off).');
  if (!REPO_RE.test(r.repo) || !Number.isInteger(r.number) || r.number < 1 || (id !== null && !(Number.isInteger(id) && id > 0))) throw new Error('PR-Angaben ungültig.');
  if (!body.trim()) throw new Error('Kein Text.');
  const token = await writeToken(r.repo);
  if (!token) throw new Error('Kein Schreibtoken für dieses Repo (Credential-Helper antwortet nicht).');
  const url = id === null ? `${API()}/repos/${r.repo}/issues/${r.number}/comments` : `${API()}/repos/${r.repo}/issues/comments/${id}`;
  const res = await fetch(url, {
    method: id === null ? 'POST' : 'PATCH', signal: AbortSignal.timeout(30_000), redirect: 'error',
    headers: { authorization: `bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'olaf-werkbank' },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`GitHub antwortet mit ${res.status}${res.status === 403 || res.status === 404 ? ' (keine Schreibrechte auf dieses Repo)' : ''}`);
  const j: any = await res.json().catch(() => ({}));
  if (!Number.isInteger(j.id)) throw new Error('GitHub lieferte keine Kommentar-Kennung.');
  return { id: j.id, url: typeof j.html_url === 'string' ? j.html_url : null };
}

/**
 * Dritter Schreibweg (Release 29, Ticket-Kette, jirakette.ts): ein Draft-PR — nur nach Knuts zweiter Freigabe und nur aus dem Takt der
 * Kette. Fest verdrahtet: draft = true, Basis nur develop/dev, Kopf nur `kette/…`; nie Merge, kein Update eines bestehenden PRs.
 */
export async function erstelleDraftPr(r: { repo: string; head: string; base: string; title: string; body: string }): Promise<{ number: number; url: string }> {
  if (schreibenAus()) throw new Error('GitHub-Schreiben ist aus (WERKBANK_GITHUB_KOMMENTAR=off).');
  if (!REPO_RE.test(r.repo) || !/^kette\/[\w.-]{1,150}$/.test(r.head) || !/^(develop|dev)$/.test(r.base)) throw new Error('PR-Angaben ungültig (Kopf kette/…, Basis develop|dev).');
  if (!r.title.trim() || !r.body.trim()) throw new Error('Kein Text.');
  const token = await writeToken(r.repo);
  if (!token) throw new Error('Kein Schreibtoken für dieses Repo (Credential-Helper antwortet nicht).');
  const res = await fetch(`${API()}/repos/${r.repo}/pulls`, {
    method: 'POST', signal: AbortSignal.timeout(30_000), redirect: 'error',
    headers: { authorization: `bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'olaf-werkbank' },
    body: JSON.stringify({ title: r.title.slice(0, 200), head: r.head, base: r.base, body: r.body.slice(0, 60_000), draft: true, maintainer_can_modify: false }),
  });
  if (!res.ok) throw new Error(`GitHub antwortet mit ${res.status}${res.status === 422 ? ' (PR existiert schon oder Zweig fehlt)' : res.status === 403 || res.status === 404 ? ' (keine Schreibrechte auf dieses Repo)' : ''}`);
  const j: any = await res.json().catch(() => ({}));
  if (!Number.isInteger(j.number) || typeof j.html_url !== 'string') throw new Error('GitHub lieferte keine PR-Nummer.');
  return { number: j.number, url: j.html_url };
}

/** R29 D (S5): PR öffnen — nur nach Klick im Hauptchat (githubaktion.ts). Kein Merge, kein Schließen. */
export async function prOeffnen(a: { repo: string; head: string; base: string; titel: string; text: string; entwurf: boolean }): Promise<{ url: string | null }> {
  if (schreibenAus()) throw new Error('GitHub-Schreiben ist aus (WERKBANK_GITHUB_KOMMENTAR=off).');
  if (!REPO_RE.test(a.repo)) throw new Error('Repo ungültig.');
  const token = await writeToken(a.repo);
  if (!token) throw new Error('Kein Schreibtoken für dieses Repo (Credential-Helper antwortet nicht).');
  const res = await fetch(`${API()}/repos/${a.repo}/pulls`, {
    method: 'POST', signal: AbortSignal.timeout(30_000), redirect: 'error',
    headers: { authorization: `bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'olaf-werkbank' },
    body: JSON.stringify({ title: a.titel, head: a.head, base: a.base, body: a.text, draft: a.entwurf }),
  });
  if (!res.ok) throw new Error(`GitHub antwortet mit ${res.status}${res.status === 422 ? ' (Zweig nicht auf GitHub, schon ein PR offen oder keine Unterschiede)' : res.status === 403 || res.status === 404 ? ' (keine Schreibrechte auf dieses Repo)' : ''}`);
  const j: any = await res.json().catch(() => ({}));
  return { url: typeof j.html_url === 'string' ? j.html_url : null };
}

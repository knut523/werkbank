// Der EINZIGE Schreibweg des Web-Servers zu GitHub (Plan 157, Ergänzung A, von Knut am 13.10.2026 freigegeben):
// ein Review an genau einen PR — POST /repos/{owner}/{repo}/pulls/{n}/reviews mit commit_id = reviewter Kopf.
// Automatisch nur event COMMENT; APPROVE/REQUEST_CHANGES nur nach Knuts Klick in der Review-Ansicht (Route prüft Admin).
// Token: WERKBANK_GITHUB_WRITE_TOKEN (Tests/Notfall), sonst das Push-Token über den Credential-Helper (`git credential
// fill`, ohne GIT_VW_READ) — nur im Speicher dieses Aufrufs, nie im Log, nie im Frontend.
// Not-Aus: WERKBANK_GITHUB_KOMMENTAR=off.

import { execFile } from 'node:child_process';

export type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';
const API = () => (process.env.WERKBANK_GITHUB_API || 'https://api.github.com').replace(/\/$/, '');
const REPO_RE = /^[\w.-]{1,100}\/[\w.-]{1,100}$/;

export const schreibenAus = (env = process.env) => env.WERKBANK_GITHUB_KOMMENTAR === 'off';

function writeToken(repo: string): Promise<string | null> {
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

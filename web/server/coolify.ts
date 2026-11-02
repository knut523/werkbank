// Coolify aus dem Hauptchat (R31 S3, Abnahme 9; Paket 400 D3): Variablen setzen, Neustart, Deploy — nur für Apps aus der
// Positivliste WERKBANK_COOLIFY_APPS (Muster mit *, Vorgabe knut-olaf-bot-demo*). Schreiben je Aufruf nach Klick (Karte der Brücke,
// Klick-Nachweis in der Route); `status` liest ohne Klick und zeigt Variablen nur mit NAMEN. Der Token kommt über den
// Geheimnis-Vermittler (Zweck „coolify“) und erreicht das Modell nie. Schalter WERKBANK_COOLIFY=on, Vorgabe aus.
// API laut Skill coolify-apps: /applications, /applications/{uuid}/envs (GET/POST/PATCH), /applications/{uuid}/restart,
// POST /deploy?uuid=…, /deployments/applications/{uuid}.

export const coolifyAn = (env: Record<string, string | undefined> = process.env) => env.WERKBANK_COOLIFY === 'on';
export const coolifyBasis = (env: Record<string, string | undefined> = process.env) => (env.WERKBANK_COOLIFY_URL || 'https://coolify.konekto.energy').replace(/\/+$/, '');

/** Positivliste der Apps (Muster, * = beliebig). */
export function appMuster(env: Record<string, string | undefined> = process.env): RegExp[] {
  const roh = (env.WERKBANK_COOLIFY_APPS ?? 'knut-olaf-bot-demo*').split(',').map((s) => s.trim()).filter((s) => /^[\w.*-]{1,80}$/.test(s));
  return roh.map((m) => new RegExp(`^${m.replace(/[.+?^${}()|[\]\\-]/g, '\\$&').replace(/\*/g, '.*')}$`));
}
export const appErlaubt = (name: string, muster: RegExp[]) => muster.some((m) => m.test(name));

export type CoolifyAktion =
  | { art: 'status'; app: string }
  | { art: 'variable_setzen'; app: string; key: string; value: string }
  | { art: 'neustart'; app: string }
  | { art: 'deploy'; app: string };

export function pruefeCoolify(a: Record<string, unknown>, muster: RegExp[]): CoolifyAktion | { fehler: string } {
  const app = String(a.app ?? '').trim();
  if (!/^[\w.-]{1,80}$/.test(app)) return { fehler: 'app: Name der Coolify-App.' };
  if (!appErlaubt(app, muster)) return { fehler: `app: ${app} ist nicht freigegeben (WERKBANK_COOLIFY_APPS).` };
  if (a.art === 'status' || a.art === 'neustart' || a.art === 'deploy') return { art: a.art, app };
  if (a.art === 'variable_setzen') {
    const key = String(a.key ?? '').trim(), value = String(a.value ?? '');
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,80}$/.test(key)) return { fehler: 'key: Variablenname (Buchstaben, Ziffern, _).' };
    // Skill coolify-apps: keine mehrzeiligen Werte (dann als _B64 ablegen).
    if (/[\r\n]/.test(value) || value.length > 4000) return { fehler: 'value: einzeilig, höchstens 4000 Zeichen (mehrzeilig als Base64 in einer *_B64-Variable).' };
    return { art: 'variable_setzen', app, key, value };
  }
  return { fehler: 'art: status, variable_setzen, neustart oder deploy.' };
}

export type Api = (methode: string, pfad: string, body?: unknown) => Promise<{ status: number; json: any; text: string }>;

const ok = (r: { status: number; text: string }, was: string) => {
  if (r.status < 200 || r.status >= 300) throw new Error(`Coolify ${was}: HTTP ${r.status} ${r.text.slice(0, 300)}`);
};

/** App-UUID zum Namen — nur, wenn der Name auf der Liste steht und eindeutig ist. */
async function appVon(api: Api, name: string): Promise<{ uuid: string; name: string; status?: string; fqdn?: string }> {
  const r = await api('GET', '/api/v1/applications');
  ok(r, 'Apps lesen');
  const treffer = (Array.isArray(r.json) ? r.json : []).filter((a: any) => a?.name === name && typeof a?.uuid === 'string');
  if (treffer.length !== 1) throw new Error(treffer.length ? `Coolify: ${treffer.length} Apps heißen ${name} — nicht eindeutig.` : `Coolify: keine App ${name}.`);
  return treffer[0];
}

/** Aktion ausführen (Klick ist vorher geprüft). Gibt nur Namen/Zustände zurück, nie Variablenwerte. */
export async function fuehreAus(a: CoolifyAktion, api: Api): Promise<string> {
  const app = await appVon(api, a.app);
  const u = encodeURIComponent(app.uuid);
  if (a.art === 'status') {
    const [envs, dep] = await Promise.all([api('GET', `/api/v1/applications/${u}/envs`), api('GET', `/api/v1/deployments/applications/${u}`)]);
    const keys = Array.isArray(envs.json) ? [...new Set(envs.json.map((e: any) => String(e?.key ?? '')).filter(Boolean))].sort() : [];
    const deps: any[] = Array.isArray(dep.json) ? dep.json : Array.isArray(dep.json?.deployments) ? dep.json.deployments : [];
    return [`Coolify-App **${app.name}**: ${app.status ?? 'Zustand unbekannt'}${app.fqdn ? ` · ${app.fqdn}` : ''}`,
      `Variablen (nur Namen, ${keys.length}): ${keys.join(', ') || '—'}`,
      `Letzte Deployments: ${deps.slice(0, 3).map((d) => `${d?.status ?? '?'} (${String(d?.created_at ?? d?.updated_at ?? '').slice(0, 16)})`).join(' · ') || '—'}`].join('\n');
  }
  if (a.art === 'variable_setzen') {
    const envs = await api('GET', `/api/v1/applications/${u}/envs`);
    ok(envs, 'Variablen lesen');
    const da = Array.isArray(envs.json) && envs.json.some((e: any) => e?.key === a.key);
    const r = await api(da ? 'PATCH' : 'POST', `/api/v1/applications/${u}/envs`, { key: a.key, value: a.value, is_preview: false });
    ok(r, 'Variable setzen');
    return `Coolify-App ${app.name}: Variable ${a.key} ${da ? 'geändert' : 'angelegt'}. Wirkt erst nach Neustart/Deploy.`;
  }
  if (a.art === 'neustart') {
    const r = await api('GET', `/api/v1/applications/${u}/restart`);
    ok(r, 'Neustart');
    return `Coolify-App ${app.name}: Neustart ausgelöst (baut neu, dauert einige Minuten). Stand mit coolify art=status.`;
  }
  const r = await api('POST', `/api/v1/deploy?uuid=${u}`);
  ok(r, 'Deploy');
  return `Coolify-App ${app.name}: Deploy ausgelöst. Stand mit coolify art=status.`;
}

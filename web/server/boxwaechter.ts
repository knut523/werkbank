// Box-Heartbeat (Knut 19.10.: „läuft eigentlich ein Heartbeat-Monitor, der rechtzeitig warnt?“). Jede Minute aus dem cos-Takt:
// echter Speicher der Box und freier Speicher des (geteilten) Hosts, wie der Review-Deckel. Meldet nur Stufenwechsel an den Hauptchat.
import { speicherStand, SPEICHER } from './prreview.ts';
import { meldeLeitstand } from './leitstand.ts';
import { wb } from './db.ts';

export type BoxStufe = 'ok' | 'warnung' | 'kritisch';
/** Rein: Stufe aus dem Stand. kritisch = gleich wird es eng (Host fast voll oder echt > 11 GB); warnung = keine schweren Starts mehr. */
export function boxStufe(sp: { echtGb: number; hostFreiGb: number } | null): BoxStufe {
  if (!sp) return 'ok';
  if (sp.hostFreiGb < SPEICHER.hostNotGb || sp.echtGb > 11) return 'kritisch';
  if (sp.hostFreiGb < SPEICHER.hostMinGb || sp.echtGb > SPEICHER.echtMaxGb) return 'warnung';
  return 'ok';
}

const meta = () => wb().collection('meta');
export async function boxTick(deps: { userById: (id: string) => Promise<any>; ownerId: () => Promise<string | null>; log?: (m: string, d?: any) => void; speicher?: typeof speicherStand }, now = Date.now()): Promise<BoxStufe | null> {
  const sp = (deps.speicher ?? speicherStand)();
  const stufe = boxStufe(sp);
  const alt: any = await meta().findOne({ _id: 'box_heartbeat' as any });
  await meta().updateOne({ _id: 'box_heartbeat' as any }, { $set: { stufe, at: new Date(now), echtGb: sp?.echtGb ?? null, hostFreiGb: sp?.hostFreiGb ?? null } }, { upsert: true });
  if ((alt?.stufe ?? 'ok') === stufe) return null;
  const owner = await deps.ownerId().catch(() => null);
  const u = owner ? await deps.userById(owner).catch(() => null) : null;
  const zahlen = sp ? `echt ${sp.echtGb.toFixed(1)} GB von 16, Host frei ${sp.hostFreiGb.toFixed(1)} GB` : 'Stand nicht lesbar';
  const text = stufe === 'kritisch' ? `⚠️ Box kritisch: ${zahlen}. Keine neuen Stränge/Tests/Builds; laufende Testinstanzen stoppen.`
    : stufe === 'warnung' ? `Box knapp: ${zahlen}. Neue Reviews warten, keine schweren Starts.`
    : `Box wieder im grünen Bereich: ${zahlen}.`;
  if (u) await meldeLeitstand(u, { _id: 'box', title: 'Box-Speicher' }, text, now).catch(() => false);
  deps.log?.('box heartbeat', { stufe, alt: alt?.stufe ?? 'ok', ...sp });
  return stufe;
}

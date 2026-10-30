// Box-Heartbeat (Knut 19.10.: „läuft eigentlich ein Heartbeat-Monitor, der rechtzeitig warnt?“). Jede Minute aus dem cos-Takt:
// echter Speicher der Box und freier Speicher des (geteilten) Hosts, wie der Review-Deckel. Meldet Stufenwechsel an den Hauptchat.
// Hysterese (Knut 23.10., q-d76f5c: „Box knapp“ und „Box wieder im grünen Bereich“ pendelten im Minutentakt, weil der Host um
// die Schwelle schwankt): „knapp“ unter hostMinGb (6), zurück auf „grün“ erst ab hostGruenGb (8); kritisch bleibt sofort.
// Dazu höchstens eine warnung/ok-Meldung je meldungPauseMin (30) — kritisch geht ungehindert raus.
import { speicherStand, SPEICHER } from './prreview.ts';
import { meldeLeitstand } from './leitstand.ts';
import { wb } from './db.ts';

export type BoxStufe = 'ok' | 'warnung' | 'kritisch';
export type BoxSchwellen = typeof SPEICHER;
export { SPEICHER };
/** Rein: Stufe aus dem Stand. kritisch = gleich wird es eng (Host fast voll oder echt > 11 GB); warnung = keine schweren Starts mehr.
 *  `alt` ist die gemeldete Stufe davor: von „warnung“ zurück auf „ok“ erst ab hostGruenGb (Hysterese), von „ok“ unter hostMinGb sofort „warnung“. */
export function boxStufe(sp: { echtGb: number; hostFreiGb: number } | null, alt: BoxStufe = 'ok', s: BoxSchwellen = SPEICHER): BoxStufe {
  if (!sp) return 'ok';
  if (sp.hostFreiGb < s.hostNotGb || sp.echtGb > 11) return 'kritisch';
  if (sp.hostFreiGb < s.hostMinGb || sp.echtGb > s.echtMaxGb) return 'warnung';
  if (alt === 'warnung' && sp.hostFreiGb < s.hostGruenGb) return 'warnung';   // Hysterese: zwischen knapp und grün bleibt es knapp
  return 'ok';
}

const meta = () => wb().collection('meta');
export async function boxTick(deps: { userById: (id: string) => Promise<any>; ownerId: () => Promise<string | null>; log?: (m: string, d?: any) => void; speicher?: typeof speicherStand }, now = Date.now()): Promise<BoxStufe | null> {
  const sp = (deps.speicher ?? speicherStand)();
  const alt: any = await meta().findOne({ _id: 'box_heartbeat' as any });
  // Hysterese und Drosselung beziehen sich auf die zuletzt GEMELDETE Stufe: eine gedrosselte Meldung geht nicht verloren —
  // der nächste Takt sieht den Wechsel weiter (meldungStufe ändert sich erst mit der Meldung selbst).
  const gemeldet: BoxStufe = alt?.meldungStufe ?? 'ok';
  const stufe = boxStufe(sp, gemeldet);
  await meta().updateOne({ _id: 'box_heartbeat' as any }, { $set: { stufe, at: new Date(now), echtGb: sp?.echtGb ?? null, hostFreiGb: sp?.hostFreiGb ?? null } }, { upsert: true });
  if (gemeldet === stufe) return null;
  // Drossel (Knut 23.10.): warnung und ok höchstens einmal je meldungPauseMin — kritisch immer sofort.
  const seit = alt?.meldungAt ? now - new Date(alt.meldungAt).getTime() : Infinity;
  if (stufe !== 'kritisch' && seit < SPEICHER.meldungPauseMin * 60_000) { deps.log?.('box heartbeat', { stufe, alt: gemeldet, gedrosselt: true, ...sp }); return null; }
  await meta().updateOne({ _id: 'box_heartbeat' as any }, { $set: { meldungAt: new Date(now), meldungStufe: stufe } });
  const owner = await deps.ownerId().catch(() => null);
  const u = owner ? await deps.userById(owner).catch(() => null) : null;
  const zahlen = sp ? `echt ${sp.echtGb.toFixed(1)} GB von 16, Host frei ${sp.hostFreiGb.toFixed(1)} GB` : 'Stand nicht lesbar';
  const text = stufe === 'kritisch' ? `⚠️ Box kritisch: ${zahlen}. Keine neuen Stränge/Tests/Builds; laufende Testinstanzen stoppen.`
    : stufe === 'warnung' ? `Box knapp: ${zahlen}. Neue Reviews warten, keine schweren Starts.`
    : `Box wieder im grünen Bereich: ${zahlen}.`;
  if (u) await meldeLeitstand(u, { _id: 'box', title: 'Box-Speicher' }, text, now).catch(() => false);
  deps.log?.('box heartbeat', { stufe, alt: gemeldet, ...sp });
  return stufe;
}

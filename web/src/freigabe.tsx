// „Push freigeben“ (docs/plan-leitstand.md, D2; Plan 184, Council 5): genau den gesehenen Stand freigeben — Stand live holen,
// im Dialog zeigen, bestätigen lassen. Gemeinsam für Heute und Übersicht. Gepusht wird nie von hier (das macht die Hauptsitzung
// nach ihrer Prüfung), gemergt nie.
import { api } from './api.ts';
import { useConfirm } from './ui.tsx';

export function usePushFreigeben() {
  const confirm = useConfirm();
  /** true = freigegeben, false = abgebrochen; wirft bei Fehlern. */
  return async (id: string): Promise<boolean> => {
    const r: any = await api(`/api/review/${id}`);
    const repo = r.repo ?? {};
    if (repo.fehler) throw new Error(repo.fehler);
    const ok = await confirm({ title: 'Push freigeben?', confirmLabel: 'Genau diesen Stand freigeben', body: <>
      <p className="small">Freigegeben wird <b>nur dieser Stand</b>. Ändert sich danach ein Commit (auch ein Rebase), verfällt die Freigabe. Pushen macht der Hauptchat nach seiner Prüfung; gemergt wird nie.</p>
      <ul className="small plain"><li>Zweig <code>{repo.branch}</code></li><li>{(repo.commits ?? []).length} Commit(s){repo.clean ? '' : ' — ⚠ ungespeicherte Änderungen'}</li></ul>
      <details className="tiny"><summary>Technische Details</summary>
        <p>Kopf <code>{String(repo.head ?? '').slice(0, 12)}</code> · Basis <code>{repo.baseRef}</code></p>
        {(repo.commits ?? []).length > 0 && <pre className="tiny" style={{ whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' }}>{(repo.commits ?? []).map((c: any) => (typeof c === 'string' ? c : `${String(c.sha ?? '').slice(0, 8)} ${c.subject ?? ''}`)).join('\n')}</pre>}
        {repo.stat && <pre className="tiny" style={{ whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' }}>{repo.stat}</pre>}</details>
      <p className="tiny"><a href={`#/leitstand?review=${id}`}>Ganzen Diff und Review-Ansicht öffnen</a></p></> });
    if (!ok) return false;
    await api(`/api/review/${id}/freigabe`, { body: { head: repo.head, patchId: repo.patchId ?? null } });
    return true;
  };
}

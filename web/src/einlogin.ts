// Plan 213 S9 (D7, Schalter WERKBANK_EIN_LOGIN): der Workspace nur noch eingebettet im Chat. Wer die Direktadresse
// öffnet, landet mit derselben Unterseite unter /wb/ im Chat — alle alten Hash-Adressen bleiben Alias (185 B3, P8),
// gezählt wird über die Seitenzählung (Zugang „direkt“, S0). `?direkt=1` bleibt als Notausgang, falls der Chat hängt.

/** Ziel im Chat für eine Direktadresse; der Hash geht unverändert als `h` mit (WerkbankRoute liest ihn). */
export function einLoginZiel(librechatUrl: string, hash: string): string {
  const h = hash && hash.startsWith('#/') ? hash : '#/';
  return `${librechatUrl.replace(/\/+$/, '')}/wb/heute?h=${encodeURIComponent(h)}`;
}

/** Umleiten? Nur mit Schalter, nur außerhalb des Chats und ohne Notausgang. */
export function einLoginUmleiten(o: { an: boolean; embedded: boolean; search: string }): boolean {
  return o.an && !o.embedded && !new URLSearchParams(o.search).has('direkt');
}

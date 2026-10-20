// U5 (Knut 19.10.: „so bauen, dass jemand einfach darauf onboarded werden kann“): der erste Start des Leads braucht nur einen Satz.
// Er kommt in die automatisch erzeugte Übergabe — als „Woran wir gerade arbeiten“ und als erster Punkt unter „Was als Nächstes ansteht“.
export function mitErstemSatz(vorlage: string, satz: string): string {
  const s = satz.replace(/\s+/g, ' ').trim();
  if (!s) return vorlage;
  let t = vorlage.replace(/^(- Woran wir gerade arbeiten \(ein bis drei Sätze\): ).*$/m, (_, k) => k + s);
  t = /^## Was als Nächstes ansteht\n1\. *$/m.test(t) ? t.replace(/^(## Was als Nächstes ansteht\n1\. ) *$/m, (_, k) => k + s) : `${t}\n\n## Was als Nächstes ansteht\n1. ${s}`;
  return t;
}

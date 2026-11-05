// Plan §24 A5 (Knut 05.11.): übersprungene Reviews ohne neuen Anstoß (z. B. #393 um 09:17: „neuer Stand seit dem Tag“) einmal
// täglich nachholen — höchstens einmal je PR und Tag, nie für gemergte/geschlossene oder zusammengefasste.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nachholKandidaten } from '../server/prticker.ts';

const r = (o: any) => ({ repo: 'WirStrom1/olaf-admin', number: 393, head: 'aaa', status: 'fertig', note: '', createdAt: new Date('2026-11-05T08:00:00Z'), trigger: 'tag', day: '2026-11-05', ...o });

test('A5: zuletzt übersprungen wegen neuem Stand → Kandidat; gemergt/geschlossen/zusammengefasst nicht', () => {
  const l = [
    r({ head: 'aaa', status: 'fertig', createdAt: new Date('2026-11-04T08:00:00Z') }),
    r({ head: 'bbb', status: 'übersprungen', note: 'neuer Stand ccc1234 seit dem Tag — für den neuen Stand neu taggen', createdAt: new Date('2026-11-05T09:17:00Z') }),
    r({ number: 400, status: 'übersprungen', note: 'PR gemergt' }),
    r({ number: 401, status: 'übersprungen', note: 'zusammengefasst: neuer Stand ddd kam innerhalb von 10 min' }),
    r({ number: 402, status: 'fertig' }),
  ];
  assert.deepEqual(nachholKandidaten(l, '2026-11-06').map((x) => `${x.repo}#${x.number}`), ['WirStrom1/olaf-admin#393']);
});

test('A5: heute schon nachgeholt → nicht noch einmal; danach wieder fertig → kein Kandidat', () => {
  const ueb = r({ head: 'bbb', status: 'übersprungen', note: 'neuer Stand seit dem Tag', createdAt: new Date('2026-11-05T09:17:00Z') });
  assert.deepEqual(nachholKandidaten([ueb, r({ head: 'ccc', trigger: 'nachholen', status: 'wartet', day: '2026-11-06', createdAt: new Date('2026-11-06T07:00:00Z') })], '2026-11-06'), []);
  assert.deepEqual(nachholKandidaten([ueb, r({ head: 'ccc', status: 'fertig', createdAt: new Date('2026-11-05T12:00:00Z') })], '2026-11-06'), []);
});

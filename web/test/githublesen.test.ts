// Lead-Lücke aus Paket 217: privates GitHub NUR LESEN — feste Liste lesender REST-Pfade, Datei-Inhalte lesbar, gekürzt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { githubLesePfad, githubLeseText } from '../server/githublesen.ts';

test('erlaubt: lesende Pfade mit einfachen Parametern; Repo wird erkannt', () => {
  for (const p of ['repos/WirStrom1/olaf-admin/pulls', 'repos/WirStrom1/olaf-admin/pulls/354', 'repos/WirStrom1/olaf-admin/pulls/354/files',
    'repos/o/r/issues/12/comments', 'repos/o/r/contents/src/a.ts?ref=main', 'repos/o/r/commits/abc1234', 'repos/o/r/compare/main...feat/x',
    'repos/o/r/actions/runs?per_page=5', '/repos/o/r/pulls?state=open', 'repos/o/r/commits/abcdef1/check-runs']) {
    const r = githubLesePfad(p);
    assert.ok('pfad' in r, p);
  }
  assert.equal((githubLesePfad('repos/WirStrom1/olaf-admin/pulls/354') as any).repo, 'WirStrom1/olaf-admin');
});

test('gesperrt: fremde Endpunkte, Schreibähnliches, Pfadtricks, freie Parameter', () => {
  for (const p of ['user', 'repos/o/r', 'repos/o/r/hooks', 'repos/o/r/collaborators', 'repos/o/r/pulls/1/merge', 'orgs/x/members',
    'repos/o/r/contents/../../x', 'repos/o/r/contents/x/compare/../../../../user/emails', 'repos/o/r/compare/a/../../../user...b', 'repos/o/r/contents/./x', 'repos/o/r/pulls?access_token=x', 'repos/o/r/pulls?state=open&q=a b', 'graphql', 'repos/o/r/git/refs']) {
    assert.ok('fehler' in githubLesePfad(p), p);
  }
});

test('Datei-Inhalte (base64) werden lesbar, lange Antworten gekürzt', () => {
  const t = githubLeseText(JSON.stringify({ path: 'a.ts', size: 5, encoding: 'base64', content: Buffer.from('hallo').toString('base64') }));
  assert.equal(t, 'Datei a.ts (5 Bytes):\nhallo');
  assert.match(githubLeseText('x'.repeat(70_000)), /gekürzt, 70000 Zeichen/);
});

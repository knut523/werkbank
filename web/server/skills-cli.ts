// scripts/werkbank.sh skills → Vault-Skills abgleichen (Vorgabe: nur berichten; --apply verlinkt fehlende).
import { cfg } from './config.ts';
import { listSkills, syncSkills } from './skills.ts';

const apply = process.argv.includes('--apply');
const asJson = process.argv.includes('--json');
const src = cfg.skillsSource, dst = cfg.skillsTarget;
const res = apply ? syncSkills(src, dst) : { linked: [], skipped: [] };
const all = listSkills(src, dst);
if (asJson) { console.log(JSON.stringify({ source: src, target: dst, linked: res.linked, skills: all }, null, 1)); process.exit(0); }
console.log(`Skills: Quelle ${src} → Ziel ${dst}`);
for (const n of res.linked) console.log(`  + verlinkt: ${n}`);
const by = (st: string) => all.filter((s) => s.state === st);
console.log(`  = verlinkt aus dem Vault: ${by('verlinkt').length}`);
for (const st of ['fehlt', 'lokale Kopie, abweichend', 'lokale Kopie, gleich', 'Link woandershin', 'kaputter Link']) {
  for (const s of by(st)) console.log(`  ! ${st}: ${s.name}${s.path ? '  (' + s.path + ')' : ''}`);
}
console.log(`  · nur lokal (nicht aus dem Vault): ${by('nur lokal').map((s) => s.name).join(', ') || '—'}`);
if (!apply && by('fehlt').length) console.log('  → Fehlende verlinken: scripts/werkbank.sh skills --apply');
if (by('lokale Kopie, abweichend').length) console.log('  → Abweichende lokale Kopien werden nicht angefasst. Wer die Vault-Fassung will: Ordner löschen und erneut abgleichen.');

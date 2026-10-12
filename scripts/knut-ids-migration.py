#!/usr/bin/env python3
"""Stabile Kennungen für leere Knut-Zeilen in den Roadmap-Specs (docs/plan-knut-ids.md, Knut 12.10.2026).

    - Knut:                          →   - Knut (<datei-basename>#K<n>):

Nur leere Zeilen, die exakt `- Knut:` sind (Einrückung und Callout-Präfix `> ` bleiben); beantwortete Zeilen,
`- Knut (29.09.): …` und alles in Code-Blöcken bleibt unberührt. Je Datei K1…Kn in Dateireihenfolge; danach geht es
bei max+1 weiter — auch über gelöschte Zeilen hinweg (Höchststand je Datei in --stand), damit eine Kennung nie zweimal
vergeben wird. Ein zweiter Lauf ändert nichts.

Zielbereich (sonst wird nichts gelesen und nichts geschrieben), relativ zu --root:
    olaf/2-Areas/Product/Produkt-OLAF/1-Roadmap/*/{1-Backlog,2-Pre-Plan,3-Plan,4-Review}/*.md
Das Register `0-Overview/offene-fragen-*` bekommt keine Kennungen: nach Prozess v4 („Inbox — ein Antwortort“) ist es
nur Anzeige; seine Antwortzeilen wandern in die Spec oder werden Verweise. Das zeigt der Lauf nur als Zahl an.

    knut-ids-migration.py [--root /vault] [--dry-run]     Standard: zeigt je Datei Anzahl und Diff, schreibt nichts
    knut-ids-migration.py --apply [--backup DIR]           Sicherungskopie, dann je Datei tmp+rename

--apply bricht ab, solange die Werkbank (web/server/roadmap.ts, `knutId`) oder roadmap_check.py (`KNUT_EMPTY`) die
Form mit Kennung nicht kennen — sonst verschwinden die Fragen dort —, wenn die Vault-Sync-Sperre nicht zu haben ist
oder wenn der Probelauf Warnungen hat (doppelte/fremde Kennungen, Dateiname ungeeignet). Eine Datei wird nur
geschrieben, wenn sie seit dem Lesen unverändert ist.
"""
import argparse, difflib, fcntl, hashlib, json, os, re, shutil, sys, time
from pathlib import Path

BASE = 'olaf/2-Areas/Product/Produkt-OLAF/1-Roadmap'
STATES = ('1-Backlog', '2-Pre-Plan', '3-Plan', '4-Review')
PREFIX = 'K'   # Knut 12.10.2026: K statt E — viele Specs nummerieren ihre Entscheidungen selbst mit E1…
EMPTY = re.compile(r'^((?:> ?)*)(\s*)([-*])\s+Knut:[ \t]*$')
# dieselbe strikte Form wie KNUT in web/server/roadmap.ts
SLUG = re.compile(r'^[a-z0-9][a-z0-9-]*$')
WITH_ID = re.compile(r'^(?:> ?)*\s*[-*]\s+Knut \(([a-z0-9][a-z0-9-]*)#([A-Z])(\d+)\):')
FENCE = re.compile(r'^(```|~~~)')
CACHE = Path.home() / '.cache/vault-sync'
LOCK = Path(os.environ.get('VAULT_SYNC_LOCK', CACHE / '.lock'))
LOCK_WAIT = int(os.environ.get('VAULT_SYNC_LOCK_WAIT', '30'))   # Sekunden
# Vorprüfung: erst schreiben, wenn beide Leser die Form mit Kennung kennen (Marker im Quelltext)
NEEDS = {
    'werkbank': (Path.home() / 'work/werkbank-dev/web/server/roadmap.ts', 'knutId'),
    'check': (Path('/vault/_meta/dist-skill/olaf-produkt-roadmap/scripts/roadmap_check.py'), 'KNUT_EMPTY'),
}


def targets(root: Path):
    base = root / BASE
    return sorted(p for st in STATES for p in base.glob(f'*/{st}/*.md') if p.is_file() and in_scope(root, p))


def in_scope(root: Path, p: Path) -> bool:
    """Auch nach realpath im Zielbereich (kein Symlink nach draußen)."""
    try:
        rel = p.resolve().relative_to((root / BASE).resolve()).parts
    except ValueError:
        return False
    return len(rel) == 3 and rel[1] in STATES and rel[2].endswith('.md')


def scan(lines):
    """Zeilen außerhalb von Code-Blöcken: (Index, Zeile)."""
    code = False
    for i, l in enumerate(lines):
        if FENCE.match(l):
            code = not code
        elif not code:
            yield i, l


def migrate(text: str, slug: str, floor: int = 0):
    """→ (neuer Text, Anzahl neu vergebener Kennungen, höchste Nummer danach, Warnungen)."""
    lines = text.split('\n')
    used, warn = {}, []
    for i, l in scan(lines):
        m = WITH_ID.match(l)
        if not m:
            continue
        if m[1] != slug:
            warn.append(f'Z. {i + 1}: Kennung {m[1]}#{m[2]}{m[3]} gehört nicht zu dieser Datei ({slug})')
        elif m[2] != PREFIX:
            warn.append(f'Z. {i + 1}: Kennung {slug}#{m[2]}{m[3]} mit anderem Präfix als {PREFIX}')
        else:
            n = int(m[3])
            if n in used:
                warn.append(f'Z. {i + 1}: Kennung {slug}#{PREFIX}{n} doppelt (auch Z. {used[n]})')
            used.setdefault(n, i + 1)
    top, added = max([floor, *used]), 0
    for i, l in list(scan(lines)):
        m = EMPTY.match(l)
        if m:
            top, added = top + 1, added + 1
            lines[i] = f'{m[1]}{m[2]}{m[3]} Knut ({slug}#{PREFIX}{top}):'
    return '\n'.join(lines), added, top, warn


def write_atomic(p: Path, text: str, expect_sha: str | None = None):
    if expect_sha is not None and hashlib.sha256(p.read_bytes()).hexdigest() != expect_sha:
        raise RuntimeError('seit dem Lesen geändert — übersprungen')
    mode = p.stat().st_mode & 0o7777 if p.exists() else 0o644
    tmp = p.with_name(f'.{p.name}.knut-ids-{os.getpid()}.tmp')
    try:
        with open(tmp, 'w', encoding='utf-8', newline='') as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, mode)
        os.replace(tmp, p)
    finally:
        if tmp.exists():
            tmp.unlink()


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--root', default='/vault', help='Vault-Wurzel (Standard /vault)')
    g = ap.add_mutually_exclusive_group()
    g.add_argument('--dry-run', action='store_true', help='nur zeigen (Standard)')
    g.add_argument('--apply', action='store_true', help='schreiben (Sicherungskopie vorab)')
    ap.add_argument('--backup', help='Ordner für die Sicherungskopie (Standard ~/work/knut/backups/knut-ids-<Zeit>)')
    ap.add_argument('--stand', default=str(CACHE / 'knut-ids-stand.json'), help='Höchststand je Datei (JSON)')
    ap.add_argument('--pruef-werkbank', default=str(NEEDS['werkbank'][0]), help='roadmap.ts der laufenden Werkbank')
    ap.add_argument('--pruef-check', default=str(NEEDS['check'][0]), help='roadmap_check.py des Skills')
    ap.add_argument('--no-diff', action='store_true', help='nur Anzahl je Datei, kein Diff')
    a = ap.parse_args(argv)
    root = Path(a.root)
    if not (root / BASE).is_dir():
        print(f'kein Roadmap-Ordner unter {root / BASE}', file=sys.stderr)
        return 2
    stand_p = Path(a.stand)
    stand = json.loads(stand_p.read_text()) if stand_p.exists() else {}

    plan, warns, total, tops = [], 0, 0, {}
    for p in targets(root):
        rel = p.relative_to(root)
        if not SLUG.match(p.stem):
            print(f'WARN {rel}: Dateiname taugt nicht als Kennung ([a-z0-9-]) — übersprungen')
            warns += 1
            continue
        raw = p.read_bytes()
        text = raw.decode('utf-8')
        new, n, top, warn = migrate(text, p.stem, int(stand.get(p.stem, 0)))
        tops[p.stem] = top
        for w in warn:
            print(f'WARN {rel}: {w}')
        warns += len(warn)
        if not n:
            continue
        total += n
        plan.append((p, new, hashlib.sha256(raw).hexdigest()))
        print(f'{n:4d}  {rel}')
        if not a.no_diff:
            sys.stdout.writelines(difflib.unified_diff(text.splitlines(True), new.splitlines(True), f'a/{rel}', f'b/{rel}', n=0))
            print()
    reg = sum(len([1 for _, l in scan(f.read_text(encoding='utf-8').split('\n')) if EMPTY.match(l)])
              for f in sorted((root / BASE / '0-Overview').glob('offene-fragen-*.md')))
    print(f'\n{total} Kennung(en) in {len(plan)} Datei(en), {warns} Warnung(en) — {"wird geschrieben" if a.apply else "Probelauf, nichts geschrieben"}')
    if reg:
        print(f'Register offene-fragen-*: {reg} leere Knut-Zeile(n), nicht migriert (Prozess v4: nur Anzeige — nach --apply Vorschlagsstapel „in Spec umhängen“/„Verweis“, Knut gibt frei)')
    if not a.apply:
        return 0

    # ---- --apply: erst alle Vorbedingungen, dann Sperre, Sicherung, Schreiben
    if warns:
        print('Abbruch: erst die Warnungen klären — nichts geschrieben.', file=sys.stderr)
        return 4
    for name, path in (('Werkbank', a.pruef_werkbank), ('roadmap_check.py', a.pruef_check)):
        marker = NEEDS['werkbank' if name == 'Werkbank' else 'check'][1]
        try:
            ok = marker in Path(path).read_text(encoding='utf-8')
        except OSError:
            ok = False
        if not ok:
            print(f'Abbruch: {name} ({path}) kennt die Form mit Kennung noch nicht (kein „{marker}“) — erst einspielen, nichts geschrieben.', file=sys.stderr)
            return 5
    if not LOCK.parent.is_dir():
        print(f'Abbruch: kein Ordner für die Vault-Sync-Sperre ({LOCK.parent}) — nichts geschrieben.', file=sys.stderr)
        return 3
    lock = open(LOCK, 'a')
    try:
        for _ in range(max(LOCK_WAIT, 1)):
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                time.sleep(1)
        else:
            print('Vault-Sync läuft (Sperre belegt) — nichts geschrieben, später nochmal.', file=sys.stderr)
            return 3
        failed = set()
        if plan:
            bdir = Path(a.backup or Path.home() / f'work/knut/backups/knut-ids-{time.strftime("%Y%m%d-%H%M%S")}')
            for p, _, _ in plan:
                dst = bdir / p.relative_to(root)
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(p, dst)
            print(f'Sicherungskopie: {bdir}')
            for p, new, sha in plan:
                try:
                    if not in_scope(root, p):
                        raise RuntimeError('außerhalb des Zielbereichs')
                    write_atomic(p, new, sha)
                except Exception as e:  # eine Datei, nicht der ganze Lauf
                    failed.add(p.stem)
                    print(f'FEHLER {p.relative_to(root)}: {e}', file=sys.stderr)
        # Höchststand nur für geschriebene/unveränderte Dateien fortschreiben, nie senken — unter der Sperre neu lesen,
        # damit ein überlappender Lauf nichts zurücksetzt
        if stand_p.exists():
            for slug, top in json.loads(stand_p.read_text()).items():
                stand[slug] = max(int(top), int(stand.get(slug, 0)))
        for slug, top in tops.items():
            if slug not in failed and top > int(stand.get(slug, 0)):
                stand[slug] = top
        stand_p.parent.mkdir(parents=True, exist_ok=True)
        write_atomic(stand_p, json.dumps(stand, indent=1, sort_keys=True) + '\n')
    finally:
        lock.close()
    print(f'geschrieben: {len(plan) - len(failed)} Datei(en), Fehler: {len(failed)}')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())

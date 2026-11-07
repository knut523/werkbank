// Plan 465 (06.11.): die Sperre „Merge über GitHub“ traf Berichtstexte, und Commit-/Heredoc-Text wurde als Befehl gelesen.
// Gesperrt bleibt, was wirklich ausführt: ein HTTP-Client oder gh api auf …/pulls/<n>/merge, gh pr merge, git merge — und jeder
// Heredoc, den eine Shell oder ein Interpreter liest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orchestratorBlock, classify } from '../src/tools.ts';

const block = (command: string) => orchestratorBlock('Bash', { command });
const voll = (command: string) => classify('Bash', { command }, { workDir: '/tmp/wt-465', scope: 'voll' }).cls;
const L = 'https://github.com/WirStrom1/olaf-admin/pull/397';

test('Plan 465: Bericht per Heredoc mit GitHub-Link und „/merge-Strategie“ ist Text, kein Merge', () => {
  const c = `cat > /tmp/wt-465/bericht.md <<'E'\n# Review\nSiehe ${L} — die /merge-Strategie bleibt.\nE`;
  assert.equal(block(c), null);
  assert.notEqual(voll(c), 'blocked');
});

test('Plan 465: Commit-Text im Heredoc (git commit -F -) und in $(cat <<EOF) ist Inhalt', () => {
  assert.equal(block(`git commit -q -F - <<'EOF'\nGegenprüfung: Merge-Sperre, git push und gh api graphql als Text\nEOF`), null);
  assert.equal(block(`git commit -m "$(cat <<'EOF'\nText mit git merge und gh pr merge\nEOF\n)"`), null);
});

test('Plan 465: was wirklich ausführt, bleibt gesperrt', () => {
  for (const c of [
    'curl -X PUT https://api.github.com/repos/o/r/pulls/1/merge',
    'wget --method=PUT https://api.github.com/repos/o/r/pulls/1/merge',
    'gh api -X PUT repos/o/r/pulls/1/merge',
    'gh pr merge 1',
    'git -C x merge y',
    `cat <<'EOF' | bash\ngit push origin main\nEOF`,
    `bash <<'EOF'\ngit push origin main\nEOF`,
    `python3 - <<'EOF'\nimport os; os.system("git push origin main")\nEOF`,
    `echo "<<X"\ngit push origin main\nX`,
    `cat > a.txt <<'EOF'\nx\nEOF\ngit push origin main`,
    `cat > x <<'EOF'\ngit push origin main\nEOF\n. ./x`,
    `tee x <<'EOF'\ngit push origin main\nEOF\nchmod +x x && ./x`,
    `cat > x <<'EOF'\ngit push origin main\nEOF\n$SHELL x`,
  ]) assert.ok(block(c), c);
});

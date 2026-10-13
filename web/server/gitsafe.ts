// Git-Aufrufe des Web-Servers in Ordnern, die Agenten beschreiben (Worktrees der Stränge): die Repo-Config ist dort nicht
// vertrauenswürdig. `core.fsmonitor` (läuft bei status/diff) und Hooks führten sonst Programme mit der Umgebung des
// Web-Servers aus (Council Plan 154, R3, Bedingung 1). Restrisiko: Filter/Textconv aus der Repo-Config — deshalb liest die
// Werkbank nur mit rev-parse/log/for-each-ref/diff --stat und status, nie mit Befehlen, die Inhalte durch Filter schicken.
export const GIT_SAFE = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.untrackedCache=false'];

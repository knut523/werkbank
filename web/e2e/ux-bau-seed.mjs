// Beispieldaten für die isolierte Instanz (Paket 187): ein Hauptchat, Unter-Chats in drei Themen (mit LibreChat-Unterhaltungen
// „Orchestrator · …“), viele weitere Unter-Chats (Prüfung: Seite voller Unter-Chats + Nachladen) und normale Chats.
// Nur Testdatenbanken auf :27780. Aufruf: node e2e/ux-bau-seed.mjs
import { MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';

const mongo = await MongoClient.connect('mongodb://127.0.0.1:27780');
const L = mongo.db('LibreChat'), W = mongo.db('werkbank');
const admin = await L.collection('users').findOne({ email: 'admin187@maxenergy.at' });
const uid = String(admin._id);
const LC = 'http://127.0.0.1:3780';
const jetzt = Date.now();
const min = (n) => new Date(jetzt - n * 60_000);

await W.collection('orchestrator_runs').deleteMany({ userId: uid });
await L.collection('conversations').deleteMany({ user: uid });

const conv = async (title, at, tags = []) => {
  const conversationId = randomUUID();
  await L.collection('conversations').insertOne({ conversationId, user: uid, title, endpoint: 'agents', model: 'Claude Code', tags, createdAt: at, updatedAt: at, isArchived: false, messages: [] });
  return conversationId;
};
const strang = async (title, status, ago, extra = {}) => {
  const c = await conv(`Orchestrator · ${title}`, min(ago), ['Orchestrator']);
  await W.collection('orchestrator_runs').insertOne({ _id: randomUUID(), userId: uid, kind: 'strand', title, conv: c, url: `${LC}/c/${c}`, startedAt: min(ago + 30), lastActivity: min(ago), statusAt: min(ago),
    lastStatus: status, knutReviewedAt: null, reviewedAt: null, startError: null, ...extra });
};
const hc = await conv('Hauptchat 15.10.', min(2), ['Hauptchat']);
await W.collection('orchestrator_runs').insertOne({ _id: randomUUID(), userId: uid, kind: 'leitstand', title: 'Hauptchat 15.10.', conv: hc, url: `${LC}/c/${hc}`, startedAt: min(600), lastActivity: min(2), endedAt: null, lastStatus: 'done' });

// sichtbare Unter-Chats (zuerst die jüngsten)
await strang('Flex: Korrekturen nach Christophs Review', 'done', 3, { reviewReadyAt: min(3), doneAt: min(3), modell: 'claude-opus', lastModell: 'claude-opus', gegenpruefung: { n: 2 } });
await strang('Flex: Kalender-Abgleich', 'running', 4);
await strang('Cockpit: Team-Layouts', 'done', 5, { doneAt: min(5) });
await strang('Bot: Gesprächsführung nach Kundentest', 'failed', 6);
// viele weitere Unter-Chats, die in der Chatliste vor allen normalen Chats stehen würden
for (let i = 0; i < 56; i++) await strang(`Archiv: Lauf ${i + 1}`, 'done', 10 + i, { knutReviewedAt: min(10 + i), reviewedAt: min(10 + i) });
// normale Chats (älter als alle Unter-Chats)
const normal = ['Tarifrechner: Preisblock prüfen', 'Service-Fall Zählerstand', 'Vault: Sprint-Review vorbereiten', 'Jira: Tickets zum Sprintende', 'Angebot Enlion lesen',
  'Skill für Textbausteine', 'Roadmap-Idee Wallbox', 'Konzept Löschung', 'Rückfrage Datenschutz', 'Notiz zum Kundentest', 'Entwurf Mail an Rogue', 'Meeting-Notizen Montag',
  'Flex-Validierung Fragen', 'Cockpit-Tabs sortieren', 'Deploy-Check', 'Prüfung Rechnungsdaten', 'Auswertung Anmeldestrecke', 'Offene Fragen Roadmap'];
for (let i = 0; i < normal.length; i++) await conv(normal[i], min(2000 + i * 30));
console.log('Seed fertig:', await L.collection('conversations').countDocuments({ user: uid }), 'Unterhaltungen,', await W.collection('orchestrator_runs').countDocuments({ userId: uid }), 'Läufe');
await mongo.close();

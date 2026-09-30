// MongoDB: eigene Datenbank "werkbank" (Jira-Spiegel, Sitzungen, Zugangsdaten verschlüsselt,
// Entwürfe, Dateien) und lesender/gezielter Zugriff auf die LibreChat-Datenbank (Konten,
// Claude-Schlüssel, geteilte Chats).

import { MongoClient, type Db } from 'mongodb';
import { cfg } from './config.ts';

let client: MongoClient | undefined;

export async function connect(): Promise<MongoClient> {
  if (!client) {
    client = new MongoClient(cfg.mongoUri, { serverSelectionTimeoutMS: 4000 });
    await client.connect();
    const db = client.db(cfg.db);
    await Promise.all([
      db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      db.collection('jira_issues').createIndex({ key: 1 }, { unique: true }),
      db.collection('creds').createIndex({ userId: 1 }, { unique: true }),
      db.collection('files').createIndex({ owner: 1 }),
      db.collection('files').createIndex({ sharedWith: 1 }),
      db.collection('agent_runs').createIndex({ key: 1, startedAt: -1 }),
      db.collection('timebox').createIndex({ userId: 1, date: 1 }),
      db.collection('github_prs').createIndex({ pr: 1 }, { unique: true }),
    ]);
  }
  return client;
}

export const wb = (): Db => { if (!client) throw new Error('DB nicht verbunden'); return client.db(cfg.db); };
export const lc = (): Db => { if (!client) throw new Error('DB nicht verbunden'); return client.db(cfg.librechatDb); };
export async function closeDb() { await client?.close(); client = undefined; }

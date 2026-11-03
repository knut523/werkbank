// Werkbank 2.0 (Paket 436, Council B1/B5): die EINZIGE Stelle der 2.0, die LibreChats Datenbank liest. Hauptchat und Unter-Chats
// bleiben LibreChat-Unterhaltungen; 2.0 liest sie hier und schreibt in sie nur über LibreChats eigenen Serverweg (`deliver` →
// createLibreChat, dieselbe Zustellung wie „Agent ansetzen“ und die Antworten an Unter-Chats). Schritt 2 tauscht nur diese Quelle.
import { lc } from './db.ts';
import { deliver, messageText } from './orchestrator.ts';
import type { User } from './auth.ts';
import { schwacherTitel, besserTitel } from './v2kern.ts';

export interface ChatNachricht { id: string; rolle: 'ich' | 'assistent'; text: string; at: string; status: 'fertig' | 'laeuft' | 'fehler' }

/** Die letzten `n` Nachrichten einer LibreChat-Unterhaltung der Person (älteste zuerst), Text gekürzt auf 20 000 Zeichen. */
export async function lesen(u: User, conv: string, n = 30): Promise<ChatNachricht[]> {
  const msgs: any[] = await lc().collection('messages').find({ conversationId: conv, user: u.id }, { projection: { messageId: 1, isCreatedByUser: 1, text: 1, content: 1, createdAt: 1, unfinished: 1, error: 1 } })
    .sort({ createdAt: -1 }).limit(Math.min(Math.max(n, 1), 100)).toArray();
  return msgs.reverse().map((m) => ({ id: String(m.messageId), rolle: m.isCreatedByUser ? 'ich' : 'assistent', text: messageText(m).slice(0, 20_000),
    at: new Date(m.createdAt ?? Date.now()).toISOString(), status: m.error ? 'fehler' : m.unfinished ? 'laeuft' : 'fertig' }));
}

/** Nachricht anhängen (Elternnachricht = letzte gespeicherte) — über LibreChats Serverweg, nie direkt in die Datenbank. */
export async function senden(u: User, conv: string, text: string): Promise<Date> {
  return deliver(u, conv, text);
}

/** Alle LibreChat-Unterhaltungen der Person (auch archivierte), neueste zuerst — nur Kopfdaten (S12 „Alle Chats“). */
export async function liste(u: User, n = 1000): Promise<{ conversationId: string; title: string; updatedAt: Date; createdAt: Date; isArchived: boolean }[]> {
  const convs: any[] = await lc().collection('conversations').find({ user: u.id }, { projection: { _id: 0, conversationId: 1, title: 1, updatedAt: 1, createdAt: 1, isArchived: 1 } })
    .sort({ updatedAt: -1 }).limit(Math.min(n, 2000)).toArray();
  // S22 (Knut B7): schwache Titel („ja“, „Ok?“) → Anfang der ersten eigenen Nachricht — eine Abfrage, höchstens 300 Unterhaltungen.
  const schwach = convs.filter((c) => schwacherTitel(c.title)).slice(0, 300).map((c) => String(c.conversationId));
  if (schwach.length) {
    const erste = new Map<string, string>();
    const msgs: any[] = await lc().collection('messages').find({ conversationId: { $in: schwach }, user: u.id, isCreatedByUser: true }, { projection: { conversationId: 1, text: 1, content: 1, createdAt: 1 } })
      .sort({ createdAt: 1 }).limit(3000).toArray().catch(() => []);
    for (const m of msgs) if (!erste.has(String(m.conversationId))) erste.set(String(m.conversationId), messageText(m));
    for (const c of convs) if (erste.has(String(c.conversationId))) c.title = besserTitel(String(c.title ?? ''), erste.get(String(c.conversationId)));
  }
  return convs;
}

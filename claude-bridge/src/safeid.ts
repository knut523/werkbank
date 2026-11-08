// Der eine Schlüssel-Säuberer von Brücke und Werkbank-Web (Strangschlüssel `<safeId(user)>:<conv>`). Bewusst ohne weitere Abhängigkeiten.
import { createHash } from 'node:crypto';

export function safeId(s: string): string {
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : createHash('sha256').update(s).digest('hex').slice(0, 24);
}

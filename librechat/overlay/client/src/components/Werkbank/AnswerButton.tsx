// Ja/Nein-Knöpfe unter Rückfragen der Werkbank (docs/plan-ja-nein-knoepfe.md; Knut, 07.10.2026: „gib mir einen Button
// zum Klicken oder Tappen“). Die Brücke hängt an jede Rückfrage `[✅ Ja](#werkbank-antwort:ja) [✖️ Nein](#werkbank-antwort:nein)`;
// MarkdownAnchor (Patch 30-client-antwort-knoepfe) gibt solche Anker hierher. Ein Tipp schickt genau „ja“ bzw. „nein“
// als Chat-Nachricht — derselbe Weg wie Tippen, also streamt die Antwort des Agenten wie gewohnt in den Chat.
import React, { useContext, useState } from 'react';
import { ChatContext, useMessageContext } from '~/Providers';
import useSubmitMessage from '~/hooks/Messages/useSubmitMessage';

export const WERKBANK_ANSWER_PREFIX = '#werkbank-antwort:';
const ALLOWED = new Set(['ja', 'nein']);
// Plan 213 S2 (Council K4): `#werkbank-antwort:<Kennung>:ja` beantwortet genau diesen Inbox-Eintrag an seiner Quelle — nie über
// Freitext. Die Kennung (q-…, d-…, b-…, p-…) bindet an den gesehenen Stand; hat er sich geändert, kommt 409 statt eines Ratens.
const INBOX = /^((?:q|d|b|p)-[A-Za-z0-9-]{1,80}):(ja|nein)$/;

type Props = { href: string; children: React.ReactNode };

/**
 * Außen: kein Chat (z. B. die Ansicht eines geteilten Chats) oder ein anderer Wert → nur der Text. `useChatContext`
 * würfe dort; darum hier `useContext` direkt, und erst innen die Hooks, die einen Chat brauchen.
 */
export default function WerkbankAnswerButton({ href, children }: Props) {
  const chat = useContext(ChatContext);
  const value = href.slice(WERKBANK_ANSWER_PREFIX.length);
  const inbox = INBOX.exec(value);
  if (chat && inbox) return <InboxButton kennung={inbox[1]} antwort={inbox[2] as 'ja' | 'nein'} />;
  if (!chat || !ALLOWED.has(value)) return <span>{children}</span>;
  return <AnswerButton value={value} />;
}

/** Inbox-Knopf: schreibt über den Workspace an die Quelle (dieselbe Anmeldung wie der Chat) und zeigt das Ergebnis. */
function InboxButton({ kennung, antwort }: { kennung: string; antwort: 'ja' | 'nein' }) {
  const [stand, setStand] = useState<'' | 'laeuft' | 'ok' | string>('');
  const yes = antwort === 'ja';
  const disabled = stand === 'laeuft' || stand === 'ok';
  const klick = async () => {
    if (disabled) return;
    setStand('laeuft');
    try {
      const r = await fetch(`/werkbank/api/inbox/${encodeURIComponent(kennung)}/antwort`, {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', 'x-werkbank': '1' },
        body: JSON.stringify({ antwort, weg: 'chat-knopf' }),
      });
      const j = await r.json().catch(() => ({}));
      setStand(r.ok ? 'ok' : String(j.error ?? `Fehler ${r.status}`));
    } catch { setStand('Workspace nicht erreichbar'); }
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button type="button" disabled={disabled} onClick={klick} aria-label={yes ? 'Ja, so entscheiden' : 'Nein'}
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 44, minWidth: 104, padding: '0 18px', margin: '4px 8px 4px 0', borderRadius: 8,
          fontWeight: 700, fontSize: 15, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
          border: yes ? '1px solid #FEE600' : '1px solid currentColor', background: yes ? '#FEE600' : 'transparent', color: yes ? '#2b2d33' : 'inherit' }}>
        {yes ? '✅ Ja' : '✖️ Nein'}
      </button>
      {stand === 'ok' && <span style={{ fontSize: 13 }}>eingetragen</span>}
      {stand && stand !== 'ok' && stand !== 'laeuft' && <span role="alert" style={{ fontSize: 13 }}>{stand}</span>}
    </span>
  );
}

/** Die Beschriftung kommt aus dem Wert, nie aus dem Linktext — ein Knopf zeigt immer, was er sendet (Review Runde 2). */
function AnswerButton({ value }: { value: string }) {
  const chat = useContext(ChatContext)!;
  const { isLatestMessage } = useMessageContext();
  const { submitMessage } = useSubmitMessage();
  const [sent, setSent] = useState(false);

  // Gesperrt, solange der Chat streamt, nach dem ersten Tipp und in älteren (schon beantworteten) Rückfragen.
  const disabled = sent || !!chat.isSubmitting || isLatestMessage === false;
  const yes = value === 'ja';
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={yes ? 'Ja, ausführen' : 'Nein, nicht ausführen'}
      onClick={() => {
        if (disabled) return;
        setSent(true);
        submitMessage({ text: value });
      }}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        minHeight: 44, minWidth: 104, padding: '0 18px', margin: '4px 8px 4px 0', borderRadius: 8,
        fontWeight: 700, fontSize: 15, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
        border: yes ? '1px solid #FEE600' : '1px solid currentColor',
        background: yes ? '#FEE600' : 'transparent', color: yes ? '#2b2d33' : 'inherit',
      }}
    >
      {yes ? '✅ Ja' : '✖️ Nein'}
    </button>
  );
}

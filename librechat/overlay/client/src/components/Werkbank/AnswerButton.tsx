// Ja/Nein-Knöpfe unter Rückfragen der Werkbank (docs/plan-ja-nein-knoepfe.md; Knut, 07.10.2026: „gib mir einen Button
// zum Klicken oder Tappen“). Die Brücke hängt an jede Rückfrage `[✅ Ja](#werkbank-antwort:ja) [✖️ Nein](#werkbank-antwort:nein)`;
// MarkdownAnchor (Patch 30-client-antwort-knoepfe) gibt solche Anker hierher. Ein Tipp schickt genau „ja“ bzw. „nein“
// als Chat-Nachricht — derselbe Weg wie Tippen, also streamt die Antwort des Agenten wie gewohnt in den Chat.
import React, { useContext, useState } from 'react';
import { ChatContext, useMessageContext } from '~/Providers';
import useSubmitMessage from '~/hooks/Messages/useSubmitMessage';

export const WERKBANK_ANSWER_PREFIX = '#werkbank-antwort:';
const ALLOWED = new Set(['ja', 'nein']);

type Props = { href: string; children: React.ReactNode };

/**
 * Außen: kein Chat (z. B. die Ansicht eines geteilten Chats) oder ein anderer Wert → nur der Text. `useChatContext`
 * würfe dort; darum hier `useContext` direkt, und erst innen die Hooks, die einen Chat brauchen.
 */
export default function WerkbankAnswerButton({ href, children }: Props) {
  const chat = useContext(ChatContext);
  const value = href.slice(WERKBANK_ANSWER_PREFIX.length);
  if (!chat || !ALLOWED.has(value)) return <span>{children}</span>;
  return <AnswerButton value={value} />;
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

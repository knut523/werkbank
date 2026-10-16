// OLAF Workspace (Auftrag 17c, Bug A): einen Chat aus der Werkbank (Hauptchat-Abschnitt, Links aus Werkbank-Seiten) so öffnen,
// wie LibreChat es selbst tut. Ein bloßes navigate('/c/<id>') ändert nur die Adresse: ChatRoute lädt die Unterhaltung nur beim
// ersten Aufruf aus der URL (hasSetConversation), der Zustand der Unterhaltung bliebe beim vorher offenen Chat — die Seite
// zeigte den Unter-Chat, Senden und Nachreichen gingen aber in den Hauptchat. useNavigateToConvo holt die Unterhaltung frisch
// vom Server, setzt den Zustand und navigiert dann (wie ein Klick in LibreChats Chatliste).
import { useCallback } from 'react';
import { useRecoilValue } from 'recoil';
import { useNavigate, type NavigateOptions } from 'react-router-dom';
import type { TConversation } from 'librechat-data-provider';
import { useNavigateToConvo } from '~/hooks';
import store from '~/store';

const CHAT = /^\/c\/([0-9a-f-]{36})(?:[/?#]|$)/i;

/** Öffnet `to` im selben Fenster: /c/<id> über LibreChats Chatwechsel, alles andere über den Router. */
export function useOpenChat() {
  const navigate = useNavigate();
  const { navigateToConvo } = useNavigateToConvo();
  const current = useRecoilValue(store.conversationIdByIndex(0));
  return useCallback((to: string, opts?: NavigateOptions) => {
    const id = CHAT.exec(to)?.[1];
    // Derselbe Chat ist schon geladen (Zustand stimmt): nur die Adresse, wie bisher.
    if (!id || id === current) return navigate(to, opts);
    navigateToConvo({ conversationId: id } as TConversation, { currentConvoId: current ?? undefined });
  }, [navigate, navigateToConvo, current]);
}

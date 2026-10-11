// OLAF-Werkbank: Eintrag „Werkbank-Einrichtung“ im Kontomenü, direkt über LibreChats „Einstellungen“
// (Patch 40-client-konto-einrichtung) — ein Ort für alles, was man einstellt (docs/plan-eine-oberflaeche.md, E3).
import * as Menu from '@ariakit/react/menu';
import { useNavigate } from 'react-router-dom';
import { Rocket } from 'lucide-react';
import { useCloseSidebarOnMobile } from './WerkbankNav';

export default function WerkbankSetupItem() {
  const navigate = useNavigate();
  const closeOnMobile = useCloseSidebarOnMobile();
  return (
    <Menu.MenuItem
      onClick={() => { navigate('/wb/einrichtung'); closeOnMobile(); }}
      className="select-item text-sm"
      data-testid="nav-werkbank-einrichtung"
    >
      <Rocket className="icon-md" aria-hidden="true" />
      Werkbank-Einrichtung
    </Menu.MenuItem>
  );
}

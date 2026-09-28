// scripts/werkbank.sh up → Vault-Suchindex auffrischen (nur lesend, nur Geänderte).
import { cfg } from './config.ts';
import { buildIndex } from './vault.ts';
import { reindex } from './search.ts';
try {
  const r = await reindex(buildIndex(cfg.vaultDir));
  console.log(`  Suchindex: ${r.added} neu/geändert, ${r.removed} entfernt`);
} catch (e: any) { console.log(`  ! Suchindex nicht aufgefrischt: ${e.message}`); }

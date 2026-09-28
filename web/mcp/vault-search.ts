#!/usr/bin/env node
// MCP-Server "vault-search" (stdio, nur lesend) für Claude-Code-Sitzungen.
// Start: node web/mcp/vault-search.ts   — Vault: $WERKBANK_VAULT_DIR oder /vault.
// Meilisearch-Schlüssel: $MEILI_MASTER_KEY, sonst aus der .env.local des Werkbank-Repos; ohne Schlüssel
// sucht er im Dateisystem.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serve } from './stdio.ts';
import { toolDefs } from './vault-tools.ts';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
function fromEnvLocal(name: string): string | undefined {
  const f = join(repo, '.env.local');
  if (!existsSync(f)) return undefined;
  try { return readFileSync(f, 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.replace(/^"|"$/g, ''); } catch { return undefined; }
}

serve('vault-search', '0.1.0', toolDefs({
  vaultDir: process.env.WERKBANK_VAULT_DIR || '/vault',
  meiliHost: process.env.MEILI_HOST || 'http://127.0.0.1:7700',
  meiliKey: process.env.MEILI_MASTER_KEY || fromEnvLocal('MEILI_MASTER_KEY'),
  meiliIndex: process.env.WERKBANK_MEILI_INDEX || 'werkbank_vault',
}));

// Tests laufen nie gegen die Live-Mongo (Release 11.10.2026: ein Testlauf ohne Angabe schrieb Wegwerf-DBs in die
// Live-Instanz auf :27017). MONGO_URI_WERKBANK muss ausdrücklich gesetzt sein; scripts/werkbank.sh test startet dafür
// eine eigene Wegwerf-Mongo. :27017 nur mit WERKBANK_TEST_ALLOW_27017=1.
const u = process.env.MONGO_URI_WERKBANK;
if (!u) throw new Error('MONGO_URI_WERKBANK fehlt — Tests brauchen eine eigene Test-Mongo (scripts/werkbank.sh test startet eine), nie die Live-Instanz.');
if (/:27017(\/|$)/.test(u) && process.env.WERKBANK_TEST_ALLOW_27017 !== '1') throw new Error('MONGO_URI_WERKBANK zeigt auf :27017 (Live-Instanz) — eigene Test-Mongo nehmen oder WERKBANK_TEST_ALLOW_27017=1.');
export const TEST_MONGO = u;

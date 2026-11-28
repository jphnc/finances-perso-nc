// Tests de la mémoire de l'appareil : copies de secours et mémoire pleine. Données inventées.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
function extract(name) {
  let i = src.indexOf('\nasync function ' + name + '(');
  if (i < 0) i = src.indexOf('\nfunction ' + name + '(');
  if (i < 0) throw new Error('fonction introuvable dans app.js : ' + name);
  return src.slice(i + 1, src.indexOf('\n}\n', i) + 3);
}
const line = start => { const i = src.indexOf('\n' + start); if (i < 0) throw new Error('ligne introuvable : ' + start); return src.slice(i + 1, src.indexOf('\n', i + 1)); };
const NAMES = ['setPref', 'writeData', 'oldPlaceBackups', 'keepRecentBackups', 'backupKey', 'storeBackups', 'readBackups', 'autoBackup'];
const CODE = [line('const MAX_BACKUPS'), ...NAMES.map(extract)].join('\n');

// appareil avec un petit stockage (place limitée) et la grande base ; base = false : indisponible
function device({ data = { operations: [{ id: 'a' }], accounts: [] }, store = {}, room = Infinity, base = true } = {}) {
  const small = new Map(Object.entries(store)), big = new Map(), alerts = [], toasts = [];
  const limit = { chars: room };
  const used = () => [...small].reduce((s, [k, v]) => s + k.length + v.length, 0);
  const localStorage = { getItem: k => (small.has(k) ? small.get(k) : null), removeItem: k => small.delete(k),
    setItem: (k, v) => { if (used() - (small.has(k) ? k.length + small.get(k).length : 0) + k.length + String(v).length > limit.chars) throw new Error('QuotaExceededError'); small.set(k, String(v)); } };
  const deviceDbRun = async (mode, action) => {
    if (!base) throw new Error('base indisponible');
    const request = value => { const r = { result: value }; queueMicrotask(() => r.onsuccess && r.onsuccess()); return r; };
    const r = action({ get: k => request(structuredClone(big.get(k))), put: (v, k) => { big.set(k, structuredClone(v)); return request(); } });
    await new Promise(done => setImmediate(done));
    return r.result;
  };
  const A = new Function('init', 'localStorage', 'deviceDbRun', 'alert', 'toast', 'console',
    `let appData = init, storageFull = false, backupWork = Promise.resolve();\n${CODE}
     return { ${NAMES.join(', ')}, data: () => appData, full: () => storageFull };`)(data, localStorage, deviceDbRun, m => alerts.push(m), m => toasts.push(m), { warn() {} });
  return Object.assign(A, { small, big, alerts, toasts, limit, used });
}
const copy = (date, text) => ({ date, ops: 1, data: text });

test('copies de secours : les 5 états différents les plus récents, dans l’ordre', () => {
  const A = device();
  const list = [3, 1, 6, 2, 5, 4, 3].map(n => copy('2026-11-0' + n + ' 10:00', 'v' + n));
  assert.deepEqual(A.keepRecentBackups([...list, null, {}]).map(b => b.data), ['v2', 'v3', 'v4', 'v5', 'v6']);
  const reopened = [copy('2026-11-01 10:00', 'avant'), ...[2, 3, 4, 5, 6, 7].map(n => copy('2026-11-0' + n + ' 10:00', 'pareil'))];
  assert.deepEqual(A.keepRecentBackups(reopened).map(b => [b.date.slice(8, 10), b.data]), [['01', 'avant'], ['07', 'pareil']]);
});

test('copies de secours : rangées dans la grande base, le petit stockage ne grossit pas', async () => {
  const A = device();
  await A.autoBackup();
  assert.equal(A.small.size, 0);
  assert.equal(A.big.get('backups').length, 1);
  assert.equal(JSON.parse((await A.readBackups())[0].data).operations[0].id, 'a');
});

test('copies de secours : la photo est prise au moment de la demande, avant un remplacement', async () => {
  const A = device();
  const pending = A.autoBackup();
  A.data().operations.length = 0;
  await pending;
  assert.equal(JSON.parse(A.big.get('backups')[0].data).operations.length, 1);
});

test('chaque copie se retrouve sans confusion, même à la même minute et à la même taille', () => {
  const A = device();
  const keys = ['ab', 'ba', 'cc'].map(text => A.backupKey(copy('2026-11-01 10:00', text)));
  assert.equal(new Set(keys).size, 3);
  assert.equal(A.backupKey(copy('2026-11-01 10:00', 'ab')), keys[0]);
});

test('anciennes copies : déplacées dans la grande base et la place est libérée', async () => {
  const old = [1, 2, 3, 4, 5].map(n => copy('2026-11-0' + n + ' 10:00', 'x'.repeat(100) + n));
  const A = device({ store: { finances_backups: JSON.stringify(old), finances_data: '{}' } });
  assert.equal((await A.readBackups()).length, 5);                 // visibles même avant le déplacement
  await A.storeBackups([]);
  assert.equal(A.small.has('finances_backups'), false);
  assert.deepEqual(A.big.get('backups').map(b => b.data), old.map(b => b.data));
  await A.autoBackup();
  assert.equal(A.big.get('backups').length, 5);
  assert.equal(A.big.get('backups')[0].data, old[1].data);
});

test('grande base indisponible : les anciennes copies restent, les 2 dernières sont gardées si la place le permet', async () => {
  const old = [copy('2026-11-01 10:00', 'ancienne')];
  const A = device({ base: false, store: { finances_backups: JSON.stringify(old) } });
  await A.storeBackups([]);
  assert.equal(JSON.parse(A.small.get('finances_backups'))[0].data, 'ancienne');
  await A.autoBackup();
  assert.equal(JSON.parse(A.small.get('finances_backups')).length, 2);
  assert.equal((await A.readBackups()).length, 2);
  const B = device({ base: false, room: 5 });
  await B.autoBackup();                                            // aucune place : pas d'erreur
  assert.equal(B.small.size, 0);
});

test('mémoire presque pleine : les données passent avant les anciennes copies', () => {
  const A = device({ store: { finances_backups: JSON.stringify([copy('2026-11-01 10:00', 'x'.repeat(200))]) }, room: 300 });
  assert.equal(A.writeData(), true);
  assert.equal(A.small.has('finances_backups'), false);
  assert.ok(A.small.has('finances_data'));
  assert.equal(A.alerts.length, 0);
});

test('mémoire pleine : prévenu une fois, puis rappel discret, sans interrompre ; tout revient quand la place revient', () => {
  const A = device({ store: { finances_driverev: 'F1:abc' }, room: 20 });
  assert.equal(A.writeData(), false);
  assert.equal(A.full(), true);
  assert.equal(A.alerts.length, 1);
  assert.match(A.alerts[0], /PAS enregistrée/);
  assert.equal(A.small.has('finances_driverev'), false);          // la prochaine synchronisation relira Drive
  assert.equal(A.writeData(), false);
  assert.deepEqual([A.alerts.length, A.toasts.length], [1, 1]);
  assert.equal(A.setPref('finances_last_account', 'un nom bien trop long'), false);
  A.limit.chars = Infinity;
  assert.equal(A.writeData(), true);
  assert.equal(A.full(), false);
});

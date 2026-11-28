// Tests de la synchronisation : réunion de deux versions, échanges avec un faux Google Drive, restaurations.
// Lancer : node --test tests/*.test.js        (Node 18+, aucune dépendance ; données inventées)
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
const NAMES = ['setPref', 'writeData', 'saveLocal', 'dropOps', 'stableText', 'recordText', 'isEmptyValue', 'settingKeys', 'stampChanges', 'dataSignature', 'isValidData',
  'mergeAppData', 'cleanData', 'getPwdHash', 'oneAtATime', 'driveRequest', 'driveError', 'findOrCreateFile', 'driveRevision', 'downloadFromDrive', 'safeBackup',
  'appOpen', 'applyRemotePassword', 'receiveFromDrive', 'sendToDrive', 'driveExchange', 'uploadToDrive', 'replaceData', 'checkRestorable', 'forgetAccount'];
const CODE = NAMES.map(extract).join('\n');

// Faux Google Drive : fichiers en mémoire, pannes à la demande
function fakeDrive(content) {
  const d = { files: [], fail: {}, log: [] };
  if (content !== undefined) d.files.push({ id: 'F1', content: typeof content === 'string' ? content : JSON.stringify(content) });
  const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => (typeof body === 'string' ? JSON.parse(body) : body), text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  const sum = text => String(text.length) + ':' + [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  d.fetch = async (url, opts) => {
    const u = new URL(url), id = (u.pathname.match(/files\/([^/]+)$/) || [])[1], method = opts.method || 'GET';
    const kind = method === 'PATCH' ? 'upload' : method === 'POST' ? 'create' : !id ? 'search' : u.searchParams.get('alt') === 'media' ? 'download' : 'revision';
    d.log.push(kind);
    if (d.fail[kind]) { const code = d.fail[kind]; delete d.fail[kind]; return reply(code, { error: { code } }); }
    if (kind === 'search') return reply(200, { files: d.files.map(f => ({ id: f.id })) });
    if (kind === 'create') { d.files.push({ id: 'F' + (d.files.length + 1), content: '' }); return reply(200, { id: d.files.at(-1).id }); }
    const file = d.files.find(f => f.id === id);
    if (!file) return reply(404, { error: { code: 404 } });
    if (kind === 'upload') { file.content = opts.body; return reply(200, { md5Checksum: sum(file.content) }); }
    if (kind === 'revision') return reply(200, { md5Checksum: sum(file.content) });
    return reply(200, file.content);
  };
  d.data = () => JSON.parse(d.files[0].content);
  d.labels = () => d.data().operations.map(o => o.label).sort();
  return d;
}

// Un « appareil » : ses données, son stockage, relié au faux Drive
let clock = Date.parse('2026-11-28T10:00:00Z');
function device(drive, data, store = {}) {
  const storage = new Map(Object.entries({ ...(data ? { finances_data: JSON.stringify(data) } : {}), ...store }));
  const room = { chars: Infinity };                // place disponible, pour simuler une mémoire pleine
  const localStorage = { getItem: k => (storage.has(k) ? storage.get(k) : null), removeItem: k => storage.delete(k),
    setItem: (k, v) => { if (String(v).length > room.chars) throw new Error('QuotaExceededError'); storage.set(k, String(v)); } };
  const Real = Date;
  class Clock extends Real {                      // chaque action a lieu une seconde après la précédente
    constructor(...a) { if (a.length) super(...a); else super(clock += 1000); }
    static now() { return clock; }
  }
  const body = `let appData = init, accessToken = null, driveFileId = null, syncRunning = 0, unlocked = true, driveNews = '', exchangeQueue = null, backups = 0, renders = 0, storageFull = false;
    const alerts = [], alert = m => alerts.push(m);
    const FILE_NAME = 'comptes_data.json';
    const updateConnBadge = () => {}, updateSyncStatus = () => {}, scheduleDirBackup = () => {}, renderAll = () => { renders++; }, toast = () => {}, autoBackup = () => { backups++; };
    ${CODE}
    return { ${NAMES.join(', ')}, data: () => appData, connect: () => { accessToken = 'jeton'; }, backups: () => backups, renders: () => renders, alerts, full: () => storageFull };`;
  const initial = data ? structuredClone(data) : { version: 2, lastSync: null, accounts: [], operations: [], recurring: [] };
  const A = new Function('init', 'localStorage', 'fetch', 'Date', 'console', body)(initial, localStorage, drive.fetch, Clock, { warn() {} });
  A.storage = storage;
  A.room = room;
  A.labels = () => A.data().operations.map(o => o.label).sort();
  // saisie comme dans l'application : on modifie les données puis on enregistre
  A.edit = (change) => { change(A.data()); A.saveLocal(); };
  A.add = (id, account = 'courant') => A.edit(d => d.operations.push({ id, account, date: '2026-11-20', type: 'debit', amount: 100, label: id, opType: 'Operation' }));
  return A;
}
const base = () => ({ version: 2, lastSync: '2026-11-28T00:00:00Z', accounts: [{ name: 'courant' }], operations: [
  { id: 'a', account: 'courant', date: '2026-11-01', type: 'debit', amount: 10, label: 'a', opType: 'Operation' },
  { id: 'b', account: 'courant', date: '2026-11-02', type: 'debit', amount: 20, label: 'b', opType: 'Operation' }] });
// deux appareils à jour et connectés
async function pair() {
  const drive = fakeDrive(base()), phone = device(drive, base()), pc = device(drive, base());
  phone.connect(); pc.connect();
  await phone.uploadToDrive(); await pc.uploadToDrive();
  return { drive, phone, pc };
}
const settle = () => new Promise(r => setTimeout(r, 20));

test('premier échange sans différence : rien n’est envoyé, puis seule l’empreinte est relue', async () => {
  const drive = fakeDrive(base()), A = device(drive, base()); A.connect();
  await A.uploadToDrive();
  assert.deepEqual(drive.log, ['search', 'revision', 'download']);
  drive.log.length = 0;
  await A.uploadToDrive();
  assert.deepEqual(drive.log, ['revision']);
});

test('téléphone puis PC saisissent chacun une opération : les deux sont gardées partout', async () => {
  const { drive, phone, pc } = await pair();
  phone.add('telephone'); await settle();
  pc.add('pc'); await settle();
  assert.deepEqual(drive.labels(), ['a', 'b', 'pc', 'telephone']);
  await phone.uploadToDrive();
  assert.deepEqual(phone.labels(), ['a', 'b', 'pc', 'telephone']);
  assert.deepEqual(pc.labels(), ['a', 'b', 'pc', 'telephone']);
});

test('modifications différentes sur deux appareils : chacune est gardée (pointage, montant, suppression, budget)', async () => {
  const { drive, phone, pc } = await pair();
  phone.edit(d => { d.operations.find(o => o.id === 'a').amount = 999; d.budgets = { Alimentation: 50 }; }); await settle();
  pc.edit(d => { d.operations.find(o => o.id === 'b').pointed = true; }); await settle();
  assert.equal(drive.data().operations.find(o => o.id === 'a').amount, 999);
  assert.equal(drive.data().operations.find(o => o.id === 'b').pointed, true);
  assert.deepEqual(drive.data().budgets, { Alimentation: 50 });
  pc.edit(() => pc.dropOps(o => o.id !== 'a')); await settle();
  await phone.uploadToDrive();
  assert.deepEqual(phone.labels(), ['b']);
  assert.deepEqual(drive.labels(), ['b']);
  assert.deepEqual(phone.data().budgets, { Alimentation: 50 });
});

test('même opération modifiée des deux côtés : la dernière modification gagne', async () => {
  const { drive, phone, pc } = await pair();
  phone.edit(d => { d.operations[0].amount = 1; }); await settle();
  pc.edit(d => { d.operations[0].amount = 2; }); await settle();
  await phone.uploadToDrive();
  assert.equal(phone.data().operations.find(o => o.id === 'a').amount, 2);
  assert.equal(drive.data().operations.find(o => o.id === 'a').amount, 2);
});

test('un ancien appareil écrase Drive sans relire : les opérations perdues sont renvoyées', async () => {
  const { drive, phone } = await pair();
  phone.add('recente'); await settle();
  drive.files[0].content = JSON.stringify({ ...base(), lastSync: '2030-01-01T00:00:00Z' });
  await phone.uploadToDrive();
  assert.deepEqual(phone.labels(), ['a', 'b', 'recente']);
  assert.deepEqual(drive.labels(), ['a', 'b', 'recente']);
});

for (const step of ['search', 'revision', 'download']) {
  test(`panne de Drive pendant « ${step} » : rien n’est remplacé ni envoyé, aucun doublon`, async () => {
    const newer = { ...base(), lastSync: '2026-11-28T05:00:00Z' };
    newer.operations.push({ ...newer.operations[0], id: 'n', label: 'nouvelle' });
    for (const data of [base(), null]) {                       // appareil en retard, puis appareil neuf
      const drive = fakeDrive(newer), A = device(drive, data); A.connect();
      drive.fail[step] = 503;
      await assert.rejects(A.uploadToDrive(), /code 503/);
      assert.deepEqual(drive.labels(), ['a', 'b', 'nouvelle']);
      assert.equal(drive.files.length, 1);
      assert.ok(!drive.log.includes('upload') && !drive.log.includes('create'));
      assert.ok(Array.isArray(A.data().operations) && !A.data().error);
      await A.uploadToDrive();                                // la panne passée, tout rentre dans l’ordre
      assert.deepEqual(A.labels(), ['a', 'b', 'nouvelle']);
    }
  });
}

test('fichier Drive non reconnu : refusé, rien n’est modifié', async () => {
  for (const content of ['{"bonjour":1}', '<html>erreur</html>', '{"operations":"x","accounts":[]}']) {
    const drive = fakeDrive(content), A = device(drive, base()); A.connect();
    await assert.rejects(A.uploadToDrive(), /pas reconnu/);
    assert.deepEqual(A.labels(), ['a', 'b']);
    assert.equal(drive.files[0].content, content);
  }
});

test('mémoire pleine : la saisie part quand même sur Drive et revient après redémarrage', async () => {
  const { drive, phone } = await pair();
  phone.room.chars = 100;
  phone.add('pleine'); await settle();
  assert.equal(phone.full(), true);
  assert.equal(phone.alerts.length, 1);
  assert.ok(drive.labels().includes('pleine'));
  assert.ok(!JSON.parse(phone.storage.get('finances_data')).operations.some(o => o.id === 'pleine'));
  assert.equal(phone.storage.get('finances_driverev'), undefined);
  // redémarrage : l’appareil repart de sa copie ancienne et récupère la saisie sur Drive sans rien écraser
  const after = device(drive, JSON.parse(phone.storage.get('finances_data')), Object.fromEntries([...phone.storage].filter(([k]) => k !== 'finances_data')));
  after.connect(); await after.uploadToDrive();
  assert.deepEqual(after.labels(), ['a', 'b', 'pleine']);
  assert.deepEqual(drive.labels(), ['a', 'b', 'pleine']);
});

test('envoi refusé : la modification reste en attente puis part au prochain essai', async () => {
  const { drive, phone } = await pair();
  drive.fail.upload = 500;
  phone.add('attente'); await settle();
  assert.equal(phone.storage.get('finances_pending'), '1');
  assert.ok(!drive.labels().includes('attente'));
  await phone.uploadToDrive();
  assert.ok(drive.labels().includes('attente'));
  assert.equal(phone.storage.get('finances_pending'), undefined);
});

test('saisies rapprochées : un seul envoi à la fois, tout arrive sur Drive', async () => {
  const { drive, phone } = await pair();
  for (const id of ['x', 'y', 'z']) phone.add(id);
  await phone.uploadToDrive(); await settle();
  assert.deepEqual(drive.labels(), ['a', 'b', 'x', 'y', 'z']);
});

test('appareil neuf : reçoit tout, n’envoie rien ; fichier Drive vide : l’appareil l’initialise', async () => {
  const full = { ...base(), budgets: { Transport: 5 } };
  const drive = fakeDrive(full), A = device(drive, null); A.connect();
  await A.uploadToDrive();
  assert.deepEqual(A.labels(), ['a', 'b']);
  assert.deepEqual(A.data().budgets, { Transport: 5 });
  assert.ok(!drive.log.includes('upload'));
  const vide = fakeDrive(), B = device(vide, base()); B.connect();
  await B.uploadToDrive();
  assert.equal(vide.files.length, 1);
  assert.deepEqual(vide.labels(), ['a', 'b']);
});

test('nouvel appareil où l’on saisit avant de se connecter : les réglages de Drive sont gardés', async () => {
  const full = { ...base(), budgets: { Transport: 5 }, pwdHash: 'h' };
  const drive = fakeDrive(full), A = device(drive, null);
  A.edit(d => d.accounts.push({ name: 'courant' }));
  A.add('avant');
  A.connect(); await A.uploadToDrive();
  assert.deepEqual(drive.labels(), ['a', 'avant', 'b']);
  assert.deepEqual(drive.data().budgets, { Transport: 5 });
  assert.equal(drive.data().pwdHash, 'h');
});

test('appareil effacé puis reconnecté : les données reviennent même si Drive n’a pas changé', async () => {
  const { drive, phone } = await pair();
  const known = phone.storage.get('finances_driverev');
  const A = device(drive, null, { finances_driverev: known }); A.connect();
  await A.uploadToDrive();
  assert.deepEqual(A.labels(), ['a', 'b']);
});

test('compte supprimé ou renommé : il ne revient pas ; compte vide créé : il se propage', async () => {
  const { drive, phone, pc } = await pair();
  pc.edit(d => d.accounts.push({ name: 'livret' })); await settle();
  phone.add('autre'); await settle();
  assert.deepEqual(drive.data().accounts.map(a => a.name).sort(), ['courant', 'livret']);
  await pc.uploadToDrive();
  pc.edit(d => { pc.forgetAccount('livret'); d.accounts = d.accounts.filter(a => a.name !== 'livret'); }); await settle();
  phone.add('encore'); await settle();
  assert.deepEqual(drive.data().accounts.map(a => a.name), ['courant']);
  await pc.uploadToDrive();
  const rename = (from, to) => d => { d.accounts.find(a => a.name === from).name = to; pc.forgetAccount(from); for (const o of d.operations) if (o.account === from) o.account = to; };
  pc.edit(rename('courant', 'principal')); await settle();
  await phone.uploadToDrive();
  assert.deepEqual(phone.data().accounts.map(a => a.name), ['principal']);
  assert.ok(phone.data().operations.every(o => o.account === 'principal'));
  // renommé pendant que l'autre appareil saisissait sur l'ancien nom : la saisie est gardée, avec son compte
  phone.add('pendant', 'principal'); await settle();
  pc.edit(rename('principal', 'maison')); await settle();
  await phone.uploadToDrive();
  assert.deepEqual(phone.data().accounts.map(a => a.name).sort(), ['maison', 'principal']);
  assert.deepEqual(phone.data().operations.filter(o => o.account === 'principal').map(o => o.id), ['pendant']);
});

test('mot de passe retiré sur un appareil : retiré sur l’autre', async () => {
  const withPwd = { ...base(), pwdHash: 'h' };
  const drive = fakeDrive(withPwd), phone = device(drive, withPwd, { finances_pwd: 'h' }), pc = device(drive, withPwd, { finances_pwd: 'h' });
  phone.connect(); pc.connect();
  await phone.uploadToDrive(); await pc.uploadToDrive();
  pc.edit(d => { delete d.pwdHash; pc.storage.delete('finances_pwd'); }); await settle();
  await phone.uploadToDrive();
  assert.equal(phone.data().pwdHash, undefined);
  assert.equal(phone.storage.get('finances_pwd'), undefined);
  assert.equal(phone.getPwdHash(), null);
});

test('restauration d’une sauvegarde : elle tient, y compris après la synchronisation des autres appareils', async () => {
  const { drive, phone, pc } = await pair();
  const saved = structuredClone(phone.data());
  phone.edit(() => phone.dropOps(o => o.id !== 'a')); await settle();
  phone.add('apres'); await settle();
  await pc.uploadToDrive();
  phone.replaceData(phone.checkRestorable(structuredClone(saved))); await settle();
  assert.deepEqual(drive.labels(), ['a', 'b']);
  await pc.uploadToDrive();
  assert.deepEqual(pc.labels(), ['a', 'b']);
  assert.deepEqual(drive.labels(), ['a', 'b']);
  assert.ok(phone.backups() >= 1);                              // copie de secours avant de remplacer
});

test('restauration : un fichier inutilisable est refusé', () => {
  const A = device(fakeDrive(base()), base());
  for (const bad of [null, {}, { operations: [] }, { operations: [], accounts: [] }, { operations: 'x', accounts: [] }, { operations: [{ id: 'a' }], accounts: [] }, { operations: [], accounts: [{}] }]) {
    assert.throws(() => A.checkRestorable(bad), /pas une sauvegarde/);
  }
  assert.ok(A.checkRestorable(base()));
});

test('enregistrement : seuls les éléments modifiés sont horodatés', () => {
  const A = device(fakeDrive(base()), base());
  A.edit(d => { d.operations[1].amount = 21; });
  const [a, b] = A.data().operations;
  assert.equal(a.updatedAt, undefined);
  assert.ok(b.updatedAt > 0);
  assert.equal(A.data().accounts[0].updatedAt, undefined);
  assert.equal(A.data().keyTimes, undefined);
  A.edit(d => { d.alerts = {}; });                              // un réglage encore vide n’est pas une modification
  assert.equal(A.data().keyTimes, undefined);
  A.edit(d => { d.alerts = { courant: 5 }; });
  assert.ok(A.data().keyTimes.alerts > 0);
});

test('réunion : une suppression l’emporte sur les versions plus anciennes, pas sur une modification postérieure', () => {
  const A = device(fakeDrive(base()), base());
  const t = Date.now() - 86400000, when = new Date(t).toISOString();
  const o = updatedAt => ({ id: 'a', account: 'courant', date: '2026-11-01', type: 'debit', amount: 1, label: 'a', updatedAt });
  const gone = { lastSync: when, accounts: [{ name: 'courant' }], operations: [], deletedIds: { a: when } };
  const keep = updatedAt => ({ lastSync: when, accounts: [{ name: 'courant' }], operations: [o(updatedAt)] });
  assert.equal(A.mergeAppData(keep(t - 10), gone).operations.length, 0);
  assert.equal(A.mergeAppData(gone, keep(t - 10)).operations.length, 0);
  const back = A.mergeAppData(gone, keep(t + 10));
  assert.equal(back.operations.length, 1);
  assert.equal(back.deletedIds.a, undefined);
});

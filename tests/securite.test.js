// Tests de sécurité : données venues de l'extérieur, données abîmées, effacement, export CSV, page sans code écrit dedans.
// Données inventées.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8').replace(/\r\n/g, '\n');
const src = read('app.js'), html = read('index.html');
function extract(name) {
  let i = src.indexOf('\nasync function ' + name + '(');
  if (i < 0) i = src.indexOf('\nfunction ' + name + '(');
  if (i < 0) throw new Error('fonction introuvable dans app.js : ' + name);
  return src.slice(i + 1, src.indexOf('\n}\n', i) + 3);
}
const keysList = () => { const i = src.indexOf('\nconst DATA_KEYS'); return src.slice(i + 1, src.indexOf('];\n', i) + 2); };
const NAMES = ['cleanData', 'isValidData', 'loadLocal', 'recoverDamagedData', 'safeCell', 'csvField', 'csvText', 'eraseDeviceData'];
const CODE = [keysList(), ...NAMES.map(extract)].join('\n');

function device({ stored, backups = [], answer = true } = {}) {
  const small = new Map(Object.entries(stored || {})), big = new Map(), alerts = [], questions = [];
  const localStorage = { getItem: k => (small.has(k) ? small.get(k) : null), setItem: (k, v) => small.set(k, String(v)), removeItem: k => small.delete(k) };
  const deviceDbRun = async (mode, action) => action({ put: (v, k) => big.set(k, v), delete: k => big.delete(k) });
  const A = new Function('localStorage', 'deviceDbRun', 'readBackups', 'alert', 'confirm', 'console', `let appData = { accounts: [], operations: [] }, damagedData = null, backupWork = Promise.resolve(), saved = 0;
    const saveLocal = () => { saved++; };
    ${CODE}
    return { ${NAMES.join(', ')}, data: () => appData, damaged: () => damagedData, saved: () => saved, done: () => backupWork };`)(
    localStorage, deviceDbRun, async () => [...backups], m => alerts.push(m), q => { questions.push(q); return answer; }, { warn() {} });
  return Object.assign(A, { small, big, alerts, questions });
}
const good = () => ({ accounts: [{ name: 'courant', initialBalance: 5 }], operations: [{ id: 'a1-b_2', account: 'courant', date: '2026-11-01', type: 'debit', amount: 10, label: 'L\'été "2026" <ok>; fin', detail: 'courant -> épargne', category: 'A/B', exceptions: ['2026-10'], endDate: null, lastPayment: '' }], budgets: { A: 5 }, alerts: { courant: 1 } });

test('données normales : le nettoyage ne change rien, textes compris', () => {
  const A = device(), data = good();
  assert.deepEqual(A.cleanData(structuredClone(data)), data);
});

test('données piégées : les champs techniques reprennent leur forme, rien ne peut s’y cacher', () => {
  const A = device(), trap = '"><img src=x onerror=alert(1)>';
  const d = A.cleanData({ accounts: [{ name: trap, initialBalance: trap, cardLimit: '300', billingCycleDay: trap, debitRuleFrom: trap }],
    operations: [{ id: 'x\');alert(1);//', account: 'c', date: '2026-11-01' + trap, type: trap, amount: trap, billingShift: trap, nextPayment: trap, endDate: trap, debitDate: trap, lastPayment: trap, exceptions: [trap, '2026-05'] }],
    budgets: { a: trap, b: '60000' }, alerts: { c: trap }, catColors: { a: 'red;' + trap, b: '#aabbcc' }, catIcons: { a: trap, b: '🛒' } });
  const o = d.operations[0];
  assert.match(o.id, /^[\w-]+$/);
  assert.match(o.date, /^[\d-]{0,10}$/);
  assert.deepEqual([o.type, o.amount, o.billingShift, o.nextPayment, o.endDate, o.debitDate, o.lastPayment, o.exceptions], ['debit', 0, 0, undefined, undefined, undefined, undefined, ['2026-05']]);
  assert.deepEqual([d.accounts[0].initialBalance, d.accounts[0].cardLimit, d.accounts[0].billingCycleDay, d.accounts[0].debitRuleFrom], [0, 300, 0, undefined]);
  assert.deepEqual([d.budgets, d.alerts, d.catColors, d.catIcons], [{ b: 60000 }, {}, { b: '#aabbcc' }, { b: '🛒' }]);
  assert.equal(d.accounts[0].name, trap);                          // un nom reste un texte : il est neutralisé à l'affichage
});

test('page : aucun code écrit dedans, et la règle de sécurité l’interdit', () => {
  assert.equal((html + src).match(/<[a-z][^<>]*\son[a-z]+\s*=\s*["']/gi), null);
  const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  const script = /script-src ([^;]+)/.exec(policy)[1];
  assert.ok(!script.includes('unsafe') && !script.includes('*') && script.includes("'self'"));
  // envoi vers Drive, connexion Google et déconnexion ; rien d'autre
  assert.match(policy, /connect-src 'self' https:\/\/www\.googleapis\.com https:\/\/accounts\.google\.com https:\/\/oauth2\.googleapis\.com;/);
  assert.equal([...html.matchAll(/<script(?![^>]*\ssrc=)/g)].length, 0);
  // chaque bouton créé par l'application renvoie à une action connue
  const actions = src.slice(src.indexOf('const ACTIONS = {'), src.indexOf('\n};\n', src.indexOf('const ACTIONS = {')));
  for (const [, name] of (src + html).matchAll(/data-action="([a-z-]+)"/g)) assert.ok(new RegExp(`(^|\\s)'?${name}'?:`, 'm').test(actions), name);
});

test('mémoire abîmée : repérée, texte gardé à part, dernière copie utilisable reprise après accord', async () => {
  const copy = (date, data) => ({ date, ops: 1, data });
  const backups = [copy('2026-11-01 10:00', JSON.stringify(good())), copy('2026-11-02 10:00', '{abîmé')];
  for (const raw of ['{"operations":[', '{"error":{"code":503}}', '{"operations":[null]}', '"texte"']) {
    const A = device({ stored: { finances_data: raw, finances_driverev: 'x' }, backups });
    assert.equal(A.loadLocal(), false, raw);
    assert.equal(A.damaged(), raw);
    assert.equal(await A.recoverDamagedData(), true);
    assert.equal(A.big.get('damaged'), raw);
    assert.equal(A.data().operations.length, 1);
    assert.equal(A.saved(), 1);
    assert.equal(A.small.has('finances_driverev'), false);
    assert.match(A.questions[0], /illisibles[\s\S]*2026-11-01/);
    assert.equal(await A.recoverDamagedData(), false);              // une seule fois
  }
  const refused = device({ stored: { finances_data: '{' }, backups, answer: false });
  refused.loadLocal();
  assert.equal(await refused.recoverDamagedData(), false);
  assert.equal(refused.saved(), 0);
  const none = device({ stored: { finances_data: '{' } });
  none.loadLocal();
  assert.equal(await none.recoverDamagedData(), false);
  assert.match(none.alerts[0], /pas de copie/);
});

test('mémoire normale ou ancienne : chargée comme avant', () => {
  const A = device({ stored: { finances_data: JSON.stringify({ operations: [] }) } });
  assert.equal(A.loadLocal(), true);
  assert.deepEqual(A.data().accounts, []);
  assert.equal(device().loadLocal(), false);
});

test('« Effacer » : données, copies et noms de comptes retirés ; apparence gardée', async () => {
  const stored = Object.fromEntries(['finances_data', 'finances_backups', 'finances_pwd', 'finances_bank_cards', 'finances_cat_skip', 'finances_proj_accounts', 'lastImportUndo', 'gToken', 'finances_card_color', 'darkMode', 'finances_background'].map(k => [k, 'x']));
  const A = device({ stored });
  A.big.set('backups', []); A.big.set('damaged', 'x'); A.big.set('backgroundPhoto', 'p');
  A.eraseDeviceData(); await A.done();
  assert.deepEqual([...A.small.keys()].sort(), ['darkMode', 'finances_background', 'finances_card_color']);
  assert.deepEqual([...A.big.keys()], ['backgroundPhoto']);
});

test('export CSV : séparateurs et guillemets protégés, jamais de formule', () => {
  const A = device();
  assert.equal(A.csvField('Courses'), 'Courses');
  assert.equal(A.csvField('Courses; cadeau'), '"Courses; cadeau"');
  assert.equal(A.csvField('dit "oui"'), '"dit ""oui"""');
  assert.equal(A.csvField('ligne\nsuite'), '"ligne\nsuite"');
  for (const formula of ['=2+3', '+33', '@SOMME(A1)', '-cmd']) assert.equal(A.csvField(formula)[0], "'");
  assert.equal(A.csvField('- remise'), '- remise');
  assert.equal(A.csvField(undefined), '');
});

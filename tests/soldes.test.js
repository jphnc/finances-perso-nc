// Tests des calculs de solde et de la fiabilité des données.
// Lancer : node --test tests/        (Node 18+, aucune dépendance)
// Les fonctions sont extraites de app.js (qui reste un simple script de navigateur).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
function extract(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('fonction introuvable dans app.js : ' + name);
  return src.slice(i, src.indexOf('\n}\n', i) + 3);
}
const NAMES = ['parseAmount', 'localDateStr', 'getEarliestScheduledMonth', 'scheduledOpsInMonth', 'calcBalanceAtDate',
  'calcBalanceEndOfMonth', 'getMonthOps', 'calcBalanceAsOf', 'dropOps', 'mergeAppData', 'stableText', 'recordText', 'isEmptyValue', 'settingKeys',
  'getAccountKind', 'groupAccountsByKind', 'isAccountIncluded', 'getUpcomingOps', 'upcomingNetForTotal',
  'getBillingCycleStart', 'billingDebitDate', 'cardDebitDate', 'parseBankText', 'inferCardRule', 'applyCardRule', 'matchBankOps', 'bankCategory', 'setBankDebit', 'applyBankImport', 'undoBankImport', 'pendingDebit', 'pendingDebitHtml', 'chosenDebitDate', 'autoDebitDate', 'balanceDate', 'cardPeriod', 'getBillingPeriodOps', 'calcBillingBalance', 'getEncoursOps', 'getCardsEncours', 'limitColor', 'encoursLeftHtml',
  'calcBalanceSeries', 'getAccountNames', 'isTransferOp', 'getScopeNames', 'checkedAccounts', 'scopeFromChecked', 'accountChecksHtml', 'pickedAccounts', 'projScope', 'projSaved', 'calcScopeBalanceEndOfMonth', 'calcFlowSummary', 'calcMonthlyFlows',
  'opFlowInScope', 'calcProjectedFlow', 'calcRecentAverageFlows', 'getProjectedOps', 'calcProjectionSeries', 'summarizeProjection',
  'calcChangePct', 'averageCompleteMonths', 'changeChip',
  'calcScopeBalanceAsOf', 'calcTrendSeries', 'getQuickSuggestions', 'findLabelHistory', 'removeAddedOps',
  'isUnclassified', 'getCategorizeQueue', 'getCategoryChoices', 'applyCategoryToOps', 'restoreCategories',
  'splitCategory', 'joinCategory', 'catKey', 'isReservedCategory', 'checkCategoryName', 'getCategoryCatalog', 'categoryExists',
  'guessCatIcon', 'catIcon', 'hashColor', 'catColor', 'snapshotCatalog', 'restoreCatalog', 'undoCategoryChange', 'materializeCatalog',
  'remapCategories', 'setCategoryIcon', 'moveCategoryStyle', 'dropCategoryStyle', 'addMainCategory', 'addSubCategory',
  'renameMainCategory', 'renameSubCategory', 'deleteMainCategory', 'deleteSubCategory', 'getAllCategoryOptions',
  'chartIndexAt', 'chartTipPosition', 'normalizePointDay', 'pointDateOf', 'pointTitle', 'balanceDayDate', 'balanceDayChoiceOf',
  'monthIndexOf', 'addDays', 'scheduledDest', 'scheduledDates', 'nextScheduledDate', 'countedOccurrences', 'occurrenceChoices',
  'findRecordedPayment', 'passScheduled', 'undoPass', 'endBeforeMonth', 'splitScheduled', 'monthlyScheduledTotals', 'visibleAreaInsets', 'backupDirView', 'backupDirError', 'autoBackupName', 'oldAutoBackups', 'backupAlert', 'oneAtATime', 'backgroundChoices', 'normalizeBackground', 'photoVisibility', 'cardChoices', 'normalizeCardColor', 'isLightColor', 'cardSettings', 'transferTarget', 'isTransferLeg', 'findTransferPartner', 'applyTransferEdit', 'cleanComment', 'csvText',
  'fieldValue', 'daysBetween', 'describeDays', 'hintText', 'similarLabel', 'telltale', 'findDuplicates', 'findDueDuplicate', 'duplicateText', 'dueText', 'entryDuplicateHint', 'findTransferDuplicates', 'transferDuplicateText', 'checkOperationRisks', 'checkTransferRisks', 'countPastOccurrences',
  'formatDate', 'esc', 'calcDashboardBalance', 'calcDashboardTotalBalance', 'getBillingInfo',
  'computeConnState', 'shouldProposeConnection',
  'statsRange', 'plainText', 'searchTerms', 'matchesSearch', 'searchRange', 'searchOperations', 'searchTotals', 'totalsText', 'groupByMonth', 'describeSearch', 'searchPrintDoc', 'bankDate', 'deferredOps', 'selectOperations', 'operationTotals', 'describeOpsFilters', 'longDate', 'monthTitle', 'opsPrintDoc', 'accountsPrintDoc', 'commentHtml', 'debitNote',
  'fileDate', 'periodView', 'cardStatementRange', 'cardDebitDates', 'printTable', 'printSummary', 'printPage', 'printCount', 'printTotals', 'periodPrintDoc', 'cardPrintDoc', 'buildPrintDoc',
  'scopeLabel', 'reportRange', 'reportData', 'categoryTable', 'reportPrintDoc', 'schedulePrintDoc', 'projectionPrintDoc', 'checkSheetPrintDoc'];
// Constantes de app.js nécessaires aux fonctions d'affichage et d'aide, puis le registre des explications (un objet, pas une fonction)
const PRELUDE = `const fmt = (n) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' F';
const today = () => localDateStr(new Date());
const signedFmt = v => (v > 0 ? '+' : '') + fmt(v);
const fmtInt = n => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n);
let dashboardBalanceDate = null;
let _projSaved;
let _uid = 0;
const uid = () => 'u' + (++_uid);
let statsMonth = new Date().getMonth();
let statsYear = new Date().getFullYear();
${['DEFAULT_CATEGORIES', 'CAT_RESERVED', 'CAT_PALETTE'].map(n => 'const ' + n + ' = ' + new RegExp('const ' + n + ' = (\\[.*?\\]);').exec(src)[1] + ';').join('\n')}
${extractConst('CAT_ICONS')}
${extractConst('CAT_COLORS')}
${extractConst('FREQ_LABELS')}`;
function extractConst(name) {
  const i = src.indexOf('const ' + name + ' = {');
  if (i < 0) throw new Error('constante introuvable dans app.js : ' + name);
  return src.slice(i, src.indexOf('\n};\n', i) + 4);
}
const CODE = PRELUDE + '\n' + NAMES.map(extract).join('\n') + '\n' + extractConst('HELP_TOPICS');

function load(data) {
  return new Function('init', `let appData = init;\n${CODE}\nreturn { ${NAMES.join(', ')}, HELP_TOPICS, getData: () => appData };`)(data);
}
// Même chargement avec une horloge figée : les fonctions de projection lisent « new Date() ».
function loadAt(data, iso) {
  const Real = Date, fixed = new Real(iso).getTime();
  class FakeDate extends Real {
    constructor(...a) { if (a.length) super(...a); else super(fixed); }
    static now() { return fixed; }
  }
  return new Function('init', 'Date', `let appData = init;\n${CODE}\nreturn { ${NAMES.join(', ')}, HELP_TOPICS, getData: () => appData };`)(data, FakeDate);
}
const op = (o) => ({ opType: 'Operation', category: 'Autre', ...o });

test('parseAmount : entier > 0 uniquement', () => {
  const { parseAmount } = load({ operations: [], accounts: [] });
  assert.equal(parseAmount('50000'), 50000);
  assert.equal(parseAmount(' 1 500 '), 1500);
  assert.equal(parseAmount('12,6'), 13);
  for (const bad of ['', '0', '-5', 'abc', null, undefined, '1e3', NaN]) assert.equal(parseAmount(bad), null, String(bad));
});

test("solde = solde initial + crédits - débits (opérations réelles, jusqu'à la date)", () => {
  const d = { accounts: [{ name: 'c', initialBalance: 1000 }], operations: [
    op({ id: '1', account: 'c', date: '2021-03-05', type: 'credit', amount: 500, label: 'a' }),
    op({ id: '2', account: 'c', date: '2021-03-20', type: 'debit', amount: 200, label: 'b' }),
    op({ id: '3', account: 'c', date: '2021-04-02', type: 'debit', amount: 50, label: 'c' }),
  ] };
  const A = load(d);
  assert.equal(A.calcBalanceAsOf('c', '2021-03-10'), 1500);
  assert.equal(A.calcBalanceEndOfMonth('c', 2021, 2), 1300);
  assert.equal(A.calcBalanceEndOfMonth('c', 2021, 3), 1250);
});

test('opération programmée mensuelle : comptée chaque mois à partir de sa date, jamais avant', () => {
  const d = { accounts: [{ name: 'c', initialBalance: 0 }], operations: [
    op({ id: 's', opType: 'Programmee', account: 'c', date: '2021-02-10', nextPayment: '2021-02-10', type: 'debit', amount: 100, label: 'loyer', detail: 'mensuelle' }),
  ] };
  const A = load(d);
  assert.equal(A.calcBalanceEndOfMonth('c', 2021, 0), 0);      // janvier : avant le début
  assert.equal(A.calcBalanceEndOfMonth('c', 2021, 1), -100);   // février
  assert.equal(A.calcBalanceEndOfMonth('c', 2021, 3), -300);   // avril
  assert.equal(A.calcBalanceAsOf('c', '2021-04-09'), -200);    // avril, échéance du 10 pas encore passée
});

test("exception sur un mois : l'échéance n'est plus comptée, l'opération réelle la remplace", () => {
  const d = { accounts: [{ name: 'c', initialBalance: 0 }], operations: [
    op({ id: 's', opType: 'Programmee', account: 'c', date: '2021-02-10', nextPayment: '2021-02-10', type: 'debit', amount: 100, label: 'loyer', detail: 'mensuelle', exceptions: ['2021-03'] }),
    op({ id: 'r', account: 'c', date: '2021-03-10', type: 'debit', amount: 80, label: 'loyer' }),
  ] };
  const A = load(d);
  assert.equal(A.calcBalanceEndOfMonth('c', 2021, 2), -100 - 80);
});

test('ponctuelle / trimestrielle / fin de série', () => {
  const base = { opType: 'Programmee', account: 'c', type: 'debit', amount: 10, label: 'x' };
  const d = { accounts: [{ name: 'c', initialBalance: 0 }], operations: [
    { ...base, id: 'p', date: '2021-01-05', nextPayment: '2021-01-05', detail: 'ponctuelle' },
    { ...base, id: 't', date: '2021-01-05', nextPayment: '2021-01-05', detail: 'trimestrielle' },
    { ...base, id: 'f', date: '2021-01-05', nextPayment: '2021-01-05', detail: 'mensuelle', endDate: '2021-02-28' },
  ] };
  const A = load(d);
  // janv : p + t + f = 30 ; fév : f ; mars : rien (f terminé, t tous les 3 mois) ; avril : t
  assert.equal(A.calcBalanceEndOfMonth('c', 2021, 0), -30);
  assert.equal(A.calcBalanceEndOfMonth('c', 2021, 1), -40);
  assert.equal(A.calcBalanceEndOfMonth('c', 2021, 2), -40);
  assert.equal(A.calcBalanceEndOfMonth('c', 2021, 3), -50);
});

test('virement programmé : débit sur la source ET crédit sur la destination (somme nulle)', () => {
  const d = { accounts: [{ name: 'a', initialBalance: 0 }, { name: 'b', initialBalance: 0 }], operations: [
    op({ id: 'v', opType: 'Programmee', account: 'a', label: '[b]', virementDest: 'b', date: '2021-01-30', nextPayment: '2021-01-30', type: 'debit', amount: 100, detail: 'mensuelle' }),
  ] };
  const A = load(d);
  assert.equal(A.calcBalanceEndOfMonth('a', 2021, 1), -200);
  assert.equal(A.calcBalanceEndOfMonth('b', 2021, 1), 200);
  assert.equal(A.calcBalanceEndOfMonth('', 2021, 1), 0);
});

test('cohérence : solde de fin de mois = solde de début + opérations du mois', () => {
  const d = { accounts: [{ name: 'c', initialBalance: 100 }], operations: [
    op({ id: '1', account: 'c', date: '2021-05-03', type: 'credit', amount: 400, label: 'a' }),
    op({ id: 's', opType: 'Programmee', account: 'c', date: '2021-04-15', nextPayment: '2021-04-15', type: 'debit', amount: 70, label: 'b', detail: 'mensuelle' }),
  ] };
  const A = load(d);
  const delta = A.getMonthOps('c', 2021, 4).reduce((s, o) => o.type === 'credit' ? s + o.amount : s - o.amount, 0);
  assert.equal(A.calcBalanceEndOfMonth('c', 2021, 4) - delta, A.calcBalanceEndOfMonth('c', 2021, 3));
});

test('suppression : dropOps garde une trace dans deletedIds', () => {
  const d = { accounts: [], operations: [op({ id: 'a' }), op({ id: 'b' })] };
  const A = load(d);
  assert.equal(A.dropOps(o => o.id !== 'a'), 1);
  assert.deepEqual(A.getData().operations.map(o => o.id), ['b']);
  assert.ok(A.getData().deletedIds.a);
});

test('fusion Drive : union des opérations, suppressions respectées, fichier récent prioritaire', () => {
  const A = load({ accounts: [], operations: [] });
  const local = { lastSync: '2026-11-21T10:00:00Z', accounts: [{ name: 'c' }, { name: 'neuf' }], deletedIds: { gone: new Date().toISOString() },
    operations: [op({ id: 'both', amount: 2, account: 'c' }), op({ id: 'onlyLocal', account: 'neuf' })] };
  const remote = { lastSync: '2026-11-20T10:00:00Z', accounts: [{ name: 'c' }],
    operations: [op({ id: 'both', amount: 1, account: 'c' }), op({ id: 'gone', account: 'c' }), op({ id: 'onlyRemote', account: 'c' })] };
  const m = A.mergeAppData(local, remote);
  assert.deepEqual(m.operations.map(o => o.id).sort(), ['both', 'onlyLocal', 'onlyRemote']);
  assert.equal(m.operations.find(o => o.id === 'both').amount, 2);       // local plus récent
  assert.deepEqual(m.accounts.map(a => a.name).sort(), ['c', 'neuf']);
  // sens inverse : le distant est plus récent → sa version gagne, mais rien n'est perdu
  const m2 = A.mergeAppData({ ...remote, lastSync: '2026-11-22T10:00:00Z' }, local);
  assert.equal(m2.operations.find(o => o.id === 'both').amount, 1);
  assert.ok(m2.operations.some(o => o.id === 'onlyLocal') && !m2.operations.some(o => o.id === 'gone'));
});

// ── Accueil « logiciel de comptes » ──────────────────────────────────────────

test('type de compte : déduit du nom / de la carte, ou choisi explicitement', () => {
  const { getAccountKind } = load({ operations: [], accounts: [] });
  assert.equal(getAccountKind({ name: 'courant' }), 'courant');
  assert.equal(getAccountKind({ name: 'compte courant' }), 'courant');
  assert.equal(getAccountKind({ name: 'epargne' }), 'epargne');
  assert.equal(getAccountKind({ name: 'Livret A' }), 'epargne');
  assert.equal(getAccountKind({ name: 'compte credit maison' }), 'credit');
  assert.equal(getAccountKind({ name: 'prêt moto' }), 'credit');
  assert.equal(getAccountKind({ name: 'financement voiture' }), 'credit');
  assert.equal(getAccountKind({ name: 'carte bleu', cardType: 'deferred' }), 'carte');
  assert.equal(getAccountKind({ name: 'courant', kind: 'epargne' }), 'epargne');   // le choix explicite l'emporte
  assert.equal(getAccountKind({ name: 'courant', kind: 'nimporte' }), 'courant');  // valeur inconnue ignorée
  assert.equal(getAccountKind(undefined), 'courant');
});

test('regroupement des comptes : ordre courant → épargne → crédit → carte, groupes vides omis', () => {
  const d = { operations: [], accounts: [
    { name: 'carte', cardType: 'deferred' }, { name: 'pret auto' }, { name: 'epargne' }, { name: 'courant' }, { name: 'second courant' },
  ] };
  const A = load(d);
  assert.deepEqual(A.groupAccountsByKind(['carte', 'pret auto', 'epargne', 'courant', 'second courant']).map(g => [g.kind, g.names]), [
    ['courant', ['courant', 'second courant']], ['epargne', ['epargne']], ['credit', ['pret auto']], ['carte', ['carte']],
  ]);
  assert.deepEqual(A.groupAccountsByKind(['epargne']).map(g => g.kind), ['epargne']);
});

test('à venir : échéances + opérations futures dans la fenêtre, virement à deux jambes, exceptions respectées', () => {
  const d = { accounts: [{ name: 'c' }, { name: 'e', includeInTotal: false }], operations: [
    op({ id: 'loyer', opType: 'Programmee', account: 'c', date: '2026-06-30', nextPayment: '2026-06-30', type: 'debit', amount: 50, label: 'loyer', detail: 'mensuelle' }),
    // virement mensuel dont l'échéance de novembre est exclue : rien dans la fenêtre (celle du 24/12 est trop loin)
    op({ id: 'virExcepte', opType: 'Programmee', account: 'c', label: '[e]', virementDest: 'e', date: '2026-10-24', nextPayment: '2026-10-24', type: 'debit', amount: 100, detail: 'mensuelle', exceptions: ['2026-11'] }),
    // virement ponctuel du 24/11 : deux jambes (débit sur c, crédit sur e)
    op({ id: 'vir2', opType: 'Programmee', account: 'c', label: '[e]', virementDest: 'e', date: '2026-11-24', nextPayment: '2026-11-24', type: 'debit', amount: 70, detail: 'ponctuelle' }),
    op({ id: 'futur', account: 'c', date: '2026-11-27', type: 'debit', amount: 300, label: 'paiement daté' }),
    op({ id: 'passe', account: 'c', date: '2026-11-20', type: 'debit', amount: 9, label: 'déjà passé' }),
    op({ id: 'lointain', account: 'c', date: '2027-03-01', type: 'debit', amount: 9, label: 'hors fenêtre' }),
  ] };
  const up = load(d).getUpcomingOps('2026-11-22', 30);   // fenêtre : du 23/11 au 22/12 inclus
  assert.deepEqual(up.map(o => [o.date, o.label, o.creditLeg]), [
    ['2026-11-24', '[c]', true],            // jambe crédit du virement (compte e)
    ['2026-11-24', '[e]', false],           // jambe débit (compte c)
    ['2026-11-27', 'paiement daté', false], // opération réelle datée dans le futur
    ['2026-11-30', 'loyer', false],         // échéance programmée (celle du 30/12 est hors fenêtre)
  ]);
});

test('à venir : une opération du jour même n\'est pas « à venir » (déjà comptée dans le solde du jour)', () => {
  const d = { accounts: [{ name: 'c' }], operations: [
    op({ id: 'a', account: 'c', date: '2026-11-22', type: 'debit', amount: 5, label: 'aujourd hui' }),
    op({ id: 'b', account: 'c', date: '2026-11-23', type: 'debit', amount: 5, label: 'demain' }),
    op({ id: 'c', account: 'c', date: '2026-12-22', type: 'debit', amount: 5, label: 'dans 30 jours pile' }),
    op({ id: 'd', account: 'c', date: '2026-12-23', type: 'debit', amount: 5, label: 'dans 31 jours' }),
  ] };
  const up = load(d).getUpcomingOps('2026-11-22', 30);
  assert.deepEqual(up.map(o => o.label), ['demain', 'dans 30 jours pile']);
});

test('à venir : le solde prévu ne compte que les comptes inclus dans le total (virement vers l\'épargne = sortie)', () => {
  const d = { accounts: [{ name: 'c' }, { name: 'e', includeInTotal: false }], operations: [
    op({ id: 'vir', opType: 'Programmee', account: 'c', label: '[e]', virementDest: 'e', date: '2026-11-25', nextPayment: '2026-11-25', type: 'debit', amount: 100, detail: 'ponctuelle' }),
    op({ id: 'rev', opType: 'Programmee', account: 'e', label: '[c]', virementDest: 'c', date: '2026-11-26', nextPayment: '2026-11-26', type: 'debit', amount: 30, detail: 'ponctuelle' }),
  ] };
  const A = load(d);
  const up = A.getUpcomingOps('2026-11-22', 30);
  assert.equal(up.length, 4);                              // 2 virements × 2 jambes
  assert.equal(up.filter(o => o.creditLeg).length, 2);
  assert.equal(A.upcomingNetForTotal(up), -100 + 30);      // c perd 100 vers e, puis reçoit 30 de e ; e est hors total
});

// ── Carte à débit différé : opérations de la période de référence (tableau de l'accueil) ──

test('carte à débit différé : opérations de la période de référence, triées par date, hors virements et programmées', () => {
  const d = { accounts: [{ name: 'cb', cardType: 'deferred', billingCycleDay: 26 }, { name: 'courant' }], operations: [
    op({ id: 'a', account: 'cb', date: '2026-10-25', type: 'debit', amount: 10, label: 'avant la période' }),
    op({ id: 'g', account: 'cb', date: '2026-11-04', type: 'credit', amount: 50, label: 'Remboursement' }),   // même jour que « c » mais saisi avant
    op({ id: 'c', account: 'cb', date: '2026-11-04', type: 'debit', amount: 200, label: 'Alpha' }),
    op({ id: 'b', account: 'cb', date: '2026-10-26', type: 'debit', amount: 100, label: 'Zeta (premier jour)' }),
    op({ id: 'e', account: 'cb', date: '2026-11-22', type: 'debit', amount: 5, label: 'dernier jour' }),
    op({ id: 'f', account: 'cb', date: '2026-11-23', type: 'debit', amount: 7, label: 'après la période' }),
    op({ id: 'h', account: 'cb', date: '2026-11-26', type: 'debit', amount: 3, label: 'jour de remise à zéro' }),
    op({ id: 'v1', account: 'cb', opType: 'Virement', date: '2026-11-10', type: 'credit', amount: 999, label: '[courant]' }),
    op({ id: 'v2', account: 'cb', date: '2026-11-11', type: 'debit', amount: 999, label: '[courant]' }),
    op({ id: 'p', account: 'cb', opType: 'Programmee', date: '2026-11-12', type: 'debit', amount: 999, label: 'programmée' }),
    op({ id: 'x', account: 'courant', date: '2026-11-05', type: 'debit', amount: 999, label: 'autre compte' }),
  ] };
  const A = load(d);
  const ref = new Date(2026, 10, 22);                       // 22/11 : la période commence le 26/10 (jour de remise à zéro = 26)
  assert.deepEqual(A.getBillingPeriodOps('cb', ref).map(o => o.id), ['b', 'g', 'c', 'e']);   // 26/10, puis les deux du 04/11 dans l'ordre de saisie, puis 22/11
  assert.equal(A.calcBillingBalance('cb', ref), 100 - 50 + 200 + 5);                          // débits − crédits = montant à prélever
  assert.equal(A.getBillingPeriodOps('courant', ref), null);                                  // pas une carte à débit différé
  assert.equal(A.calcBillingBalance('courant', ref), null);
  // le 25/11 (avant le jour de remise à zéro) la période a toujours commencé le 26/10 ; le 26/11 elle recommence à zéro
  assert.deepEqual(A.getBillingPeriodOps('cb', new Date(2026, 10, 25)).map(o => o.id), ['b', 'g', 'c', 'e', 'f']);
  assert.deepEqual(A.getBillingPeriodOps('cb', new Date(2026, 10, 26)).map(o => o.id), ['h']);
});

// ── Encours des cartes : les paiements des 30 derniers jours, pour toutes les cartes ──

test("encours d'une carte : paiements de « date − 30 jours » à « date » incluses, hors virements, programmées et crédits", () => {
  const d = { accounts: [{ name: 'cb', cardType: 'deferred', cardLimit: 1000 }, { name: 'courant' }], operations: [
    op({ id: 'avant', account: 'cb', date: '2026-10-23', type: 'debit', amount: 1, label: 'trente et un jours avant' }),   // hors fenêtre
    op({ id: 'debut', account: 'cb', date: '2026-10-24', type: 'debit', amount: 100, label: 'trente jours avant' }),        // premier jour inclus
    op({ id: 'b', account: 'cb', date: '2026-11-04', type: 'debit', amount: 200, label: 'Zeta (saisi en premier)' }),
    op({ id: 'a', account: 'cb', date: '2026-11-04', type: 'debit', amount: 50, label: 'Alpha (saisi ensuite)' }),
    op({ id: 'fin', account: 'cb', date: '2026-11-23', type: 'debit', amount: 5, label: "aujourd'hui" }),                    // dernier jour inclus
    op({ id: 'demain', account: 'cb', date: '2026-11-24', type: 'debit', amount: 7, label: 'dans le futur' }),
    op({ id: 'remb', account: 'cb', date: '2026-11-10', type: 'credit', amount: 999, label: 'Remboursement' }),             // seuls les paiements comptent
    op({ id: 'vir', account: 'cb', opType: 'Virement', date: '2026-11-11', type: 'debit', amount: 999, label: 'virement' }),
    op({ id: 'cro', account: 'cb', date: '2026-11-12', type: 'debit', amount: 999, label: '[courant]' }),
    op({ id: 'prog', account: 'cb', opType: 'Programmee', date: '2026-11-13', type: 'debit', amount: 999, label: 'programmée' }),
    op({ id: 'x', account: 'courant', date: '2026-11-05', type: 'debit', amount: 999, label: 'autre compte' }),
  ] };
  const A = load(d);
  const ref = new Date(2026, 10, 23);
  assert.deepEqual(A.getEncoursOps('cb', ref).map(o => o.id), ['debut', 'b', 'a', 'fin']);   // du plus ancien au plus récent, à date égale dans l'ordre de saisie
  assert.equal(A.getEncoursOps('courant', ref), null);                                      // pas une carte à débit différé
  assert.equal(A.getEncoursOps('inconnu', ref), null);
  // la fenêtre suit la date de référence, y compris à cheval sur deux années (23/11 → 24/10 ; 05/01/2027 → 06/12/2026)
  const d2 = { accounts: [{ name: 'cb', cardType: 'deferred' }], operations: [
    op({ id: 'n1', account: 'cb', date: '2026-12-05', type: 'debit', amount: 1, label: 'veille' }),
    op({ id: 'n2', account: 'cb', date: '2026-12-06', type: 'debit', amount: 2, label: 'premier jour' }),
    op({ id: 'n3', account: 'cb', date: '2027-01-05', type: 'debit', amount: 4, label: 'dernier jour' }),
  ] };
  assert.deepEqual(load(d2).getEncoursOps('cb', new Date(2027, 0, 5)).map(o => o.id), ['n2', 'n3']);
});

test("encours de toutes les cartes : une entrée par carte, total, et une seule liste triée par date", () => {
  const d = { accounts: [
    { name: 'cb1', cardType: 'deferred', cardLimit: 500 }, { name: 'cb2', cardType: 'deferred' },
    { name: 'courant' }, { name: 'epargne', cardType: 'immediate' },
  ], operations: [
    op({ id: '1', account: 'cb2', date: '2026-11-05', type: 'debit', amount: 30, label: 'x' }),
    op({ id: '2', account: 'cb1', date: '2026-11-05', type: 'debit', amount: 20, label: 'y' }),
    op({ id: '3', account: 'cb1', date: '2026-11-01', type: 'debit', amount: 10, label: 'z' }),
    op({ id: '4', account: 'courant', date: '2026-11-02', type: 'debit', amount: 999, label: 'pas une carte' }),
    op({ id: '5', account: 'cb2', date: '2026-09-01', type: 'debit', amount: 777, label: 'trop ancien' }),
    op({ id: '6', account: 'cb1', date: '2026-11-06', type: 'credit', amount: 888, label: 'remboursement non compté' }),
  ] };
  const A = load(d);
  const e = A.getCardsEncours(new Date(2026, 10, 23));
  assert.deepEqual([e.from, e.to], ['2026-10-24', '2026-11-23']);
  assert.deepEqual(e.cards.map(c => [c.name, c.total, c.limit, c.ops.length]), [['cb1', 30, 500, 2], ['cb2', 30, 0, 1]]);
  assert.equal(e.total, 60);
  // 01/11 puis les deux du 05/11 : la carte « cb1 » avant « cb2 » (ordre des comptes)
  assert.deepEqual(e.rows.map(r => [r.op.id, r.card]), [['3', 'cb1'], ['2', 'cb1'], ['1', 'cb2']]);
  // aucune carte à débit différé (ou aucune fiche de compte) : rien à afficher, pas d'erreur
  for (const none of [{ accounts: [{ name: 'courant' }], operations: [] }, { operations: [] }]) {
    const r = load(none).getCardsEncours(new Date(2026, 10, 23));
    assert.deepEqual([r.cards.length, r.rows.length, r.total], [0, 0, 0]);
  }
  // une carte sans paiement : encours nul, liste vide
  const vide = load({ accounts: [{ name: 'cb', cardType: 'deferred' }], operations: [] }).getCardsEncours(new Date(2026, 10, 23));
  assert.deepEqual([vide.cards[0].total, vide.cards[0].ops.length, vide.rows.length, vide.total], [0, 0, 0, 0]);
});

// ── Analyses : revenus / dépenses sans les virements entre comptes ──

test('virement entre comptes : opType Virement ou libellé entre crochets', () => {
  const { isTransferOp: t } = load({ operations: [], accounts: [] });
  assert.equal(t({ opType: 'Virement', label: 'Virement vers X' }), true);
  assert.equal(t({ opType: 'Operation', label: '[epargne]' }), true);
  assert.equal(t({ label: '[carte bleu]' }), true);
  assert.equal(t({ opType: 'Operation', label: 'Super U [centre]' }), false);
  assert.equal(t({ opType: 'Operation', label: 'Super U' }), false);
  assert.equal(t({}), false);
});

test("revenus et dépenses d'une période : échéances programmées comptées ; virements et régularisations non", () => {
  const d = { accounts: [{ name: 'courant' }, { name: 'epargne' }], operations: [
    op({ id: 'sal', account: 'courant', date: '2026-11-03', type: 'credit', amount: 1000, label: 'salaire', category: 'Revenus' }),
    op({ id: 'a1', account: 'courant', date: '2026-11-05', type: 'debit', amount: 100, label: 'Super U', category: 'Alimentation/Courses' }),
    op({ id: 'a2', account: 'courant', date: '2026-11-06', type: 'debit', amount: 50, label: 'Boulangerie', category: 'Alimentation' }),
    op({ id: 'a3', account: 'courant', date: '2026-11-07', type: 'debit', amount: 30, label: 'Bus', category: '' }),
    op({ id: 'v1', account: 'courant', opType: 'Virement', date: '2026-11-08', type: 'debit', amount: 200, label: '[epargne]', category: 'Transfert' }),
    op({ id: 'v2', account: 'epargne', opType: 'Virement', date: '2026-11-08', type: 'credit', amount: 200, label: '[courant]', category: 'Transfert' }),
    op({ id: 'v3', account: 'courant', date: '2026-11-09', type: 'debit', amount: 10, label: '[carte]' }),       // virement saisi sans opType
    op({ id: 'prog', account: 'courant', opType: 'Programmee', date: '2026-11-12', type: 'debit', amount: 999, label: 'programmée' }),
    op({ id: 'reg', account: 'courant', opType: 'Regularisation', date: '2026-11-13', type: 'credit', amount: 999, label: 'régul' }),
    op({ id: 'old', account: 'courant', date: '2026-10-31', type: 'debit', amount: 70, label: 'mois précédent' }),
  ] };
  const A = load(d);
  const all = A.calcFlowSummary('', '2026-11-01', '2026-11-30');
  assert.deepEqual([all.income, all.expense, all.net], [1000, 1179, -179]);                      // 200 + 200 + 10 de virements ne sont ni revenus ni dépenses
  assert.deepEqual(all.byCategory, { Alimentation: 150, Autre: 1029 });                       // « Alimentation/Courses » regroupé avec « Alimentation »
  assert.deepEqual(all.expenses.map(o => o.id), ['a1', 'a2', 'a3', 'prog']);
  assert.deepEqual(all.transfers, { 'courant → epargne': 200, 'courant → carte': 10 });     // tous les comptes : une seule jambe par virement
  const cour = A.calcFlowSummary('courant', '2026-11-01', '2026-11-30');
  assert.deepEqual([cour.income, cour.expense], [1000, 1179]);
  assert.deepEqual(cour.transfers, { 'courant → epargne': 200, 'courant → carte': 10 });
  const ep = A.calcFlowSummary('epargne', '2026-11-01', '2026-11-30');
  assert.deepEqual([ep.income, ep.expense], [0, 0]);
  assert.deepEqual(ep.transfers, { 'courant → epargne': 200 });                                // jambe crédit vue du compte qui reçoit
  assert.equal(A.calcFlowSummary('', '2026-10-01', '2026-10-31').expense, 70);               // bornes de période : le 31/10 compte pour octobre
});

test('revenus / dépenses par mois : du plus ancien au plus récent, y compris à cheval sur deux années', () => {
  const d = { accounts: [{ name: 'c' }], operations: [
    op({ id: '1', account: 'c', date: '2026-11-30', type: 'debit', amount: 10, label: 'a' }),
    op({ id: '2', account: 'c', date: '2026-12-01', type: 'credit', amount: 500, label: 'b' }),
    op({ id: '3', account: 'c', date: '2026-12-31', type: 'debit', amount: 20, label: 'c' }),
    op({ id: '4', account: 'c', date: '2027-01-01', type: 'debit', amount: 5, label: 'd' }),
  ] };
  const r = loadAt(d, '2027-02-15T10:00:00').calcMonthlyFlows('', 2027, 0, 3);
  assert.deepEqual(r.map(x => [x.year, x.month, x.income, x.expense, x.net]),
    [[2026, 10, 0, 10, -10], [2026, 11, 500, 20, 480], [2027, 0, 0, 5, -5]]);
});

test('variation en % et pastille : une hausse de dépenses est mauvaise, une hausse de revenus est bonne', () => {
  const A = load({ operations: [], accounts: [] });
  assert.equal(A.calcChangePct(120, 100), 20);
  assert.equal(A.calcChangePct(80, 100), -20);
  assert.equal(A.calcChangePct(5, 0), null);                                   // rien à comparer
  assert.match(A.changeChip(120, 100, true), /bad.*▲ 20 %/);                   // dépenses en hausse : rouge
  assert.match(A.changeChip(80, 100, true), /good.*▼ 20 %/);                   // dépenses en baisse : vert
  assert.match(A.changeChip(120, 100, false), /good.*▲ 20 %/);                 // revenus en hausse : vert
  assert.match(A.changeChip(80, 100, false), /bad.*▼ 20 %/);
  assert.equal(A.changeChip(100, 100, true), '');                              // inchangé ou sans comparaison : pas de pastille
  assert.equal(A.changeChip(7, 0, true), '');
});

test('moyennes mensuelles : mois complets seulement (avant le mois en cours), mois vides ignorés', () => {
  const { averageCompleteMonths: avg } = load({ operations: [], accounts: [] });
  const flows = [
    { year: 2026, month: 7, income: 0, expense: 0 },           // avant le début des données : ignoré
    { year: 2026, month: 8, income: 1000, expense: 600 },
    { year: 2026, month: 9, income: 500, expense: 900 },
    { year: 2026, month: 10, income: 9999, expense: 9999 },    // mois en cours : incomplet, ignoré
    { year: 2026, month: 11, income: 0, expense: 0 },          // mois à venir
  ];
  assert.deepEqual(avg(flows, 2026, 10), { months: 2, income: 750, expense: 750, net: 0, rate: 0 });
  assert.deepEqual(avg(flows.slice(1, 2), 2026, 10), { months: 1, income: 1000, expense: 600, net: 400, rate: 40 });
  assert.deepEqual(avg(flows.slice(3), 2026, 10), { months: 0, income: 0, expense: 0, net: 0, rate: null });
  assert.equal(avg([{ year: 2026, month: 9, income: 0, expense: 50 }], 2026, 10).rate, null);   // aucun revenu : taux d'épargne indéfini
});

// ── Projection : « Tous les comptes » = tous les comptes ──

// Jeu de données commun (date figée au 23/11/2026) : un compte courant dans le solde total, une épargne et un prêt hors total
const projData = () => ({ accounts: [
  { name: 'courant', initialBalance: 1000 },
  { name: 'epargne', initialBalance: 5000, includeInTotal: false },
  { name: 'pret', initialBalance: -9000, includeInTotal: false },
], operations: [
  op({ id: 'r1', account: 'courant', date: '2026-11-10', type: 'credit', amount: 500, label: 'prime' }),                   // déjà dans le solde de départ
  op({ id: 'r2', account: 'courant', date: '2026-12-05', type: 'debit', amount: 40, label: 'réel déjà saisi, futur' }),
  op({ id: 's1', opType: 'Programmee', account: 'courant', date: '2026-11-25', nextPayment: '2026-11-25', type: 'credit', amount: 1000, label: 'salaire' }),
  op({ id: 's2', opType: 'Programmee', account: 'courant', date: '2026-11-28', nextPayment: '2026-11-28', type: 'debit', amount: 300, label: 'loyer' }),
  op({ id: 's3', opType: 'Programmee', account: 'courant', date: '2026-11-26', nextPayment: '2026-11-26', type: 'debit', amount: 200, label: '[epargne]' }),
  op({ id: 's4', opType: 'Programmee', account: 'courant', date: '2026-11-27', nextPayment: '2026-11-27', type: 'debit', amount: 100, label: '[pret]', endDate: '2027-01-31' }),
  op({ id: 's5', opType: 'Programmee', account: 'courant', date: '2026-12-15', nextPayment: '2026-12-15', type: 'debit', amount: 60, label: 'ponctuelle', detail: 'ponctuelle' }),
] });

test("périmètre : '' = tous les comptes, '__total' = comptes du solde total, ou un compte", () => {
  const A = loadAt(projData(), '2026-11-23T10:00:00');
  assert.deepEqual(A.getScopeNames(''), ['courant', 'epargne', 'pret']);
  assert.deepEqual(A.getScopeNames('__total'), ['courant']);
  assert.deepEqual(A.getScopeNames('epargne'), ['epargne']);
  assert.deepEqual(A.getScopeNames('inconnu'), []);
  assert.equal(A.calcScopeBalanceEndOfMonth('', 2026, 10), 1900 + 5200 - 8900);
  assert.equal(A.calcScopeBalanceEndOfMonth('__total', 2026, 10), 1900);
});

test('projection de tous les comptes : un solde par compte, total cohérent, virements internes sans effet', () => {
  const A = loadAt(projData(), '2026-11-23T10:00:00');
  const s = A.calcProjectionSeries('', 3, 0);
  assert.deepEqual(s.names, ['courant', 'epargne', 'pret']);                    // les comptes hors solde total y sont aussi
  assert.deepEqual(s.months.map(m => [m.year, m.month]), [[2026, 10], [2026, 11], [2027, 0], [2027, 1]]);
  assert.deepEqual(s.perAccount.courant, [1900, 2200, 2600, 3100]);
  assert.deepEqual(s.perAccount.epargne, [5200, 5400, 5600, 5800]);             // +200 par mois : jambe crédit du virement programmé
  assert.deepEqual(s.perAccount.pret, [-8900, -8800, -8700, -8700]);            // remboursement terminé fin janvier
  assert.deepEqual(s.totals, [-1800, -1200, -500, 200]);
  // flux du périmètre : les virements vers l'épargne et le prêt restent dans le périmètre → ni entrée ni sortie
  assert.deepEqual(s.flows, [null, { income: 1000, expense: 400 }, { income: 1000, expense: 300 }, { income: 1000, expense: 300 }]);
  // cohérence : variation du total = entrées − sorties, et le solde du détail rejoint le total à chaque fin de mois
  for (let i = 1; i < s.totals.length; i++) assert.equal(s.totals[i] - s.totals[i - 1], s.flows[i].income - s.flows[i].expense);
  const lastOfMonth = [];
  for (const l of s.opLines) lastOfMonth[l.month.getMonth()] = l.balance;
  assert.equal(lastOfMonth[11], s.totals[1]);                                     // décembre
  assert.equal(lastOfMonth[0], s.totals[2]);                                      // janvier
  // un virement interne n'apparaît qu'une fois (jambe débit), sans effet sur le solde
  const dec = s.opLines.filter(l => l.month.getMonth() === 11).map(l => l.op.id);
  assert.deepEqual(dec, ['r2', 's5', 's1', 's3', 's4', 's2']);
});

test("projection des comptes du solde total ou d'un seul compte : un virement vers un autre compte est une sortie", () => {
  const A = loadAt(projData(), '2026-11-23T10:00:00');
  const t = A.calcProjectionSeries('__total', 3, 0);
  assert.deepEqual(t.names, ['courant']);
  assert.deepEqual(t.totals, [1900, 2200, 2600, 3100]);
  assert.deepEqual(t.flows.slice(1), [{ income: 1000, expense: 700 }, { income: 1000, expense: 600 }, { income: 1000, expense: 500 }]);
  const e = A.calcProjectionSeries('epargne', 3, 0);
  assert.deepEqual(e.totals, [5200, 5400, 5600, 5800]);
  assert.deepEqual(e.flows.slice(1), [{ income: 200, expense: 0 }, { income: 200, expense: 0 }, { income: 200, expense: 0 }]);
  for (let i = 1; i < t.totals.length; i++) assert.equal(t.totals[i] - t.totals[i - 1], t.flows[i].income - t.flows[i].expense);
});

test('projection avec un jour de relevé : la période va du lendemain du jour le mois précédent à ce jour', () => {
  const A = loadAt(projData(), '2026-11-23T10:00:00');
  const ids = (names, y, m, cut) => A.getProjectedOps(names, y, m, cut).map(o => o.id);
  // période de décembre pour le relevé du 25 : du 26/11 au 25/12 (le salaire du 25/11 appartient à la période de novembre)
  assert.deepEqual(ids(['courant'], 2026, 11, 25), ['s3', 's4', 's2', 'r2', 's5', 's1']);
  assert.deepEqual(ids(['courant'], 2026, 11, 0), ['r2', 's5', 's1', 's3', 's4', 's2']);      // mois civil : tout décembre
  for (const scope of ['', '__total', 'epargne']) {
    const s = A.calcProjectionSeries(scope, 3, 25);
    for (let i = 1; i < s.totals.length; i++) assert.equal(s.totals[i] - s.totals[i - 1], s.flows[i].income - s.flows[i].expense, scope + ' mois ' + i);
  }
  assert.equal(A.calcProjectionSeries('__total', 1, 25).totals[0], 2500);                    // départ : solde au 25/11 (le salaire du jour compte, pas le loyer du 28)
});

test('série de soldes : mêmes valeurs que le calcul mois par mois (fréquences, exceptions, fins, virements, jours de relevé)', () => {
  const d = projData();
  d.operations.push(
    op({ id: 'q', opType: 'Programmee', account: 'courant', date: '2026-08-31', nextPayment: '2026-08-31', type: 'debit', amount: 33, label: 'fin de mois' }),
    op({ id: 't', opType: 'Programmee', account: 'epargne', date: '2026-09-12', nextPayment: '2026-09-12', type: 'credit', amount: 77, label: 'trimestre', detail: 'trimestrielle' }),
    op({ id: 'b', opType: 'Programmee', account: 'courant', date: '2026-10-03', nextPayment: '2026-10-03', type: 'debit', amount: 11, label: 'bimestre', detail: 'bimensuelle' }),
    op({ id: 'a', opType: 'Programmee', account: 'pret', date: '2026-07-20', nextPayment: '2026-07-20', type: 'debit', amount: 5, label: 'annuelle', detail: 'annuelle' }),
    op({ id: 'x', opType: 'Programmee', account: 'courant', date: '2026-06-15', nextPayment: '2026-06-15', type: 'debit', amount: 9, label: 'exception', exceptions: ['2026-12'] }),
    op({ id: 'p', opType: 'Programmee', account: 'courant', date: '2026-08-20', nextPayment: '2026-08-20', type: 'credit', amount: 4, label: 'ponctuelle passée', detail: 'ponctuelle' }),
  );
  const A = loadAt(d, '2026-11-23T10:00:00');
  const months = [];
  for (let i = -4; i <= 14; i++) { const x = new Date(2026, 10 + i, 1); months.push({ year: x.getFullYear(), month: x.getMonth() }); }
  const sched = d.operations.filter(o => o.opType === 'Programmee');
  for (const name of ['courant', 'epargne', 'pret', 'absent']) {
    for (const cut of [0, 15, 25, 31]) {
      const ref = months.map(p => A.calcBalanceAtDate(name, p.year, p.month, cut));
      assert.deepEqual(A.calcBalanceSeries(name, months, cut, sched), ref, name + ' jour ' + cut);
      assert.deepEqual(A.calcBalanceSeries(name, months, cut), ref, name + ' jour ' + cut + ' (liste extraite en interne)');
    }
  }
});

test('synthèse de projection : point le plus bas, premier solde négatif, flux moyens', () => {
  const { summarizeProjection: sum } = load({ operations: [], accounts: [] });
  const s = sum({ totals: [100, 50, -20, 30], flows: [null, { income: 10, expense: 70 }, { income: 10, expense: 80 }, { income: 70, expense: 20 }] });
  assert.deepEqual([s.start, s.end, s.delta, s.lowIndex, s.lowValue, s.firstNegativeIndex, s.avgIncome, s.avgExpense], [100, 30, -70, 2, -20, 2, 30, 57]);
  const ok = sum({ totals: [10, 20], flows: [null, { income: 30, expense: 20 }] });
  assert.deepEqual([ok.lowIndex, ok.firstNegativeIndex, ok.delta], [0, -1, 10]);              // jamais négatif ; le plus bas est le départ
  const neg = sum({ totals: [-5, 5], flows: [null, { income: 10, expense: 0 }] });
  assert.equal(neg.firstNegativeIndex, 0);                                                    // déjà négatif au départ
});

test('flux constatés récents : moyenne des mois complets précédents, virements internes au périmètre ignorés', () => {
  const d = { accounts: [{ name: 'courant' }, { name: 'epargne' }], operations: [
    op({ id: 'a', account: 'courant', date: '2026-09-10', type: 'credit', amount: 900, label: 'salaire' }),
    op({ id: 'b', account: 'courant', date: '2026-09-12', type: 'debit', amount: 300, label: 'courses' }),
    op({ id: 'c', account: 'courant', date: '2026-10-05', type: 'debit', amount: 600, label: 'loyer' }),
    op({ id: 'v1', account: 'courant', opType: 'Virement', date: '2026-10-20', type: 'debit', amount: 200, label: '[epargne]' }),
    op({ id: 'v2', account: 'epargne', opType: 'Virement', date: '2026-10-20', type: 'credit', amount: 200, label: '[courant]' }),
    op({ id: 'now', account: 'courant', date: '2026-11-02', type: 'debit', amount: 5000, label: 'mois en cours : ignoré' }),
  ] };
  const A = loadAt(d, '2026-11-23T10:00:00');
  assert.deepEqual(A.calcRecentAverageFlows(['courant'], 3), { income: 300, expense: Math.round(1100 / 3) });      // le virement vers l'épargne sort du périmètre
  assert.deepEqual(A.calcRecentAverageFlows(['courant', 'epargne'], 3), { income: 300, expense: 300 });            // ...mais pas des deux comptes ensemble
});

// ── Aide contextuelle et garde-fous de saisie ──

const norm = (s) => String(s).replace(/\s/g, ' ');          // espaces insécables des nombres français → espace simple

test('aide sous un champ : montant lisible (zéros), date en toutes lettres', () => {
  const { hintText: h } = load({ operations: [], accounts: [] });
  assert.equal(norm(h('amount', '12500', '2026-11-23').text), '12 500 F');
  assert.equal(norm(h('amount', '1250000', '2026-11-23').text), '1 250 000 F — environ 1,25 million');
  assert.equal(norm(h('amount', '3000000', '2026-11-23').text), '3 000 000 F — environ 3 millions');
  assert.equal(h('amount', '', '2026-11-23').text, '');                                  // champ vide : rien à dire
  for (const bad of ['-5', 'abc', '0', '1e3']) assert.deepEqual([h('amount', bad, '2026-11-23').warn, h('amount', bad, '2026-11-23').text.length > 0], [true, true], bad);
  const today = h('date', '2026-11-23', '2026-11-23');
  assert.match(today.text, /lundi 23 novembre 2026 \(aujourd'hui\)/);
  assert.equal(today.warn, false);
  assert.match(h('date', '2026-11-24', '2026-11-23').text, /\(demain\)/);
  assert.equal(h('date', '2062-05-05', '2026-11-23').warn, true);                       // année probablement fausse
  assert.equal(h('date', '2025-01-01', '2026-11-23').warn, true);                       // plus d'un an dans le passé
  assert.equal(h('date', '2026-10-01', '2026-11-23').warn, false);
  assert.equal(h('date', '', '2026-11-23').text, '');
  assert.match(h('date', '2062-11-23', '2026-11-23').text, /(dans environ 36 ans)/);        // écart énorme : en années, pas en milliers de jours
  assert.match(h('date', '2000-01-01', '2026-11-23').text, /il y a environ 27 ans/);
  assert.match(h('date', '2026-01-23', '2026-11-23').text, /il y a 304 jours/);
});

test("opération : doublon, date très éloignée et montant inhabituel sont signalés (jamais d'alerte pour une saisie normale)", () => {
  const d = { accounts: [{ name: 'courant' }, { name: 'epargne' }], operations: [
    op({ id: 'c1', account: 'courant', date: '2026-09-02', type: 'debit', amount: 10000, label: 'Carrefour' }),
    op({ id: 'c2', account: 'courant', date: '2026-10-03', type: 'debit', amount: 12000, label: 'carrefour ' }),
    op({ id: 'c3', account: 'epargne', date: '2026-10-20', type: 'debit', amount: 11000, label: 'CARREFOUR' }),
    op({ id: 'pr', account: 'courant', opType: 'Programmee', date: '2026-11-01', type: 'debit', amount: 99999, label: 'Carrefour' }),
    ...['2026-08-01', '2026-09-01', '2026-10-01'].map((date, i) => op({ id: 'h' + i, account: 'courant', date, type: 'debit', amount: 1000, label: '<i>pain</i>' })),
  ] };
  const A = load(d);
  const codes = (o) => A.checkOperationRisks(o, '2026-11-23').map(w => w.code);
  const base = { account: 'courant', date: '2026-11-23', type: 'debit', amount: 13000, label: 'Carrefour' };
  assert.deepEqual(codes(base), []);                                                      // montant habituel, date du jour
  assert.deepEqual(codes({ ...base, amount: 120000 }), ['amount']);                       // zéro de trop (médiane 11 000 → 120 000)
  assert.match(norm(A.checkOperationRisks({ ...base, amount: 120000 }, '2026-11-23')[0].text), /11 000 F.*120 000 F.*zéro de trop/);
  assert.deepEqual(codes({ ...base, amount: 40000 }), []);                                // moins de 5 fois l'habitude
  assert.deepEqual(codes({ ...base, label: 'Nouveau commerce', amount: 900000 }), []);    // pas d'historique : rien à comparer
  assert.deepEqual(codes({ ...base, label: 'Boulangerie', amount: 90 }), []);
  assert.deepEqual(codes({ ...base, date: '2026-10-03', amount: 12000, label: 'carrefour' }), ['duplicate']);   // même compte, jour, libellé (casse ignorée), montant
  assert.deepEqual(codes({ ...base, date: '2026-10-03', amount: 12000, account: 'epargne' }), []);              // autre compte : pas un doublon
  assert.deepEqual(codes({ ...base, date: '2062-11-23' }), ['date']);
  assert.deepEqual(codes({ ...base, date: '2025-06-01' }), ['date']);
  assert.deepEqual(codes({ ...base, date: '2027-01-15' }), []);                           // dans moins de 60 jours : normal
  assert.deepEqual(codes({ ...base, date: '2062-11-23', amount: 120000 }), ['date', 'amount']);
  // le libellé saisi est échappé (il est affiché dans une fenêtre)
  const evil = A.checkOperationRisks({ ...base, label: '<i>pain</i>', amount: 6000 }, '2026-11-23');
  assert.deepEqual(evil.map(w => w.code), ['amount']);
  assert.ok(evil[0].text.includes('&lt;i&gt;pain&lt;/i&gt;') && !evil[0].text.includes('<i>'));
});

test('virement : doublon, date lointaine, et compte courant ou épargne qui passerait en négatif', () => {
  const d = { accounts: [{ name: 'courant', initialBalance: 1000 }, { name: 'epargne', initialBalance: 50000 }, { name: 'pret auto', initialBalance: -9000 }], operations: [
    op({ id: 'v1', account: 'epargne', opType: 'Virement', date: '2026-11-10', type: 'debit', amount: 200, label: '[courant]' }),
    op({ id: 'v2', account: 'courant', opType: 'Virement', date: '2026-11-10', type: 'credit', amount: 200, label: '[epargne]' }),
  ] };
  const A = loadAt(d, '2026-11-23T10:00:00');
  const codes = (from, to, amount, date) => A.checkTransferRisks(from, to, amount, date, '2026-11-23').map(w => w.code);
  assert.deepEqual(codes('epargne', 'courant', 300, '2026-11-23'), []);                  // simple et sans risque
  assert.deepEqual(codes('epargne', 'courant', 200, '2026-11-10'), ['duplicate']);         // même virement le même jour
  assert.deepEqual(codes('courant', 'epargne', 5000, '2026-11-23'), ['negative']);        // courant : 1 200 avant, −3 800 après
  assert.match(norm(A.checkTransferRisks('courant', 'epargne', 5000, '2026-11-23', '2026-11-23')[0].text), /-3 800 F.*1 200 F/);
  assert.deepEqual(codes('courant', 'epargne', 1200, '2026-11-23'), []);                  // tombe exactement à zéro : pas négatif
  assert.deepEqual(codes('pret auto', 'courant', 1000, '2026-11-23'), []);                // un prêt est négatif par nature
  assert.deepEqual(codes('epargne', 'courant', 300, '2062-01-01'), ['date']);
});

test("échéances déjà passées : nombre d'occurrences comptées depuis la date de départ", () => {
  const { countPastOccurrences: n } = load({ operations: [], accounts: [] });
  const T = '2026-11-23';
  assert.equal(n('mensuelle', '2026-06-15', null, T), 6);              // juin, juil., août, sept., oct., nov. (le 15 est passé)
  assert.equal(n('mensuelle', '2026-11-10', null, T), 1);
  assert.equal(n('mensuelle', '2026-11-25', null, T), 0);              // pas encore arrivée
  assert.equal(n('mensuelle', '2026-12-05', null, T), 0);              // départ dans le futur
  assert.equal(n('bimensuelle', '2026-06-15', null, T), 3);            // juin, août, octobre
  assert.equal(n('trimestrielle', '2026-02-01', null, T), 4);          // févr., mai, août, nov.
  assert.equal(n('annuelle', '2025-12-01', null, T), 1);
  assert.equal(n('ponctuelle', '2026-05-01', null, T), 1);
  assert.equal(n('ponctuelle', '2026-12-01', null, T), 0);
  assert.equal(n('mensuelle', '2026-06-15', '2026-08-01', T), 3);      // la date de fin arrête la série (au mois près, comme les soldes)
  assert.equal(n('mensuelle', '2026-08-31', null, T), 3);              // le 31 devient le 30 en septembre : août, sept., oct.
});

test("registre d'aide : chaque bouton « i » renvoie vers une explication qui existe", () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const used = new Set([...html.matchAll(/data-help="([a-z0-9-]+)"/g)].map(m => m[1]));
  for (const m of src.matchAll(/infoBtn\('([a-z0-9-]+)'/g)) used.add(m[1]);
  const { HELP_TOPICS } = load({ operations: [], accounts: [] });
  assert.ok(used.size >= 15, 'au moins quinze boutons : ' + used.size);
  for (const key of used) assert.equal(typeof HELP_TOPICS[key], 'function', 'explication manquante : ' + key);
  for (const key of Object.keys(HELP_TOPICS)) assert.ok(used.has(key), 'explication jamais utilisée : ' + key);
});

test("explications : chaque texte se construit sans erreur, avec les chiffres de l'utilisateur et sans injection", () => {
  const d = projData();
  d.accounts.push({ name: 'carte <b>x</b>', cardType: 'deferred', billingCycleDay: 26, cardLimit: 100000, includeInTotal: false });
  d.operations.push(
    op({ id: 'k1', account: 'carte <b>x</b>', date: '2026-11-10', type: 'debit', amount: 30000, label: 'achat' }),
    op({ id: 'k2', account: 'courant', date: '2026-11-12', type: 'debit', amount: 4500, label: 'courses', category: 'Alimentation' }),
    op({ id: 'k3', account: 'courant', date: '2026-10-12', type: 'credit', amount: 90000, label: 'salaire', category: 'Revenus' }),
  );
  const A = loadAt(d, '2026-11-23T10:00:00');
  for (const key of Object.keys(A.HELP_TOPICS)) {
    const t = A.HELP_TOPICS[key]('carte <b>x</b>');
    assert.ok(t.title && t.lead, key + ' : titre et résumé');
    assert.ok(Array.isArray(t.how) && Array.isArray(t.tips), key + ' : listes');
    const all = [t.title, t.lead, ...t.how, t.example, ...t.tips].join(' ');
    assert.ok(!/undefined|NaN|\[object/.test(all), key + ' : texte incohérent → ' + all.slice(0, 200));
    assert.ok(!/<b>x<\/b>/.test(t.example), key + ' : un nom de compte doit être échappé');
  }
  const ex = (key, arg) => norm(A.HELP_TOPICS[key](arg).example);
  assert.match(ex('solde-total'), /courant 87 000 F/);                                 // solde du jour du compte compté ; les autres sont « non comptés »
  assert.match(ex('solde-total'), /Non comptés : epargne, pret, carte &lt;b&gt;x&lt;\/b&gt;/);
  assert.match(ex('encours-cartes'), /30 000 F.*il reste.*70 000 F.*100 000 F.*30 %/);
  assert.match(ex('carte-prelevement', 'carte <b>x</b>'), /à prélever.*30 000 F/);
  assert.match(ex('inclus-total'), /Comptés aujourd'hui : courant\./);
});

// ── Projection : flux constatés (opérations saisies + échéances non remplacées) ──

// Échéances depuis juin 2026 ; le règlement de la carte (« [carte] ») n'y figure que pour 200 (provisoire) alors qu'il est
// réellement de 500, 600 et 400 ; les achats par carte (450, 550, 350) ne sont programmés nulle part.
const gapData = () => ({
  accounts: [{ name: 'courant', initialBalance: 0 }, { name: 'carte', initialBalance: 0 }, { name: 'epargne', initialBalance: 0, includeInTotal: false }],
  operations: [
    op({ id: 'sal', opType: 'Programmee', account: 'courant', date: '2026-06-25', nextPayment: '2026-06-25', type: 'credit', amount: 1000, label: 'salaire', exceptions: ['2026-09'] }),
    op({ id: 'loy', opType: 'Programmee', account: 'courant', date: '2026-06-28', nextPayment: '2026-06-28', type: 'debit', amount: 300, label: 'loyer', exceptions: ['2026-08'] }),
    op({ id: 'reg', opType: 'Programmee', account: 'courant', date: '2026-06-26', nextPayment: '2026-06-26', type: 'debit', amount: 200, label: '[carte]', exceptions: ['2026-08', '2026-09', '2026-10'] }),
    // août : loyer réel (remplace l'échéance), règlement réel 500, achats par carte 450
    op({ id: 'a1', account: 'courant', date: '2026-08-28', type: 'debit', amount: 310, label: 'loyer' }),
    op({ id: 'a2', account: 'courant', opType: 'Virement', date: '2026-08-26', type: 'debit', amount: 500, label: '[carte]' }),
    op({ id: 'a3', account: 'carte', opType: 'Virement', date: '2026-08-26', type: 'credit', amount: 500, label: '[courant]' }),
    op({ id: 'a4', account: 'carte', date: '2026-08-12', type: 'debit', amount: 450, label: 'courses' }),
    // septembre : salaire réel 1100 (remplace l'échéance), règlement 600, achats 550, retrait d'épargne de 300
    op({ id: 's1', account: 'courant', date: '2026-09-25', type: 'credit', amount: 1100, label: 'salaire' }),
    op({ id: 's2', account: 'courant', opType: 'Virement', date: '2026-09-26', type: 'debit', amount: 600, label: '[carte]' }),
    op({ id: 's3', account: 'carte', opType: 'Virement', date: '2026-09-26', type: 'credit', amount: 600, label: '[courant]' }),
    op({ id: 's4', account: 'carte', date: '2026-09-10', type: 'debit', amount: 550, label: 'courses' }),
    op({ id: 's5', account: 'epargne', opType: 'Virement', date: '2026-09-15', type: 'debit', amount: 300, label: '[courant]' }),
    op({ id: 's6', account: 'courant', opType: 'Virement', date: '2026-09-15', type: 'credit', amount: 300, label: '[epargne]' }),
    // octobre : règlement 400, achats 350
    op({ id: 'o1', account: 'courant', opType: 'Virement', date: '2026-10-26', type: 'debit', amount: 400, label: '[carte]' }),
    op({ id: 'o2', account: 'carte', opType: 'Virement', date: '2026-10-26', type: 'credit', amount: 400, label: '[courant]' }),
    op({ id: 'o3', account: 'carte', date: '2026-10-10', type: 'debit', amount: 350, label: 'courses' }),
  ],
});

test('flux constatés : opérations saisies + échéances non remplacées, moyenne des mois complets précédents', () => {
  const A = loadAt(gapData(), '2026-11-23T10:00:00');
  const all = A.getScopeNames('');
  assert.deepEqual(A.calcRecentAverageFlows(all, 3), { income: 1033, expense: 753 });
  assert.deepEqual(A.calcRecentAverageFlows(['courant'], 3), { income: 1133, expense: 803 });             // ici le retrait d'épargne apparaît (il a bien eu lieu)
  // août, compte courant : l'échéance du salaire (1000) est comptée ; le loyer et le règlement de la carte, remplacés par des opérations réelles, une seule fois
  assert.deepEqual(A.calcProjectedFlow(['courant'], 2026, 7, 0), { income: 1000, expense: 310 + 500 });
});

test('projection : le solde varie chaque mois exactement des entrées moins les sorties, le total est la somme des comptes', () => {
  const A = loadAt(gapData(), '2026-11-23T10:00:00');
  for (const [scope, cut] of [['', 0], ['__total', 0], ['courant', 0], ['', 25]]) {
    const s = A.calcProjectionSeries(scope, 4, cut);
    for (let i = 1; i < s.totals.length; i++) assert.equal(s.totals[i] - s.totals[i - 1], s.flows[i].income - s.flows[i].expense, `${scope || 'tous'} / jour ${cut} / mois ${i}`);
    assert.deepEqual(s.totals, s.totals.map((_, i) => s.names.reduce((sum, n) => sum + s.perAccount[n][i], 0)));
    assert.ok(!('adjust' in s) && !s.opLines.some(l => l.op.estimated), 'aucune dépense estimée dans la projection');
  }
});

// ── Inspirations des applications de gestion de comptes : tendance, suggestions de saisie, annulation ──

test('tendance du solde sur 30 jours : un point tous les N jours, le dernier à la date de fin', () => {
  const d = { accounts: [{ name: 'c', initialBalance: 100 }], operations: [
    op({ id: 'r1', account: 'c', date: '2026-11-10', type: 'credit', amount: 50, label: 'prime' }),
    op({ id: 'r2', account: 'c', date: '2026-11-20', type: 'debit', amount: 30, label: 'courses' }),
    op({ id: 's1', opType: 'Programmee', account: 'c', date: '2026-10-15', nextPayment: '2026-10-15', type: 'debit', amount: 10, label: 'abonnement' }),
  ] };
  const A = loadAt(d, '2026-11-23T10:00:00');
  const tr = A.calcTrendSeries('', '2026-11-23', 30, 10);
  assert.deepEqual(tr.points, [
    { date: '2026-10-24', balance: 90 },     // l'échéance du 15/10 est passée
    { date: '2026-11-03', balance: 90 },
    { date: '2026-11-13', balance: 140 },    // prime reçue ; l'échéance du 15/11 n'est pas encore arrivée
    { date: '2026-11-23', balance: 100 },    // courses −30 et échéance du 15/11 −10
  ]);
  assert.deepEqual([tr.first, tr.last, tr.delta], [90, 100, 10]);
  const odd = A.calcTrendSeries('', '2026-11-23', 30, 7);                  // 7 ne divise pas 30 : le dernier point reste la date de fin
  assert.equal(odd.points.length, 6);
  assert.equal(odd.points[odd.points.length - 1].date, '2026-11-23');
  assert.equal(A.calcScopeBalanceAsOf('', '2026-11-23'), 100);
});

test('suggestions de saisie : fréquence pondérée par la récence, même sens, montant seulement s\'il se répète', () => {
  const lab = (id, label, date, amount, extra = {}) => op({ id, account: 'courant', label, date, amount, type: 'debit', category: 'Alimentation', ...extra });
  const d = { accounts: [{ name: 'courant' }], operations: [
    lab('c1', 'Carrefour', '2026-11-20', 12000), lab('c2', 'carrefour', '2026-11-10', 8000), lab('c3', ' Carrefour ', '2026-10-01', 9500),
    lab('l1', 'Loyer', '2026-11-01', 50000, { category: 'Logement' }), lab('l2', 'Loyer', '2026-10-01', 50000, { category: 'Logement' }), lab('l3', 'Loyer', '2026-09-01', 50000, { category: 'Logement' }),
    lab('b1', 'Boulangerie', '2026-11-22', 300),
    ...['2025-01-01', '2025-01-02', '2025-01-03', '2025-01-04', '2025-01-05'].map((x, i) => lab('v' + i, 'Vieux commerce', x, 500)),
    lab('t1', '[epargne]', '2026-11-21', 999, { opType: 'Virement' }),                                  // virement : jamais proposé
    lab('p1', 'Programmée', '2026-11-21', 999, { opType: 'Programmee' }),                              // échéance : jamais proposée
    op({ id: 'k1', account: 'courant', label: 'Salaire', date: '2026-11-05', amount: 400000, type: 'credit', category: 'Revenus' }),
  ] };
  const A = load(d);
  const s = A.getQuickSuggestions('debit', 10, '2026-11-23');
  assert.deepEqual(s.map(x => x.label), ['Carrefour', 'Loyer', 'Boulangerie', 'Vieux commerce']);          // récents et fréquents d'abord ; le très ancien en dernier
  assert.deepEqual(s.map(x => x.amount), [null, 50000, null, 500]);                                          // montants variables : pas de montant proposé
  assert.deepEqual([s[0].count, s[0].category, s[0].account], [3, 'Alimentation', 'courant']);
  assert.equal(s[0].label, 'Carrefour');                                                                    // libellé du plus récent, sans espaces parasites
  assert.deepEqual(A.getQuickSuggestions('debit', 2, '2026-11-23').map(x => x.label), ['Carrefour', 'Loyer']);
  assert.deepEqual(A.getQuickSuggestions('credit', 10, '2026-11-23').map(x => x.label), ['Salaire']);        // les revenus ont leurs propres suggestions
  assert.deepEqual(A.getQuickSuggestions('debit', 10, '2026-11-23').map(x => x.label).filter(l => /^\[/.test(l)), []);
  // catégorie et compte habituels d'un libellé déjà utilisé (casse et espaces ignorés)
  assert.deepEqual(A.findLabelHistory('  LOYER ', 'debit'), { category: 'Logement', account: 'courant' });
  assert.equal(A.findLabelHistory('Loyer', 'credit'), null);
  assert.equal(A.findLabelHistory('Inconnu', 'debit'), null);
  assert.equal(A.findLabelHistory('', 'debit'), null);
});

test("annuler une saisie : l'opération disparaît, avec une trace de suppression pour la synchronisation", () => {
  const A = load({ accounts: [{ name: 'c' }], operations: [op({ id: 'a', account: 'c' }), op({ id: 'b', account: 'c' }), op({ id: 'c', account: 'c' })] });
  assert.equal(A.removeAddedOps(['a', 'c']), 2);                                  // un virement = deux jambes
  assert.deepEqual(A.getData().operations.map(o => o.id), ['b']);
  assert.ok(A.getData().deletedIds.a && A.getData().deletedIds.c);
  assert.equal(A.removeAddedOps(['zzz']), 0);                                     // identifiant inconnu : rien ne bouge
  assert.deepEqual(A.getData().operations.map(o => o.id), ['b']);
});

// ── Classer les opérations sans catégorie ──

test('« sans catégorie » : vide, « Autre » ou « … à catégoriser » ; une sous-catégorie nommée Autre est un vrai classement', () => {
  const { isUnclassified: u } = load({ operations: [], accounts: [] });
  for (const c of [undefined, null, '', '   ', 'Autre', 'autre', ' AUTRE ', 'Dépenses à catégoriser', 'Revenus à catégoriser', 'Depenses a categoriser']) assert.equal(u({ category: c }), true, String(c));
  for (const c of ['Alimentation', 'Alimentation/Courses', 'Revenus', 'Logement/Autre', 'Virement']) assert.equal(u({ category: c }), false, c);
  assert.equal(u({}), true);                                                          // pas de champ catégorie du tout
});

// Libellés groupés sans tenir compte de la casse ni des espaces ; « Prime » existe en revenu et en dépense (deux groupes)
const catData = () => {
  const lab = (id, label, date, amount, extra = {}) => op({ id, account: 'courant', label, date, amount, type: 'debit', category: 'Autre', ...extra });
  return { accounts: [{ name: 'courant' }], operations: [
    // Carrefour : trois opérations déjà classées « Alimentation » → suggestion sûre pour les deux qui n'ont pas de catégorie
    lab('c1', 'Carrefour', '2026-01-05', 100, { category: 'Alimentation' }), lab('c2', 'carrefour', '2026-02-05', 100, { category: 'Alimentation' }), lab('c3', 'CARREFOUR', '2026-03-05', 100, { category: 'Alimentation' }),
    lab('c4', 'Carrefour', '2026-10-05', 1200), lab('c5', ' carrefour  ', '2026-11-05', 1800, { category: '' }),
    // Total : 2 × Transport, 1 × Alimentation → 67 % : proposée, mais pas « sûre »
    lab('t1', 'Total', '2026-01-10', 50, { category: 'Transport' }), lab('t2', 'Total', '2026-02-10', 50, { category: 'Transport' }), lab('t3', 'Total', '2026-03-10', 50, { category: 'Alimentation' }),
    lab('t4', 'Total', '2026-11-10', 700, { category: 'Dépenses à catégoriser' }),
    // Marché : moitié-moitié → aucune suggestion, mais les deux catégories connues sont listées
    lab('m1', 'Marché', '2026-01-12', 10, { category: 'Alimentation' }), lab('m2', 'Marché', '2026-02-12', 10, { category: 'Loisirs' }), lab('m3', 'Marché', '2026-11-12', 400),
    // Inconnu : jamais classé ; Solo : un seul jumeau classé (proposé, mais pas assez pour une application en lot)
    lab('i1', 'Inconnu', '2026-11-15', 5000),
    lab('s1', 'Solo', '2026-02-01', 20, { category: 'Loisirs' }), lab('s2', 'Solo', '2026-11-16', 30),
    // Prime : revenu sans catégorie avec deux jumeaux « Revenus » ; la dépense du même nom est un autre groupe, sans jumeau
    lab('p1', 'Prime', '2026-01-20', 900, { type: 'credit', category: 'Revenus' }), lab('p2', 'Prime', '2026-02-20', 900, { type: 'credit', category: 'Revenus' }),
    lab('p3', 'Prime', '2026-11-20', 950, { type: 'credit', category: 'Revenus à catégoriser' }), lab('p4', 'Prime', '2026-11-21', 20),
    // jamais proposés : virement, échéance, régularisation, sans libellé, sans date, sens inconnu
    lab('x1', '[epargne]', '2026-11-01', 9999, { opType: 'Virement' }), lab('x2', 'Loyer', '2026-11-01', 9999, { opType: 'Programmee' }),
    lab('x3', 'Regul', '2026-11-01', 9999, { opType: 'Regularisation' }), lab('x4', '', '2026-11-01', 9999), lab('x5', 'Sans date', '', 9999),
    lab('x6', 'Bizarre', '2026-11-01', 9999, { type: 'autre' }),
    // Ancien commerce : sans catégorie seulement en 2025 ; Mixte : en 2025 et en 2026
    lab('a1', 'Ancien commerce', '2025-03-01', 300), lab('a2', 'Mixte', '2025-03-02', 100), lab('a3', 'Mixte', '2026-11-02', 150),
  ] };
};

test('file « à classer » : regroupée par libellé et par sens, du total le plus élevé au plus faible, sans virements ni échéances', () => {
  const A = load(catData());
  const q = A.getCategorizeQueue('', new Set());
  assert.deepEqual(q.map(g => g.key), ['debit|inconnu', 'debit|carrefour', 'credit|prime', 'debit|total', 'debit|marché', 'debit|ancien commerce', 'debit|mixte', 'debit|solo', 'debit|prime']);
  const by = Object.fromEntries(q.map(g => [g.key, g]));
  const c = by['debit|carrefour'];
  assert.deepEqual([c.count, c.total, c.lastDate, c.label, c.type], [2, 3000, '2026-11-05', 'carrefour', 'debit']);   // libellé de la plus récente, sans espaces parasites
  assert.deepEqual(c.ids, ['c4', 'c5']);                                                                              // seules les opérations sans catégorie
  assert.deepEqual(c.suggestion, { category: 'Alimentation', count: 3, share: 1, confident: true });
  const t = by['debit|total'].suggestion;
  assert.equal(t.category, 'Transport');
  assert.equal(t.count, 3);
  assert.equal(t.confident, false);                                                                                   // 67 % : proposée sans être « sûre »
  assert.ok(Math.abs(t.share - 2 / 3) < 1e-9);
  assert.deepEqual(by['debit|solo'].suggestion, { category: 'Loisirs', count: 1, share: 1, confident: false });       // un seul jumeau : proposée, jamais « sûre »
  assert.equal(by['debit|marché'].suggestion, null);                                                                  // 50 % : trop incertain
  assert.deepEqual(by['debit|marché'].seen, [{ category: 'Alimentation', count: 1 }, { category: 'Loisirs', count: 1 }]);
  assert.equal(by['debit|inconnu'].suggestion, null);
  assert.deepEqual(by['debit|inconnu'].seen, []);
  assert.equal(by['credit|prime'].suggestion.category, 'Revenus');                                                    // les revenus et les dépenses ne se mélangent pas
  assert.equal(by['credit|prime'].suggestion.confident, true);
  assert.equal(by['debit|prime'].suggestion, null);
  assert.ok(!q.some(g => g.ids.some(id => /^x/.test(id))), 'virement, échéance, régularisation, sans libellé, sans date, sens inconnu : jamais proposés');
});

test('file « à classer » : période et libellés ignorés', () => {
  const A = load(catData());
  const since = A.getCategorizeQueue('2026-01-01', new Set());
  assert.ok(!since.some(g => g.key === 'debit|ancien commerce'));                                                     // rien de récent : hors période
  const mixte = since.find(g => g.key === 'debit|mixte');
  assert.deepEqual([mixte.count, mixte.total, mixte.ids], [2, 250, ['a2', 'a3']]);                                    // le libellé reste complet, même pour les dates plus anciennes
  assert.equal(A.getCategorizeQueue('', new Set()).length, since.length + 1);
  assert.equal(A.getCategorizeQueue('2030-01-01', new Set()).length, 0);
  const skipped = ['debit|inconnu', 'credit|prime'];
  assert.deepEqual(A.getCategorizeQueue('', new Set(skipped)).map(g => g.key).filter(k => skipped.includes(k)), []);
  assert.equal(A.getCategorizeQueue('', skipped).length, A.getCategorizeQueue('', new Set()).length - 2);            // une liste est acceptée comme un ensemble
  assert.equal(A.getCategorizeQueue('').length, A.getCategorizeQueue('', new Set()).length);                         // et l'absence de liste aussi
});

test('classer : seule la catégorie change, et « Annuler » rétablit exactement les anciennes valeurs', () => {
  const d = { accounts: [{ name: 'c' }], operations: [
    op({ id: 'a', account: 'c', category: 'Autre', amount: 10 }), op({ id: 'b', account: 'c', category: '', amount: 20 }),
    { id: 'u', account: 'c', date: '2026-01-01', type: 'debit', amount: 30, label: 'sans champ' },                // aucun champ catégorie
    op({ id: 'k', account: 'c', category: 'Transport', amount: 40 }), op({ id: 'z', account: 'c', category: 'Autre', amount: 50 }),
  ] };
  const A = load(d);
  const before = JSON.stringify(A.getData().operations);
  const undo = A.applyCategoryToOps(['a', 'b', 'u', 'k', 'zzz'], 'Transport');
  assert.deepEqual(undo, [{ id: 'a', category: 'Autre' }, { id: 'b', category: '' }, { id: 'u', category: null }]);   // « k » l'avait déjà, « zzz » n'existe pas
  const ops = Object.fromEntries(A.getData().operations.map(o => [o.id, o]));
  assert.deepEqual(['a', 'b', 'u', 'k', 'z'].map(id => ops[id].category), ['Transport', 'Transport', 'Transport', 'Transport', 'Autre']);
  assert.deepEqual(['a', 'b', 'u', 'k', 'z'].map(id => ops[id].amount), [10, 20, 30, 40, 50]);                        // les montants ne bougent jamais
  assert.equal(A.restoreCategories(undo), 3);
  assert.equal(JSON.stringify(A.getData().operations), before);                                                       // retour exact, y compris l'absence de champ
  assert.equal(A.restoreCategories([{ id: 'inconnu', category: 'x' }]), 0);
  assert.deepEqual(A.applyCategoryToOps([], 'Transport'), []);
});

test('classer le groupe d\'un libellé : il sort de la file, les analyses suivent, et l\'annulation le remet', () => {
  const A = load(catData());
  const before = A.getCategorizeQueue('', new Set()).length;
  const g = A.getCategorizeQueue('', new Set()).find(x => x.key === 'debit|carrefour');
  const undo = A.applyCategoryToOps(g.ids, g.suggestion.category);
  assert.equal(undo.length, 2);
  const after = A.getCategorizeQueue('', new Set());
  assert.equal(after.length, before - 1);
  assert.ok(!after.some(x => x.key === 'debit|carrefour'));
  assert.equal(A.calcFlowSummary('', '2026-11-01', '2026-11-30').byCategory.Alimentation, 1800);                     // la dépense de novembre quitte « Autre »
  A.restoreCategories(undo);
  assert.equal(A.getCategorizeQueue('', new Set()).length, before);
  assert.equal(A.calcFlowSummary('', '2026-11-01', '2026-11-30').byCategory.Alimentation, undefined);
});

test('catégories proposées : celles déjà utilisées (les plus fréquentes d\'abord), puis les catégories de base du bon sens', () => {
  const d = { accounts: [{ name: 'c' }], subcategories: { Alimentation: ['Courses'], Transport: ['Essence'] }, operations: [
    op({ id: '1', account: 'c', type: 'debit', category: 'Loisirs' }),
    op({ id: '2', account: 'c', type: 'debit', category: 'Alimentation/Courses' }), op({ id: '3', account: 'c', type: 'debit', category: 'Alimentation/Courses' }),
    op({ id: '4', account: 'c', type: 'debit', category: 'Autre' }),                                                  // sans catégorie : ne compte pas
    op({ id: '5', account: 'c', type: 'credit', category: 'Remboursement' }),
    op({ id: '6', account: 'c', type: 'debit', opType: 'Programmee', category: 'Telecom' }),                           // échéance : ne compte pas
    op({ id: '7', account: 'c', type: 'debit', opType: 'Virement', label: '[x]', category: 'Virement' }),             // virement : ne compte pas
  ] };
  const A = load(d);
  const deb = A.getCategoryChoices('debit');
  assert.deepEqual(deb, ['Alimentation/Courses', 'Loisirs', 'Alimentation', 'Transport', 'Transport/Essence', 'Sante', 'Logement', 'Telecom']);
  assert.ok(!deb.includes('Autre') && !deb.includes('Virement') && !deb.includes('Revenus'));                         // jamais « Autre » ; « Revenus » est réservée aux revenus
  assert.deepEqual(A.getCategoryChoices('credit').slice(0, 3), ['Remboursement', 'Revenus', 'Transport']);           // déjà utilisée d'abord, puis « Revenus » en tête des catégories de base (« Alimentation » ne sert qu'aux dépenses)
  assert.equal(new Set(A.getCategoryChoices('credit')).size, A.getCategoryChoices('credit').length);                   // aucun doublon
});

// ── Gérer les catégories : créer, renommer (ou fusionner), supprimer ──

const mgrOp = (id, category, extra = {}) => op({ id, account: 'courant', label: 'libellé ' + id, date: '2026-05-04', amount: 100, type: 'debit', category, ...extra });
const mgrData = () => ({
  accounts: [{ name: 'courant' }],
  subcategories: { Transport: ['carburant', 'entretien'] },
  budgets: { Alimentation: 60000, Transport: 40000, Loisirs: 5000 },
  operations: [
    mgrOp('a1', 'Alimentation'), mgrOp('a2', 'Frais alimentaires'), mgrOp('a3', 'Frais alimentaires'),                // une ancienne catégorie (venue d'un import)
    mgrOp('t1', 'Transport/carburant'), mgrOp('t2', 'Transport/carburant'), mgrOp('t3', 'Transport/Péage'), mgrOp('t4', 'Transport'),
    mgrOp('l1', 'Loisirs'), mgrOp('p1', 'Loisirs', { opType: 'Programmee' }),                                           // une échéance compte aussi
    mgrOp('r1', 'Revenus', { type: 'credit' }),
    mgrOp('v1', 'Virement', { opType: 'Virement', label: '[epargne]' }),                                               // réservée : jamais dans le catalogue
    mgrOp('u1', 'Dépenses à catégoriser'), mgrOp('u2', 'Autre'), mgrOp('u3', ''),                                       // sans catégorie : idem
  ],
});
const stripCat = (ops) => ops.map(({ category, ...rest }) => rest);                                                   // tout sauf la catégorie
const catOf = (A, id) => A.getData().operations.find(o => o.id === id).category;

test('catalogue : liste de base, catégories encore utilisées en plus, sous-catégories de la liste puis des opérations', () => {
  const A = load(mgrData());
  const cat = A.getCategoryCatalog();
  assert.deepEqual(cat.map(c => c.name), ['Alimentation', 'Transport', 'Sante', 'Loisirs', 'Logement', 'Telecom', 'Revenus', 'Frais alimentaires']);
  assert.deepEqual(cat.map(c => c.count), [1, 4, 0, 2, 0, 0, 1, 2]);
  assert.deepEqual(cat.map(c => c.listed), [true, true, true, true, true, true, true, false]);
  assert.deepEqual(cat[1].subs, [{ name: 'carburant', count: 2 }, { name: 'entretien', count: 0 }, { name: 'Péage', count: 1 }]);
  assert.ok(!cat.some(c => ['Autre', 'Virement', 'Dépenses à catégoriser', ''].includes(c.name)));
  // liste de l'utilisateur : son ordre, sans doublon ni nom réservé ; les autres catégories utilisées suivent, les plus fréquentes d'abord
  const d = mgrData();
  d.categories = ['Zèbre', 'Alimentation', 'Autre', 'Alimentation', 'Virement'];
  assert.deepEqual(load(d).getCategoryCatalog().map(c => c.name), ['Zèbre', 'Alimentation', 'Transport', 'Frais alimentaires', 'Loisirs', 'Revenus']);
  assert.deepEqual(load({ accounts: [], operations: [] }).getCategoryCatalog().map(c => c.name), ['Alimentation', 'Transport', 'Sante', 'Loisirs', 'Logement', 'Telecom', 'Revenus']);
});

test('noms de catégories : nettoyés, sans « / », sans nom réservé ; comparaison sans casse ni espaces', () => {
  const A = load(mgrData());
  assert.deepEqual(A.checkCategoryName('  Café   du  matin '), { name: 'Café du matin' });
  for (const bad of ['', '   ', 'a/b', 'x'.repeat(41), 'Autre', ' autre ', 'VIREMENT', 'Transfert', 'À catégoriser', 'Dépenses à categoriser', '__proto__']) assert.ok(A.checkCategoryName(bad).error, JSON.stringify(bad));
  assert.deepEqual(A.checkCategoryName('Autre', true), { name: 'Autre' });                                            // une sous-catégorie peut s'appeler « Autre »
  assert.ok(A.checkCategoryName('À catégoriser', true).error);
  assert.equal(A.catKey('  Frais   ALIMENTAIRES '), 'frais alimentaires');
  assert.deepEqual(A.splitCategory('Transport/carburant'), { main: 'Transport', sub: 'carburant' });
  assert.deepEqual(A.splitCategory('Transport'), { main: 'Transport', sub: '' });
  assert.deepEqual(A.splitCategory(undefined), { main: '', sub: '' });
  assert.equal(A.joinCategory('Transport', 'x'), 'Transport/x');
  assert.equal(A.joinCategory('Transport', ''), 'Transport');
});

test('créer une catégorie ou une sous-catégorie : doublons refusés (casse ignorée), annulation exacte', () => {
  const A = load(mgrData());
  const before = JSON.stringify(A.getData());
  const r = A.addMainCategory('  Animaux ', '🐶');
  assert.deepEqual([r.name, r.ops], ['Animaux', 0]);
  assert.equal(A.getCategoryCatalog().at(-1).name, 'Animaux');                                                         // à la suite des autres
  assert.equal(A.catIcon('Animaux'), '🐶');
  for (const dup of ['animaux', ' ANIMAUX', 'Frais Alimentaires', 'Autre', 'a/b', '']) assert.ok(A.addMainCategory(dup).error, dup);
  const s = A.addSubCategory('Animaux', 'Vétérinaire');
  assert.deepEqual(A.getCategoryCatalog().find(c => c.name === 'Animaux').subs, [{ name: 'Vétérinaire', count: 0 }]);
  assert.ok(A.addSubCategory('Animaux', 'vétérinaire').error);
  assert.ok(A.addSubCategory('Inconnue', 'x').error);
  assert.ok(A.addSubCategory('Animaux', 'a/b').error);
  A.undoCategoryChange(s.undo);
  assert.deepEqual(A.getCategoryCatalog().find(c => c.name === 'Animaux').subs, []);
  A.undoCategoryChange(r.undo);
  assert.equal(JSON.stringify(A.getData()), before);                                                                   // retour exact
});

test('renommer une catégorie : opérations, sous-catégories, budget, pictogramme et couleur suivent ; rien d\'autre ne change', () => {
  const A = load(mgrData());
  const before = JSON.stringify(A.getData());
  const ops0 = stripCat(A.getData().operations);
  const r = A.renameMainCategory('Transport', '  Déplacements ');
  assert.deepEqual([r.name, r.merged, r.ops], ['Déplacements', false, 4]);
  assert.deepEqual(['t1', 't2', 't3', 't4'].map(id => catOf(A, id)), ['Déplacements/carburant', 'Déplacements/carburant', 'Déplacements/Péage', 'Déplacements']);
  const d = A.getData();
  assert.equal(d.categories.indexOf('Déplacements'), 1);                                                               // même place dans la liste
  assert.ok(!d.categories.includes('Transport'));
  assert.deepEqual(d.subcategories['Déplacements'], ['carburant', 'entretien', 'Péage']);
  assert.equal(d.subcategories['Transport'], undefined);
  assert.deepEqual([d.budgets['Déplacements'], d.budgets['Transport'], d.budgets['Alimentation']], [40000, undefined, 60000]);
  assert.equal(A.catIcon('Déplacements'), '🚗');                                                                       // l'aspect de « Transport » suit
  assert.equal(A.catColor('Déplacements'), '#1565c0');
  assert.deepEqual(stripCat(d.operations), ops0);                                                                      // montants, dates, libellés, comptes : intacts
  assert.equal(catOf(A, 'v1'), 'Virement');                                                                            // les virements ne bougent pas
  A.undoCategoryChange(r.undo);
  assert.equal(JSON.stringify(A.getData()), before);
  // casse seule (même catégorie), pictogramme seul, rien à changer, nom refusé
  const c = A.renameMainCategory('Sante', 'Santé');
  assert.deepEqual([c.name, c.merged, c.ops], ['Santé', false, 0]);
  assert.deepEqual(A.renameMainCategory('Alimentation', 'Alimentation', '🍎').ops, 0);
  assert.equal(A.catIcon('Alimentation'), '🍎');
  assert.equal(A.renameMainCategory('Alimentation', 'Alimentation', '').name, 'Alimentation');
  assert.equal(A.catIcon('Alimentation'), '🛒');                                                                       // pictogramme effacé : retour à celui de base
  assert.equal(A.renameMainCategory('Alimentation', 'Alimentation').error, 'Aucun changement.');
  const snap = JSON.stringify(A.getData());
  for (const [from, to] of [['Alimentation', 'a/b'], ['Alimentation', 'Autre'], ['Alimentation', ''], ['Inconnue', 'Nouvelle']]) assert.ok(A.renameMainCategory(from, to).error, from + ' → ' + to);
  assert.equal(JSON.stringify(A.getData()), snap);                                                                     // un refus ne modifie rien
});

test('renommer vers un nom qui existe : fusion (opérations, sous-catégories, budget de la catégorie d\'arrivée gardé)', () => {
  const A = load(mgrData());
  A.getData().budgets['Frais alimentaires'] = 1000;
  const snap = JSON.stringify(A.getData());
  const r = A.renameMainCategory('Frais alimentaires', 'alimentation');                                                // même nom que « Alimentation », à la casse près
  assert.deepEqual([r.name, r.merged, r.ops], ['Alimentation', true, 2]);
  assert.deepEqual(['a1', 'a2', 'a3'].map(id => catOf(A, id)), ['Alimentation', 'Alimentation', 'Alimentation']);
  assert.ok(!A.getCategoryCatalog().some(c => c.name === 'Frais alimentaires'));
  assert.deepEqual([A.getData().budgets['Alimentation'], A.getData().budgets['Frais alimentaires']], [60000, undefined]);
  A.undoCategoryChange(r.undo);
  assert.equal(JSON.stringify(A.getData()), snap);
  // « Transport » (avec ses sous-catégories) fusionné dans « Loisirs » (qui a un budget) ; « Sante » reprend le budget de « Loisirs »
  const m = A.renameMainCategory('Transport', 'Loisirs');
  assert.deepEqual([m.merged, m.ops], [true, 4]);
  assert.deepEqual(['t1', 't3', 't4', 'l1'].map(id => catOf(A, id)), ['Loisirs/carburant', 'Loisirs/Péage', 'Loisirs', 'Loisirs']);
  assert.deepEqual(A.getData().subcategories['Loisirs'], ['carburant', 'entretien', 'Péage']);
  assert.equal(A.getData().budgets['Loisirs'], 5000);
  const s = A.renameMainCategory('Loisirs', 'Sante');
  assert.equal(A.getData().budgets['Sante'], 5000);                                                                    // la catégorie d'arrivée n'avait pas de budget
  assert.equal(s.merged, true);
});

test('renommer une sous-catégorie : opérations suivent ; un nom existant la fusionne', () => {
  const A = load(mgrData());
  const before = JSON.stringify(A.getData());
  const r = A.renameSubCategory('Transport', 'carburant', 'Essence');
  assert.deepEqual([r.name, r.merged, r.ops], ['Essence', false, 2]);
  assert.deepEqual(['t1', 't2'].map(id => catOf(A, id)), ['Transport/Essence', 'Transport/Essence']);
  assert.deepEqual(A.getData().subcategories['Transport'], ['Essence', 'entretien', 'Péage']);                           // même place
  const m = A.renameSubCategory('Transport', 'Péage', 'ESSENCE');
  assert.deepEqual([m.name, m.merged, m.ops], ['Essence', true, 1]);
  assert.equal(catOf(A, 't3'), 'Transport/Essence');
  assert.deepEqual(A.getData().subcategories['Transport'], ['Essence', 'entretien']);
  A.undoCategoryChange(m.undo);
  A.undoCategoryChange(r.undo);
  assert.equal(JSON.stringify(A.getData()), before);
  for (const bad of [['Transport', 'carburant', 'carburant'], ['Transport', 'inconnue', 'x'], ['Inconnue', 'x', 'y'], ['Transport', 'carburant', 'a/b'], ['Transport', 'carburant', '']]) assert.ok(A.renameSubCategory(...bad).error, bad.join(' | '));
  assert.equal(JSON.stringify(A.getData()), before);
});

test('supprimer une catégorie : aucune opération perdue, elles vont où on le choisit ; annulation exacte', () => {
  const A = load(mgrData());
  const before = JSON.stringify(A.getData());
  const ops0 = stripCat(A.getData().operations);
  const r = A.deleteMainCategory('Frais alimentaires');                                                                 // par défaut : « Autre » (à reclasser)
  assert.deepEqual([r.name, r.dest, r.ops], ['Frais alimentaires', 'Autre', 2]);
  assert.deepEqual(['a2', 'a3'].map(id => catOf(A, id)), ['Autre', 'Autre']);
  assert.ok(!A.getCategoryCatalog().some(c => c.name === 'Frais alimentaires'));
  assert.ok(A.getCategorizeQueue('', new Set()).some(g => g.ids.includes('a2')));                                      // elles réapparaissent dans « À classer »
  A.undoCategoryChange(r.undo);
  assert.equal(JSON.stringify(A.getData()), before);
  const t = A.deleteMainCategory('Transport', 'Alimentation');                                                         // vers une autre catégorie (la sous-catégorie disparaît)
  assert.deepEqual([t.ops, ['t1', 't3', 't4'].map(id => catOf(A, id))], [4, ['Alimentation', 'Alimentation', 'Alimentation']]);
  const d = A.getData();
  assert.deepEqual([d.subcategories['Transport'], d.budgets['Transport'], d.categories.includes('Transport')], [undefined, undefined, false]);
  assert.equal(d.budgets['Alimentation'], 60000);
  const u = A.deleteMainCategory('Sante');                                                                             // sans opération : rien à déplacer
  assert.deepEqual([u.ops, A.getCategoryCatalog().some(c => c.name === 'Sante')], [0, false]);
  assert.deepEqual(stripCat(d.operations), ops0);
  const snap = JSON.stringify(d);
  for (const [name, dest] of [['Alimentation', 'Alimentation/x'], ['Alimentation', 'Virement'], ['Alimentation', 'Inconnue'], ['Inconnue', 'Autre'], ['Alimentation', 'Alimentation']]) assert.ok(A.deleteMainCategory(name, dest).error, name + ' → ' + dest);
  assert.equal(JSON.stringify(A.getData()), snap);
});

test('supprimer une sous-catégorie : ses opérations remontent dans la catégorie principale (ou vont ailleurs)', () => {
  const A = load(mgrData());
  const before = JSON.stringify(A.getData());
  const r = A.deleteSubCategory('Transport', 'carburant');
  assert.deepEqual([r.ops, r.dest, ['t1', 't2'].map(id => catOf(A, id))], [2, 'Transport', ['Transport', 'Transport']]);
  assert.deepEqual(A.getData().subcategories['Transport'], ['entretien', 'Péage']);
  const p = A.deleteSubCategory('Transport', 'Péage', 'Loisirs');
  assert.deepEqual([p.ops, catOf(A, 't3')], [1, 'Loisirs']);
  A.deleteSubCategory('Transport', 'entretien');
  assert.equal(A.getData().subcategories['Transport'], undefined);                                                     // plus aucune sous-catégorie : la clé disparaît
  A.undoCategoryChange(p.undo);                                                                                        // annuler dans l'ordre inverse
  assert.equal(catOf(A, 't3'), 'Transport/Péage');
  for (const bad of [['Transport', 'inconnue'], ['Inconnue', 'x'], ['Transport', 'Péage', 'Transport/Péage'], ['Transport', 'Péage', 'Inconnue']]) assert.ok(A.deleteSubCategory(...bad).error, bad.join(' | '));
  const B = load(mgrData());
  const q = B.deleteSubCategory('Transport', 'carburant', 'Autre');
  B.undoCategoryChange(q.undo);
  assert.equal(JSON.stringify(B.getData()), before);
});

test('listes de choix : toute catégorie utilisée y figure (une opération ne perd jamais la sienne), noms échappés, modifications suivies', () => {
  const d = mgrData();
  d.operations.push(mgrOp('x1', 'R&D "x"'), mgrOp('x2', 'Transport/a<b>'));
  const A = load(d);
  const html = A.getAllCategoryOptions();
  for (const o of A.getData().operations) {
    if (!o.category || A.isReservedCategory(A.splitCategory(o.category).main) || /catégoris/.test(o.category)) continue;
    assert.ok(html.includes(`value="${A.esc(o.category)}"`), 'option manquante : ' + o.category);
  }
  assert.ok(html.includes('value="R&amp;D &quot;x&quot;"') && !html.includes('<b>'));
  assert.ok(html.endsWith('<option value="Autre">📦 Autre</option><option value="Virement">Virement</option>'));
  // les choix de classement suivent la liste : renommée, créée, supprimée
  const B = load(mgrData());
  B.renameMainCategory('Alimentation', 'Courses');
  B.addMainCategory('Animaux');
  B.deleteMainCategory('Telecom');
  const ch = B.getCategoryChoices('debit');
  assert.ok(ch.includes('Courses') && ch.includes('Animaux') && !ch.includes('Alimentation') && !ch.includes('Telecom'));
});

test('choix de classement : une catégorie qui ne sert qu\'à l\'autre sens (revenu / dépense) n\'est pas proposée en base', () => {
  const d = mgrData();
  d.operations.push(mgrOp('c1', 'Salaires', { type: 'credit' }), mgrOp('c2', 'Salaires', { type: 'credit' }));
  const A = load(d);
  A.addMainCategory('Prime');                                                       // fige la liste : les catégories des opérations y entrent toutes
  const debit = A.getCategoryChoices('debit'), credit = A.getCategoryChoices('credit');
  assert.ok(!debit.includes('Salaires') && debit.includes('Frais alimentaires') && debit.includes('Prime') && debit.includes('Sante'));
  assert.equal(credit[0], 'Salaires');                                              // utilisée par des revenus : en tête
  assert.ok(credit.includes('Prime') && credit.includes('Revenus') && !credit.includes('Frais alimentaires'));
});

test('pictogrammes et couleurs : choix de l\'utilisateur, sinon base, sinon déduits du nom ; sous-catégorie = celle de la catégorie', () => {
  const A = load(mgrData());
  assert.equal(A.catIcon('Alimentation'), '🛒');
  assert.equal(A.catIcon('Transport/carburant'), '🚗');
  assert.equal(A.catIcon('Frais alimentaires'), '🛒');                                                                 // déduit du nom
  assert.equal(A.catIcon('Zorglub'), '📦');
  A.getData().catIcons = { Zorglub: '🦄' };
  assert.equal(A.catIcon('Zorglub'), '🦄');
  assert.equal(A.catColor('Alimentation'), '#ef6c00');
  assert.equal(A.catColor('Zorglub'), A.catColor('Zorglub/x'));
  assert.ok(A.catColor('Zorglub').startsWith('#'));
  A.getData().catColors = { Zorglub: '#123456' };
  assert.equal(A.catColor('Zorglub'), '#123456');
  assert.equal(A.guessCatIcon('Électricité Gaz'), '🏠');
  assert.equal(A.guessCatIcon('Truc'), '');
});

// ── Infobulle des graphiques : quelle colonne, et où poser la bulle ──

test('infobulle d\'un graphique : colonne la plus proche du pointeur (12 colonnes de 30 unités, la 1re centrée en 100)', () => {
  const { chartIndexAt: at } = load({ operations: [], accounts: [] });
  assert.deepEqual([100, 114, 116, 130, 430, 445, 1000, -50].map(x => at(x, 100, 30, 12)), [0, 0, 1, 1, 11, 11, 11, 0]);   // à mi-chemin : la suivante ; hors graphique : la plus proche
  assert.equal(at(100, 100, 30, 1), 0);                                                                                   // une seule colonne
  for (const bad of [[NaN, 100, 30, 12], [100, 100, 0, 12], [100, 100, -5, 12], [100, 100, 30, 0], [Infinity, 100, 30, 12]]) assert.equal(at(...bad), -1, String(bad));
});

test('infobulle d\'un graphique : bulle centrée au-dessus du point, dessous si pas de place, toujours dans l\'écran', () => {
  const { chartTipPosition: pos } = load({ operations: [], accounts: [] });
  assert.deepEqual(pos(200, 300, 100, 40, 400, 800), { left: 150, top: 246 });          // centrée, 14 au-dessus du point
  assert.deepEqual(pos(10, 300, 100, 40, 400, 800), { left: 8, top: 246 });             // trop à gauche : marge de 8
  assert.deepEqual(pos(395, 300, 100, 40, 400, 800), { left: 292, top: 246 });          // trop à droite : collée à la marge droite
  assert.deepEqual(pos(200, 30, 100, 40, 400, 800), { left: 150, top: 44 });            // pas de place au-dessus : en dessous
  assert.deepEqual(pos(200, 5, 100, 40, 400, 60), { left: 150, top: 12 });              // ni au-dessus ni en dessous : la plus proche position visible
  assert.deepEqual(pos(200, 300, 500, 40, 400, 800), { left: 8, top: 246 });            // bulle plus large que l'écran : calée à gauche
});

// ── Évolution du solde : le jour du mois où chaque point est lu ──

test('jour du point de solde : 1 à 30, sinon fin de mois ; date réellement lue et libellé du point', () => {
  const { normalizePointDay: nd, pointDateOf: pd, pointTitle: pt } = load({ operations: [], accounts: [] });
  assert.deepEqual(['', '0', '1', ' 15 ', '30', '31', '45', '-3', 'abc', null, undefined, 12.7].map(nd), [0, 0, 1, 15, 30, 0, 0, 0, 0, 0, 0, 12]);
  assert.equal(pd(2026, 10, 0), '2026-11-30');                                              // fin de novembre
  assert.equal(pd(2026, 10, 15), '2026-11-15');
  assert.equal(pd(2026, 4, 30), '2026-05-30');                                              // le 30 mai : mai a 31 jours, ce n'est pas la fin du mois
  assert.equal(pd(2026, 1, 30), '2026-02-28');                                              // février n'a pas de 30 : fin de mois
  assert.equal(pd(2028, 1, 30), '2028-02-29');                                              // année bissextile
  assert.equal(pd(2026, 11, 0), '2026-12-31');
  const t = (y, m, d) => norm(pt(y, m, d, '2026-11-24'));                                   // « aujourd'hui » : le 24 novembre 2026
  assert.equal(t(2026, 9, 0), 'Fin octobre 2026');
  assert.equal(t(2026, 10, 0), 'Fin novembre 2026 · prévu');                                // fin du mois en cours : pas encore arrivée
  assert.equal(t(2026, 10, 15), 'Au 15 novembre 2026');
  assert.equal(t(2026, 10, 24), 'Au 24 novembre 2026');                                     // aujourd'hui : pas « prévu »
  assert.equal(t(2026, 10, 28), 'Au 28 novembre 2026 · prévu');
  assert.equal(t(2026, 11, 1), 'Au 1er décembre 2026 · prévu');
  assert.equal(t(2026, 1, 30), 'Fin février 2026');                                         // jour absent du mois : c'est la fin de mois
});

// Compte « c » : échéance de 20 le 10 de chaque mois depuis septembre, entrée de 5 le 31 de chaque mois depuis août (le 30 dans les mois courts) ;
// compte « e » (hors solde total) : une entrée de 70 le 10 octobre
const dayData = () => ({
  accounts: [{ name: 'c', initialBalance: 1000 }, { name: 'e', initialBalance: 500, includeInTotal: false }],
  operations: [
    op({ id: 'r1', account: 'c', date: '2026-10-05', type: 'credit', amount: 300, label: 'a' }),
    op({ id: 'r2', account: 'c', date: '2026-10-20', type: 'debit', amount: 100, label: 'b' }),
    op({ id: 'r3', account: 'c', date: '2026-11-03', type: 'debit', amount: 50, label: 'c' }),
    op({ id: 'r4', account: 'e', date: '2026-10-10', type: 'credit', amount: 70, label: 'd' }),
    op({ id: 's1', opType: 'Programmee', account: 'c', date: '2026-09-10', nextPayment: '2026-09-10', type: 'debit', amount: 20, label: 'abo' }),
    op({ id: 's2', opType: 'Programmee', account: 'c', date: '2026-08-31', nextPayment: '2026-08-31', type: 'credit', amount: 5, label: 'prime' }),
  ],
});

test('solde lu un jour précis : opérations réelles et échéances jusqu\'à ce jour, fin de mois = dernier jour, périmètres', () => {
  const A = loadAt(dayData(), '2026-11-24T10:00:00');
  const at = (scope, y, m, d) => (d ? A.calcScopeBalanceAsOf(scope, A.pointDateOf(y, m, d)) : A.calcScopeBalanceEndOfMonth(scope, y, m));
  assert.equal(at('c', 2026, 9, 15), 1270);          // 1000 + 300 (5 oct.) ; échéances : +5 (août) −20 +5 (sept.) −20 (10 oct.) = −30
  assert.equal(at('c', 2026, 9, 0), 1175);           // fin octobre : 1000 + 300 − 100 ; échéances : −30 −20 (10 oct.) +5 (31 oct.) → −25
  assert.equal(at('c', 2026, 9, 4), 1000 + (5 - 15));  // le 4 octobre : avant la première opération réelle du mois et avant l'échéance du 10
  assert.equal(at('c', 2026, 10, 30), at('c', 2026, 10, 0));   // novembre a 30 jours : « le 30 » = fin de mois, y compris l'entrée clampée au 30
  assert.equal(at('c', 2026, 10, 0), 1110);                    // 1150 réel + échéances (5 −15 −15 −15)
  assert.equal(at('c', 2026, 1, 30), at('c', 2026, 1, 0));     // février n'a pas de 30
  assert.equal(at('__total', 2026, 9, 15), 1270);              // « e » n'est pas dans le solde total
  assert.equal(at('', 2026, 9, 15), 1270 + 570);               // tous les comptes : « e » = 500 + 70
  assert.equal(at('e', 2026, 9, 9), 500);                      // avant l'entrée du 10
  assert.equal(at('e', 2026, 9, 10), 570);                     // le jour même : compté
  // le mois en cours, avant et après le jour choisi (échéance du 10 novembre)
  assert.equal(at('c', 2026, 10, 9), 1000 + 300 - 100 - 50 + (5 - 15 - 15) );   // avant le 10 novembre : l'échéance de −20 n'est pas encore passée
  assert.equal(at('c', 2026, 10, 10), at('c', 2026, 10, 9) - 20);
});

test('solde lu un jour précis : mêmes valeurs que la série de soldes (autre calcul), pour tous les jours et plusieurs mois', () => {
  const A = loadAt(dayData(), '2026-11-24T10:00:00');
  for (const [y, m] of [[2026, 7], [2026, 8], [2026, 9], [2026, 10], [2026, 11], [2027, 1]]) {
    for (const d of [0, 1, 4, 9, 10, 15, 20, 28, 29, 30]) {
      const viaDate = d ? A.calcScopeBalanceAsOf('c', A.pointDateOf(y, m, d)) : A.calcScopeBalanceEndOfMonth('c', y, m);
      const viaSeries = A.calcBalanceSeries('c', [{ year: y, month: m }], d)[0];
      assert.equal(viaDate, viaSeries, `${y}-${m + 1} jour ${d}`);
    }
  }
});

// ── Solde total de la carte bleue : « Jour du solde » ──

test('jour du solde total : aujourd\'hui, fin de mois, ou un jour du mois en cours ; choix qui correspond à une date', () => {
  const { balanceDayDate: dd, balanceDayChoiceOf: ch } = load({ operations: [], accounts: [] });
  const t = '2026-11-24';
  assert.equal(dd('', t), null);                                         // aujourd'hui
  assert.equal(dd('26', t), '2026-11-26');                               // le 26 du mois en cours (dans le futur : solde prévu)
  assert.equal(dd('1', t), '2026-11-01');
  assert.equal(dd('end', t), '2026-11-30');
  assert.equal(dd('30', '2026-02-10'), '2026-02-28');                    // jour absent du mois : fin de mois
  assert.equal(dd('end', '2028-02-10'), '2028-02-29');
  for (const bad of ['custom', 'abc', '0', '31', '45', undefined, null]) assert.equal(dd(bad, t), null, String(bad));
  // choix affiché selon la date retenue
  assert.equal(ch(null, t), '');
  assert.equal(ch('2026-11-26', t), '26');
  assert.equal(ch('2026-11-24', t), '24');                                // aujourd'hui choisi au calendrier : « Le 24 »
  assert.equal(ch('2026-11-30', t), 'end');
  assert.equal(ch('2026-11-01', t), '1');
  assert.equal(ch('2026-10-26', t), 'custom');                            // un autre mois : choisi avec le calendrier
  assert.equal(ch('2025-11-26', t), 'custom');
  for (const c of ['', 'end', '1', '15', '26']) assert.equal(ch(dd(c, t), t), c, 'aller-retour : ' + c);
});

test('jour du solde total : le solde lu ce jour-là est celui de la série de soldes (autre calcul), échéances comprises', () => {
  const A = loadAt(dayData(), '2026-11-24T10:00:00');
  for (const c of ['1', '9', '10', '15', '28', 'end']) {
    const date = A.balanceDayDate(c, '2026-11-24');
    const viaDate = A.calcScopeBalanceAsOf('c', date);
    const [y, m, d] = date.split('-').map(Number);
    assert.equal(viaDate, A.calcBalanceSeries('c', [{ year: y, month: m - 1 }], c === 'end' ? 0 : d)[0], 'jour ' + c);
  }
  assert.equal(A.calcScopeBalanceAsOf('c', A.balanceDayDate('9', '2026-11-24')), 1000 + 300 - 100 - 50 + (5 - 15 - 15));   // avant l'échéance du 10 novembre
  assert.equal(A.calcScopeBalanceAsOf('c', A.balanceDayDate('10', '2026-11-24')), 1000 + 300 - 100 - 50 + (5 - 15 - 15) - 20);
});

// ── Échéances programmées : passer, modifier, arrêter, sans toucher au passé ──

const echData = () => ({
  accounts: [{ name: 'courant', initialBalance: 1000000 }, { name: 'epargne', initialBalance: 0, includeInTotal: false }],
  operations: [
    op({ id: 'elec', opType: 'Programmee', account: 'courant', date: '2026-07-10', nextPayment: '2026-07-10', type: 'debit', amount: 11400, label: 'Elec - Abonnement', category: 'Logement' }),
    op({ id: 'loyer', opType: 'Programmee', account: 'courant', date: '2026-06-30', nextPayment: '2026-06-30', type: 'debit', amount: 50000, label: 'loyer', exceptions: ['2026-08'] }),
    op({ id: 'sal', opType: 'Programmee', account: 'courant', date: '2026-07-25', nextPayment: '2026-07-25', type: 'credit', amount: 400000, label: 'salaire', endDate: '2026-12-31' }),
    op({ id: 'sal2', opType: 'Programmee', account: 'courant', date: '2027-01-25', nextPayment: '2027-01-25', type: 'credit', amount: 420000, label: 'salaire' }),
    op({ id: 'ass', opType: 'Programmee', account: 'courant', date: '2026-09-24', nextPayment: '2026-09-24', type: 'debit', amount: 12000, label: 'assurance', detail: 'annuelle' }),
    op({ id: 'vir', opType: 'Programmee', account: 'courant', date: '2026-10-01', nextPayment: '2026-10-01', type: 'debit', amount: 30000, label: '[epargne]', virementDest: 'epargne' }),
    op({ id: 'old', opType: 'Programmee', account: 'courant', date: '2026-07-01', nextPayment: '2026-07-01', type: 'debit', amount: 5000, label: 'ancien', endDate: '2026-07-31' }),
    op({ id: 'une', opType: 'Programmee', account: 'courant', date: '2026-12-15', nextPayment: '2026-12-15', type: 'debit', amount: 7000, label: 'cadeau', detail: 'ponctuelle' }),
    op({ id: 'rl', account: 'courant', date: '2026-06-30', type: 'debit', amount: 50000, label: 'Loyer' }),                       // loyer de juin déjà saisi
    op({ id: 'rx', account: 'courant', date: '2026-07-31', opType: 'Virement', type: 'debit', amount: 50000, label: '[epargne]' }),  // même montant que le loyer, autre libellé
    op({ id: 'rs', account: 'courant', date: '2026-09-29', type: 'debit', amount: 20000, label: 'LOYER' }),                       // même libellé, montant trop différent
    op({ id: 'rv', account: 'courant', date: '2026-10-02', opType: 'Virement', type: 'debit', amount: 30000, label: '[epargne]' }),
  ],
});
const TODAY = '2026-11-26';
const ech = () => { const A = loadAt(echData(), TODAY + 'T10:00:00'); return [A, id => A.getData().operations.find(o => o.id === id)]; };

test('échéances : prochaine date à partir d\'aujourd\'hui et occurrences déjà comptées, quelle que soit la date de départ', () => {
  const [A, t] = ech();
  assert.deepEqual(['elec', 'loyer', 'sal', 'ass', 'old', 'une'].map(id => A.nextScheduledDate(t(id), TODAY)),
    ['2026-12-10', '2026-11-30', '2026-12-25', '2027-09-24', null, '2026-12-15']);
  assert.equal(A.nextScheduledDate(t('elec'), '2026-12-10'), '2026-12-10');                                   // le jour même
  assert.deepEqual(A.countedOccurrences(t('elec'), TODAY), ['2026-07-10', '2026-08-10', '2026-09-10', '2026-10-10', '2026-11-10']);
  assert.deepEqual(A.countedOccurrences(t('loyer'), TODAY), ['2026-06-30', '2026-07-30', '2026-09-30', '2026-10-30']);  // août remplacé, 30/11 pas encore
});

test('« Passer » : l\'échéance réglée est devinée d\'après la date (retard, avance, mois déjà remplacé)', () => {
  const [A, t] = ech();
  const g = (id, d) => A.occurrenceChoices(t(id), d).guess;
  assert.equal(g('elec', TODAY), '2026-11-10');                          // électricité du 10 payée le 26
  assert.equal(g('sal', '2026-12-01'), '2026-11-25');                   // salaire de novembre reçu le 1er décembre
  assert.equal(g('sal', '2026-11-20'), '2026-11-25');                   // ou en avance
  assert.equal(g('loyer', '2026-06-30'), '2026-06-30');
  assert.equal(g('loyer', '2026-08-25'), '2026-09-30');                 // août déjà remplacé : la suivante
  assert.equal(g('elec', '2026-01-01'), '2026-07-10');                   // avant le début : la première
  assert.equal(g('old', TODAY), '2026-07-01');                          // terminée mais jamais remplacée : on peut encore la régler
  assert.deepEqual(A.occurrenceChoices(t('elec'), TODAY).choices, ['2026-08-10', '2026-09-10', '2026-10-10', '2026-11-10', '2026-12-10', '2027-01-10', '2027-02-10']);
});

test('paiement déjà saisi : reconnu par libellé et montant (ou virement vers le même compte), jamais par le montant seul', () => {
  const [A, t] = ech();
  assert.equal(A.findRecordedPayment(t('loyer'), '2026-06').id, 'rl');
  assert.equal(A.findRecordedPayment(t('loyer'), '2026-07'), null);     // même montant, mais un virement vers l'épargne
  assert.equal(A.findRecordedPayment(t('loyer'), '2026-09'), null);     // « LOYER » de 20 000 : trop différent
  assert.equal(A.findRecordedPayment(t('vir'), '2026-10').id, 'rv');
  assert.equal(A.findRecordedPayment(t('vir'), '2026-07'), null);       // virement de 50 000 : trop différent de 30 000
  assert.equal(A.findRecordedPayment(t('elec'), '2026-06'), null);
});

test('« Passer » ne touche ni au départ ni aux autres mois, le mois réglé ne compte qu\'une fois, et « Annuler » rétablit tout', () => {
  const [A, t] = ech();
  const bal = d => A.calcBalanceAsOf('courant', d);
  const dates = ['2026-06-30', '2026-07-31', '2026-08-31', '2026-09-30', '2026-10-31', '2026-11-09', '2026-11-26', '2026-11-30', '2026-12-31'];
  const before = dates.map(bal), ops = JSON.stringify(A.getData().operations);
  const u = A.passScheduled('elec', { monthKey: '2026-11', date: TODAY, amount: 11900, type: 'debit', alreadyRecorded: false });
  assert.equal(t('elec').nextPayment, '2026-07-10');                     // (l'ancien « Passer » avançait le départ : juillet disparaissait)
  assert.deepEqual(t('elec').exceptions, ['2026-11']);
  assert.deepEqual(A.getMonthOps('courant', 2026, 10).filter(o => o.label === 'Elec - Abonnement').map(o => [o.date, o.opType]), [[TODAY, 'Operation']]);
  assert.deepEqual(dates.map((d, i) => bal(d) - before[i]), [0, 0, 0, 0, 0, 0, -500, -500, -500]);           // seule la différence de montant, à partir du paiement
  A.undoPass(u);
  assert.equal(JSON.stringify(A.getData().operations), ops);
  assert.deepEqual(dates.map(bal), before);
});

test('« Passer » un paiement déjà saisi : rien n\'est ajouté, le mois n\'est plus compté deux fois', () => {
  const [A, t] = ech();
  const before = A.calcBalanceAsOf('courant', TODAY), n = A.getData().operations.length;
  A.passScheduled('loyer', { monthKey: '2026-06', date: '2026-06-30', amount: 50000, type: 'debit', alreadyRecorded: true });
  assert.equal(A.calcBalanceAsOf('courant', TODAY), before + 50000);
  assert.equal(A.getData().operations.length, n);
  assert.deepEqual(t('loyer').exceptions, ['2026-08', '2026-06']);
});

test('« Passer » un virement (les deux comptes) et une échéance ponctuelle (retirée, « Annuler » la remet)', () => {
  const [A, t] = ech();
  const c = A.calcBalanceAsOf('courant', '2026-11-30'), e = A.calcBalanceAsOf('epargne', '2026-11-30');
  const v = A.passScheduled('vir', { monthKey: '2026-11', date: '2026-11-05', amount: 30000, type: 'debit' });
  assert.equal(v.added.length, 2);
  assert.deepEqual([A.calcBalanceAsOf('courant', '2026-11-30'), A.calcBalanceAsOf('epargne', '2026-11-30')], [c, e]);
  const u = A.passScheduled('une', { monthKey: '2026-12', date: '2026-12-15', amount: 7000, type: 'debit' });
  assert.equal(t('une'), undefined);
  A.undoPass(u);
  const cadeaux = A.getData().operations.filter(o => o.label === 'cadeau');
  assert.deepEqual(cadeaux.map(o => o.opType), ['Programmee']);
  assert.equal(A.passScheduled('inconnu', { monthKey: '2026-11', date: TODAY, amount: 1, type: 'debit' }), null);
});

test('modifier « à partir de » ou arrêter : le passé garde ses valeurs, la date de fin et les mois remplacés sont conservés', () => {
  const [A, t] = ech();
  const bal = d => A.calcBalanceAsOf('courant', d);
  const past = ['2026-07-31', '2026-09-30', '2026-11-26'];
  const before = past.map(bal), dec = bal('2026-12-31');
  const next = A.splitScheduled(t('sal'), '2026-12-25', { amount: 500000 });
  assert.deepEqual(past.map(bal), before);
  assert.equal(bal('2026-12-31'), dec + 100000);
  assert.deepEqual([t('sal').endDate, next.endDate, next.nextPayment, next.amount], ['2026-11-30', '2026-12-31', '2026-12-25', 500000]);
  t('loyer').exceptions = ['2026-08', '2027-01'];
  const l2 = A.splitScheduled(t('loyer'), '2026-11-30', { amount: 55000 });
  assert.deepEqual(l2.exceptions, ['2027-01']);                           // le mois déjà remplacé reste remplacé
  assert.deepEqual(past.map(bal), before);
  const dec2 = bal('2026-12-31');
  A.endBeforeMonth(t('elec'), '2026-12-10');
  assert.equal(t('elec').endDate, '2026-11-30');
  assert.deepEqual(past.map(bal), before);
  assert.equal(bal('2026-12-31'), dec2 + 11400);
});

test('total mensuel des échéances : en cours seulement, annuelle ramenée au mois, sans virements ni ponctuelles', () => {
  const [A] = ech();
  assert.deepEqual(A.monthlyScheduledTotals(TODAY), { income: 400000, expense: 11400 + 50000 + 1000 });   // le salaire de 2027 n'a pas commencé
  assert.deepEqual(A.monthlyScheduledTotals('2027-01-10'), { income: 420000, expense: 11400 + 50000 + 1000 });
});

// ── Connexion Google Drive : pastille d'état et proposition au démarrage ──

test('état de la connexion : hors ligne > non connecté (ou jeton expiré) > synchronisation > envoi en attente > connecté', () => {
  const { computeConnState: s } = load({ operations: [], accounts: [] });
  const base = { online: true, syncing: false, hasToken: true, tokenExp: 2000, now: 1000, pending: false };
  assert.equal(s(base), 'connected');
  assert.equal(s({ ...base, pending: true }), 'pending');
  assert.equal(s({ ...base, syncing: true, pending: true }), 'syncing');
  assert.equal(s({ ...base, hasToken: false }), 'disconnected');
  assert.equal(s({ ...base, tokenExp: 1000 }), 'disconnected');       // jeton arrivé à expiration
  assert.equal(s({ ...base, tokenExp: 999 }), 'disconnected');        // et au-delà
  assert.equal(s({ ...base, tokenExp: 0 }), 'connected');             // pas de date d'expiration connue : on fait confiance au jeton
  assert.equal(s({ ...base, online: false }), 'offline');             // sans réseau, même avec un jeton
  assert.equal(s({ ...base, online: false, hasToken: false }), 'offline');
});

test('proposition de connexion au démarrage : seulement si non connecté, en ligne, non désactivée, non refusée, écran principal', () => {
  const { shouldProposeConnection: p } = load({ operations: [], accounts: [] });
  const base = { hasToken: false, online: true, askDisabled: false, skipped: false, mainActive: true };
  assert.equal(p(base), true);
  assert.equal(p({ ...base, hasToken: true }), false);       // déjà connecté
  assert.equal(p({ ...base, online: false }), false);        // pas de réseau : on démarre sans connexion
  assert.equal(p({ ...base, askDisabled: true }), false);    // désactivée dans les Réglages
  assert.equal(p({ ...base, skipped: true }), false);        // refusée pendant cette session
  assert.equal(p({ ...base, mainActive: false }), false);    // écran de verrouillage ou de connexion affiché
});

// ── Fenêtres entières à l'écran ──

test("fenêtres : place prise par le clavier à l'écran (zoom et petits écarts ignorés)", () => {
  const A = load({ accounts: [], operations: [] });
  const vv = (height, offsetTop = 0, scale = 1) => ({ height, offsetTop, scale });
  assert.deepEqual(A.visibleAreaInsets(800, vv(480)), { top: 0, bottom: 320 });          // clavier ouvert
  assert.deepEqual(A.visibleAreaInsets(800, vv(480, 100)), { top: 100, bottom: 220 });   // page remontée par le navigateur
  assert.deepEqual(A.visibleAreaInsets(800, vv(744)), { top: 0, bottom: 0 });            // barre d'adresse : ignorée
  assert.deepEqual(A.visibleAreaInsets(800, vv(400, 0, 2)), { top: 0, bottom: 0 });      // zoom avec les doigts
  assert.deepEqual(A.visibleAreaInsets(800, undefined), { top: 0, bottom: 0 });
});

test("fenêtres : aucune hauteur imposée dans la page (elles suivent la taille de l'écran)", () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const boxes = html.match(/<div class="modal-content[^>]*>/g);
  assert.ok(boxes.length >= 11);
  assert.deepEqual(boxes.filter(b => /height/.test(b)), []);
});

// ── Dossier de sauvegarde automatique ──

test("dossier de sauvegarde : chaque situation propose la bonne action", () => {
  const A = load({ accounts: [], operations: [] });
  const view = (...x) => { const v = A.backupDirView(...x); return [v.main, v.allow, v.clear, v.tone]; };
  assert.deepEqual(view(true, null, false), ['📁 Choisir le dossier', false, false, 'muted']);
  assert.deepEqual(view(true, 'Copies', false), ['📁 Changer de dossier', true, true, 'warn']);      // autorisation perdue
  assert.deepEqual(view(true, 'Copies', true), ['📁 Changer de dossier', false, true, 'ok']);        // on peut toujours changer
  assert.deepEqual(view(false, null, false), ['📁 Choisir le dossier', false, false, 'warn']);
  assert.match(A.backupDirView(false, null, false).status, /Chrome ou Edge/);
});

test("dossier de sauvegarde : un échec est expliqué (dossier refusé ou annulé, accès interdit, autre)", () => {
  const A = load({ accounts: [], operations: [] });
  assert.match(A.backupDirError({ name: 'AbortError', message: 'x' }), /à l'intérieur de Documents/);
  assert.match(A.backupDirError({ name: 'SecurityError', message: 'x' }), /autorisations.*SecurityError : x/);
  assert.match(A.backupDirError({ name: 'TypeError', message: 'boum' }), /TypeError : boum/);
});

test("sauvegarde auto : une copie par jour, 10 jours gardés, les autres fichiers ne sont jamais touchés", () => {
  const A = load({ accounts: [], operations: [] });
  assert.equal(A.autoBackupName(new Date(2026, 0, 5, 23, 59)), 'finances-auto-20260105.json');
  const days = Array.from({ length: 12 }, (_, i) => A.autoBackupName(new Date(2026, 10, 15 + i)));
  const others = ['finances-backup-20260101.json', 'finances-backup-20260101_120000.json', 'finances-auto-20260101.json.crswap', 'finances-auto-notes.json', 'photo.jpg'];
  assert.deepEqual(A.oldAutoBackups([...others, ...days].reverse()), [days[1], days[0]]);
  assert.deepEqual(A.oldAutoBackups(days.slice(0, 10)), []);
});

test("sauvegarde auto : l'accueil avertit seulement quand elle ne fonctionne plus", () => {
  const A = load({ accounts: [], operations: [] });
  assert.equal(A.backupAlert(true, true, true, false), null);       // tout va bien
  assert.equal(A.backupAlert(true, false, false, false), null);     // aucun dossier choisi
  assert.equal(A.backupAlert(false, true, false, false), null);     // appareil sans cette possibilité
  assert.equal(A.backupAlert(true, true, false, false).button, 'Réautoriser');
  assert.equal(A.backupAlert(true, true, true, true).button, 'Réessayer');
});

// ── Fond de l'application ──

test("fond : seuls les choix connus sont appliqués, la photo seulement si elle existe", () => {
  const A = load({ accounts: [], operations: [] });
  assert.equal(A.normalizeBackground('lagon', false), 'lagon');
  assert.equal(A.normalizeBackground('photo', true), 'photo');
  assert.equal(A.normalizeBackground('photo', false), 'defaut');
  assert.equal(A.normalizeBackground('inconnu', true), 'defaut');
});

test("fond : chaque choix a ses couleurs en clair et en sombre", () => {
  const A = load({ accounts: [], operations: [] });
  const lines = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8').split(String.fromCharCode(10));
  for (const [id] of A.backgroundChoices()) {
    assert.ok(lines.some(l => l.startsWith('[data-bg="' + id + '"] {')), 'clair : ' + id);
    assert.ok(lines.some(l => l.startsWith('body.dark-mode[data-bg="' + id + '"]')), 'sombre : ' + id);
  }
});

test("sauvegarde auto : jamais deux écritures à la fois, et la dernière demande est toujours servie", async () => {
  const A = load({ accounts: [], operations: [] });
  let active = 0, most = 0, runs = 0;
  const run = A.oneAtATime(async () => { most = Math.max(most, ++active); runs++; await new Promise(r => setImmediate(r)); active--; });
  await Promise.all([run(), run(), run()]);
  assert.deepEqual([most, runs], [1, 2]);       // les demandes reçues pendant l'écriture sont regroupées en une seule
  await run();
  assert.deepEqual([most, runs], [1, 3]);
});

test("fond photo : visibilité entre 10 et 100 %, 70 % tant que rien n'est choisi", () => {
  const A = load({ accounts: [], operations: [] });
  assert.deepEqual([null, '', 'abc', '55', '72', '3', 130].map(v => A.photoVisibility(v)), [70, 70, 70, 55, 70, 10, 100]);
});

// ── Cadre « Solde total » ──

test("cadre du solde : couleurs connues ou libres, sinon le bleu ; chaque couleur est définie", () => {
  const A = load({ accounts: [], operations: [] });
  assert.deepEqual(['vert', 'invisible', '#FF8800', '#12345g', '#fff', null, 'inconnu'].map(v => A.normalizeCardColor(v)),
    ['vert', 'invisible', '#ff8800', 'bleu', 'bleu', 'bleu', 'bleu']);
  const lines = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8').split(String.fromCharCode(10));
  for (const [id] of A.cardChoices()) assert.ok(lines.some(l => l.startsWith('[data-card="' + id + '"] {')), id);
});

test("cadre du solde : texte foncé sur les couleurs claires, blanc sur les couleurs sombres", () => {
  const A = load({ accounts: [], operations: [] });
  assert.deepEqual(['#ffffff', '#ffeb3b', '#a5d6a7', '#1a237e', '#c25100', '#000000'].map(h => A.isLightColor(h)),
    [true, true, true, false, false, false]);
});

test("cadre du solde : visibilité de 0 à 100 %, et l'ancien réglage « invisible » est repris", () => {
  const A = load({ accounts: [], operations: [] });
  const look = (c, v) => { const r = A.cardSettings(c, v); return [r.color, r.visibility]; };
  assert.deepEqual(look(null, null), ['bleu', 100]);
  assert.deepEqual(look('invisible', null), ['bleu', 0]);
  assert.deepEqual(look('invisible', '35'), ['bleu', 35]);
  assert.deepEqual(look('vert', '42'), ['vert', 40]);
  assert.deepEqual(look('#ff8800', '130'), ['#ff8800', 100]);
  assert.deepEqual(look('orange', '-5'), ['orange', 0]);
  assert.deepEqual(look('orange', 'abc'), ['orange', 100]);
});

// ── Modifier ou supprimer un virement ──

const leg = (id, account, date, type, other, amount = 315000) => op({ id, account, date, type, amount, label: '[' + other + ']', category: 'Virement', opType: 'Virement' });
const row = o => [o.id, o.date, o.account, o.type, o.amount, o.label];

test("virement : modifié depuis le côté carte, les deux côtés suivent et rien n'est créé", () => {
  const A = load({ accounts: [], operations: [leg('d', 'courant', '2026-11-27', 'debit', 'carte bleu'), leg('c', 'carte bleu', '2026-11-27', 'credit', 'courant')] });
  const ops = A.getData().operations, c = ops[1];
  const partner = A.findTransferPartner(c, ops);
  assert.equal(partner.id, 'd');
  assert.deepEqual(A.applyTransferEdit(c, partner, false, { date: '2026-11-25', amount: 315000, from: 'courant', to: 'carte bleu' }), {});
  assert.deepEqual(ops.map(row), [['d', '2026-11-25', 'courant', 'debit', 315000, '[carte bleu]'], ['c', '2026-11-25', 'carte bleu', 'credit', 315000, '[courant]']]);
});

test("virement : un côté en trop n'emporte pas la bonne paire, et le modifier ne crée rien", () => {
  const A = load({ accounts: [], operations: [leg('g', 'courant', '2026-11-25', 'debit', 'carte bleu'), leg('o', 'carte bleu', '2026-11-25', 'credit', 'courant'), leg('x', 'courant', '2026-11-27', 'debit', 'carte bleu')] });
  const ops = A.getData().operations, [g, o, x] = ops;
  assert.deepEqual([g, o, x].map(l => A.findTransferPartner(l, ops)?.id ?? null), ['o', 'g', null]);
  assert.deepEqual(A.applyTransferEdit(x, null, false, { date: '2026-11-28', amount: 315000, from: 'courant', to: 'carte bleu' }), { alone: true });
  assert.equal(ops.length, 3);
  x.date = '2026-11-25';                                   // doublon le même jour : lui non plus n'a pas de partenaire
  assert.equal(A.findTransferPartner(x, ops), null);
});

test("virement : dates différentes d'un côté à l'autre (relevés bancaires), le montant change sans déplacer l'autre date", () => {
  const A = load({ accounts: [], operations: [leg('d', 'courant', '2026-11-01', 'debit', 'epargne', 5000), leg('c', 'epargne', '2026-11-03', 'credit', 'courant', 5000), leg('z', 'epargne', '2026-11-20', 'credit', 'courant', 5000)] });
  const ops = A.getData().operations, [d, c] = ops;
  const partner = A.findTransferPartner(d, ops);
  assert.equal(partner.id, 'c');
  A.applyTransferEdit(d, partner, false, { date: '2026-11-01', amount: 6000, from: 'courant', to: 'epargne' });
  assert.deepEqual([c.date, c.amount, d.amount], ['2026-11-03', 6000, 6000]);
});

test("virement : seule la conversion d'une opération simple crée l'autre côté, dans le bon sens", () => {
  const recu = op({ id: 'r', account: 'carte bleu', date: '2026-11-10', type: 'credit', amount: 2000, label: 'remboursement' });
  const A = load({ accounts: [], operations: [recu] });
  const r = A.applyTransferEdit(A.getData().operations[0], null, true, { date: '2026-11-10', amount: 2000, from: 'courant', to: 'carte bleu' });
  assert.deepEqual([row(A.getData().operations[0]).slice(1), [r.created.account, r.created.type, r.created.label]],
    [['2026-11-10', 'carte bleu', 'credit', 2000, '[courant]'], ['courant', 'debit', '[carte bleu]']]);
});

// ── Commentaires ──

test("commentaire : nettoyé, limité à 200 caractères, et protégé dans l'export CSV", () => {
  const A = load({ accounts: [], operations: [] });
  assert.deepEqual(['  Cadeau  ', '', '   ', undefined].map(v => A.cleanComment(v)), ['Cadeau', undefined, undefined, undefined]);
  assert.equal(A.cleanComment('x'.repeat(250)).length, 200);
  assert.equal(A.csvText('a;"b"' + String.fromCharCode(10) + 'c'), '"a;""b""' + String.fromCharCode(10) + 'c"');
});

test("commentaire : reporté sur les deux côtés d'un virement modifié, sans effacer celui de l'autre côté s'il ne change pas", () => {
  const A = load({ accounts: [], operations: [leg('d', 'courant', '2026-11-01', 'debit', 'epargne', 5000), { ...leg('c', 'epargne', '2026-11-01', 'credit', 'courant', 5000), comment: 'reçu' }] });
  const [d, c] = A.getData().operations;
  A.applyTransferEdit(d, c, false, { date: '2026-11-02', amount: 5000, from: 'courant', to: 'epargne' });
  assert.deepEqual([d.comment, c.comment], [undefined, 'reçu']);
  A.applyTransferEdit(d, c, false, { date: '2026-11-02', amount: 5000, from: 'courant', to: 'epargne', comment: 'vacances' });
  assert.deepEqual([d.comment, c.comment], ['vacances', 'vacances']);
});

test("commentaire : « Passer » reprend celui de l'échéance, ou celui saisi pour cette fois", () => {
  const [A, t] = ech();
  t('vir').comment = 'mensuel';
  const first = A.passScheduled('vir', { monthKey: '2026-10', date: '2026-10-01', amount: 30000, type: 'debit' });
  const added = id => A.getData().operations.filter(o => id.includes(o.id)).map(o => o.comment);
  assert.deepEqual(added(first.added), ['mensuel', 'mensuel']);
  const second = A.passScheduled('elec', { monthKey: '2026-11', date: '2026-11-10', amount: 11400, type: 'debit', comment: '  relevé corrigé ' });
  assert.deepEqual(added(second.added), ['relevé corrigé']);
});

// ── Prélèvement choisi par opération (la banque compte un achat sur le mois voisin) ──

test("prélèvement : d'après la date par défaut, ou celui choisi pour l'opération", () => {
  const buy = (id, date, billingShift, amount = 1000) => op({ id, account: 'carte', date, type: 'debit', amount, label: id, billingShift });
  const A = load({ accounts: [{ name: 'carte', cardType: 'deferred', billingCycleDay: 25 }], operations: [
    buy('veille', '2026-10-24', 1), buy('autre-veille', '2026-10-24'), buy('jour', '2026-10-25'), buy('banque-avant', '2026-10-25', -1),
    buy('plus-tard', '2026-11-02', 1), buy('normal', '2026-11-02'),
  ] });
  const nov = new Date('2026-11-20T12:00:00');
  assert.deepEqual(['2026-10-24', '2026-10-25', '2026-11-24'].map(d => A.billingDebitDate(d, 25)), ['2026-10-25', '2026-11-25', '2026-11-25']);
  const p = A.cardPeriod('carte', nov);
  assert.deepEqual([p.debit, p.ops.map(o => o.id), p.moved.map(o => o.id)], ['2026-11-25', ['veille', 'jour', 'normal'], ['banque-avant', 'plus-tard']]);
  assert.equal(A.calcBillingBalance('carte', nov), 3000);
  // au prélèvement suivant, l'achat reporté est bien compté une fois
  assert.deepEqual(A.getBillingPeriodOps('carte', new Date('2026-12-10T12:00:00')).map(o => o.id), ['plus-tard']);
});

test("jour de prélèvement choisi : l'achat compte dans les soldes et le mois de ce jour-là", () => {
  const card = (id, date, amount, extra) => op({ id, account: 'carte', date, type: 'debit', amount, label: id, ...extra });
  const A = loadAt({ accounts: [{ name: 'carte', initialBalance: 0, cardType: 'deferred', billingCycleDay: 25 }], operations: [
    card('nov', '2026-11-10', 1000), card('choisi', '2026-11-28', 3000, { debitDate: '2026-12-25' }), card('ancien', '2026-11-24', 500, { billingShift: 1 }),
  ] }, '2026-11-30T10:00:00');
  assert.deepEqual(['2026-11-30', '2026-12-24', '2026-12-25', '2026-12-31'].map(d => A.calcBalanceAsOf('carte', d)), [-1000, -1000, -4500, -4500]);
  assert.deepEqual(A.getMonthOps('carte', 2026, 10).map(o => o.id), ['nov']);
  assert.deepEqual(A.getMonthOps('carte', 2026, 11).map(o => o.id), ['ancien', 'choisi']);     // rangées par date d’achat
  assert.deepEqual(A.calcBalanceSeries('carte', [{ year: 2026, month: 10 }, { year: 2026, month: 11 }], 0, []), [-1000, -4500]);
  const p = A.cardPeriod('carte', new Date('2026-11-30T12:00:00'));              // prélèvement du 25/12
  assert.deepEqual([p.ops.map(o => o.id), p.moved.length], [['ancien', 'choisi'], 0]);
});

test("jour de prélèvement : un achat sans choix reste à sa date, et un virement n'en garde aucun", () => {
  const A = load({ accounts: [], operations: [op({ id: 'x', account: 'carte', date: '2026-11-28', type: 'debit', amount: 10, label: 'x', debitDate: '2026-12-25' })] });
  const x = A.getData().operations[0];
  assert.equal(A.balanceDate(op({ date: '2026-11-28' })), '2026-11-28');
  A.applyTransferEdit(x, null, true, { date: '2026-11-28', amount: 10, from: 'carte', to: 'courant' });
  assert.equal(A.balanceDate(x), '2026-11-28');
});

test("carte : avant le jour de remise à zéro un achat compte à sa date, à partir de ce jour au prélèvement suivant", () => {
  const card = (id, date, amount, extra) => op({ id, account: 'carte', date, type: 'debit', amount, label: id, ...extra });
  const A = loadAt({ accounts: [{ name: 'carte', initialBalance: 0, cardType: 'deferred', billingCycleDay: 25 }, { name: 'courant', initialBalance: 0 }], operations: [
    card('veille', '2026-11-24', 1000), card('jour', '2026-11-25', 2000), card('fin', '2026-11-30', 500),
    card('force', '2026-11-27', 40, { debitDate: '2026-11-27' }), card('rembourse', '2026-11-26', 100, { type: 'credit' }),
    op({ id: 'reglement', account: 'carte', date: '2026-11-25', type: 'credit', amount: 3000, label: '[courant]', opType: 'Virement' }),
  ] }, '2026-11-30T10:00:00');
  assert.deepEqual(A.getData().operations.map(o => A.balanceDate(o)), ['2026-11-24', '2026-12-25', '2026-12-25', '2026-11-27', '2026-12-25', '2026-11-25']);
  assert.deepEqual(['2026-11-30', '2026-12-25'].map(d => A.calcBalanceAsOf('carte', d)), [1960, -440]);
  assert.deepEqual(A.getMonthOps('carte', 2026, 10).map(o => o.id), ['veille', 'reglement', 'force']);
  assert.equal(A.autoDebitDate('courant', '2026-11-30'), '2026-11-30');        // autres comptes : rien ne change
});

// ── Impression ───────────────────────────────────────────────────────────────
const F = n => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' F';
const impData = () => ({
  accounts: [{ name: 'courant', initialBalance: 100000 }, { name: 'epargne', initialBalance: 5000 },
    { name: 'carte', initialBalance: 0, cardType: 'deferred', billingCycleDay: 25, includeInTotal: false }],
  operations: [
    op({ id: 'oct', account: 'courant', date: '2026-10-31', type: 'debit', amount: 1000, label: 'Octobre' }),
    op({ id: 'paie', account: 'courant', date: '2026-11-02', type: 'credit', amount: 200000, label: 'Paie', category: 'Salaire' }),
    op({ id: 'courses', account: 'courant', date: '2026-11-10', type: 'debit', amount: 15000, label: 'Courses', category: 'Alimentation/Super', comment: 'Fête de <Léa>', pointed: true }),
    op({ id: 'loyer', opType: 'Programmee', account: 'courant', date: '2026-11-05', nextPayment: '2026-11-05', type: 'debit', amount: 50000, label: 'Loyer', category: 'Logement' }),
    leg('v1', 'courant', '2026-11-20', 'debit', 'epargne', 30000),
    leg('v2', 'epargne', '2026-11-20', 'credit', 'courant', 30000),
    op({ id: 'cb', account: 'carte', date: '2026-11-26', type: 'debit', amount: 7000, label: 'Essence', category: 'Transport' }),
  ],
});
const filtres = (o = {}) => ({ account: '', type: '', category: '', search: '', amountMin: 0, amountMax: 0, dateFrom: '', dateTo: '', year: 2026, month: 10, ...o });
const lignes = html => html.split('<td class="nowrap">').length - 1;
const resume = (A, o) => { const f = filtres(o), v = A.selectOperations(f); return [v.rows.map(r => r.op.id), A.operationTotals(v, f.account)]; };

test("impression d'un mois : les lignes de l'écran, échéances programmées comprises, avec soldes de début et de fin", () => {
  const A = loadAt(impData(), '2026-11-27T10:00:00');
  const f = filtres({ account: 'courant' }), view = A.selectOperations(f);
  assert.deepEqual(view.rows.map(r => r.op.id), ['paie', 'loyer', 'courses', 'v1']);
  assert.deepEqual([view.opening, view.closing, view.rows.map(r => r.balance)], [99000, 204000, [299000, 249000, 234000, 204000]]);
  assert.deepEqual(A.operationTotals(view, 'courant'), { income: 200000, expense: 95000 });
  const doc = A.opsPrintDoc(f);
  assert.equal(doc.title, 'Relevé courant - Novembre 2026');
  assert.equal(lignes(doc.html), 4);
  for (const text of ['Solde au début du mois', F(99000), 'Total des entrées', '+' + F(200000), 'Total des sorties', '-' + F(95000), 'Solde à la fin du mois', F(204000), 'programmée', '✓ pointée', 'Fête de &lt;Léa&gt;']) {
    assert.ok(doc.html.includes(text), text);
  }
  assert.ok(!doc.html.includes('<th>Compte</th>'));
  // ordre décroissant : mêmes lignes à l'envers, mêmes soldes après chaque ligne
  const envers = A.opsPrintDoc(f, { ascending: false }).html;
  assert.ok(envers.indexOf('Paie') > envers.indexOf('Loyer') && envers.indexOf('Loyer') > envers.indexOf('Courses'));
  assert.ok(doc.html.indexOf('Paie') < doc.html.indexOf('Loyer'));
});

test("impression d'un mois de carte : les achats prélevés ce mois-là, avec leur date de prélèvement", () => {
  const A = loadAt(impData(), '2026-11-27T10:00:00');
  assert.deepEqual(resume(A, { account: 'carte' })[0], []);
  const doc = A.opsPrintDoc(filtres({ account: 'carte', month: 11 }));
  assert.equal(lignes(doc.html), 1);
  assert.ok(doc.html.includes('prélevé le 25/12/2026') && doc.html.includes('26/11/2026'));
  assert.ok(A.opsPrintDoc(filtres({ account: 'carte' })).html.includes('Aucune opération'));
});

test("impression avec filtres : tous les filtres de l'écran s'appliquent", () => {
  const A = loadAt(impData(), '2026-11-27T10:00:00');
  assert.deepEqual(resume(A, { search: 'léa' })[0], ['courses']);                                  // commentaire compris
  assert.deepEqual(resume(A, { category: 'Alimentation' })[0], ['courses']);                      // sous-catégories comprises
  assert.deepEqual(resume(A, { amountMin: 10000, amountMax: 20000 })[0], ['courses']);
  assert.deepEqual(resume(A, { dateFrom: '2026-11-20', dateTo: '2026-11-26' })[0], ['cb', 'v2', 'v1']);
  assert.deepEqual(resume(A, { account: 'courant', type: 'credit' })[0], ['paie']);
  const doc = A.opsPrintDoc(filtres({ account: 'courant', dateFrom: '2026-11-01' }));
  assert.equal(lignes(doc.html), 4);
  assert.ok(doc.html.includes('Dates : à partir du 01/11/2026') && !doc.html.includes('Solde au début du mois'));
});

test('totaux filtrés : sans les modèles programmés, et sans les virements quand tous les comptes sont mêlés', () => {
  const A = loadAt(impData(), '2026-11-27T10:00:00');
  assert.deepEqual(resume(A, { dateFrom: '2026-11-01' })[1], { income: 200000, expense: 22000 });
  assert.deepEqual(resume(A, { account: 'courant', dateFrom: '2026-11-01' })[1], { income: 200000, expense: 45000 });   // le virement sort bien du compte
  const tous = A.opsPrintDoc(filtres()).html;
  assert.ok(tous.includes('<th>Compte</th>') && tous.includes('virements entre vos comptes') && tous.includes('programmées sont listées'));
  const un = A.opsPrintDoc(filtres({ account: 'courant', type: 'debit', search: 'courses' })).html;
  assert.ok(!un.includes('virements entre vos comptes') && !un.includes('programmées sont listées'));
});

test("impression d'une longue liste : aucune ligne n'est coupée", () => {
  const ops = Array.from({ length: 1234 }, (_, i) => op({ id: 'n' + i, account: 'courant', date: '2026-11-10', type: 'debit', amount: 1, label: 'n' + i }));
  const A = load({ accounts: [{ name: 'courant', initialBalance: 0 }], operations: ops });
  const doc = A.opsPrintDoc(filtres());
  assert.deepEqual([doc.count, lignes(doc.html)], [1234, 1234]);
});

test('filtres actifs : écrits en clair en tête du document', () => {
  const A = load({ accounts: [], operations: [] });
  assert.equal(A.describeOpsFilters(filtres()), '');
  assert.equal(A.describeOpsFilters(filtres({ type: 'debit', category: 'Logement', search: 'elec', dateFrom: '2026-11-01', dateTo: '2026-11-30', amountMin: 1000, amountMax: 5000 })),
    `Débits seulement · Catégorie : Logement · Recherche : « elec » · Dates : à partir du 01/11/2026 jusqu’au 30/11/2026 · Montants : à partir de ${F(1000)} jusqu’à ${F(5000)}`);
});

test("impression de l'accueil : soldes à la date choisie, comptes hors total signalés, total identique à l'écran", () => {
  const A = loadAt(impData(), '2026-11-27T10:00:00');
  const jour = A.accountsPrintDoc('2026-11-27');
  assert.ok(jour.html.includes('(hors total)') && jour.html.includes('Soldes des comptes au 27 novembre 2026') && !jour.html.includes('(prévu)'));
  assert.ok(jour.html.includes(F(A.calcDashboardTotalBalance())));
  assert.equal(jour.title, 'Soldes des comptes au 27-11-2026');
  const avant = A.accountsPrintDoc('2026-11-01');                // avant la paie
  assert.ok(avant.html.includes(F(99000)) && avant.html.includes(F(104000)));
  const apres = A.accountsPrintDoc('2026-12-31');
  assert.ok(apres.html.includes('(prévu)') && apres.html.includes(F(-7000)));
});

test('impression : le document garde sa propre marge, même quand la page n’en a pas', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
  const marge = /@media print [{][^.]*[.]print-doc [{] padding: ([0-9]+)mm;[^}]*box-decoration-break: clone;/.exec(css);
  assert.ok(marge && +marge[1] >= 8);
});

// ── Centre d'impression ──
test('relevé d’une période : les lignes du mois à l’écran, et solde de début + lignes = solde de fin', () => {
  const A = loadAt(impData(), '2026-11-27T10:00:00');
  const signes = v => v.opening + v.rows.reduce((s, r) => s + (r.op.type === 'credit' ? r.op.amount : -r.op.amount), 0);
  const ecran = A.selectOperations(filtres({ account: 'courant' })), mois = A.periodView('courant', '2026-11-01', '2026-11-30');
  assert.deepEqual([mois.opening, mois.closing, mois.rows.map(r => [r.op.id, r.balance])], [ecran.opening, ecran.closing, ecran.rows.map(r => [r.op.id, r.balance])]);
  const debut = A.periodView('courant', '2026-10-31', '2026-11-05');
  assert.deepEqual([debut.opening, debut.closing, debut.rows.map(r => r.op.id)], [100000, 249000, ['oct', 'paie', 'loyer']]);
  const cheval = A.periodView('courant', '2026-11-05', '2026-12-05');                       // l’échéance de chaque mois
  assert.deepEqual([cheval.opening, cheval.closing, cheval.rows.map(r => r.op.id)], [299000, 154000, ['loyer', 'courses', 'v1', 'loyer']]);
  for (const [du, au] of [['2025-01-01', '2027-03-15'], ['2026-11-21', '2026-11-21'], ['2026-12-06', '2027-01-04']]) {
    const v = A.periodView('courant', du, au);
    assert.equal(signes(v), v.closing, du + ' ' + au);
  }
  const doc = A.periodPrintDoc('courant', '2026-11-05', '2026-12-05');
  assert.equal(doc.title, 'Relevé courant - du 05-11-2026 au 05-12-2026');
  for (const text of ['du 05/11/2026 au 05/12/2026', 'Solde au début de la période', F(299000), 'Solde à la fin de la période', F(154000)]) assert.ok(doc.html.includes(text), text);
  assert.equal(lignes(doc.html), 4);
});

const carteData = () => ({
  accounts: [{ name: 'carte', initialBalance: 0, cardType: 'deferred', billingCycleDay: 25, includeInTotal: false }, { name: 'courant', initialBalance: 0 }],
  operations: [
    ['avant', '2026-10-24', 100], ['a', '2026-10-25', 200], ['b', '2026-11-24', 300], ['c', '2026-11-26', 400],
    ['choisi', '2026-11-10', 500, { debitDate: '2026-12-25' }], ['rendu', '2026-11-27', 50, { type: 'credit' }],
    ['jour25', '2026-11-25', 70, { debitDate: '2026-11-25' }],              // daté après la période, rattaché à la main
  ].map(([id, date, amount, extra]) => op({ id, account: 'carte', date, type: 'debit', amount, label: 'achat ' + id, ...extra }))
    .concat(leg('regle', 'carte', '2026-11-25', 'credit', 'courant', 600)),
});

test('relevé de carte : prélèvements proposés, dates d’achat, total identique à l’accueil, achats comptés ailleurs signalés', () => {
  const A = loadAt(carteData(), '2026-11-28T10:00:00');
  assert.deepEqual(A.cardDebitDates('carte'), ['2026-12-25', '2026-11-25', '2026-10-25']);
  assert.deepEqual(A.cardDebitDates('courant'), []);
  assert.deepEqual(A.cardStatementRange('carte', '2026-12-25'), { start: '2026-11-25', end: '2026-11-28', current: true });
  assert.deepEqual(A.cardStatementRange('carte', '2026-11-25'), { start: '2026-10-25', end: '2026-11-24', current: false });
  const cours = A.cardPrintDoc('carte', '2026-12-25');
  assert.equal(cours.title, 'Relevé carte - prélèvement du 25-12-2026');
  assert.equal(lignes(cours.html), 3);
  for (const text of ['Prélèvement du 25/12/2026', '(en cours)', 'Total à prélever', F(A.calcBillingBalance('carte')), 'Remboursements']) assert.ok(cours.html.includes(text), text);
  assert.equal(A.calcBillingBalance('carte'), 850);
  assert.ok(!cours.html.includes('achat regle') && !cours.html.includes('prélevé le 25/12'));
  const passe = A.cardPrintDoc('carte', '2026-11-25');
  assert.equal(lignes(passe.html), 3);
  assert.ok(passe.html.includes(F(570)) && passe.html.includes('achat jour25') && !passe.html.includes('(en cours)') && passe.html.includes('autre prélèvement') && passe.html.includes('achat choisi') && passe.html.includes('prélevé le 25/12/2026'));
});

test('options d’impression : commentaires, catégories, soldes et pointage masquables, ordre choisi, aperçu limité', () => {
  const A = loadAt(impData(), '2026-11-27T10:00:00');
  const nu = A.opsPrintDoc(filtres({ account: 'courant' }), { comments: false, categories: false, balance: false, pointed: false }).html;
  for (const text of ['Fête', '<th>Catégorie</th>', '<th class="right">Solde</th>', 'pointée']) assert.ok(!nu.includes(text), text);
  assert.ok(nu.includes('Solde au début du mois') && nu.includes('programmée'));            // les totaux et « programmée » restent
  const tout = A.opsPrintDoc(filtres()), court = A.opsPrintDoc(filtres(), { limit: 2 });
  assert.deepEqual([tout.count, court.count, lignes(court.html)], [7, 7, 2]);
  assert.ok(court.html.includes('… et 5 autres lignes') && court.html.includes(F(22000 + 1000)) && tout.html.includes(F(22000 + 1000)));
  const ancien = A.opsPrintDoc(filtres(), { ascending: true }).html;
  assert.ok(ancien.indexOf('Octobre') < ancien.indexOf('Essence') && tout.html.indexOf('Octobre') > tout.html.indexOf('Essence'));
});

test('centre d’impression : un document par choix, un message quand le choix est incomplet', () => {
  const A = loadAt(impData(), '2026-11-27T10:00:00');
  const choix = o => ({ type: 'compte', account: 'courant', period: 'mois', year: 2026, month: 10, from: '', to: '', card: '', debit: '', date: '', filters: filtres({ search: 'paie' }), ...o });
  assert.equal(A.buildPrintDoc(choix()).title, 'Relevé courant - Novembre 2026');
  assert.equal(A.buildPrintDoc(choix({ period: 'libre', from: '2026-11-01', to: '2026-11-10' })).title, 'Relevé courant - du 01-11-2026 au 10-11-2026');
  for (const bad of [{ period: 'libre' }, { period: 'libre', from: '2026-11-10', to: '2026-11-01' }]) assert.match(A.buildPrintDoc(choix(bad)).error, /dates/);
  assert.match(A.buildPrintDoc(choix({ type: 'carte' })).error, /carte/);
  assert.match(A.buildPrintDoc(choix({ type: 'soldes' })).error, /date/);
  assert.equal(A.buildPrintDoc(choix({ type: 'soldes', date: '2026-11-27' })).title, 'Soldes des comptes au 27-11-2026');
  assert.equal(A.buildPrintDoc(choix({ type: 'liste' })).count, 1);
});

// ── Bilans à imprimer ──
const bilanData = () => ({
  accounts: [{ name: 'courant', initialBalance: 100000 }, { name: 'epargne', initialBalance: 5000, includeInTotal: false }],
  budgets: { Alimentation: 20000, Logement: 40000 },
  operations: [
    op({ id: 'paie1', account: 'courant', date: '2026-10-02', type: 'credit', amount: 200000, label: 'Paie', category: 'Revenus' }),
    op({ id: 'paie2', account: 'courant', date: '2026-11-02', type: 'credit', amount: 210000, label: 'Paie', category: 'Revenus' }),
    op({ id: 'super', account: 'courant', date: '2026-11-10', type: 'debit', amount: 15000, label: 'Super', category: 'Alimentation/Supermarché' }),
    op({ id: 'pain', account: 'courant', date: '2026-11-11', type: 'debit', amount: 9000, label: 'Pain', category: 'Alimentation', pointed: true }),
    op({ id: 'loyer', opType: 'Programmee', account: 'courant', date: '2026-10-05', nextPayment: '2026-10-05', type: 'debit', amount: 50000, label: 'Loyer', category: 'Logement' }),
    op({ id: 'futur', account: 'courant', date: '2026-11-29', type: 'debit', amount: 1000, label: 'Demain', category: 'Autre' }),
    op({ id: 'regul', opType: 'Regularisation', account: 'courant', date: '2026-11-03', type: 'credit', amount: 300, label: 'Régularisation' }),
    leg('v1', 'courant', '2026-11-20', 'debit', 'epargne', 30000), leg('v2', 'epargne', '2026-11-20', 'credit', 'courant', 30000),
  ],
});
const finDe = (A, scope, date) => A.getScopeNames(scope).reduce((s, n) => s + A.calcBalanceAsOf(n, date), 0);

test('bilan : échéances comptées, virements internes compensés, solde de début à solde de fin sans écart', () => {
  const A = loadAt(bilanData(), '2026-11-27T10:00:00');
  assert.deepEqual(A.reportRange('mois', 2026, 10), { from: '2026-11-01', to: '2026-11-27', current: true });
  assert.deepEqual(A.reportRange('mois', 2026, 9), { from: '2026-10-01', to: '2026-10-31', current: false });
  const d = A.reportData('', '2026-11-01', '2026-11-27');
  assert.deepEqual([d.income.total, d.expense.total, d.transfers, d.adjustments], [210000, 74000, 0, 300]);
  assert.deepEqual(d.expense.categories.Alimentation, { total: 24000, subs: { 'Supermarché': 15000 } });
  assert.equal(d.expense.categories.Logement.total, 50000);
  assert.equal(d.closing, finDe(A, '', '2026-11-27'));
  const un = A.reportData('courant', '2026-11-01', '2026-11-27');
  assert.deepEqual([un.transfers, un.closing], [-30000, finDe(A, 'courant', '2026-11-27')]);
  const an = A.reportData('__total', '2026-01-01', '2026-11-27');
  assert.deepEqual([an.income.total, an.expense.total, an.closing], [410000, 124000, finDe(A, '__total', '2026-11-27')]);
});

test('bilan imprimé : totaux, catégories avec part, budgets, mois par mois sur une année', () => {
  const A = loadAt(bilanData(), '2026-11-27T10:00:00');
  const mois = A.reportPrintDoc('', 'mois', 2026, 10);
  assert.equal(mois.title, 'Bilan Novembre 2026 - Tous les comptes');
  for (const text of ['(en cours)', 'Dépenses par catégorie', 'Revenus par catégorie', 'Supermarché', '68 %', 'Budgets', F(-4000), F(-10000), 'Régularisations']) assert.ok(mois.html.includes(text), text);
  assert.ok(!mois.html.includes('Mois par mois') && !mois.html.includes('Demain'));
  assert.ok(!A.reportPrintDoc('', 'mois', 2026, 10, { sub: false }).html.includes('Supermarché'));
  const an = A.reportPrintDoc('__total', 'annee', 2026, 0);
  assert.equal(an.title, 'Bilan Année 2026 - Comptes du solde total');
  assert.ok(an.html.includes('Mois par mois') && an.html.includes('budget du mois × 11') && an.html.includes(F(finDe(A, '__total', '2026-10-31'))));
  assert.match(A.reportPrintDoc('', 'mois', 2026, 11).error, /pas encore commencé/);
  const zero = loadAt({ accounts: [{ name: 'c' }], operations: [op({ id: 'z', account: 'c', date: '2026-11-02', type: 'debit', amount: 0, label: 'z' })] }, '2026-11-27T10:00:00');
  assert.ok(!zero.reportPrintDoc('', 'mois', 2026, 10).html.includes('NaN'));          // montant nul : pas de part
});

test('échéances imprimées : prochaine date, virements nommés, moyenne par mois des comptes choisis', () => {
  const data = bilanData();
  data.operations.push(op({ id: 'epar', opType: 'Programmee', account: 'courant', date: '2026-12-01', nextPayment: '2026-12-01', type: 'debit', amount: 10000, label: '[epargne]' }),
    op({ id: 'fini', opType: 'Programmee', account: 'courant', date: '2026-01-01', nextPayment: '2026-01-01', endDate: '2026-02-01', type: 'debit', amount: 7, label: 'Ancien' }));
  const A = loadAt(data, '2026-11-27T10:00:00');
  const doc = A.schedulePrintDoc('');
  assert.equal(doc.what, '2 échéances en cours');
  for (const text of ['05/12/2026', 'Loyer', 'Virement vers epargne', 'Mensuelle', '-' + F(50000)]) assert.ok(doc.html.includes(text), text);
  assert.ok(!doc.html.includes('Ancien'));
  assert.equal(A.schedulePrintDoc('epargne').what, '1 échéance en cours');
});

test('projection imprimée : un solde par fin de mois, identique à l’onglet Projection', () => {
  const A = loadAt(bilanData(), '2026-11-27T10:00:00');
  const serie = A.calcProjectionSeries('', 3, 0), doc = A.projectionPrintDoc('', 3);
  for (const v of serie.totals) assert.ok(doc.html.includes(F(v)), String(v));
  assert.ok(doc.html.includes('Février 2027') && doc.html.includes('<th class="right">courant</th>') && doc.html.includes('Sur 3 mois'));
  assert.ok(!A.projectionPrintDoc('courant', 12).html.includes('<th class="right">courant</th>'));
});

test('feuille de pointage : cases à cocher, pointées repérées, seulement les non pointées au choix', () => {
  const A = loadAt(bilanData(), '2026-11-27T10:00:00');
  const choix = o => ({ type: 'pointage', account: 'courant', period: 'mois', year: 2026, month: 10, from: '', to: '', ...o });
  const doc = A.buildPrintDoc(choix());
  assert.equal(doc.title, 'Pointage courant - Novembre 2026');
  assert.equal(doc.count, 7);
  assert.equal(doc.html.split('☑').length - 1, 1);
  assert.equal(doc.html.split('☐').length - 1, 6);
  assert.ok(doc.html.includes(F(A.calcBalanceEndOfMonth('courant', 2026, 10))) && doc.html.includes('relevé de la banque'));
  assert.equal(A.buildPrintDoc(choix(), { unpointed: true }).count, 6);
  assert.equal(A.buildPrintDoc(choix({ period: 'libre', from: '2026-11-10', to: '2026-11-11' })).count, 2);
  assert.match(A.buildPrintDoc(choix({ period: 'libre' })).error, /dates/);
});

// ── Analyses : les mêmes opérations que les soldes et le bilan ──
test('analyses : mêmes revenus et dépenses que le bilan imprimé, mois par mois et compte par compte', () => {
  const data = bilanData();
  data.accounts.push({ name: 'carte', initialBalance: 0, cardType: 'deferred', billingCycleDay: 25 });
  data.operations.push(op({ id: 'cb', account: 'carte', date: '2026-10-26', type: 'debit', amount: 4000, label: 'Essence', category: 'Transport' }),
    op({ id: 'ep', opType: 'Programmee', account: 'courant', date: '2026-10-06', nextPayment: '2026-10-06', type: 'debit', amount: 10000, label: 'Mise de côté', virementDest: 'epargne' }));
  const A = loadAt(data, '2026-11-27T10:00:00');
  for (const scope of ['', 'courant', 'epargne', 'carte']) {
    for (const month of [8, 9, 10]) {
      const f = A.calcFlowSummary(scope, ...A.statsRange(2026, month)), r = A.reportRange('mois', 2026, month), b = A.reportData(scope, r.from, r.to);
      assert.deepEqual([f.income, f.expense], [b.income.total, b.expense.total], scope + ' ' + month);
    }
  }
  assert.deepEqual(A.statsRange(2026, 10), ['2026-11-01', '2026-11-27']);
  assert.deepEqual(A.statsRange(2026, 11), ['2026-12-01', '2026-12-31']);
  assert.equal(A.calcFlowSummary('carte', ...A.statsRange(2026, 9)).expense, 0);                 // achat du 26/10 : prélevé le 25/11
  assert.equal(A.calcFlowSummary('carte', ...A.statsRange(2026, 10)).expense, 4000);
  assert.deepEqual(A.calcFlowSummary('', ...A.statsRange(2026, 9)).transfers, { 'courant → epargne': 10000 });
});

// ── Recherche ──
test('recherche : sans accents ni majuscules, mots dans tous les sens, montant exact, catégorie, mois et compte', () => {
  const A = loadAt(impData(), '2026-11-27T10:00:00');
  const ids = c => A.searchOperations(c).map(o => o.id);
  assert.deepEqual(A.searchTerms('  Fête   12 500 F '), ['fete', '12500']);
  assert.deepEqual(ids({ query: 'FETE' }), ['courses']);                                    // commentaire « Fête »
  assert.deepEqual(ids({ query: 'super courses' }), ['courses']);                         // catégorie + libellé
  assert.deepEqual(ids({ query: '15 000' }), ['courses']);
  assert.deepEqual(ids({ query: '15000f' }), ['courses']);
  assert.deepEqual(ids({ query: '1500' }), []);                                            // montant exact seulement
  assert.deepEqual(ids({ query: 'octobre' }), ['oct']);
  assert.deepEqual(ids({ query: 'virement epargne', account: 'courant' }), ['v1']);
  assert.deepEqual(ids({ query: 'programmee' }), ['loyer']);
  assert.deepEqual(ids({ period: 'mois', type: 'credit' }), ['v2', 'paie']);
  assert.deepEqual(ids({ pointed: 'oui' }), ['courses']);
  assert.ok(!ids({ pointed: 'non' }).includes('loyer') && ids({ pointed: 'non' }).length === 5);
  assert.deepEqual(A.searchRange('3mois'), { from: '2026-09-01', to: '2026-11-31' });
  assert.deepEqual(A.selectOperations(filtres({ search: 'logement loyer' })).rows.map(r => r.op.id), ['loyer']);   // l'onglet Opérations aussi
});

test('recherche : totaux (sans programmées ni virements entre comptes), groupes par mois, impression', () => {
  const A = loadAt(impData(), '2026-11-27T10:00:00');
  const tout = A.searchOperations({});
  assert.deepEqual(A.searchTotals(tout, ''), { income: 200000, expense: 23000 });
  assert.deepEqual(A.groupByMonth(tout).map(g => [g.title, g.ops.length]), [['Novembre 2026', 6], ['Octobre 2026', 1]]);
  assert.equal(A.totalsText({ income: 0, expense: 5 }), 'sorties -' + F(5));
  const doc = A.searchPrintDoc({ query: 'courses', period: 'annee' });
  assert.equal(doc.title, 'Recherche courses - 27-11-2026');
  assert.equal(doc.count, 1);
  assert.ok(doc.html.includes('Recherche : « courses » · Cette année') && doc.html.includes('-' + F(15000)));
});

// ── Projection : comptes cochés ──
test('comptes cochés : tous par défaut, périmètre reconnu, noms disparus ignorés', () => {
  const A = load(projData());
  const names = ['courant', 'epargne', 'pret'];
  assert.deepEqual(A.checkedAccounts(null, names), names);
  assert.deepEqual(A.checkedAccounts(['pret', 'courant'], names), ['courant', 'pret']);
  assert.deepEqual(A.checkedAccounts([], names), []);
  assert.deepEqual(A.checkedAccounts(['ancien'], names), names);                 // compte renommé : on revient à tous
  assert.equal(A.scopeFromChecked(names), '');
  assert.equal(A.scopeFromChecked(['courant']), '__total');
  assert.deepEqual(A.scopeFromChecked(['courant', 'epargne']), ['courant', 'epargne']);
  assert.deepEqual(A.scopeFromChecked([]), []);
  assert.deepEqual(A.pickedAccounts('total'), ['courant']);
  const html = A.accountChecksHtml(['epargne']);
  assert.ok(html.includes('value="epargne" checked') && !html.includes('value="courant" checked') && html.includes('data-pick="total"'));
});

test('projection de plusieurs comptes : somme des comptes cochés, virement entre eux neutre, impression', () => {
  const A = loadAt(projData(), '2026-11-23T10:00:00');
  const deux = A.calcProjectionSeries(['courant', 'epargne'], 3, 0), seuls = ['courant', 'epargne'].map(n => A.calcProjectionSeries(n, 3, 0));
  assert.deepEqual(deux.totals, deux.totals.map((_, i) => seuls[0].totals[i] + seuls[1].totals[i]));
  assert.deepEqual(deux.names, ['courant', 'epargne']);
  assert.ok(deux.flows[1].expense < seuls[0].flows[1].expense);                  // le virement courant → épargne ne sort plus
  const doc = A.projectionPrintDoc(['courant', 'epargne'], 3);
  assert.equal(doc.title, 'Projection courant + epargne - 23-11-2026');
  assert.ok(doc.html.includes('<th class="right">epargne</th>') && !doc.html.includes('<th class="right">pret</th>'));
  assert.match(A.buildPrintDoc({ type: 'projection', scope: [], horizon: 3 }).error, /Cochez/);
});

// ── Import du site bancaire ──
const ligneBanque = (date, label, prelevement, montant, sens = 'Débit') => ['111122******3333', date, label, prelevement, ''].join('\t') + '\n' + montant + '\nXPF\t' + sens;
const texteBanque = [
  ligneBanque('24-11-2026', 'SUPERETTE DU NORD 99 VILLEROSE', '01-01-2027', '4 180'),
  ligneBanque('23-11-2026', 'STATION ALPHA 99 VILLEBLEUE', '01-12-2026', '3 000'),
  ligneBanque('20-11-2026', 'RETRAIT GUICHET', '01-12-2026', '20 000'),
  ligneBanque('19-11-2026', 'AVOIR BOUTIQUE', '01-12-2026', '1 200', 'Crédit'),
].join('\n');
const banqueData = () => ({
  accounts: [{ name: 'carte', initialBalance: 0, cardType: 'deferred', billingCycleDay: 25 }, { name: 'courant', initialBalance: 100000 }],
  operations: [
    op({ id: 'ancien', account: 'carte', date: '2026-09-28', type: 'debit', amount: 900, label: 'SUPERETTE DU NORD 99 VILLEVERTE', category: 'Alimentation' }),
    op({ id: 'station', account: 'carte', date: '2026-11-23', type: 'debit', amount: 3000, label: 'STATION ALPHA 99 VILLEBLEUE', category: 'Transport' }),
    op({ id: 'retrait', account: 'carte', date: '2026-11-21', type: 'debit', amount: 20000, label: 'Retrait' }),
  ],
});

test('banque : lecture du texte copié (plusieurs lignes par opération) ; un autre collage n’est pas reconnu', () => {
  const A = load({ accounts: [], operations: [] });
  const ops = A.parseBankText(texteBanque);
  assert.equal(ops.length, 4);
  assert.deepEqual(ops[0], { card: '111122******3333', date: '2026-11-24', label: 'SUPERETTE DU NORD 99 VILLEROSE', debitDate: '2027-01-01', amount: 4180, type: 'debit' });
  assert.deepEqual([ops[3].type, ops[3].amount], ['credit', 1200]);
  assert.deepEqual(A.parseBankText('Date\tLibellé\tDébit\tCrédit\n24/11/2026\tAchat\t4 180\t\n23/11/2026\tPaie\t\t200 000'), []);
});

test('banque : jour d’arrêté et de prélèvement retrouvés ; l’ancienne règle ne change pas', () => {
  const A = load({ accounts: [], operations: [] });
  const ops = A.parseBankText(texteBanque);
  assert.deepEqual(A.inferCardRule(ops), { cut: 24, debitDay: 1 });
  assert.equal(A.inferCardRule(ops.slice(1)), null);                                  // une seule période : on ne devine pas
  assert.deepEqual(['2026-11-23', '2026-11-24', '2026-12-23'].map(d => A.billingDebitDate(d, 24, 0, 1)), ['2026-12-01', '2027-01-01', '2027-01-01']);
  assert.deepEqual(['2026-11-10', '2026-11-25'].map(d => A.billingDebitDate(d, 25)), ['2026-11-25', '2026-12-25']);
});

test('banque : déjà saisie (à quelques jours près), échéance programmée ou nouvelle avec la catégorie habituelle', () => {
  const A = loadAt(banqueData(), '2026-11-28T10:00:00');
  const rows = A.matchBankOps(A.parseBankText(texteBanque), 'carte');
  assert.deepEqual(rows.map(r => [r.status, r.match ? r.match.id : r.category]), [['new', 'Alimentation'], ['known', 'station'], ['known', 'retrait'], ['new', 'Autre']]);
  const B = loadAt({ accounts: [{ name: 'courant' }], operations: [op({ id: 'abo', opType: 'Programmee', account: 'courant', date: '2026-09-05', nextPayment: '2026-09-05', type: 'debit', amount: 3712, label: 'Abonnement' })] }, '2026-11-28T10:00:00');
  const due = B.matchBankOps([{ date: '2026-11-07', label: 'OPT', debitDate: null, amount: 3712, type: 'debit' }], 'courant')[0];
  assert.deepEqual([due.status, due.match.id, due.monthKey], ['scheduled', 'abo', '2026-11']);
  const undo = B.applyBankImport([due], 'courant', null);
  assert.equal(B.getMonthOps('courant', 2026, 10).length, 1);                          // pas de doublon avec l'échéance
  B.undoBankImport(undo);
  assert.deepEqual(B.getMonthOps('courant', 2026, 10).map(o => o.id), ['abo']);
});

test('banque : import avec les dates de prélèvement, carte réglée comme la banque, annulation exacte', () => {
  const A = loadAt(banqueData(), '2026-11-28T10:00:00');
  const avant = JSON.stringify(A.getData());
  const ops = A.parseBankText(texteBanque);
  const undo = A.applyBankImport(A.matchBankOps(ops, 'carte'), 'carte', A.inferCardRule(ops));
  const d = A.getData(), carte = d.accounts[0], par = id => d.operations.find(o => o.id === id);
  assert.deepEqual([carte.billingCycleDay, carte.billingDebitDay, carte.debitRuleFrom], [24, 1, '2026-11-19']);       // à partir du premier achat collé
  assert.equal(d.operations.length, 5);
  assert.deepEqual([par('station'), par('retrait')].map(o => [o.pointed, A.bankDate(o), A.balanceDate(o)]), [[true, '2026-12-01', '2026-11-30'], [true, '2026-12-01', '2026-11-30']]);
  assert.equal(A.balanceDate(par('ancien')), '2026-10-25');                            // le passé garde l'ancienne règle
  assert.equal(A.balanceDate(op({ account: 'carte', date: '2026-11-26' })), '2026-12-31');   // saisie à la main : même règle que la banque
  assert.equal(A.balanceDate(op({ account: 'carte', date: '2026-12-01', debitDate: '2026-12-01' })), '2026-12-01');   // payé le jour même : pas de décalage
  assert.equal(A.balanceDate(op({ account: 'courant', date: '2026-11-26', debitDate: '2026-12-01' })), '2026-12-01'); // autres comptes : inchangés
  assert.equal(A.calcBillingBalance('carte'), 4180);
  assert.deepEqual(A.pendingDebit('carte'), { debit: '2026-12-01', total: 21800, count: 3 });
  assert.deepEqual(A.cardStatementRange('carte', '2026-12-01'), { start: '2026-10-24', end: '2026-11-23', current: false });
  assert.deepEqual(A.cardStatementRange('carte', '2027-01-01'), { start: '2026-11-24', end: '2026-11-28', current: true });
  assert.equal(A.matchBankOps(ops, 'carte').filter(r => r.status === 'known').length, 4);      // recoller ne crée aucun doublon
  A.undoBankImport(undo);
  const apres = JSON.parse(JSON.stringify(A.getData())); delete apres.deletedIds;
  assert.deepEqual(apres, JSON.parse(avant));
});

test('banque : sans changer le réglage de la carte, la date de prélèvement de la banque est gardée sur chaque achat', () => {
  const A = loadAt(banqueData(), '2026-11-28T10:00:00');
  A.applyBankImport(A.matchBankOps(A.parseBankText(texteBanque), 'carte'), 'carte', null);
  const d = A.getData();
  assert.equal(d.accounts[0].billingCycleDay, 25);
  assert.deepEqual(['station', 'retrait'].map(id => d.operations.find(o => o.id === id).debitDate), ['2026-12-01', '2026-12-01']);
});

test('mois d’un compte : les achats faits ce mois et comptés plus tard restent visibles à part (écran et impression)', () => {
  const A = loadAt(banqueData(), '2026-11-28T10:00:00');
  A.applyBankImport(A.matchBankOps(A.parseBankText(texteBanque), 'carte'), 'carte', A.inferCardRule(A.parseBankText(texteBanque)));
  const v = A.selectOperations(filtres({ account: 'carte' }));
  assert.deepEqual(v.rows.map(r => r.op.date), ['2026-11-19', '2026-11-21', '2026-11-23']);   // prélevés le 01/12 : comptés en novembre
  assert.deepEqual(v.deferred.map(o => o.date), ['2026-11-24']);                              // prélevé le 01/01 : compté en décembre
  const doc = A.opsPrintDoc(filtres({ account: 'carte' }));
  assert.ok(doc.html.includes('comptées plus tard') && doc.html.includes('SUPERETTE DU NORD') && doc.html.includes('prélevé le 01/12/2026'));
  assert.deepEqual(A.deferredOps('courant', 2026, 10), []);
});

test('saisie : opération déjà saisie ou déjà programmée signalée, sans alerte pour les petits achats répétés', () => {
  const A = loadAt({ accounts: [{ name: 'courant' }, { name: 'carte' }, { name: 'epargne' }], operations: [
    op({ id: 'canape', account: 'carte', date: '2026-11-18', type: 'debit', amount: 20000, label: 'Canape' }),
    op({ id: 'station', account: 'carte', date: '2026-11-16', type: 'debit', amount: 7340, label: 'STATION BETA 99 VILLEBLEUE' }),
    op({ id: 'pain', account: 'carte', date: '2026-11-20', type: 'debit', amount: 500, label: 'Boulangerie' }),
    op({ id: 'elec', opType: 'Programmee', account: 'courant', date: '2026-09-15', nextPayment: '2026-09-15', type: 'debit', amount: 11400, label: 'Elec - Abonnement' }),
    op({ id: 'mise', opType: 'Programmee', account: 'courant', date: '2026-09-06', nextPayment: '2026-09-06', type: 'debit', amount: 30000, label: '[epargne]' }),
    leg('v', 'courant', '2026-11-10', 'debit', 'epargne', 7000),
  ] }, '2026-11-28T10:00:00');
  const dup = o => A.findDuplicates({ account: 'carte', type: 'debit', ...o }).map(x => x.id);
  assert.deepEqual(dup({ date: '2026-11-17', amount: 20000, label: 'MOBILIER SAS' }), ['canape']);           // gros montant, un jour d'écart
  assert.deepEqual(dup({ date: '2026-11-18', amount: 7340, label: 'Essence' }), ['station']);             // montant précis, deux jours
  assert.deepEqual(dup({ date: '2026-11-22', amount: 500, label: 'Cafe' }), []);                           // petit montant rond, autre jour
  assert.deepEqual(dup({ date: '2026-11-22', amount: 500, label: 'boulangerie' }), ['pain']);             // même commerçant
  assert.deepEqual(dup({ date: '2026-11-16', amount: 7340, label: 'x', account: 'courant' }), []);       // autre compte
  assert.deepEqual(dup({ date: '2026-11-20', amount: 7340, label: 'STATION BETA' }), []);                // quatre jours
  const due = o => A.findDueDuplicate({ account: 'courant', type: 'debit', ...o })?.id.replace(/_credit$/, '') || null;
  assert.equal(due({ date: '2026-11-18', amount: 11400, label: 'electricite' }), 'elec');                  // montant précis
  assert.equal(due({ date: '2026-11-17', amount: 11950, label: 'Elec novembre' }), 'elec');                 // même fournisseur, montant proche
  assert.equal(due({ date: '2026-11-28', amount: 11400, label: 'Elec' }), null);                            // trop loin de l'échéance
  assert.deepEqual(A.checkOperationRisks({ account: 'courant', type: 'debit', date: '2026-11-15', amount: 11400, label: 'Elec' }, '2026-11-28').map(w => w.code), ['scheduled']);
  assert.deepEqual(A.checkTransferRisks('courant', 'epargne', 7000, '2026-11-12', '2026-11-28').map(w => w.code), ['duplicate']);
  assert.deepEqual(A.checkTransferRisks('courant', 'epargne', 30000, '2026-11-07', '2026-11-28').map(w => w.code).filter(c => c !== 'negative'), ['scheduled']);
  assert.match(A.entryDuplicateHint({ account: 'carte', type: 'debit', date: '2026-11-16', amount: 7340, label: '' }), /Déjà saisie.*à cette date/);
  assert.equal(A.entryDuplicateHint({ account: 'carte', type: 'debit', date: '2026-11-16', amount: null, label: '' }), '');
});

test('encours des cartes : plafond restant sous chaque paiement, carte par carte', () => {
  const A = load({ accounts: [{ name: 'cb1', cardType: 'deferred', cardLimit: 1000 }, { name: 'cb2', cardType: 'deferred' }], operations: [
    op({ id: 'c', account: 'cb1', date: '2026-11-20', type: 'debit', amount: 700, label: 'c' }),
    op({ id: 'a', account: 'cb1', date: '2026-11-01', type: 'debit', amount: 200, label: 'a' }),
    op({ id: 'x', account: 'cb2', date: '2026-11-02', type: 'debit', amount: 50, label: 'sans plafond' }),
    op({ id: 'b', account: 'cb1', date: '2026-11-10', type: 'debit', amount: 400, label: 'b' }),
  ] });
  const e = A.getCardsEncours(new Date(2026, 10, 23));
  assert.deepEqual(e.rows.map(r => [r.op.id, r.left]), [['a', 800], ['x', null], ['b', 400], ['c', -300]]);
  assert.equal(A.encoursLeftHtml(null, 0), '');
  assert.match(A.encoursLeftHtml(800, 1000), /Plafond restant[\s\S]*var\(--accent\)[\s\S]*800/);
  assert.match(A.encoursLeftHtml(400, 1000), /#ef9f27/);
  assert.match(A.encoursLeftHtml(-300, 1000), /Plafond dépassé de[\s\S]*var\(--danger\)[\s\S]*>300/);
});

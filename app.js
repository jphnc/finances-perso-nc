// La bibliothèque de connexion Google n'a pas pu se charger (hors ligne, bloquée) : l'application continue sans elle
window.addEventListener('error', (e) => { if (e.target && e.target.id === 'gsi-script') window.gsiFailed = true; }, true);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
}

const CLIENT_ID = '619213518527-fnhgngfn15alhkhnpiq8mnock1jpqbfa.apps.googleusercontent.com';
const SCOPES    = 'https://www.googleapis.com/auth/drive.file';
const FILE_NAME = 'comptes_data.json';

let tokenClient = null;
let accessToken  = null;
let driveFileId  = null;
let activeAccount = '';  // '' = tous les comptes

const defaultData = {
  version: 2,
  lastSync: null,
  accounts: [],
  operations: [],
  recurring: [],
};
let appData = structuredClone(defaultData);

// ── UTILITAIRES ─────────────────────────────────────────────────────────────
const fmt = (n) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' F';
const today = () => localDateStr(new Date());
const uid   = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Lit un montant saisi : entier strictement positif, sinon null (formulaires → refus + message).
function parseAmount(raw) {
  const s = String(raw === null || raw === undefined ? '' : raw).trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(parseFloat(s));
  return n > 0 && Number.isSafeInteger(n) ? n : null;
}

// Échappe le texte utilisateur avant insertion dans le HTML (protection XSS)
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('with-act');
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), duration);
}
// Message avec un bouton d'action (ex. « Annuler » juste après un enregistrement).
function toastAction(msg, label, onClick, duration = 7000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'toast-act';
  b.textContent = label;
  b.addEventListener('click', () => { clearTimeout(toast._t); el.classList.add('hidden'); onClick(); });
  el.appendChild(b);
  el.classList.add('with-act');
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), duration);
}
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
function showTab(name) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => { b.classList.remove('active'); b.removeAttribute('aria-current'); });
  document.getElementById('tab-' + name).classList.add('active');
  const btn = document.querySelector(`[data-tab="${name}"]`);
  btn.classList.add('active');
  btn.setAttribute('aria-current', 'page');
  window.scrollTo(0, 0); // on arrive toujours en haut du nouvel onglet
}

// ── MOT DE PASSE ────────────────────────────────────────────────────────────
async function hashPassword(pwd) {
  const data = new TextEncoder().encode(pwd);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getPwdHash() {
  return (appData && appData.pwdHash) || localStorage.getItem('finances_pwd') || null;
}

function checkLockScreen() {
  if (getPwdHash()) {
    showScreen('screen-lock');
    document.getElementById('lock-password').focus();
    return true;
  }
  return false;
}

document.getElementById('btn-unlock').addEventListener('click', async () => {
  const pwd = document.getElementById('lock-password').value;
  if (!pwd) return;
  const hash = await hashPassword(pwd);
  const stored = getPwdHash();
  if (hash === stored) {
    unlocked = true;
    document.getElementById('lock-password').value = '';
    document.getElementById('lock-error').classList.add('hidden');
    const hasData = loadLocal();
    if (hasData) {
      autoBackup();
      renderAll();
      showScreen('screen-main');
    } else {
      showScreen('screen-login');
    }
    if (damagedData) { startAfterDamage(); return; }
    // Google : synchro silencieuse si un jeton valide existe, sinon proposition de connexion
    initConnectionAtStartup();
  } else {
    document.getElementById('lock-error').textContent = 'Mot de passe incorrect';
    document.getElementById('lock-error').classList.remove('hidden');
  }
});

document.getElementById('lock-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-unlock').click();
});

document.getElementById('btn-pwd-set').addEventListener('click', async () => {
  const pwd = document.getElementById('cfg-pwd-new').value;
  const confirm = document.getElementById('cfg-pwd-confirm').value;
  if (!pwd) { toast('⚠️ Mot de passe requis'); return; }
  if (pwd !== confirm) { toast('⚠️ Les mots de passe ne correspondent pas'); return; }
  if (pwd.length < 4) { toast('⚠️ Minimum 4 caractères'); return; }
  const hash = await hashPassword(pwd);
  appData.pwdHash = hash;
  setPref('finances_pwd', hash);
  saveLocal();
  document.getElementById('cfg-pwd-new').value = '';
  document.getElementById('cfg-pwd-confirm').value = '';
  updatePwdStatus();
  if (accessToken) {
    try {
      await uploadToDrive();
      toast('🔒 Mot de passe enregistré ET synchronisé sur Drive');
    } catch (e) {
      toast('🔒 Enregistré localement, mais erreur Drive : ' + e.message);
    }
  } else {
    toast('🔒 Enregistré localement — connectez-vous à Drive (🔄) pour le synchroniser');
  }
});

document.getElementById('btn-pwd-remove').addEventListener('click', () => {
  if (!confirm('Supprimer le mot de passe ?')) return;
  delete appData.pwdHash;
  localStorage.removeItem('finances_pwd');
  saveLocal();
  updatePwdStatus();
  toast('🔓 Mot de passe supprimé');
  if (accessToken) uploadToDrive().catch(() => {});
});

document.getElementById('balance-date-picker').addEventListener('change', (e) => {
  dashboardBalanceDate = e.target.value || null;
  renderDashboard();
});
document.getElementById('btn-balance-date-today').addEventListener('click', () => {
  dashboardBalanceDate = null;
  document.getElementById('balance-date-picker').value = today();
  renderDashboard();
});
// « Jour du solde » dans la carte bleue : aujourd'hui, fin de mois, ou un jour du mois en cours (le calendrier sous la carte reste
// disponible pour une autre date) ; comme « Solde au », ce choix n'est pas mémorisé : l'application s'ouvre toujours sur aujourd'hui
(function initBalanceDay() {
  const sel = document.getElementById('balance-day');
  if (!sel) return;
  sel.innerHTML = '<option value="">Aujourd\'hui</option><option value="end">Fin de mois</option>'
    + Array.from({ length: 30 }, (_, i) => `<option value="${i + 1}">Le ${i === 0 ? '1er' : i + 1}</option>`).join('')
    + '<option value="custom" disabled hidden>Autre date</option>';
  sel.addEventListener('change', () => {
    if (sel.value === 'custom') return;
    dashboardBalanceDate = balanceDayDate(sel.value, today());
    document.getElementById('balance-date-picker').value = dashboardBalanceDate || today();
    renderDashboard();
  });
})();

function updatePwdStatus() {
  const localPwd = !!localStorage.getItem('finances_pwd');
  const drivePwd = !!(appData && appData.pwdHash);
  const has = localPwd || drivePwd;
  const driveCon = accessToken ? '✅ connecté' : '❌ non connecté';
  document.getElementById('pwd-status').innerHTML = `
    <div>Drive : ${driveCon}</div>
    <div>Mot de passe local : ${localPwd ? '✅' : '❌'}</div>
    <div>Mot de passe sur Drive : ${drivePwd ? '✅' : '❌ (pas encore synchronisé)'}</div>`;
  document.getElementById('btn-pwd-remove').style.display = has ? '' : 'none';
}

// ── STOCKAGE LOCAL ───────────────────────────────────────────────────────────
// Écrit un réglage sans jamais interrompre l'action en cours (mémoire pleine, stockage refusé)
function setPref(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}
let storageFull = false;      // la dernière écriture des données a échoué
// Enregistre les données sur l'appareil. Si la place manque, on le dit clairement : jamais d'échec silencieux.
function writeData() {
  const text = JSON.stringify(appData);
  const write = () => {
    try { localStorage.setItem('finances_data', text); return true; }
    catch (e) { console.warn('Enregistrement impossible :', e.message); return false; }
  };
  let saved = write();
  // les données passent avant les copies de secours restées dans le même petit stockage
  if (!saved && localStorage.getItem('finances_backups')) {
    localStorage.removeItem('finances_backups');
    saved = write();
  }
  const first = !saved && !storageFull;
  storageFull = !saved;
  if (saved) return true;
  // l'appareil garde une version ancienne : la prochaine synchronisation devra relire Drive avant d'envoyer
  localStorage.removeItem('finances_driverev');
  if (first) alert('⚠️ La mémoire de l’appareil est pleine : la dernière modification n’est PAS enregistrée sur cet appareil.\n\nNe fermez pas l’application : connectez-vous à Google Drive, ou utilisez Paramètres › Sauvegardes › Télécharger.');
  else toast('⚠️ Mémoire pleine : modification non enregistrée sur cet appareil', 6000);
  return false;
}

// touch=true (défaut) → horodate la version des données (modification utilisateur)
// touch=false → conserve l'horodatage existant (ex: après téléchargement depuis Drive)
function saveLocal(touch = true) {
  if (touch) {
    const now = new Date();
    let before = null;
    try { before = JSON.parse(localStorage.getItem('finances_data')); } catch { /* illisible : rien à comparer */ }
    stampChanges(appData, before, now.getTime());
    appData.lastSync = now.toISOString();
    appData.lastSyncLocal = now.toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' });
  }
  const saved = writeData();
  // Modification locale pas encore confirmée par Drive : on s'en souvient jusqu'à l'envoi réussi
  if (touch) { setPref('finances_pending', '1'); updateConnBadge(); }
  // Auto-upload vers Drive si connecté (silencieux, pas de popup) : Drive est toujours relu avant l'envoi
  if (touch && accessToken) uploadToDrive().catch(() => {});
  scheduleDirBackup();
  return saved;
}

// Supprime des opérations ET garde une trace (id → date) pour que la fusion avec Drive
// ne les ressuscite pas depuis un autre appareil.
function dropOps(keep) {
  const removed = appData.operations.filter(o => !keep(o));
  if (!removed.length) return 0;
  appData.operations = appData.operations.filter(keep);
  if (!appData.deletedIds) appData.deletedIds = {};
  const t = new Date().toISOString();
  for (const o of removed) appData.deletedIds[o.id] = t;
  return removed.length;
}

// ── RÉUNION DE DEUX VERSIONS DES DONNÉES ─────────────────────────────────────
// Texte d'une valeur indépendant de l'ordre des champs, pour comparer deux versions
function stableText(value) {
  return JSON.stringify(value, (k, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(key => [key, v[key]])) : v);
}
// Contenu d'une opération ou d'un compte, sans son heure de modification
function recordText({ updatedAt, ...rest }) {
  return stableText(rest);
}
function isEmptyValue(v) {
  return v === undefined || v === null || (typeof v === 'object' && !Object.keys(v).length);
}
// Réglages : tout ce qui n'est ni une opération, ni un compte, ni une information de suivi
function settingKeys(...versions) {
  const skip = ['version', 'operations', 'accounts', 'deletedIds', 'deletedAccounts', 'keyTimes', 'lastSync', 'lastSyncLocal'];
  return [...new Set(versions.flatMap(v => Object.keys(v)))].filter(k => !skip.includes(k));
}
// Note l'heure de modification de ce qui a changé depuis le dernier enregistrement : quand deux versions sont réunies,
// c'est la modification la plus récente de chaque élément qui est gardée.
function stampChanges(data, before, now) {
  if (!before || !Array.isArray(before.operations)) return;
  for (const [list, key] of [['operations', 'id'], ['accounts', 'name']]) {
    const old = new Map((before[list] || []).map(x => [x[key], x]));
    for (const x of data[list] || []) {
      const o = old.get(x[key]);
      if (!o || (JSON.stringify(o) !== JSON.stringify(x) && recordText(o) !== recordText(x))) x.updatedAt = now;
    }
  }
  const text = v => (isEmptyValue(v) ? '' : stableText(v));
  for (const k of settingKeys(data, before)) {
    if (text(data[k]) !== text(before[k])) data.keyTimes = { ...data.keyTimes, [k]: now };
  }
}
// Empreinte du contenu (sans les dates d'enregistrement) : deux versions identiques ne sont ni renvoyées ni rechargées
function dataSignature(data) {
  const sorted = (list, key) => [...(list || [])].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
  const settings = settingKeys(data).filter(k => !isEmptyValue(data[k])).map(k => [k, data[k]]);
  return stableText([sorted(data.operations, 'id'), sorted(data.accounts, 'name'),
    Object.keys(data.deletedIds || {}).sort(), Object.keys(data.deletedAccounts || {}).sort(), Object.fromEntries(settings)]);
}
// Un fichier de données exploitable (Drive, autre fenêtre, restauration) : sinon on ne touche à rien
function isValidData(d) {
  return !!d && typeof d === 'object' && Array.isArray(d.operations) && Array.isArray(d.accounts)
    && d.accounts.every(a => !!a && typeof a.name === 'string')
    && d.operations.every(o => !!o && o.id !== undefined && o.id !== null && typeof o.account === 'string' && typeof o.date === 'string');
}
// Les champs techniques d'une donnée venue de l'extérieur (Drive, fichier, mémoire de l'appareil) reprennent leur forme
// normale : rien de piégé ne peut s'y cacher. Les textes saisis (libellés, noms, commentaires) restent tels quels : ils
// sont neutralisés à l'affichage.
function cleanData(data) {
  const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const toNumber = (x, k) => { if (x[k] !== undefined && x[k] !== null && !Number.isFinite(x[k])) x[k] = Number.isFinite(Number(x[k])) ? Number(x[k]) : 0; };
  const dropBadDate = (x, k) => { if (x[k] && !isDate(x[k])) delete x[k]; };
  for (const o of data.operations) {
    if (!/^[\w-]+$/.test(o.id)) o.id = String(o.id).replace(/[^\w-]/g, '_');
    if (!isDate(o.date)) o.date = String(o.date || '').replace(/[^\d-]/g, '').slice(0, 10);
    if (o.type !== 'credit' && o.type !== 'debit') o.type = 'debit';
    toNumber(o, 'amount');
    toNumber(o, 'billingShift');
    for (const k of ['nextPayment', 'endDate', 'debitDate', 'lastPayment']) dropBadDate(o, k);
    if (o.exceptions !== undefined) o.exceptions = (Array.isArray(o.exceptions) ? o.exceptions : []).filter(m => /^\d{4}-\d{2}$/.test(m));
  }
  for (const a of data.accounts || []) {
    for (const k of ['initialBalance', 'cardLimit', 'billingCycleDay', 'billingDebitDay', 'previousCycleDay']) toNumber(a, k);
    dropBadDate(a, 'debitRuleFrom');
  }
  for (const group of [data.budgets, data.alerts]) {
    for (const [name, v] of Object.entries(group || {})) {
      if (v === '' || !Number.isFinite(Number(v))) delete group[name]; else group[name] = Number(v);
    }
  }
  for (const [name, v] of Object.entries(data.catColors || {})) if (!/^#[0-9a-fA-F]{3,8}$/.test(v)) delete data.catColors[name];
  for (const [name, v] of Object.entries(data.catIcons || {})) if (typeof v !== 'string' || v.length > 16 || /[<>"'&]/.test(v)) delete data.catIcons[name];
  return data;
}
// Réunion de deux versions (appareil et Drive, ou deux fenêtres) : rien ne se perd.
//  - opérations et comptes : réunis un par un ; modifiés des deux côtés, la modification la plus récente gagne
//    (à égalité : celle du fichier le plus récent) ; une suppression l'emporte sur les versions plus anciennes qu'elle ;
//  - réglages (budgets, alertes, catégories, mot de passe…) : le réglage modifié le plus récemment gagne.
function mergeAppData(local, remote) {
  const lt = Date.parse(local.lastSync) || 0, rt = Date.parse(remote.lastSync) || 0;
  const newer = lt >= rt ? local : remote;
  const older = newer === local ? remote : local;
  const limit = Date.now() - 730 * 86400000;
  const tombstones = field => {
    const out = {};
    for (const src of [older[field] || {}, newer[field] || {}]) {
      for (const [k, t] of Object.entries(src)) {
        const when = Date.parse(t) || 0;
        if (when > limit && when >= (Date.parse(out[k]) || 0)) out[k] = t;
      }
    }
    return out;
  };
  // l'ordre de la version « local » est gardé, les éléments qui lui manquent sont ajoutés à la suite
  const unite = (list, key) => {
    const byKey = new Map((local[list] || []).map(x => [x[key], x]));
    for (const r of remote[list] || []) {
      const l = byKey.get(r[key]);
      const mine = (l && l.updatedAt) || 0, theirs = r.updatedAt || 0;
      // identiques : l'objet de l'appareil est conservé (une fenêtre ouverte peut être en train de le modifier)
      if (!l || theirs > mine || (theirs === mine && newer === remote && JSON.stringify(l) !== JSON.stringify(r))) byKey.set(r[key], r);
    }
    return [...byKey.values()];
  };
  // supprimé : sauf si l'élément a été modifié (ou rétabli) après la suppression
  const alive = (x, tombs, k) => {
    if (!tombs[k]) return true;
    if ((x.updatedAt || 0) <= Date.parse(tombs[k])) return false;
    delete tombs[k];
    return true;
  };
  const deletedIds = tombstones('deletedIds'), deletedAccounts = tombstones('deletedAccounts');
  const operations = unite('operations', 'id').filter(o => alive(o, deletedIds, o.id));
  const used = new Set(operations.map(o => o.account));
  const recent = new Set((newer.accounts || []).map(a => a.name));
  const accounts = unite('accounts', 'name').filter(a => {
    if (used.has(a.name)) { delete deletedAccounts[a.name]; return true; }       // un compte qui a des opérations est gardé
    if (deletedAccounts[a.name]) return alive(a, deletedAccounts, a.name);
    return recent.has(a.name) || !!a.updatedAt;
  });

  const merged = { ...newer, operations, accounts, deletedIds };
  const keyTimes = {};
  for (const k of settingKeys(local, remote)) {
    const mine = (local.keyTimes || {})[k] || 0, theirs = (remote.keyTimes || {})[k] || 0;
    let from = mine > theirs ? local : remote;
    if (mine === theirs) from = isEmptyValue(newer[k]) ? older : newer;       // un réglage vide n'efface pas l'autre
    if (from[k] === undefined) delete merged[k]; else merged[k] = from[k];
    if (mine || theirs) keyTimes[k] = Math.max(mine, theirs);
  }
  if (Object.keys(keyTimes).length) merged.keyTimes = keyTimes;
  if (Object.keys(deletedAccounts).length) merged.deletedAccounts = deletedAccounts; else delete merged.deletedAccounts;
  return merged;
}
let damagedData = null;      // texte illisible trouvé dans la mémoire de l'appareil
function loadLocal() {
  const raw = localStorage.getItem('finances_data');
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.operations) || !data.operations.every(o => o && typeof o === 'object')) throw new Error('forme inattendue');
    if (!Array.isArray(data.accounts)) data.accounts = [];
    appData = cleanData(data);
    return true;
  } catch (e) {
    console.warn('Données de l’appareil illisibles :', e.message);
    damagedData = raw;
    return false;
  }
}
// Données illisibles : on le dit, on garde le texte abîmé à part, et on propose la dernière copie de secours utilisable
async function recoverDamagedData() {
  if (!damagedData) return false;
  const raw = damagedData;
  damagedData = null;
  await deviceDbRun('readwrite', s => s.put(raw, 'damaged')).catch(() => {});
  const readable = b => { try { return isValidData(JSON.parse(b.data)); } catch { return false; } };
  const backup = (await readBackups()).reverse().find(readable);
  if (!backup) {
    alert('⚠️ Les données de cet appareil sont illisibles et il n’y a pas de copie de secours.\n\nConnectez-vous à Google Drive pour les retrouver, ou restaurez un fichier de sauvegarde (Paramètres › Sauvegardes).');
    return false;
  }
  if (!confirm(`⚠️ Les données de cet appareil sont illisibles.\n\nReprendre la copie de secours du ${backup.date} (${backup.ops} opérations) ?\n\n« Annuler » : continuer sans, puis vous connecter à Google Drive.`)) return false;
  appData = cleanData(JSON.parse(backup.data));
  localStorage.removeItem('finances_driverev');          // la prochaine synchronisation réunira cette copie avec Drive
  saveLocal(false);
  return true;
}
// Suite du démarrage quand les données étaient illisibles : récupération, puis connexion
async function startAfterDamage() {
  if (await recoverDamagedData()) {
    unlocked = true;
    renderAll();
    showScreen('screen-main');
  }
  initConnectionAtStartup();
}

// ── GOOGLE AUTH ──────────────────────────────────────────────────────────────
// Jeton Google enregistré, seulement s'il n'a pas expiré (durée de vie ~1 h)
function getSavedToken() {
  const t = localStorage.getItem('gToken');
  const exp = parseInt(localStorage.getItem('gTokenExp') || '0', 10);
  return t && exp > Date.now() ? t : null;
}
function initGoogleAuth() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: onTokenReceived,
    // fenêtre fermée, bloquée par le navigateur… (les refus d'autorisation arrivent par `callback`)
    error_callback: (err) => onConnectionFailed(err && err.type),
  });
}
let unlocked = false;
function onTokenReceived(resp) {
  if (!resp || resp.error || !resp.access_token) { onConnectionFailed(resp && resp.error); return; }
  accessToken = resp.access_token;
  setPref('gToken', accessToken);
  setPref('gTokenExp', String(Date.now() + ((resp.expires_in || 3600) - 60) * 1000));
  closeConnectModal();
  updateConnBadge();
  toast('☁️ Connecté à Google Drive');
  syncFromDrive();
}
// La connexion n'a pas abouti (fenêtre fermée, accès refusé, fenêtre bloquée…) : l'application continue SANS connexion.
function onConnectionFailed(reason) {
  closeConnectModal();
  try { sessionStorage.setItem('finances_skip_connect', '1'); } catch { /* ignoré */ }
  const why = {
    popup_closed: 'Connexion annulée',
    access_denied: 'Accès refusé',
    popup_failed_to_open: 'Fenêtre de connexion bloquée par le navigateur',
  }[reason] || 'La connexion n\'a pas abouti';
  toast(`☁️ ${why} — l'application fonctionne sans connexion`, 5000);
  updateConnBadge();
}
// Ouvre la fenêtre de connexion Google. À appeler depuis un geste de l'utilisateur (clic, toucher) :
// sinon le navigateur bloque la fenêtre. Renvoie false si Google n'est pas disponible.
function startGoogleConnection() {
  if (typeof google === 'undefined' || !google.accounts) {
    toast(window.gsiFailed || !navigator.onLine
      ? '☁️ Google est indisponible (hors ligne ?) — l\'application fonctionne sans connexion'
      : '☁️ Google se charge encore, réessayez dans un instant', 5000);
    return false;
  }
  try {
    if (!tokenClient) initGoogleAuth();
    tokenClient.requestAccessToken({ prompt: '' });
    return true;
  } catch (e) {
    onConnectionFailed('unknown');
    return false;
  }
}
document.getElementById('btn-login').addEventListener('click', () => { startGoogleConnection(); });

// ── INSTALLATION DE L'APP (PWA) ──────────────────────────────────────────────
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const btn = document.getElementById('btn-install-app');
  if (btn) btn.classList.remove('hidden');
});

window.addEventListener('appinstalled', () => {
  const btn = document.getElementById('btn-install-app');
  if (btn) btn.classList.add('hidden');
  toast('✅ Application installée !');
});

document.getElementById('btn-install-app').addEventListener('click', async () => {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') toast('✅ Installation lancée');
    deferredInstallPrompt = null;
    document.getElementById('btn-install-app').classList.add('hidden');
  }
});

function checkInstallState() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const btn = document.getElementById('btn-install-app');
  const hint = document.getElementById('install-hint');
  if (isStandalone) {
    // Déjà installée : ne rien afficher
    return;
  }
  if (isIOS) {
    // iOS Safari ne supporte pas beforeinstallprompt : montrer les instructions
    btn.classList.add('hidden');
    hint.classList.remove('hidden');
    hint.innerHTML = '📲 <b>Installer sur iPhone</b> : touchez le bouton Partager (⬆️) en bas de Safari, puis « Sur l\'écran d\'accueil ».';
  } else if (!deferredInstallPrompt) {
    // Android : si le navigateur n'a pas encore proposé, donner l'astuce manuelle
    hint.classList.remove('hidden');
    hint.innerHTML = '📲 <b>Installer</b> : ouvrez le menu ⋮ du navigateur (en haut ou en bas à droite) puis « Installer l\'application » ou « Ajouter à l\'écran d\'accueil ».';
  }
}

// Sauvegarde quand l'app se ferme ou passe en arrière-plan
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && backupDirHandle && appData.operations.length) {
    autoBackupToDir();
  }
});

// Re-synchronise automatiquement quand la connexion revient
window.addEventListener('online', () => {
  toast('🌐 Connexion rétablie');
  updateSyncStatus();
});
window.addEventListener('offline', () => {
  toast('📴 Hors ligne — vos modifications sont sauvegardées localement');
  updateSyncStatus();
});
document.getElementById('btn-skip-login').addEventListener('click', () => {
  showScreen('screen-main');
  if (loadLocal()) renderAll();
});
window.addEventListener('load', () => {
  const hasData = loadLocal();
  if (localStorage.getItem('finances_backups')) storeBackups([]);   // libère la place prise par les anciennes copies
  const locked = checkLockScreen();
  if (!locked) {
    if (hasData) {
      unlocked = true;
      autoBackup();
      renderAll();
      showScreen('screen-main');
    }
  }
  setDefaultDate();
  updatePwdStatus();
  checkInstallState();
  initBackupDir();
  initBackground();
  initCardColor();

  updateConnBadge();
  if (locked) return;
  if (damagedData) { startAfterDamage(); return; }
  // Google : synchro silencieuse si un jeton valide existe, sinon proposition de connexion
  initConnectionAtStartup();
});

// ── GOOGLE DRIVE ─────────────────────────────────────────────────────────────
async function driveRequest(method, url, body = null) {
  const opts = { method, headers: { Authorization: 'Bearer ' + accessToken } };
  if (body !== null) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (res.status === 401) {
    accessToken = null; localStorage.removeItem('gToken'); localStorage.removeItem('gTokenExp');
    updateConnBadge();
    throw new Error('Connexion Google expirée — touchez la pastille « Non connecté » pour vous reconnecter');
  }
  return res;
}
function driveError(status) {
  return new Error(`Drive n'a pas répondu correctement (code ${status}) : rien n'a été modifié, nouvel essai plus tard`);
}
async function findOrCreateFile() {
  const search = await driveRequest('GET',
    `https://www.googleapis.com/drive/v3/files?q=name='${FILE_NAME}'+and+trashed=false&orderBy=modifiedTime+desc&fields=files(id,name)`);
  // en cas de panne, surtout ne pas conclure « aucun fichier » : cela créerait un doublon
  if (!search.ok) throw driveError(search.status);
  const { files } = await search.json();
  if (!Array.isArray(files)) throw driveError(search.status);
  if (files.length > 0) { driveFileId = files[0].id; return; }
  const meta = await driveRequest('POST', 'https://www.googleapis.com/drive/v3/files',
    { name: FILE_NAME, mimeType: 'application/json' });
  if (!meta.ok) throw driveError(meta.status);
  const { id } = await meta.json();
  if (!id) throw driveError(meta.status);
  driveFileId = id;
}
// Empreinte du contenu actuellement sur Drive (null si inconnue) : dit si un autre appareil a envoyé quelque chose
async function driveRevision() {
  if (!driveFileId) await findOrCreateFile();
  const res = await driveRequest('GET',
    `https://www.googleapis.com/drive/v3/files/${driveFileId}?fields=md5Checksum,headRevisionId`);
  if (res.status === 404) driveFileId = null;                 // fichier disparu : on le recherchera au prochain essai
  if (!res.ok) throw driveError(res.status);
  const info = await res.json();
  const rev = info.md5Checksum || info.headRevisionId;
  return rev ? driveFileId + ':' + rev : null;
}
// Contenu du fichier Drive, vérifié ; null s'il est encore vide
async function downloadFromDrive() {
  if (!driveFileId) await findOrCreateFile();
  const res = await driveRequest('GET',
    `https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`);
  if (res.status === 404) driveFileId = null;
  if (!res.ok) throw driveError(res.status);
  const text = await res.text();
  if (!text || text.trim() === '') return null;
  let data = null;
  try { data = JSON.parse(text); } catch { /* signalé ci-dessous */ }
  if (!isValidData(data)) throw new Error('Le fichier sur Drive n’est pas reconnu : rien n’a été modifié');
  return cleanData(data);
}
function safeBackup() {
  try { autoBackup(); } catch (e) { console.warn('Copie de secours impossible :', e.message); }
}
// L'application est ouverte (pas arrêtée sur l'écran du mot de passe)
function appOpen() {
  return unlocked || !getPwdHash();
}
// Le mot de passe suit les données : ajouté ou retiré sur un autre appareil, il l'est aussi ici
function applyRemotePassword() {
  if (appData.pwdHash) setPref('finances_pwd', appData.pwdHash);
  else if (appData.keyTimes && appData.keyTimes.pwdHash) localStorage.removeItem('finances_pwd');
}
// Réunit ce qui vient de Drive avec les données de l'appareil
function receiveFromDrive(remote) {
  const merged = mergeAppData(appData, remote);
  const result = dataSignature(merged);
  const gained = result !== dataSignature(appData);          // Drive apporte quelque chose
  const toSend = result !== dataSignature(remote);           // l'appareil a quelque chose que Drive n'a pas
  const stamp = toSend ? new Date() : null;
  const lastSync = stamp ? stamp.toISOString() : remote.lastSync;
  const lastSyncLocal = stamp ? stamp.toLocaleString('fr-FR') : remote.lastSyncLocal;
  if (gained) {
    if (appData.operations.length) safeBackup();
    appData = merged;
  }
  appData.lastSync = lastSync;
  appData.lastSyncLocal = lastSyncLocal;
  saveLocal(false);
  applyRemotePassword();
  setPref('finances_basesync', remote.lastSync || '');
  if (toSend) setPref('finances_pending', '1');
  else localStorage.removeItem('finances_pending');
  return gained;
}
async function sendToDrive() {
  // On envoie appData tel quel — son horodatage = date de dernière modification.
  const sent = appData.lastSync;
  const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${driveFileId}?uploadType=media&fields=md5Checksum,headRevisionId`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(appData, null, 2),
  });
  if (res.status === 401) {
    accessToken = null;
    localStorage.removeItem('gToken'); localStorage.removeItem('gTokenExp');
    throw new Error('Connexion Google expirée — touchez 🔄 pour vous reconnecter');
  }
  if (!res.ok) throw new Error('Envoi refusé par Drive (code ' + res.status + ')');
  const info = await res.json().catch(() => ({}));
  const rev = info.md5Checksum || info.headRevisionId;
  if (rev && !storageFull) setPref('finances_driverev', driveFileId + ':' + rev);
  else localStorage.removeItem('finances_driverev');        // inconnue, ou appareil en retard : on relira Drive la prochaine fois
  setPref('finances_lastdrive', new Date().toISOString());
  setPref('finances_basesync', sent || '');
  // Si l'utilisateur a encore modifié pendant l'envoi, il reste des changements à envoyer
  if (appData.lastSync === sent) localStorage.removeItem('finances_pending');
}
// Un échange complet : relire Drive s'il a changé, réunir les deux versions, puis envoyer ce qui manque à Drive.
// Rien n'est jamais envoyé sans avoir vérifié ce que Drive contient.
async function driveExchange() {
  syncRunning++; updateConnBadge();
  try {
    const rev = await driveRevision();
    const nothingHere = !appData.operations.length && !(appData.accounts || []).length;      // appareil neuf ou effacé
    let remoteEmpty = false;
    if (!rev || rev !== localStorage.getItem('finances_driverev') || nothingHere) {
      const remote = await downloadFromDrive();
      if (remote) {
        const gained = receiveFromDrive(remote);
        if (rev && !storageFull) setPref('finances_driverev', rev);
        if (gained) {
          driveNews = '🔀 Données mises à jour avec celles de Drive';
          if (appOpen()) { renderAll(); toast(driveNews, 3500); }
        }
      } else {
        remoteEmpty = true;
        if (!nothingHere) setPref('finances_pending', '1');
      }
    }
    // mémoire pleine : la version la plus récente n'existe qu'ici, Drive doit la recevoir
    if ((localStorage.getItem('finances_pending') === '1' || storageFull) && !(remoteEmpty && nothingHere)) {
      await sendToDrive();
      if (!driveNews) driveNews = '✅ Modifications envoyées vers Drive';
    }
  } finally {
    syncRunning--;
    updateSyncStatus();   // met aussi à jour la pastille de connexion
  }
}
let driveNews = '';                     // ce que le dernier échange a apporté, pour le message
let exchangeQueue = null;
// Un seul échange à la fois ; une demande reçue pendant un échange en provoque un autre juste après
function uploadToDrive() {
  if (!exchangeQueue) exchangeQueue = oneAtATime(driveExchange);
  return exchangeQueue();
}
async function syncFromDrive() {
  document.getElementById('sync-status').textContent = '⏳ Synchronisation…';
  driveNews = '';
  try {
    await uploadToDrive();
    if (getPwdHash() && !unlocked) {
      applyRemotePassword();
      checkLockScreen();
      return;
    }
    renderAll();
    showScreen('screen-main');
    updateSyncStatus();
    if (driveNews.startsWith('✅')) toast(driveNews);
  } catch (e) {
    console.warn('Sync erreur:', e.message);
    // Ne pas afficher l'erreur dans le bandeau bleu si on a des données locales
    if (appData.lastSync) {
      updateSyncStatus();
    } else {
      document.getElementById('sync-status').textContent = 'Non synchronisé';
    }
    toast(e instanceof TypeError ? '⚠️ Drive est injoignable : vos données restent sur cet appareil' : '⚠️ ' + e.message, 6000);
  } finally {
    updateConnBadge();
  }
}
// De retour sur l'application ou au retour du réseau : on regarde si un autre appareil a changé quelque chose
function checkDrive() {
  if (accessToken && navigator.onLine && appOpen()) uploadToDrive().catch(() => {});
}
window.addEventListener('online', checkDrive);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkDrive(); });
// Une autre fenêtre de l'application vient d'enregistrer : on réunit ses données avec les nôtres
// (sinon la dernière fenêtre à enregistrer effacerait la saisie de l'autre)
window.addEventListener('storage', (e) => {
  if (e.key !== 'finances_data' || !e.newValue) return;
  let other = null;
  try { other = JSON.parse(e.newValue); } catch { return; }
  if (!isValidData(other)) return;
  cleanData(other);
  const mine = dataSignature(appData);
  appData = mergeAppData(appData, other);
  const result = dataSignature(appData);
  if (result !== dataSignature(other)) saveLocal(false);
  if (result !== mine && appOpen()) renderAll();
});
function updateSyncStatus() {
  updateConnBadge();
  const el = document.getElementById('sync-status');
  const ls = document.getElementById('display-lastsync');
  if (appData.lastSync) {
    const str = appData.lastSyncLocal || new Date(appData.lastSync).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' });
    const online = navigator.onLine ? '' : ' (hors ligne)';
    // l'avertissement n'a de sens que si cet appareil utilise Drive (sinon il resterait affiché à vie après la 1re modification)
    const usesDrive = !!(accessToken || localStorage.getItem('finances_lastdrive') || localStorage.getItem('gToken'));
    const pend = (usesDrive && localStorage.getItem('finances_pending') === '1') ? ' · ⚠️ modifications non envoyées à Drive' : '';
    el.textContent = '📊 Données du ' + str + online + pend + (storageFull ? ' · ⚠️ mémoire pleine' : '');
    if (ls) ls.textContent = str;
  }
}

// ── ÉTAT DE LA CONNEXION (pastille toujours visible) + PROPOSITION AU DÉMARRAGE ──
// État à partir de faits simples (testable) : offline | disconnected | syncing | pending | connected
function computeConnState({ online, syncing, hasToken, tokenExp, now, pending }) {
  if (!online) return 'offline';
  if (!hasToken || (tokenExp && tokenExp <= now)) return 'disconnected';
  if (syncing) return 'syncing';
  return pending ? 'pending' : 'connected';
}
// La connexion est proposée au démarrage seulement si on n'est pas déjà connecté, qu'il y a du réseau,
// que l'utilisateur ne l'a pas désactivé, ne l'a pas déjà refusée pendant cette session, et que l'écran principal est affiché.
function shouldProposeConnection({ hasToken, online, askDisabled, skipped, mainActive }) {
  return !hasToken && !!online && !askDisabled && !skipped && !!mainActive;
}

let syncRunning = 0;   // nombre d'envois / synchronisations en cours
function getConnState() {
  return computeConnState({
    online: navigator.onLine,
    syncing: syncRunning > 0,
    hasToken: !!accessToken,
    tokenExp: parseInt(localStorage.getItem('gTokenExp') || '0', 10),
    now: Date.now(),
    pending: localStorage.getItem('finances_pending') === '1',
  });
}
const CONN_INFO = {
  connected:    { cls: 'ok',   text: 'Connecté',                    tip: 'Connecté à Google Drive : vos modifications sont envoyées automatiquement. Touchez pour synchroniser maintenant.' },
  pending:      { cls: 'warn', text: 'Connecté · envoi en attente', tip: 'Connecté à Google Drive, mais des modifications ne sont pas encore envoyées. Touchez pour synchroniser maintenant.' },
  syncing:      { cls: 'busy', text: 'Synchronisation…',            tip: 'Échange avec Google Drive en cours.' },
  disconnected: { cls: 'off',  text: 'Non connecté',                tip: 'Vous travaillez sans connexion : les données restent sur cet appareil. Touchez pour vous connecter à Google Drive.' },
  offline:      { cls: 'off',  text: 'Hors ligne',                  tip: 'Pas de réseau : les modifications sont enregistrées sur cet appareil et seront envoyées au retour de la connexion.' },
};
function updateConnBadge() {
  const b = document.getElementById('conn-badge');
  if (!b) return;
  const info = CONN_INFO[getConnState()];
  b.className = 'conn-badge ' + info.cls;
  b.querySelector('.txt').textContent = info.text;
  let tip = info.tip;
  const last = localStorage.getItem('finances_lastdrive');
  if (last) tip += ' Dernier envoi : ' + new Date(last).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + '.';
  b.title = tip;
  b.setAttribute('aria-label', info.text + '. ' + tip);
}
document.getElementById('conn-badge').addEventListener('click', () => {
  const st = getConnState();
  if (st === 'connected' || st === 'pending') { toast('🔄 Synchronisation avec Drive…', 2000); syncFromDrive(); }
  else if (st === 'offline') toast('📴 Hors ligne — la synchronisation reprendra au retour du réseau', 4000);
  else if (st === 'disconnected') startGoogleConnection();
});
// Le jeton Google dure environ 1 h : on s'en aperçoit tout de suite (pastille « Non connecté » + message)
// au lieu d'attendre qu'un envoi échoue.
setInterval(() => {
  const exp = parseInt(localStorage.getItem('gTokenExp') || '0', 10);
  if (accessToken && exp && exp <= Date.now()) {
    accessToken = null;
    localStorage.removeItem('gToken'); localStorage.removeItem('gTokenExp');
    toast('☁️ La connexion Google a expiré — touchez la pastille en haut à droite pour vous reconnecter', 6000);
  }
  updateConnBadge();
}, 20000);

function closeConnectModal() { document.getElementById('modal-connect').classList.add('hidden'); }
function proposeConnection() {
  let askDisabled = false, skipped = false;
  try {
    askDisabled = localStorage.getItem('finances_ask_connect') === '0';
    skipped = sessionStorage.getItem('finances_skip_connect') === '1';
  } catch { /* stockage indisponible : on propose */ }
  const ok = shouldProposeConnection({
    hasToken: !!accessToken, online: navigator.onLine, askDisabled, skipped,
    mainActive: document.getElementById('screen-main').classList.contains('active'),
  });
  if (!ok) return;
  document.getElementById('connect-status').textContent = '';
  document.getElementById('chk-no-ask').checked = false;
  document.getElementById('modal-connect').classList.remove('hidden');
  document.getElementById('btn-connect-now').focus({ preventScroll: true });
}
function applyNoAskChoice() {
  if (!document.getElementById('chk-no-ask').checked) return;
  try { localStorage.setItem('finances_ask_connect', '0'); } catch { /* ignoré */ }
  const c = document.getElementById('cfg-ask-connect');
  if (c) c.checked = false;
}
document.getElementById('btn-connect-now').addEventListener('click', () => {
  applyNoAskChoice();
  document.getElementById('connect-status').textContent = 'Ouverture de la fenêtre de connexion Google…';
  if (!startGoogleConnection()) closeConnectModal();
});
document.getElementById('btn-connect-skip').addEventListener('click', () => {
  applyNoAskChoice();
  closeConnectModal();
  try { sessionStorage.setItem('finances_skip_connect', '1'); } catch { /* ignoré */ }
  toast('Mode sans connexion : vos données restent sur cet appareil.', 3500);
  updateConnBadge();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !document.getElementById('modal-connect').classList.contains('hidden')) {
    document.getElementById('btn-connect-skip').click();
  }
});
(function initAskConnectSetting() {
  const c = document.getElementById('cfg-ask-connect');
  if (!c) return;
  let off = false;
  try { off = localStorage.getItem('finances_ask_connect') === '0'; } catch { /* ignoré */ }
  c.checked = !off;
  c.addEventListener('change', () => {
    try { localStorage.setItem('finances_ask_connect', c.checked ? '1' : '0'); } catch { /* ignoré */ }
    toast(c.checked ? 'La connexion sera proposée à chaque démarrage' : 'La connexion ne sera plus proposée au démarrage', 3000);
  });
})();

// Au démarrage : on attend la bibliothèque Google (8 s au plus). Jeton encore valide → synchro silencieuse ;
// sinon on propose la connexion. Pas de réseau / Google bloqué → l'application démarre sans connexion.
function initConnectionAtStartup() {
  let tries = 0;
  const timer = setInterval(() => {
    tries++;
    const ready = typeof google !== 'undefined' && google.accounts;
    if (!ready && !window.gsiFailed && tries < 40) return;
    clearInterval(timer);
    updateConnBadge();
    if (!ready) return;
    if (!tokenClient) initGoogleAuth();
    const saved = getSavedToken();
    if (saved) {
      accessToken = saved;
      updateConnBadge();
      syncFromDrive();
    } else {
      proposeConnection();
    }
  }, 200);
}

// ── CALCULS ──────────────────────────────────────────────────────────────────
const CAT_ICONS = {
  Alimentation:'🛒', Transport:'🚗', Sante:'💊', Loisirs:'🎉',
  Logement:'🏠', Telecom:'📱', Revenus:'💰', Autre:'📦',
};

// Solde "actuel" d'un compte = solde à la date du jour, ops programmées du mois courant incluses.
// Seul point d'entrée pour le solde courant — cohérent avec la vue Opérations et la Projection,
// qui reposent toutes sur calcBalanceAtDate (voir plus bas dans le fichier).
function calcAccountBalance(accountName) {
  return calcBalanceAsOf(accountName, today());
}

// ── DÉBIT DIFFÉRÉ ───────────────────────────────────────────────────────────
function getBillingCycleStart(billingDay, refDate) {
  const d = refDate || new Date();
  const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
  if (day >= billingDay) {
    return new Date(y, m, billingDay);
  } else {
    return new Date(y, m - 1, billingDay);
  }
}

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Date du prélèvement qui comprend une opération (le jour de remise à zéro qui suit sa période), décalée de `shift`
// mois quand la banque l'a comptée sur le prélèvement voisin
// Premier jour de prélèvement après l'arrêté de la période qui contient `date` (arrêtée la veille du jour suivant).
// Sans jour de prélèvement distinct, c'est le jour d'arrêté du mois suivant.
function billingDebitDate(date, billingDay, shift = 0, debitDay = billingDay) {
  const start = getBillingCycleStart(billingDay, new Date(date + 'T00:00:00'));
  const end = new Date(start.getFullYear(), start.getMonth() + 1, billingDay - 1);
  let debit = new Date(end.getFullYear(), end.getMonth(), debitDay);
  if (debit <= end) debit = new Date(end.getFullYear(), end.getMonth() + 1, debitDay);
  return localDateStr(new Date(debit.getFullYear(), debit.getMonth() + shift, debitDay));
}
function cardDebitDate(acc, date) {
  return billingDebitDate(date, acc.billingCycleDay, 0, acc.billingDebitDay || acc.billingCycleDay);
}
// Jour de prélèvement choisi pour un achat par carte (null si aucun choix ; « mois suivant / précédent » repris)
function chosenDebitDate(op) {
  if (op.debitDate) return op.debitDate;
  if (!op.billingShift) return null;
  const acc = appData.accounts.find(a => a.name === op.account);
  return acc && acc.billingCycleDay ? billingDebitDate(op.date, acc.previousCycleDay || acc.billingCycleDay, op.billingShift) : null;
}
// Sans choix : un achat fait avant le jour de remise à zéro compte à sa date ; à partir de ce jour, il compte
// automatiquement au prélèvement du mois suivant. (Hors carte à débit différé : la date elle-même.)
function autoDebitDate(accountName, date) {
  const acc = appData.accounts.find(a => a.name === accountName);
  if (!acc || acc.cardType !== 'deferred' || !acc.billingCycleDay || !date) return date;
  // carte réglée comme la banque : chaque achat compte à son prélèvement (à partir de la date de ce réglage)
  if (acc.billingDebitDay && (!acc.debitRuleFrom || date >= acc.debitRuleFrom)) return cardDebitDate(acc, date);
  const day = acc.previousCycleDay || acc.billingCycleDay;
  return +date.slice(8, 10) >= day ? billingDebitDate(date, day) : date;
}
// Date de prélèvement par la banque (un virement ou une échéance : sa date)
function bankDate(op) {
  const chosen = chosenDebitDate(op);
  if (chosen) return chosen;
  return op.opType === 'Programmee' || op.opType === 'Virement' || transferTarget(op) !== null ? op.date : autoDebitDate(op.account, op.date);
}
// Date à laquelle une opération compte dans les soldes et les mois d'un compte : un prélèvement de carte fait le 1er
// compte le dernier jour du mois précédent
function balanceDate(op) {
  const day = bankDate(op);
  if (day === op.date || !day.endsWith('-01')) return day;
  const acc = appData.accounts.find(a => a.name === op.account);
  return acc && acc.cardType === 'deferred' ? addDays(day, -1) : day;
}
// Achats et remboursements du prélèvement en cours d'une carte à débit différé (hors virements, échéances programmées
// et lignes entre crochets), jusqu'à refDate, par date croissante ; `moved` : ceux de ces dates comptés ailleurs.
// Le rattachement suit la date, sauf choix « Prélèvement » de l'opération. null si ce n'est pas une carte.
function cardPeriod(accountName, refDate) {
  const acc = appData.accounts.find(a => a.name === accountName);
  if (!acc || acc.cardType !== 'deferred') return null;
  const d = refDate || new Date(), day = acc.billingCycleDay;
  const startStr = localDateStr(getBillingCycleStart(day, d)), endStr = localDateStr(d), debit = cardDebitDate(acc, endStr);
  const ops = appData.operations
    .map((op, i) => ({ op, i }))
    .filter(({ op }) =>
      op.account === accountName &&
      op.opType !== 'Programmee' &&
      op.opType !== 'Virement' &&
      !(op.label && op.label.match(/^\[.+\]$/)) &&
      op.date <= endStr)
    .sort((a, b) => a.op.date.localeCompare(b.op.date) || a.i - b.i)
    .map(({ op }) => op);
  const inPeriod = op => {
    const chosen = chosenDebitDate(op);
    return chosen ? chosen.slice(0, 7) === debit.slice(0, 7) : op.date >= startStr;
  };
  return { ops: ops.filter(inPeriod), moved: ops.filter(op => !inPeriod(op) && op.date >= startStr), debit };
}
function getBillingPeriodOps(accountName, refDate) {
  const period = cardPeriod(accountName, refDate);
  return period && period.ops;
}
// Champ « Prélevé le » d'un formulaire (caché sauf pour un achat sur une carte à débit différé). Il est rempli
// automatiquement selon la règle ; dès que vous le modifiez, votre date est gardée.
function showDebitField(id, account, date, hidden) {
  const acc = appData.accounts.find(a => a.name === account);
  const show = !hidden && !!acc && acc.cardType === 'deferred';
  document.getElementById(id + '-wrap').classList.toggle('hidden', !show);
  const input = document.getElementById(id);
  if (!show) { input.value = ''; delete input.dataset.manual; return; }
  if (!input.dataset.manual) input.value = autoDebitDate(account, date);
}
// Jour à enregistrer : seulement s'il diffère de la règle automatique
function debitDateOf(id, account, date) {
  const v = document.getElementById(id).value;
  return v && v !== autoDebitDate(account, date) ? v : undefined;
}
function refreshEntryDebit() {
  const g = id => document.getElementById(id).value;
  showDebitField('inp-debit', g('inp-account-name'), g('inp-date'), false);
}
function refreshEditDebit() {
  const g = id => document.getElementById(id).value;
  const op = appData.operations.find(o => o.id === _editOpId);
  const hidden = g('edit-op-type') === 'virement' || (!!op && op.opType === 'Programmee');
  showDebitField('edit-op-debit', g('edit-op-account'), g('edit-op-date'), hidden);
}
// Ouverture ou remise à zéro : date choisie auparavant, sinon règle automatique
function setDebitField(id, chosen) {
  const input = document.getElementById(id);
  input.value = chosen || '';
  if (chosen) input.dataset.manual = '1'; else delete input.dataset.manual;
}

function calcBillingBalance(accountName, refDate) {
  const ops = getBillingPeriodOps(accountName, refDate);
  if (ops === null) return null;
  return ops.reduce((sum, op) =>
    op.type === 'debit' ? sum + op.amount : sum - op.amount, 0);
}

function getBillingInfo(accountName) {
  const acc = appData.accounts.find(a => a.name === accountName);
  if (!acc || acc.cardType !== 'deferred') return { period: '', detail: '' };
  const d = new Date();
  const cycleStart = getBillingCycleStart(acc.billingCycleDay, d);
  const ops = getBillingPeriodOps(accountName, d);

  const startFmt = cycleStart.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  const endFmt = d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  const period = `${startFmt} → ${endFmt}`;
  const detail = ops.map(op => {
    const sign = op.type === 'credit' ? '+' : '-';
    return `${op.date.substring(8,10)}/${op.date.substring(5,7)} ${sign}${op.amount} ${esc(op.label)}`;
  }).join(' | ');
  return { period, detail: ops.length + ' ops : ' + detail, count: ops.length, list: detail, ops };
}

// Opérations qui composent l'encours d'une carte à débit différé : ses paiements (débits réels, hors virements,
// opérations programmées et lignes entre crochets) de « date − 30 jours » à « date » incluses, du plus ancien
// au plus récent (à date égale : ordre de saisie). null si le compte n'est pas une carte à débit différé.
function getEncoursOps(accountName, refDate) {
  const acc = (appData.accounts || []).find(a => a.name === accountName);
  if (!acc || acc.cardType !== 'deferred') return null;
  const d = refDate || new Date();
  const from = new Date(d);
  from.setDate(from.getDate() - 30);
  const startStr = localDateStr(from);
  const endStr = localDateStr(d);
  return appData.operations
    .map((op, i) => ({ op, i }))
    .filter(({ op }) =>
      op.account === accountName &&
      op.opType !== 'Programmee' &&
      op.opType !== 'Virement' &&
      !(op.label && op.label.match(/^\[.+\]$/)) &&
      op.type === 'debit' &&
      op.date >= startStr && op.date <= endStr)
    .sort((a, b) => a.op.date.localeCompare(b.op.date) || a.i - b.i)
    .map(({ op }) => op);
}

// Encours de TOUTES les cartes à débit différé sur la même fenêtre (de « date − 30 jours » à « date ») :
// une entrée par carte (encours, plafond, opérations), le total, et la liste regroupée de toutes les opérations
// (rows : { card, op }, triées par date, à date égale dans l'ordre des cartes puis de saisie).
function getCardsEncours(refDate) {
  const d = refDate || new Date();
  const from = new Date(d);
  from.setDate(from.getDate() - 30);
  const cards = (appData.accounts || []).filter(a => a.cardType === 'deferred').map(acc => {
    const ops = getEncoursOps(acc.name, d);
    return { name: acc.name, limit: acc.cardLimit || 0, ops, total: ops.reduce((s, o) => s + o.amount, 0) };
  });
  const rows = [];
  for (const c of cards) for (const op of c.ops) rows.push({ card: c.name, op });
  rows.sort((a, b) => a.op.date.localeCompare(b.op.date));   // tri stable : l'ordre d'arrivée départage les égalités
  // plafond restant de la carte après chaque paiement, dans l'ordre de la liste (null sans plafond renseigné)
  const left = new Map(cards.filter(c => c.limit).map(c => [c.name, c.limit]));
  for (const row of rows) {
    if (left.has(row.card)) left.set(row.card, left.get(row.card) - row.op.amount);
    row.left = left.has(row.card) ? left.get(row.card) : null;
  }
  return { from: localDateStr(from), to: localDateStr(d), cards, rows, total: cards.reduce((s, c) => s + c.total, 0) };
}

function getAccountNames() {
  if (appData.accounts && appData.accounts.length > 0) {
    return appData.accounts.map(a => a.name).filter(n => n !== 'Mon compte');
  }
  return [...new Set(appData.operations.map(op => op.account).filter(Boolean))];
}

// ── BOUTONS DES LISTES ───────────────────────────────────────────────────────
// Un seul écouteur pour les boutons créés par l'application : les données restent des données (attributs), jamais du code.
// La page interdit d'ailleurs tout code écrit dedans (voir la règle de sécurité en tête de index.html).
const ACTIONS = {
  edit: el => editOp(el.dataset.id, el.dataset.date),
  point: el => togglePointed(el.dataset.id),
  tab: el => showTab(el.dataset.arg),
  more: () => showMoreOps(),
  'account-rename': el => renameAccount(el.dataset.name),
  'account-delete': el => deleteAccount(el.dataset.name),
  pass: el => passerScheduled(el.dataset.id),
  'sched-edit': el => editScheduled(el.dataset.id),
  'sched-delete': el => deleteScheduled(el.dataset.id),
};
// le bouton le plus proche du toucher agit seul (pointer une opération n'ouvre pas la ligne qui l'entoure)
document.addEventListener('click', (e) => {
  const el = e.target.closest && e.target.closest('[data-action]');
  if (el && ACTIONS[el.dataset.action]) ACTIONS[el.dataset.action](el);
});

// ── RENDU ────────────────────────────────────────────────────────────────────
let dashboardBalanceDate = null; // null = aujourd'hui, sinon date choisie via le sélecteur

function calcBalanceAsOf(accountName, dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return calcBalanceAtDate(accountName, y, m - 1, d);
}

// Solde utilisé par le dashboard : à la date choisie, ou aujourd'hui par défaut
function calcDashboardBalance(name) {
  return calcBalanceAsOf(name, dashboardBalanceDate || today());
}

function calcDashboardTotalBalance() {
  const names = getAccountNames();
  if (names.length > 0) {
    return names
      .filter(n => { const a = appData.accounts.find(x => x.name === n); return !a || a.includeInTotal !== false; })
      .reduce((sum, n) => sum + calcDashboardBalance(n), 0);
  }
  return calcDashboardBalance('');
}

// ── ACCUEIL « LOGICIEL DE COMPTES » ──────────────────────────────────────────
// Comptes regroupés par type avec sous-totaux, échéancier à 30 jours, synthèse du solde,
// dernières opérations classées par jour.

// Type d'un compte : choix explicite (acc.kind, dans les Réglages), sinon déduit de la carte / du nom.
function getAccountKind(acc) {
  if (!acc) return 'courant';
  if (['courant', 'epargne', 'credit', 'carte'].includes(acc.kind)) return acc.kind;
  if (acc.cardType === 'deferred') return 'carte';
  const n = String(acc.name || '').toLowerCase();
  if (/(é|e)pargne|livret|assurance[- ]?vie|\bpel\b|\bcel\b/.test(n)) return 'epargne';
  if (/cr(é|e)dit|pr(ê|e)t|emprunt|hypoth|voiture|loan/.test(n)) return 'credit';
  return 'courant';
}

// Regroupe des noms de comptes par type, dans l'ordre courant → épargne → crédit → carte (groupes vides omis).
function groupAccountsByKind(names) {
  const order = ['courant', 'epargne', 'credit', 'carte'];
  const groups = order.map(kind => ({ kind, names: [] }));
  for (const n of names) {
    const acc = appData.accounts.find(a => a.name === n);
    groups[order.indexOf(getAccountKind(acc || { name: n }))].names.push(n);
  }
  return groups.filter(g => g.names.length);
}

function isAccountIncluded(name) {
  const a = appData.accounts.find(x => x.name === name);
  return !a || a.includeInTotal !== false;
}

// Opérations à venir dans les `days` jours qui suivent `fromStr` (exclu) : échéances programmées
// + opérations réelles datées dans le futur. Un virement compte deux jambes (débit + crédit) :
// la jambe crédit porte `creditLeg: true` (utile au solde prévu, à masquer dans l'affichage).
function getUpcomingOps(fromStr, days) {
  const from = new Date(fromStr + 'T00:00:00');
  const to = new Date(from);
  to.setDate(to.getDate() + days);
  const toStr = localDateStr(to);
  const out = [];
  let y = from.getFullYear(), m = from.getMonth();
  const lastMonth = to.getFullYear() * 12 + to.getMonth();
  while (y * 12 + m <= lastMonth) {
    for (const op of scheduledOpsInMonth(y, m, '')) {
      const d = op.nextPayment || op.date;
      if (d > fromStr && d <= toStr) out.push({ ...op, date: d, scheduled: true, creditLeg: String(op.id).endsWith('_credit') });
    }
    if (++m > 11) { m = 0; y++; }
  }
  for (const op of appData.operations) {
    if (op.opType === 'Programmee') continue;
    if (op.date > fromStr && op.date <= toStr) {
      out.push({ ...op, scheduled: false, creditLeg: op.opType === 'Virement' && op.type === 'credit' });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || String(a.label).localeCompare(String(b.label)));
}

// Effet net de ces opérations sur le solde total (seuls les comptes inclus dans le total comptent).
function upcomingNetForTotal(items) {
  return items
    .filter(o => isAccountIncluded(o.account))
    .reduce((s, o) => o.type === 'credit' ? s + o.amount : s - o.amount, 0);
}

const ACCOUNT_KIND_INFO = {
  courant: { label: 'Comptes courants', icon: '🏦' },
  epargne: { label: 'Épargne',          icon: '🐖' },
  credit:  { label: 'Crédits et prêts', icon: '🧾' },
  carte:   { label: 'Cartes bancaires', icon: '💳' },
};

const signedFmt = v => (v > 0 ? '+' : '') + fmt(v);

// Pictogramme d'une opération (catégorie connue, sinon déduit du texte de la catégorie)
function catEmoji(op) {
  const c = String(op.category || '').toLowerCase();
  if (op.opType === 'Virement' || /^\[.+\]$/.test(op.label || '') || /virement|transfert/.test(c)) return '🔄';
  const parent = String(op.category || '').split('/')[0];
  const mine = appData.catIcons || {};
  if (mine[parent]) return mine[parent];
  if (CAT_ICONS[op.category]) return CAT_ICONS[op.category];
  if (CAT_ICONS[parent]) return CAT_ICONS[parent];
  return guessCatIcon(op.category) || (op.type === 'credit' ? '💰' : '📦');
}

function dayLabel(dateStr, todayStr) {
  if (dateStr === todayStr) return "Aujourd'hui";
  const d = new Date(dateStr + 'T00:00:00'), t = new Date(todayStr + 'T00:00:00');
  if (Math.round((t - d) / 86400000) === 1) return 'Hier';
  const opt = { weekday: 'long', day: 'numeric', month: 'long' };
  if (d.getFullYear() !== t.getFullYear()) opt.year = 'numeric';
  const s = d.toLocaleDateString('fr-FR', opt);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Détails de la carte à débit différé : prélèvement et opérations de la période de référence.
// (L'encours et le plafond de toutes les cartes sont dans la section « Encours des cartes », voir encoursSectionHtml.)
function cardDetailsHtml(name) {
  const billing = calcBillingBalance(name);
  const billingInfo = getBillingInfo(name);
  // Tableau des opérations comprises dans la période de référence (du jour de remise à zéro à aujourd'hui)
  let opened = true;
  try { opened = localStorage.getItem('finances_card_detail') !== '0'; } catch { /* stockage indisponible : ouvert */ }
  const rows = billingInfo.ops.map(o => `<tr class="tx-click" data-action="edit" data-id="${esc(o.id)}" data-date="${esc(o.date)}">
        <td class="c-date">${o.date.slice(8, 10)}/${o.date.slice(5, 7)}</td>
        <td class="c-label">${esc(o.label)}${chosenDebitDate(o) ? `<small class="c-card">↪ prélevé le ${formatDate(chosenDebitDate(o))}</small>` : ''}${commentHtml(o, 'small')}</td>
        <td class="c-catcol">${esc(o.category || '')}</td>
        <td class="c-amt ${o.type}">${o.type === 'credit' ? '+' : '-'}${fmt(o.amount)}</td>
      </tr>`).join('');
  const table = billingInfo.count
    ? `<details class="kv-more" data-card-detail${opened ? ' open' : ''}>
      <summary>Opérations de la période (${billingInfo.count})</summary>
      <div class="tbl-wrap"><table class="op-table">
        <thead><tr><th>Date</th><th>Libellé</th><th class="c-catcol">Catégorie</th><th class="r">Montant</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="2">Total à prélever</td><td class="c-catcol"></td><td class="c-amt">${fmt(billing)}</td></tr></tfoot>
      </table></div>
    </details>`
    : '<div class="kv-detail">Aucune opération sur cette période.</div>';
  return `<div class="acc-extra">${pendingDebitHtml(name)}
    <div class="kv"><span>Prélèvement (${billingInfo.period})${infoBtn('carte-prelevement', name)}</span><b class="neg">${fmt(billing)}</b></div>
    ${table}
    ${movedOpsHtml(name)}
  </div>`;
}
// Période déjà arrêtée dont le prélèvement n'est pas encore passé (banque qui prélève après l'arrêté)
function pendingDebit(name, now = today()) {
  const acc = appData.accounts.find(a => a.name === name);
  if (!acc || !acc.billingDebitDay) return null;
  const start = getBillingCycleStart(acc.billingCycleDay, new Date(now + 'T00:00:00'));
  const period = cardPeriod(name, new Date(addDays(localDateStr(start), -1) + 'T00:00:00'));
  if (!period || period.debit <= now) return null;
  const waiting = period.ops.filter(o => balanceDate(o) > now);           // pas encore comptés dans le solde
  const total = waiting.reduce((s, o) => s + (o.type === 'debit' ? o.amount : -o.amount), 0);
  return total ? { debit: period.debit, total, count: waiting.length } : null;
}
function pendingDebitHtml(name) {
  const p = pendingDebit(name);
  return p ? `<div class="kv"><span>À débiter le ${formatDate(p.debit)} (${p.count} achat${p.count > 1 ? 's' : ''})</span><b class="neg">${fmt(p.total)}</b></div>` : '';
}
// Achats de la période que la banque compte sur un autre prélèvement (touchez-en un pour le modifier)
function movedOpsHtml(name) {
  const period = cardPeriod(name), acc = appData.accounts.find(a => a.name === name);
  if (!period || !period.moved.length) return '';
  const dm = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  return `<div class="kv-detail">Comptées sur un autre prélèvement :${period.moved.map(o =>
    `<button type="button" class="link-btn moved-op" data-action="edit" data-id="${esc(o.id)}" data-date="${esc(o.date)}">${dm(o.date)} ${esc(o.label)} · ${fmt(o.amount)} → prélevé le ${dm(chosenDebitDate(o))}</button>`).join('')}</div>`;
}

// Couleur du plafond selon la part utilisée : orange au-delà de 50 %, rouge au-delà de 80 %
function limitColor(spent, limit) {
  const pct = limit ? Math.round((spent / limit) * 100) : 0;
  return pct > 80 ? 'var(--danger)' : pct > 50 ? '#ef9f27' : 'var(--accent)';
}
// Ligne sous un paiement de l'encours : ce qu'il reste du plafond après lui
function encoursLeftHtml(left, limit) {
  if (left === null) return '';
  return `<tr class="enc-left">
        <td colspan="2">${left >= 0 ? 'Plafond restant' : 'Plafond dépassé de'}</td><td class="c-catcol"></td>
        <td class="c-amt" style="color:${limitColor(limit - left, limit)}">${fmt(Math.abs(left))}</td>
      </tr>`;
}

// Section « Encours des cartes » de l'accueil : pour TOUTES les cartes à débit différé, l'encours informatique des
// 30 derniers jours (de « aujourd'hui − 30 jours » à aujourd'hui) avec le plafond restant, puis le tableau de
// toutes les opérations qui le composent. Vide s'il n'y a aucune carte à débit différé.
function encoursSectionHtml() {
  const enc = getCardsEncours();
  if (!enc.cards.length) return '';
  const multi = enc.cards.length > 1;
  const shortDay = s => new Date(s + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  let opened = true;
  try { opened = localStorage.getItem('finances_enc_detail') !== '0'; } catch { /* stockage indisponible : ouvert */ }

  const cardRows = enc.cards.map(c => {
    const n = c.ops.length;
    const pct = c.limit ? Math.min(100, Math.round((c.total / c.limit) * 100)) : 0;
    const barCol = limitColor(c.total, c.limit);
    const left = c.limit - c.total;
    const limitHtml = c.limit
      ? `<div class="enc-limit"><span>${left >= 0 ? 'Plafond restant' : 'Plafond dépassé de'}</span><b style="color:${barCol}">${left >= 0 ? `${fmt(left)} / ${fmt(c.limit)}` : `${fmt(-left)} (plafond ${fmt(c.limit)})`}</b></div>
        <div class="meter"><div style="width:${pct}%;background:${barCol}"></div></div>`
      : '<div class="enc-limit"><span>Plafond non renseigné (Paramètres › Comptes)</span></div>';
    return `<div class="enc-row">
      <span class="avatar kind-carte">💳</span>
      <div class="enc-main">
        <div class="enc-top"><span class="acc-name">${esc(c.name)}</span><b class="amt">${fmt(c.total)}</b></div>
        <div class="acc-sub">${n} paiement${n > 1 ? 's' : ''}${c.limit ? ` · ${pct} % du plafond` : ''}</div>
        ${limitHtml}
      </div>
    </div>`;
  }).join('');

  const limits = new Map(enc.cards.map(c => [c.name, c.limit]));
  const rows = enc.rows.map(({ card, op, left }) => `<tr${left === null ? '' : ' class="has-left"'}>
        <td class="c-date">${op.date.slice(8, 10)}/${op.date.slice(5, 7)}</td>
        <td class="c-label">${esc(op.label)}${multi ? `<small class="c-card">${esc(card)}</small>` : ''}${commentHtml(op, 'small')}</td>
        <td class="c-catcol">${esc(op.category || '')}</td>
        <td class="c-amt debit">-${fmt(op.amount)}</td>
      </tr>${encoursLeftHtml(left, limits.get(card))}`).join('');
  const table = enc.rows.length
    ? `<details class="kv-more" data-enc-detail${opened ? ' open' : ''}>
      <summary>Opérations de l'encours (${enc.rows.length})</summary>
      <div class="tbl-wrap"><table class="op-table">
        <thead><tr><th>Date</th><th>Libellé</th><th class="c-catcol">Catégorie</th><th class="r">Montant</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="2">Total de l'encours</td><td class="c-catcol"></td><td class="c-amt">${fmt(enc.total)}</td></tr></tfoot>
      </table></div>
    </details>`
    : '<div class="kv-detail">Aucun paiement par carte sur ces 30 jours.</div>';

  return `<section class="acc-group enc-group">
    <div class="acc-group-head"><span>Encours des cartes · 30 jours${infoBtn('encours-cartes')}</span><b>${fmt(enc.total)}</b></div>
    <div class="acc-group-body">
      <div class="enc-period">Du ${shortDay(enc.from)} au ${shortDay(enc.to)} · paiements uniquement (virements et remboursements exclus)</div>
      ${cardRows}
      <div class="enc-foot">${table}</div>
    </div>
  </section>`;
}

function renderHeroStats() {
  const t = today();
  const [y, m] = t.split('-').map(Number);
  const set = (id, v, signed) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = signed ? signedFmt(v) : fmt(v);
    el.classList.toggle('neg', v < 0);
    el.classList.toggle('pos', signed && v > 0);
  };
  // même périmètre que le solde total : comptes inclus dans le total, par nom (marche aussi sans fiche de compte)
  const eom = getAccountNames().filter(isAccountIncluded).reduce((s, n) => s + calcBalanceEndOfMonth(n, y, m - 1), 0);
  set('hero-eom', eom, false);
  set('hero-upcoming', upcomingNetForTotal(getUpcomingOps(t, 30)), true);
}

function renderAccountGroups(refDate) {
  const box = document.getElementById('list-accounts');
  if (!box) return;
  const names = getAccountNames();
  if (!names.length) { box.innerHTML = '<div class="empty-state">Aucun compte</div>'; return; }
  const [ry, rm] = refDate.split('-').map(Number);
  const t = today();
  const count = {}, last = {};
  for (const op of appData.operations) {
    if (op.opType === 'Programmee') continue;
    count[op.account] = (count[op.account] || 0) + 1;
    if (op.date <= t && (!last[op.account] || op.date > last[op.account])) last[op.account] = op.date;
  }
  const bal = {}, eom = {};
  for (const n of names) { bal[n] = calcDashboardBalance(n); eom[n] = calcBalanceEndOfMonth(n, ry, rm - 1); }

  box.innerHTML = groupAccountsByKind(names).map(g => {
    const info = ACCOUNT_KIND_INFO[g.kind];
    const subtotal = g.names.reduce((s, n) => s + bal[n], 0);
    const rows = g.names.map(name => {
      const acc = appData.accounts.find(a => a.name === name);
      const b = bal[name];
      const below = appData.alerts && appData.alerts[name] !== undefined && b < appData.alerts[name];
      const shortDate = d => d.slice(0, 4) === t.slice(0, 4) ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}`;
      const sub = [`${fmtInt(count[name] || 0)} opérations`];
      if (last[name]) sub.push(`dernière : ${shortDate(last[name])}`);
      const pills = (isAccountIncluded(name) ? '' : '<span class="pill" title="Ce compte n\'est pas compté dans le solde total">hors total</span>')
        + (below ? '<span class="pill warn">⚠️ sous le seuil</span>' : '');
      return `<div class="acc-item">
        <button type="button" class="acc-row" data-account="${esc(name)}">
          <span class="avatar kind-${g.kind}">${info.icon}</span>
          <span class="acc-main">
            <span class="acc-name">${esc(name)}</span>
            <span class="acc-sub">${esc(sub.join(' · '))}</span>
            ${pills ? `<span class="acc-pills">${pills}</span>` : ''}
          </span>
          <span class="acc-amounts">
            <b class="amt ${b >= 0 ? 'credit' : 'debit'}">${fmt(b)}</b>
            ${eom[name] !== b ? `<small class="acc-eom">fin de mois : ${fmt(eom[name])}</small>` : ''}
          </span>
        </button>
        ${acc && acc.cardType === 'deferred' ? cardDetailsHtml(name) : ''}
      </div>`;
    }).join('');
    return `<section class="acc-group">
      <div class="acc-group-head"><span>${info.label}${infoBtn('types-comptes')}</span><b>${fmt(subtotal)}</b></div>
      <div class="acc-group-body">${rows}</div>
    </section>`;
  }).join('') + encoursSectionHtml();
}

// Ligne d'une opération à venir (liste « À venir » et carte « Dans les 7 jours »).
function upcomingRowHtml(o) {
  const mShort = d => new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '');
  const dest = (String(o.label || '').match(/^\[(.+)\]$/) || [])[1];
  const label = dest ? `Virement vers ${dest}` : o.label;
  return `<li class="tx-row" data-action="edit" data-id="${esc(o.id)}" data-date="${esc(o.date)}">
      <span class="date-chip"><b>${o.date.slice(8, 10)}</b><small>${esc(mShort(o.date))}</small></span>
      <span class="tx-main"><span class="tx-label">${esc(label)}</span><span class="tx-sub">${esc(o.account)}${o.scheduled ? ' · programmée' : ''}</span>${commentHtml(o, 'span')}</span>
      <span class="tx-amt ${o.type}">${o.type === 'credit' ? '+' : '-'}${fmt(o.amount)}</span>
    </li>`;
}

function renderUpcoming() {
  const el = document.getElementById('list-upcoming');
  if (!el) return;
  const items = getUpcomingOps(today(), 30).filter(o => !o.creditLeg);
  const meta = document.getElementById('upcoming-meta');
  if (meta) meta.textContent = items.length ? `${items.length} opération${items.length > 1 ? 's' : ''}` : 'rien de prévu';
  if (!items.length) { el.innerHTML = '<li class="empty-state">Rien de prévu dans les 30 prochains jours</li>'; return; }
  const shown = items.slice(0, 12);
  el.innerHTML = shown.map(upcomingRowHtml).join('') + (items.length > shown.length
    ? `<li class="more-row"><button type="button" class="btn-secondary" data-action="tab" data-arg="scheduled">Voir les ${items.length - shown.length} autres →</button></li>`
    : '');
}

function renderRecentOps() {
  const el = document.getElementById('list-recent');
  if (!el) return;
  const t = today();
  const ops = appData.operations
    .filter(o => o.opType !== 'Programmee' && o.date <= t)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 12);
  const meta = document.getElementById('recent-meta');
  if (meta) {
    const d = ops.length ? ops[0].date : '';
    meta.textContent = d ? `le ${d.slice(8, 10)}/${d.slice(5, 7)}${d.slice(0, 4) === t.slice(0, 4) ? '' : '/' + d.slice(2, 4)}` : '';
  }
  if (!ops.length) { el.innerHTML = '<li class="empty-state">Aucune opération</li>'; return; }
  let html = '', cur = '';
  for (const o of ops) {
    if (o.date !== cur) { cur = o.date; html += `<li class="day-head">${esc(dayLabel(o.date, t))}</li>`; }
    const other = (String(o.label || '').match(/^\[(.+)\]$/) || [])[1];
    const label = other ? (o.type === 'credit' ? `Virement depuis ${other}` : `Virement vers ${other}`) : o.label;
    html += `<li class="tx-row" data-action="edit" data-id="${esc(o.id)}" data-date="${esc(o.date)}">
      <span class="avatar sm ${o.type}">${esc(catEmoji(o))}</span>
      <span class="tx-main"><span class="tx-label">${esc(label)}</span><span class="tx-sub">${esc([o.account, o.category].filter(Boolean).join(' · '))}</span>${commentHtml(o, 'span')}</span>
      <span class="tx-amt ${o.type}">${o.type === 'credit' ? '+' : '-'}${fmt(o.amount)}</span>
    </li>`;
  }
  el.innerHTML = html + `<li class="more-row"><button type="button" class="btn-secondary" data-action="tab" data-arg="operations">Voir toutes les opérations →</button></li>`;
}

function renderDashboard() {
  document.getElementById('display-balance').textContent = fmt(calcDashboardTotalBalance());
  const dateLabel = document.getElementById('balance-date-label');
  if (dashboardBalanceDate) {
    const d = new Date(dashboardBalanceDate + 'T00:00:00');
    dateLabel.textContent = `(au ${d.toLocaleDateString('fr-FR')}${dashboardBalanceDate > today() ? ' · prévu' : ''})`;
  } else {
    dateLabel.textContent = '';
  }
  const dayChoice = document.getElementById('balance-day');
  if (dayChoice) dayChoice.value = balanceDayChoiceOf(dashboardBalanceDate, today());
  const dd = document.getElementById('dash-date');
  if (dd) {
    const s = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    dd.textContent = s.charAt(0).toUpperCase() + s.slice(1);
  }
  renderHeroStats();
  renderHeroTrend();
  renderSoonCard();
  renderAccountGroups(dashboardBalanceDate || today());
  renderUpcoming();
  renderRecentOps();
  renderActiveDashPanel();
}

// ── ONGLETS DE L'ACCUEIL + BLOCS DÉPLIABLES ──────────────────────────────────
const DASH_TABS = ['comptes', 'activite', 'analyses', 'projection'];
const getActiveDashTab = () => {
  const b = document.querySelector('.dash-tab.active');
  return b ? b.dataset.dtab : 'comptes';
};
// Le graphique du patrimoine et la projection se dessinent à leur taille réelle : on les (re)calcule
// quand leur onglet est visible (un panneau masqué n'a pas de largeur).
function renderActiveDashPanel() {
  const tab = getActiveDashTab();
  if (tab === 'analyses') { renderWealthChart(); renderFlowChart(); }
  else if (tab === 'projection') renderProjection();
}
function showDashTab(name, remember = true, render = true) {
  if (!DASH_TABS.includes(name)) name = 'comptes';
  document.querySelectorAll('.dash-tab').forEach(b => {
    const on = b.dataset.dtab === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.tabIndex = on ? 0 : -1;
  });
  document.querySelectorAll('.dash-panel').forEach(p => p.classList.toggle('active', p.id === 'dpanel-' + name));
  if (remember) { try { localStorage.setItem('finances_dash_tab', name); } catch { /* stockage indisponible */ } }
  if (render) renderActiveDashPanel();
}
document.querySelectorAll('.dash-tab').forEach(b => {
  b.addEventListener('click', () => showDashTab(b.dataset.dtab));
  b.addEventListener('keydown', (e) => {   // flèches / Début / Fin : navigation au clavier entre onglets
    const i = DASH_TABS.indexOf(b.dataset.dtab);
    let j = null;
    if (e.key === 'ArrowRight') j = (i + 1) % DASH_TABS.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + DASH_TABS.length) % DASH_TABS.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = DASH_TABS.length - 1;
    if (j === null) return;
    e.preventDefault();
    showDashTab(DASH_TABS[j]);
    document.getElementById('dtab-' + DASH_TABS[j]).focus();
  });
});
try { showDashTab(localStorage.getItem('finances_dash_tab') || 'comptes', false, false); } catch { /* onglet Comptes par défaut */ }

// Bloc dépliable (<details>) dont l'état ouvert / fermé est mémorisé. Seuls les gestes de l'utilisateur sont
// enregistrés : l'ouverture par défaut (selon la taille d'écran) ne fige pas de préférence.
function initFold(id, key, defaultOpen) {
  const el = document.getElementById(id);
  if (!el) return;
  let saved = null;
  try { saved = localStorage.getItem(key); } catch { /* ignoré */ }
  el.open = saved === null ? defaultOpen : saved === '1';
  el.querySelector('summary').addEventListener('click', () => {
    setTimeout(() => { try { localStorage.setItem(key, el.open ? '1' : '0'); } catch { /* ignoré */ } }, 0);
  });
}
const WIDE_SCREEN = window.matchMedia('(min-width: 960px)').matches;
initFold('fold-upcoming', 'finances_fold_upcoming', true);
initFold('fold-recent', 'finances_fold_recent', WIDE_SCREEN);   // replié par défaut sur téléphone, déplié sur grand écran

// Le tableau des opérations de la carte se replie / se déplie : on se souvient du choix
// (l'évènement « toggle » ne remonte pas : écoute en phase de capture)
document.getElementById('list-accounts').addEventListener('toggle', (e) => {
  if (!e.target.matches) return;
  const key = e.target.matches('details[data-card-detail]') ? 'finances_card_detail'
    : e.target.matches('details[data-enc-detail]') ? 'finances_enc_detail' : null;
  if (key) { try { localStorage.setItem(key, e.target.open ? '1' : '0'); } catch { /* ignoré */ } }
}, true);

// Clic sur un compte (délégation : le nom du compte reste en données, pas dans du code HTML)
document.getElementById('list-accounts').addEventListener('click', (e) => {
  const row = e.target.closest('.acc-row');
  if (row) filterByAccount(row.dataset.account);
});
// Raccourcis de l'accueil
document.getElementById('qa-expense').addEventListener('click', () => { showTab('add-expense'); document.getElementById('btn-mode-expense').click(); });
document.getElementById('qa-transfer').addEventListener('click', () => { showTab('add-expense'); document.getElementById('btn-mode-transfer').click(); });
document.getElementById('qa-scheduled').addEventListener('click', () => showTab('scheduled'));

// ── INFOBULLE DES GRAPHIQUES (solde par mois) ────────────────────────────────
// Survoler (souris), toucher ou parcourir au clavier (flèches gauche / droite) une colonne du graphique affiche le mois et le solde
// correspondants dans une petite bulle ; la colonne est mise en évidence (trait vertical + point agrandi).

// Colonne la plus proche du pointeur : x et first (centre de la 1re colonne) dans les unités du graphique, step = largeur d'une colonne
function chartIndexAt(x, first, step, n) {
  if (!(n > 0) || !(step > 0) || !Number.isFinite(x)) return -1;
  return Math.max(0, Math.min(n - 1, Math.round((x - first) / step)));
}

// Place la bulle (coordonnées écran) : centrée au-dessus du point, en dessous s'il n'y a pas la place, toujours dans l'écran
function chartTipPosition(px, py, tipW, tipH, viewW, viewH) {
  const margin = 8, offset = 14;
  const left = Math.max(margin, Math.min(viewW - tipW - margin, px - tipW / 2));
  let top = py - tipH - offset;
  if (top < margin) top = py + offset;
  top = Math.max(margin, Math.min(viewH - tipH - margin, top));
  return { left, top };
}

let _tipChart = null;                                   // graphique dont la bulle est affichée : { svg, spec, i }

function hideChartTip() {
  const tip = document.getElementById('chart-tip');
  if (tip) tip.classList.add('hidden');
  if (_tipChart && _tipChart.svg.isConnected) {
    for (const el of _tipChart.svg.querySelectorAll('.ct-guide, .ct-dot')) el.setAttribute('visibility', 'hidden');
  }
  _tipChart = null;
}

function showChartTip(svg, spec, i) {
  const it = spec.items[i];
  const tip = document.getElementById('chart-tip');
  const m = svg.getScreenCTM();
  if (!it || !tip || !m) { hideChartTip(); return; }
  if (_tipChart && _tipChart.svg !== svg) hideChartTip();                // une seule bulle à la fois
  _tipChart = { svg, spec, i };
  const guide = svg.querySelector('.ct-guide'), dot = svg.querySelector('.ct-dot');
  if (guide) { guide.setAttribute('x1', it.x); guide.setAttribute('x2', it.x); guide.setAttribute('visibility', 'visible'); }
  if (dot) { dot.setAttribute('cx', it.x); dot.setAttribute('cy', it.y); dot.setAttribute('visibility', 'visible'); }
  tip.innerHTML = `<small>${esc(it.title)}</small><b class="pv${it.value < 0 ? ' neg' : ''}">${fmt(it.value)}</b>`;
  tip.classList.remove('hidden');
  const s = new DOMPoint(it.x, it.y).matrixTransform(m);
  const pos = chartTipPosition(s.x, s.y, tip.offsetWidth, tip.offsetHeight, window.innerWidth, window.innerHeight);
  tip.style.left = pos.left + 'px';
  tip.style.top = pos.top + 'px';
}

// Branche la bulle sur un graphique dessiné. spec = { items: [{ x, y, title, value }], first, step, left, right } : x, y, first, step,
// left et right sont dans les unités du graphique (viewBox) ; le pointeur n'est pris en compte qu'entre left et right.
function enableChartTooltip(svg, spec) {
  if (!svg || !spec || !spec.items.length) return;
  const n = spec.items.length;
  const point = (e) => {
    const m = svg.getScreenCTM();
    const u = m && new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    const i = !u || u.x < spec.left || u.x > spec.right ? -1 : chartIndexAt(u.x, spec.first, spec.step, n);
    if (i < 0) hideChartTip(); else showChartTip(svg, spec, i);
  };
  svg.addEventListener('pointermove', point);
  svg.addEventListener('pointerdown', point);
  svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hideChartTip(); });   // au doigt, la bulle reste jusqu'au toucher suivant
  svg.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hideChartTip(); return; }
    const cur = _tipChart && _tipChart.svg === svg ? _tipChart.i : n - 1;
    const next = e.key === 'ArrowLeft' ? Math.max(0, cur - 1) : e.key === 'ArrowRight' ? Math.min(n - 1, cur + 1)
      : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    showChartTip(svg, spec, next);
  });
  svg.addEventListener('focus', () => {
    try { if (svg.matches(':focus-visible')) showChartTip(svg, spec, n - 1); } catch { /* ancien navigateur : pas de bulle au focus */ }
  });
  svg.addEventListener('blur', hideChartTip);
}
document.addEventListener('pointerdown', (e) => { if (_tipChart && !_tipChart.svg.contains(e.target)) hideChartTip(); }, true);
window.addEventListener('scroll', () => { if (_tipChart) hideChartTip(); }, true);
window.addEventListener('resize', () => { if (_tipChart) hideChartTip(); });

// Jour du mois où le solde de chaque point est lu : 1 à 30, ou 0 = fin de mois (champ vide, 31 ou valeur invalide)
function normalizePointDay(raw) {
  const n = parseInt(raw, 10);
  return n >= 1 && n <= 30 ? n : 0;
}

// Date ('AAAA-MM-JJ') réellement lue pour un mois : le jour choisi, ou le dernier jour du mois (fin de mois, ou jour absent de ce
// mois, comme le 30 en février)
function pointDateOf(year, month, cutDay) {
  const last = new Date(year, month + 1, 0).getDate();
  const day = cutDay >= 1 && cutDay < last ? cutDay : last;
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Libellé d'un point du graphique : « Fin novembre 2026 » ou « Au 15 novembre 2026 », avec « · prévu » si la date n'est pas encore arrivée
function pointTitle(year, month, cutDay, todayStr) {
  const date = pointDateOf(year, month, cutDay);
  const monthName = new Date(year, month, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const day = +date.slice(8, 10);
  const text = day === new Date(year, month + 1, 0).getDate() ? `Fin ${monthName}` : `Au ${day === 1 ? '1er' : day} ${monthName}`;
  return date > todayStr ? `${text} · prévu` : text;
}

// Date lue pour le solde total (carte bleue de l'accueil) selon le choix « Jour du solde » : '' = aujourd'hui (null), 'end' = fin du
// mois en cours, 1 à 30 = ce jour du mois en cours (le dernier jour quand le mois est plus court). Toute autre valeur : aujourd'hui.
function balanceDayDate(choice, todayStr) {
  const day = normalizePointDay(choice);
  if (choice !== 'end' && !day) return null;
  return pointDateOf(+todayStr.slice(0, 4), +todayStr.slice(5, 7) - 1, day);
}

// Choix « Jour du solde » qui correspond à la date affichée : '' = aujourd'hui, 'end' = dernier jour du mois en cours, '26' = ce jour
// du mois en cours, 'custom' = une date d'un autre mois (choisie avec le calendrier sous la carte)
function balanceDayChoiceOf(date, todayStr) {
  if (!date) return '';
  if (date.slice(0, 7) !== todayStr.slice(0, 7)) return 'custom';
  const day = +date.slice(8, 10);
  return day === new Date(+date.slice(0, 4), +date.slice(5, 7), 0).getDate() ? 'end' : String(day);
}

// Évolution du solde sur les 12 derniers mois : comptes du solde total (par défaut), tous les comptes, ou un compte ;
// un point par mois, lu en fin de mois ou le jour choisi (#wealth-day)
function renderWealthChart() {
  const container = document.getElementById('wealth-chart');
  if (!container) return;
  hideChartTip();
  const scope = document.getElementById('wealth-account').value;
  const cutDay = normalizePointDay(fieldValue('wealth-day'));

  const now = new Date();
  const todayStr = localDateStr(now);
  const points = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const date = pointDateOf(d.getFullYear(), d.getMonth(), cutDay);
    const bal = cutDay ? calcScopeBalanceAsOf(scope, date) : calcScopeBalanceEndOfMonth(scope, d.getFullYear(), d.getMonth());
    const label = d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
    points.push({ label, date, title: pointTitle(d.getFullYear(), d.getMonth(), cutDay, todayStr), balance: bal });
  }

  const fmtK = v => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(v);
  const n = points.length;
  // Largeur réelle du conteneur : le graphique s'affiche à l'échelle 1:1 (texte lisible) au lieu d'être réduit de moitié
  const W = Math.max(300, Math.round(container.clientWidth) || 340);
  const H = 210;
  const pad = { top: 24, right: 12, bottom: 50, left: 65 };
  const cw = W - pad.left - pad.right;
  const ch = H - pad.top - pad.bottom;

  const balances = points.map(p => p.balance);
  const minB = Math.min(0, ...balances);
  const maxB = Math.max(0, ...balances);
  const range = maxB - minB || 1;

  const yScale = v => pad.top + ch - ((v - minB) / range) * ch;
  const gap = cw / n;
  const barW = Math.max(10, Math.min(32, gap * 0.6));
  const zeroY = yScale(0);

  const gridLines = [0, 0.5, 1].map(r => {
    const v = minB + r * range;
    const y = yScale(v);
    return `<line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" stroke="var(--border)" stroke-dasharray="3,3"/>
            <text x="${pad.left - 4}" y="${y + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${fmtK(v)}</text>`;
  }).join('');

  const bars = points.map((p, i) => {
    const x = pad.left + i * gap + (gap - barW) / 2;
    const y = yScale(p.balance);
    const h = Math.abs(y - zeroY);
    const top = p.balance >= 0 ? y : zeroY;
    const col = p.balance >= 0 ? '#43a047' : '#e53935';
    return `<rect x="${x}" y="${top}" width="${barW}" height="${h}" fill="${col}" rx="3" opacity="0.85"/>`;
  }).join('');

  const polyPts = points.map((p, i) => `${pad.left + i * gap + gap / 2},${yScale(p.balance)}`).join(' ');
  const dots = points.map((p, i) => {
    const x = pad.left + i * gap + gap / 2;
    return `<circle cx="${x}" cy="${yScale(p.balance)}" r="3" fill="var(--primary)" stroke="white" stroke-width="1.5"/>`;
  }).join('');

  const xLabels = points.map((p, i) => {
    const x = pad.left + i * gap + gap / 2;
    return `<text x="${x}" y="${H - pad.bottom + 14}" text-anchor="end" font-size="10" fill="var(--muted)" transform="rotate(-45 ${x} ${H - pad.bottom + 14})">${p.label}</text>`;
  }).join('');

  const svg = `<svg class="chart-hover" tabindex="0" role="group" aria-label="Évolution du solde sur 12 mois. Survolez ou touchez un mois pour voir son solde ; flèches gauche et droite au clavier." viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;min-width:300px">
    ${gridLines}
    <line x1="${pad.left}" y1="${zeroY}" x2="${W - pad.right}" y2="${zeroY}" stroke="var(--text)" stroke-width="0.5" opacity="0.3"/>
    ${bars}
    <line class="ct-guide" y1="${pad.top}" y2="${H - pad.bottom}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3,3" visibility="hidden" pointer-events="none"/>
    <polyline points="${polyPts}" fill="none" stroke="var(--primary)" stroke-width="2" opacity="0.6"/>
    ${dots}
    <circle class="ct-dot" r="6" fill="var(--primary)" stroke="white" stroke-width="2" visibility="hidden" pointer-events="none"/>
    ${xLabels}
  </svg>`;
  container.innerHTML = svg;
  enableChartTooltip(container.querySelector('svg'), {
    items: points.map((p, i) => ({ x: pad.left + i * gap + gap / 2, y: yScale(p.balance), title: p.title, value: p.balance })),
    first: pad.left + gap / 2, step: gap, left: pad.left, right: W - pad.right,
  });

  // résumé sous le graphique : du plus ancien au plus récent des 12 points
  const first = points[0], last = points[n - 1], diff = last.balance - first.balance;
  const when = p => (cutDay ? `${+p.date.slice(8, 10)} ` : '') + p.label;          // « 15 nov. 26 » avec un jour choisi, « nov. 26 » en fin de mois
  document.getElementById('wealth-meta').innerHTML = `
    <div class="kpi-grid kpi-3">
      <div class="kpi"><span>Il y a 11 mois</span><b class="${first.balance < 0 ? 'neg' : ''}">${fmt(first.balance)}</b><small>${when(first)}</small></div>
      <div class="kpi"><span>Ce mois-ci</span><b class="${last.balance < 0 ? 'neg' : ''}">${fmt(last.balance)}</b><small>${when(last)}</small></div>
      <div class="kpi"><span>Variation</span><b class="${diff < 0 ? 'neg' : diff > 0 ? 'pos' : ''}">${signedFmt(diff)}</b><small>en 11 mois</small></div>
    </div>`;
}

let opsMonth = new Date().getMonth();
let opsYear  = new Date().getFullYear();
let opsSortAsc = true; // true = croissant (ancien→récent), false = décroissant

// ── RECHERCHE (sans accents ni majuscules, mots dans n'importe quel ordre) ──
function plainText(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
// Les mots cherchés ; « 12 500 F » forme un seul montant
function searchTerms(query) {
  return plainText(query).replace(/(\d)\s+(?=\d{3}(\D|$))/g, '$1').replace(/(\d)\s*f(?=\s|$)/g, '$1').split(/\s+/).filter(Boolean);
}
// Chaque mot doit se trouver dans le libellé, le commentaire, la catégorie, le compte ou la date (« novembre 2026 »),
// ou être exactement le montant
function matchesSearch(op, terms) {
  if (!terms.length) return true;
  const month = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'][+String(op.date).slice(5, 7) - 1];
  const text = plainText([op.label, op.comment, op.category, op.account, op.date ? formatDate(op.date) : '', month,
    isTransferOp(op) ? 'virement' : '', op.opType === 'Programmee' ? 'programmée' : ''].join(' '));
  return terms.every(t => text.includes(t) || (/^\d+$/.test(t) && op.amount === +t));
}
// Périodes proposées par la fenêtre de recherche (selon la date d'achat)
function searchRange(period) {
  const now = today(), month = monthIndexOf(now);
  const first = m => `${Math.floor(m / 12)}-${String(m % 12 + 1).padStart(2, '0')}-01`;
  if (period === 'mois') return { from: first(month), to: `${now.slice(0, 7)}-31` };
  if (period === '3mois') return { from: first(month - 2), to: `${now.slice(0, 7)}-31` };
  if (period === 'annee') return { from: `${now.slice(0, 4)}-01-01`, to: `${now.slice(0, 4)}-12-31` };
  return { from: '', to: '' };
}
// Les opérations trouvées, des plus récentes aux plus anciennes. pointed : '' | 'oui' | 'non'
function searchOperations({ query = '', period = '', account = '', type = '', pointed = '' }) {
  const terms = searchTerms(query), { from, to } = searchRange(period);
  return appData.operations.filter(op => (!account || op.account === account) && (!type || op.type === type)
    && (!pointed || (op.opType !== 'Programmee' && !!op.pointed === (pointed === 'oui')))
    && (!from || op.date >= from) && (!to || op.date <= to) && matchesSearch(op, terms))
    .sort((a, b) => b.date.localeCompare(a.date));
}
// Entrées et sorties d'une liste trouvée : mêmes règles que l'onglet Opérations
function searchTotals(ops, account) {
  return operationTotals({ monthView: false, rows: ops.map(op => ({ op })) }, account);
}
function totalsText({ income, expense }) {
  return [income && `entrées +${fmt(income)}`, expense && `sorties -${fmt(expense)}`].filter(Boolean).join(' · ');
}
function groupByMonth(ops) {
  const groups = [];
  for (const op of ops) {
    const key = op.date.slice(0, 7);
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) groups.push(group = { key, title: monthTitle(+key.slice(0, 4), +key.slice(5) - 1), ops: [] });
    group.ops.push(op);
  }
  return groups;
}
function describeSearch({ query = '', period = '', account = '', type = '', pointed = '' }) {
  return [query.trim() && `Recherche : « ${query.trim()} »`, { mois: 'Ce mois', '3mois': 'Les 3 derniers mois', annee: 'Cette année' }[period],
    account && `Compte : ${account}`, type && (type === 'credit' ? 'Revenus' : 'Dépenses'), pointed && (pointed === 'oui' ? 'Pointées' : 'Non pointées')]
    .filter(Boolean).join(' · ') || 'Toutes les opérations';
}
// Les résultats, à imprimer
function searchPrintDoc(criteria) {
  const ops = searchOperations(criteria), totals = searchTotals(ops, criteria.account);
  const notes = [];
  if (ops.some(op => op.opType === 'Programmee')) notes.push('Les opérations programmées sont listées mais ne sont pas comptées dans les totaux.');
  if (!criteria.account && ops.some(isTransferOp)) notes.push('Les virements entre vos comptes ne sont pas comptés dans les totaux.');
  const html = printPage('Recherche d’opérations', `${esc(describeSearch(criteria))}<br>${printCount(ops.length)}`,
    printSummary([['Total des entrées', (totals.income ? '+' : '') + fmt(totals.income), 'credit'], ['Total des sorties', (totals.expense ? '-' : '') + fmt(totals.expense), 'debit']])
    + printTable(ops.map(op => ({ op })), { account: criteria.account }, {})
    + notes.map(n => `<p class="footnote">${n}</p>`).join(''));
  const words = String(criteria.query || '').trim().replace(/[\\/:*?"<>|]/g, ' ');
  return { title: `Recherche ${words || 'opérations'} - ${fileDate(today())}`, html, count: ops.length };
}

// ── LIGNES DE LA LISTE (les mêmes à l'écran et à l'impression) ───────────────
// Filtres de l'onglet Opérations, tels qu'ils sont réglés à l'écran
function readOpsFilters() {
  const value = id => document.getElementById(id).value;
  return {
    account: value('filter-account'), type: value('filter-type'), category: value('filter-category'),
    search: value('filter-search').trim(),
    amountMin: parseInt(value('filter-amount-min'), 10) || 0, amountMax: parseInt(value('filter-amount-max'), 10) || 0,
    dateFrom: value('filter-date-from'), dateTo: value('filter-date-to'),
    year: opsYear, month: opsMonth,
  };
}

// Opérations faites pendant le mois mais comptées à un autre (prélèvement) : montrées à part, rien ne semble disparu
function deferredOps(account, year, month) {
  const key = `${year}-${String(month + 1).padStart(2, '0')}`;
  return appData.operations.filter(op => op.account === account && op.opType !== 'Programmee' && op.date.slice(0, 7) === key && balanceDate(op).slice(0, 7) !== key)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Avec un compte et sans autre filtre : un mois de ce compte, avec le solde de début, de fin et après chaque ligne
// (calculé dans l'ordre des dates). Sinon : toutes les opérations qui passent les filtres, des plus récentes aux plus anciennes.
function selectOperations(f) {
  const monthView = !!f.account && !f.type && !f.category && !f.search && !f.amountMin && !f.amountMax && !f.dateFrom && !f.dateTo;
  if (monthView) {
    const signed = op => (op.type === 'credit' ? op.amount : -op.amount);
    const ops = getMonthOps(f.account, f.year, f.month);
    // solde de fin de mois : même calcul que la projection ; solde de début = fin moins les opérations du mois
    const closing = calcBalanceEndOfMonth(f.account, f.year, f.month);
    const opening = closing - ops.reduce((s, op) => s + signed(op), 0);
    let running = opening;
    return { monthView, opening, closing, rows: ops.map(op => ({ op, balance: (running += signed(op)) })), deferred: deferredOps(f.account, f.year, f.month) };
  }
  const terms = searchTerms(f.search);
  const ops = [...appData.operations].sort((a, b) => a.date.localeCompare(b.date)).filter(op =>
    (!f.account || op.account === f.account)
    && (!f.type || op.type === f.type)
    && (!f.category || op.category === f.category || (op.category && op.category.startsWith(f.category + '/')))
    && matchesSearch(op, terms)
    && (!f.amountMin || op.amount >= f.amountMin) && (!f.amountMax || op.amount <= f.amountMax)
    && (!f.dateFrom || op.date >= f.dateFrom) && (!f.dateTo || op.date <= f.dateTo));
  return { monthView, rows: ops.reverse().map(op => ({ op })) };
}

// Entrées et sorties des lignes montrées. Hors vue d'un mois, les modèles d'opérations programmées ne comptent pas ;
// sur tous les comptes, les virements entre comptes non plus.
function operationTotals(view, account) {
  let income = 0, expense = 0;
  for (const { op } of view.rows) {
    if (!view.monthView && op.opType === 'Programmee') continue;
    if (!account && isTransferOp(op)) continue;
    if (op.type === 'credit') income += op.amount; else expense += op.amount;
  }
  return { income, expense };
}

// Les filtres actifs, en clair, pour l'en-tête imprimé
function describeOpsFilters(f) {
  const words = (...parts) => parts.filter(Boolean).join(' ');
  return [
    f.type && (f.type === 'credit' ? 'Crédits seulement' : 'Débits seulement'),
    f.category && `Catégorie : ${f.category}`,
    f.search && `Recherche : « ${f.search} »`,
    (f.dateFrom || f.dateTo) && words('Dates :', f.dateFrom && `à partir du ${formatDate(f.dateFrom)}`, f.dateTo && `jusqu’au ${formatDate(f.dateTo)}`),
    (f.amountMin || f.amountMax) && words('Montants :', f.amountMin && `à partir de ${fmt(f.amountMin)}`, f.amountMax && `jusqu’à ${fmt(f.amountMax)}`),
  ].filter(Boolean).join(' · ');
}

function renderOperations() {
  const filters = readOpsFilters();
  const accFilter = filters.account;
  const view = selectOperations(filters);

  const monthNav = document.getElementById('ops-month-nav');
  updateFiltersBadge();

  if (view.monthView) {
    monthNav.style.display = 'flex';
    monthNav.classList.remove('hidden');
    document.getElementById('ops-month-label').textContent = monthTitle(opsYear, opsMonth);
  } else {
    monthNav.style.display = 'none';
  }

  // avec une recherche ou un filtre : nombre trouvé et totaux
  const summary = document.getElementById('ops-summary');
  const filtered = !view.monthView && !!(filters.search || filters.type || filters.category || filters.dateFrom || filters.dateTo || filters.amountMin || filters.amountMax);
  summary.classList.toggle('hidden', !filtered);
  if (filtered) {
    const total = totalsText(operationTotals(view, accFilter));
    summary.textContent = `${fmtInt(view.rows.length)} résultat${view.rows.length > 1 ? 's' : ''}${total ? ' · ' + total : ''}`;
  }

  const list = document.getElementById('list-operations');
  if (view.monthView) {
    // Afficher solde début de mois
    const fmtN = v => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(v);
    document.getElementById('ops-month-balance').textContent =
      `Solde début de mois : ${fmtN(view.opening)} F`;
    document.getElementById('ops-title').textContent = accFilter + ` (${view.rows.length})`;

    const later = deferredHtml(opsSortAsc ? view.deferred : [...view.deferred].reverse());
    if (!view.rows.length) {
      list.innerHTML = '<li class="empty-state">Aucune opération comptée ce mois</li>' + later;
      return;
    }

    // Afficher dans l'ordre choisi
    const displayOps = opsSortAsc ? view.rows : [...view.rows].reverse();

    list.innerHTML = displayOps.map(({ op, balance }) => {
      const sign = op.type === 'credit' ? '+' : '-';
      const balCol = balance >= 0 ? 'var(--accent)' : 'var(--danger)';
      const pointed = op.pointed ? 'opacity:0.5;' : '';
      const checkIcon = op.pointed ? '✅' : '⬜';
      const isProgrammee = op.opType === 'Programmee';
      const metaSuffix = isProgrammee ? ' · programmée' : '';
      return `<li style="flex-direction:column;align-items:stretch;gap:6px;padding:12px 16px;cursor:pointer;${pointed}" data-action="edit" data-id="${esc(op.id)}" data-date="${esc(op.date)}">
        <div style="display:flex;align-items:center;gap:12px">
          ${isProgrammee ? '<span class="op-icon">🔁</span>' : `<span class="op-check" role="checkbox" aria-checked="${op.pointed ? 'true' : 'false'}" aria-label="Pointer l'opération" data-action="point" data-id="${esc(op.id)}">${checkIcon}</span>`}
          <div class="op-info">
            <div class="op-label">${esc(op.label)}</div>
            <div class="op-meta">${formatDate(op.date)}${debitNote(op)} · ${esc(op.category || '')}${metaSuffix}${op.pointed ? ' · ✓ pointée' : ''}</div>
            ${commentHtml(op)}
          </div>
          <span class="op-amount ${op.type}">${sign}${fmt(op.amount)}</span>
        </div>
        <div style="text-align:right;font-size:0.78rem;color:${balCol};font-weight:600;border-top:1px solid var(--border);padding-top:5px">
          Solde : ${fmtN(balance)} F
        </div>
      </li>`;
    }).join('') + later;
    return;
  }

  // Vue normale sans filtre de mois
  const ops = view.rows.map(r => r.op);

  const title = accFilter ? accFilter : 'Toutes les opérations';
  document.getElementById('ops-title').textContent = title + ` (${ops.length})`;

  if (!ops.length) { list.innerHTML = '<li class="empty-state">Aucune opération</li>'; return; }

  // Pagination : on n'affiche que les OPS_PAGE premières lignes (la liste complète fait des milliers de lignes,
  // ce qui rendait l'onglet lent et la page interminable). Le reste se charge au défilement ou au clic.
  const sig = [accFilter, filters.type, filters.category, filters.search.toLowerCase(), filters.amountMin, filters.amountMax, filters.dateFrom, filters.dateTo].join('|');
  if (sig !== opsSig) {
    opsSig = sig; opsLimit = OPS_PAGE;
    // nouvelle recherche / nouveaux filtres : on repart du haut de la liste (sinon le défilement automatique rechargerait des pages)
    if (document.getElementById('tab-operations').classList.contains('active')) window.scrollTo(0, 0);
  }
  const shown = ops.slice(0, opsLimit);
  const remaining = ops.length - shown.length;
  list.innerHTML = shown.map(op => opHtml(op, !accFilter)).join('') +
    (remaining > 0
      ? `<li class="more-row"><button type="button" id="btn-ops-more" class="btn-secondary" data-action="more">Afficher plus (${fmtInt(remaining)} restantes)</button></li>`
      : '');
  observeMoreOps();
}

function deferredHtml(ops) {
  if (!ops.length) return '';
  const total = ops.reduce((s, op) => s + (op.type === 'debit' ? op.amount : -op.amount), 0);
  return `<li class="deferred-head"><b>Faites ce mois, comptées plus tard (${ops.length})</b><span class="pv">${total >= 0 ? '-' : '+'}${fmt(Math.abs(total))}</span></li>`
    + ops.map(op => opHtml(op)).join('');
}

// ── PAGINATION DE LA LISTE DES OPÉRATIONS ────────────────────────────────────
const OPS_PAGE = 100;   // lignes affichées d'un coup
let opsLimit = OPS_PAGE;
let opsSig = '';        // signature des filtres : change → on repart de la première page
const fmtInt = n => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n);
window.showMoreOps = function() { opsLimit += OPS_PAGE; renderOperations(); };
let _moreObserver = null;
function observeMoreOps() {
  if (_moreObserver) { _moreObserver.disconnect(); _moreObserver = null; }
  const btn = document.getElementById('btn-ops-more');
  if (!btn || typeof IntersectionObserver === 'undefined') return;
  // chargement automatique quand le bouton approche de l'écran (le bouton reste utilisable en secours)
  _moreObserver = new IntersectionObserver((entries) => {
    if (entries.some(e => e.isIntersecting)) showMoreOps();
  }, { rootMargin: '600px 0px' });
  _moreObserver.observe(btn);
}

// ── FILTRES (panneau repliable + pastille du nombre de filtres actifs) ───────
const FILTER_IDS = ['filter-account', 'filter-type', 'filter-category', 'filter-date-from', 'filter-date-to', 'filter-amount-min', 'filter-amount-max'];
function updateFiltersBadge() {
  const badge = document.getElementById('filters-badge');
  if (!badge) return;
  const n = FILTER_IDS.filter(id => document.getElementById(id).value).length;
  badge.textContent = n;
  badge.classList.toggle('hidden', n === 0);
}
document.getElementById('btn-toggle-filters').addEventListener('click', () => {
  const panel = document.getElementById('ops-filters');
  const open = panel.classList.toggle('hidden') === false;
  document.getElementById('btn-toggle-filters').setAttribute('aria-expanded', open ? 'true' : 'false');
});

function opHtml(op, showAccount = false) {
  const sign = op.type === 'credit' ? '+' : '-';
  // pas de séparateur « · » orphelin quand la catégorie ou le compte est vide
  const meta = [formatDate(op.date) + debitNote(op), showAccount ? esc(op.account || '') : '', esc(op.category || '')].filter(Boolean).join(' · ');
  const pointed = op.pointed ? 'opacity:0.5;' : '';
  const checkIcon = op.pointed ? '✅' : '⬜';
  return `<li style="cursor:pointer;${pointed}" data-action="edit" data-id="${esc(op.id)}" data-date="${esc(op.date)}">
    <span class="op-check" role="checkbox" aria-checked="${op.pointed ? 'true' : 'false'}" aria-label="Pointer l'opération" data-action="point" data-id="${esc(op.id)}">${checkIcon}</span>
    <div class="op-info">
      <div class="op-label">${esc(op.label)}</div>
      <div class="op-meta">${meta}</div>
      ${commentHtml(op)}
    </div>
    <span class="op-amount ${op.type}">${sign}${fmt(op.amount)}</span>
  </li>`;
}

// Commentaire libre d'une opération : espaces retirés, 200 caractères au plus ; rien s'il est vide
function cleanComment(text) {
  const c = String(text || '').trim().slice(0, 200);
  return c || undefined;
}
function commentHtml(op, tag = 'div') {
  return op.comment ? `<${tag} class="op-comment">📝 ${esc(op.comment)}</${tag}>` : '';
}
// Un texte commençant comme une formule serait calculé par le tableur : on le garde comme texte
function safeCell(value) {
  const text = String(value === undefined || value === null ? '' : value);
  return /^[=+@\t\r]|^-(?![\d ])/.test(text) ? "'" + text : text;
}
// Champ d'un fichier CSV : entre guillemets s'il contient le séparateur, un guillemet ou un retour à la ligne
function csvField(value) {
  const text = safeCell(value);
  return /[;"\r\n]/.test(text) ? csvText(text) : text;
}
function csvText(value) {
  return '"' + String(value || '').split('"').join('""') + '"';
}

// « · prélevé le … » quand l'opération compte à un autre jour que le sien
function debitNote(op) {
  const day = bankDate(op);
  return day !== op.date ? ` · prélevé le ${formatDate(day)}` : '';
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function populateAccountFilters() {
  const names = getAccountNames();
  const opts = names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  const allOpt = '<option value="">Tous les comptes</option>';
  // On mémorise les choix en cours : reconstruire les listes les remettait à « Tous / premier compte »
  // à chaque enregistrement ou synchronisation (la liste affichée et le filtre ne correspondaient plus).
  const prev = {};
  for (const id of ['filter-account', 'wealth-account', 'stats-account', 'inp-account-name']) prev[id] = document.getElementById(id).value;
  document.getElementById('filter-account').innerHTML = allOpt + opts;
  const hasExcluded = names.some(n => !isAccountIncluded(n));
  const scopeOpts = allOpt + (hasExcluded ? '<option value="__total">Comptes du solde total</option>' : '') + opts;
  renderProjAccounts();
  document.getElementById('wealth-account').innerHTML = scopeOpts;
  document.getElementById('stats-account').innerHTML = allOpt + opts;
  document.getElementById('inp-account-name').innerHTML = opts || '<option value="courant">courant</option>';
  const restore = (id, v) => {
    const el = document.getElementById(id);
    if (v && [...el.options].some(o => o.value === v)) el.value = v;
  };
  restore('filter-account', prev['filter-account']);
  restore('wealth-account', prev['wealth-account']);   // (le choix par défaut, « comptes du solde total », est celui du HTML)
  restore('stats-account', prev['stats-account']);
  // compte de saisie : choix en cours, sinon le dernier compte utilisé
  restore('inp-account-name', prev['inp-account-name'] || localStorage.getItem('finances_last_account'));
}

function renderAll() {
  renderDashboard();
  renderStats();
  renderOperations();
  renderScheduled();
  populateAccountFilters();
  refreshEntryDebit();
  document.getElementById('display-email').textContent = localStorage.getItem('userEmail') || '—';
  updateSyncStatus();
  renderBackupList();
  renderQuickSuggestions();
  renderAccountsConfig();
  renderCategoriesConfig();
  renderBudgetsConfig();
  renderAlertsConfig();
  populateExportAccount();
  updateCategorySelects();
  updatePwdStatus();
  populateTotalAccountsConfig();
  populateCardConfig();
  renderSearch();   // fenêtre de recherche ouverte : ses résultats suivent les modifications
}

window.filterByAccount = function(name) {
  document.getElementById('filter-account').value = name;
  opsMonth = new Date().getMonth();
  opsYear  = new Date().getFullYear();
  renderOperations();
  showTab('operations');
};

// ── FILTRES ──────────────────────────────────────────────────────────────────
['filter-account','filter-type','filter-category','filter-date-from','filter-date-to'].forEach(id =>
  document.getElementById(id).addEventListener('change', renderOperations));
document.getElementById('filter-search').addEventListener('input', renderOperations);
document.getElementById('filter-amount-min').addEventListener('input', renderOperations);
document.getElementById('filter-amount-max').addEventListener('input', renderOperations);
document.getElementById('btn-filter-reset').addEventListener('click', () => {
  ['filter-account','filter-type','filter-category','filter-date-from','filter-date-to'].forEach(id =>
    document.getElementById(id).value = '');
  document.getElementById('filter-search').value = '';
  document.getElementById('filter-amount-min').value = '';
  document.getElementById('filter-amount-max').value = '';
  opsMonth = new Date().getMonth();
  opsYear  = new Date().getFullYear();
  renderOperations();
});
document.getElementById('btn-sort-ops').addEventListener('click', () => {
  opsSortAsc = !opsSortAsc;
  document.getElementById('btn-sort-ops').textContent = opsSortAsc ? '⬇️' : '⬆️';
  document.getElementById('btn-sort-ops').title = opsSortAsc ? 'Tri croissant (ancien→récent)' : 'Tri décroissant (récent→ancien)';
  renderOperations();
});

document.getElementById('btn-ops-month-prev').addEventListener('click', () => {
  opsMonth--; if (opsMonth < 0) { opsMonth = 11; opsYear--; }
  renderOperations();
});
document.getElementById('btn-ops-month-next').addEventListener('click', () => {
  opsMonth++; if (opsMonth > 11) { opsMonth = 0; opsYear++; }
  renderOperations();
});

// ── SAISIE DÉPENSE ───────────────────────────────────────────────────────────
function setDefaultDate() {
  document.getElementById('inp-date').value = today();
  refreshEntryDebit();
  const picker = document.getElementById('balance-date-picker');
  if (picker && !picker.value) picker.value = today();
}
document.getElementById('form-expense').addEventListener('submit', async (e) => {
  e.preventDefault();
  const accountName = document.getElementById('inp-account-name').value;
  const newAmount = parseAmount(document.getElementById('inp-amount').value);
  if (newAmount === null) { toast('⚠️ Montant invalide (nombre supérieur à 0)'); return; }
  const op = {
    id: uid(),
    date: document.getElementById('inp-date').value,
    label: document.getElementById('inp-label').value.trim(),
    amount: newAmount,
    category: document.getElementById('inp-category').value,
    type: document.getElementById('inp-type').value,
    account: accountName,
    accountId: 0,
    comment: cleanComment(document.getElementById('inp-comment').value),
    debitDate: debitDateOf('inp-debit', accountName, document.getElementById('inp-date').value),
  };
  // garde-fou : doublon, date très éloignée, montant inhabituel → on demande confirmation (rien n'est perdu si on corrige)
  const risks = checkOperationRisks(op, today());
  if (risks.length) {
    const answer = await askConfirm({ title: 'Vérifiez cette opération', lines: risks.map(r => r.text), newLabel: '🆕 Nouvelle saisie' });
    if (answer === 'new') startNewEntry('expense');
    if (answer !== true) return;
  }
  appData.operations.push(op);
  setPref('finances_last_account', accountName);
  saveLocal();
  renderAll();
  const fb = document.getElementById('save-feedback');
  fb.classList.remove('hidden');
  setTimeout(() => fb.classList.add('hidden'), 2000);
  resetExpenseEntry();
  toastAction(`✅ ${op.type === 'credit' ? 'Revenu' : 'Dépense'} de ${fmt(op.amount)} enregistré(e) sur ${accountName}`, 'Annuler', () => undoAdded([op.id]));
  if (accessToken) uploadToDrive().catch(err => toast('⚠️ ' + err.message));
});

// Formulaire vide pour une autre opération ; la dépense reste sur le même compte (pour enchaîner plusieurs saisies)
function resetExpenseEntry() {
  const form = document.getElementById('form-expense'), account = document.getElementById('inp-account-name').value;
  form.reset();
  setDefaultDate();
  document.getElementById('inp-account-name').value = account;
  setDebitField('inp-debit', '');
  refreshEntryDebit();
}
function resetTransferEntry() {
  document.getElementById('form-transfer').reset();
  document.getElementById('trf-date').value = today();
}
function startNewEntry(kind) {
  if (kind === 'transfer') resetTransferEntry(); else resetExpenseEntry();
  const amount = document.getElementById(kind === 'transfer' ? 'trf-amount' : 'inp-amount');
  amount.focus({ preventScroll: true });
  amount.scrollIntoView({ block: 'center' });
}
document.addEventListener('click', (e) => {
  const button = e.target.closest && e.target.closest('[data-new-entry]');
  if (button) startNewEntry(button.dataset.newEntry);
});

// ── BASCULE DÉPENSE / REVENU (saisie rapide) ─────────────────────────────────
// Le select caché #inp-type reste la source de vérité (lu à l'enregistrement) ; les boutons le pilotent.
function setExpenseType(type) {
  document.getElementById('inp-type').value = type;
  document.querySelectorAll('#form-expense .seg-btn').forEach(b => {
    const on = b.dataset.type === type;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const cat = document.getElementById('inp-category');
  if (type === 'credit' && cat.value !== 'Revenus' && [...cat.options].some(o => o.value === 'Revenus')) cat.value = 'Revenus';
  else if (type === 'debit' && cat.value === 'Revenus' && cat.options.length) cat.value = cat.options[0].value;
  renderQuickSuggestions();
}
document.querySelectorAll('#form-expense .seg-btn').forEach(b =>
  b.addEventListener('click', () => setExpenseType(b.dataset.type)));
document.getElementById('form-expense').addEventListener('reset', () => setTimeout(() => setExpenseType('debit'), 0));

// ── TOGGLE OPÉRATION / VIREMENT ──────────────────────────────────────────────
function setEntryModeButtons(mode) {
  for (const [id, on] of [['btn-mode-expense', mode === 'expense'], ['btn-mode-transfer', mode === 'transfer']]) {
    const b = document.getElementById(id);
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}
document.getElementById('btn-mode-expense').addEventListener('click', () => {
  document.getElementById('form-expense').classList.remove('hidden');
  document.getElementById('form-transfer').classList.add('hidden');
  setEntryModeButtons('expense');
});

document.getElementById('btn-mode-transfer').addEventListener('click', () => {
  document.getElementById('form-expense').classList.add('hidden');
  document.getElementById('form-transfer').classList.remove('hidden');
  setEntryModeButtons('transfer');
  // Remplir les selects
  const names = getAccountNames();
  const opts = names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  document.getElementById('trf-from').innerHTML = opts;
  document.getElementById('trf-to').innerHTML = opts;
  if (names.length > 1) document.getElementById('trf-to').selectedIndex = 1;
  document.getElementById('trf-date').value = today();
});

// ── VIREMENT ────────────────────────────────────────────────────────────────
document.getElementById('form-transfer').addEventListener('submit', async (e) => {
  e.preventDefault();
  const from   = document.getElementById('trf-from').value;
  const to     = document.getElementById('trf-to').value;
  const amount = parseAmount(document.getElementById('trf-amount').value);
  const date   = document.getElementById('trf-date').value;
  const comment = cleanComment(document.getElementById('trf-comment').value);

  if (from === to) { toast('⚠️ Les comptes source et destination doivent être différents'); return; }
  if (!amount || amount <= 0) { toast('⚠️ Montant invalide'); return; }

  // garde-fou : doublon, date très éloignée, compte source qui passerait en négatif
  const risks = checkTransferRisks(from, to, amount, date, today());
  if (risks.length) {
    const answer = await askConfirm({ title: 'Vérifiez ce virement', lines: risks.map(r => r.text), newLabel: '🆕 Nouvelle saisie' });
    if (answer === 'new') startNewEntry('transfer');
    if (answer !== true) return;
  }

  // Débit sur le compte source
  const debitLeg = {
    id: uid(),
    date,
    label: `[${to}]`,
    amount,
    type: 'debit',
    account: from,
    category: 'Virement',
    opType: 'Virement',
    comment,
  };
  // Crédit sur le compte destination
  const creditLeg = {
    id: uid(),
    date,
    label: `[${from}]`,
    amount,
    type: 'credit',
    account: to,
    category: 'Virement',
    opType: 'Virement',
    comment,
  };
  appData.operations.push(debitLeg, creditLeg);

  saveLocal();
  renderAll();
  resetTransferEntry();
  toastAction(`✅ Virement de ${fmt(amount)} : ${from} → ${to}`, 'Annuler', () => undoAdded([debitLeg.id, creditLeg.id]));
  if (accessToken) uploadToDrive().catch(err => toast('⚠️ ' + err.message));
});

// ── NAVIGATION ───────────────────────────────────────────────────────────────
// (le bouton ❓ de la barre n'a pas d'onglet : il ouvre l'aide ; sans ce filtre il vidait l'écran puis provoquait une erreur)
document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});
document.getElementById('btn-sync').addEventListener('click', () => {
  if (!accessToken) { startGoogleConnection(); return; }
  syncFromDrive();
});

document.getElementById('btn-force-upload').addEventListener('click', async () => {
  if (!accessToken) {
    if (startGoogleConnection()) toast('⏳ Connexion Google...');
    return;
  }
  try {
    document.getElementById('sync-detail').textContent = '⏳ Envoi en cours...';
    saveLocal(true); // horodate maintenant pour que cette version gagne partout
    await uploadToDrive();
    document.getElementById('sync-detail').textContent = '✅ Données envoyées vers Drive à ' + new Date().toLocaleTimeString('fr-FR');
    toast('✅ Données envoyées vers Drive');
  } catch (e) {
    document.getElementById('sync-detail').textContent = '❌ ' + e.message;
  }
});

document.getElementById('btn-force-download').addEventListener('click', async () => {
  if (!accessToken) {
    if (startGoogleConnection()) toast('⏳ Connexion Google...');
    return;
  }
  if (!confirm('Remplacer les données de cet appareil par celles de Google Drive ?\n\nCe qui n’a pas été envoyé à Drive sera retiré (une copie de secours est faite avant).')) return;
  try {
    document.getElementById('sync-detail').textContent = '⏳ Téléchargement...';
    const rev = await driveRevision();
    const remote = await downloadFromDrive();
    if (remote) {
      safeBackup();
      appData = remote;
      saveLocal(false);
      applyRemotePassword();
      if (rev && !storageFull) setPref('finances_driverev', rev);
      setPref('finances_basesync', remote.lastSync || '');
      localStorage.removeItem('finances_pending');
      renderAll();
      document.getElementById('sync-detail').textContent = '✅ Données récupérées de Drive — ' + (appData.operations || []).length + ' opérations';
      toast('✅ Données récupérées');
    } else {
      document.getElementById('sync-detail').textContent = '⚠️ Aucune donnée sur Drive';
    }
  } catch (e) {
    document.getElementById('sync-detail').textContent = '❌ ' + e.message;
  }
});

// ── GESTION DES COMPTES ─────────────────────────────────────────────────────
function renderAccountsConfig() {
  const names = getAccountNames();
  const container = document.getElementById('cfg-accounts-list');
  const KIND_SHORT = { courant: 'Courant', epargne: 'Épargne', credit: 'Crédit', carte: 'Carte' };
  container.innerHTML = names.map(name => {
    const ops = appData.operations.filter(op => op.account === name).length;
    const acc = appData.accounts.find(a => a.name === name);
    // type du compte (regroupement de l'accueil) : « Auto » = déduit du nom ; on peut le fixer à la main
    const auto = getAccountKind(acc ? { ...acc, kind: undefined } : { name });
    const kindSel = acc ? `<select class="cfg-kind" data-account="${esc(name)}" aria-label="Type du compte ${esc(name)}" style="width:auto;min-height:40px;padding:4px 8px;font-size:0.82rem;border-radius:8px">
        <option value="">Auto (${KIND_SHORT[auto]})</option>
        ${Object.entries(KIND_SHORT).map(([k, l]) => `<option value="${k}"${acc.kind === k ? ' selected' : ''}>${l}</option>`).join('')}
      </select>` : '';
    return `<div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:8px 0;border-bottom:1px solid var(--border)">
      <span style="flex:1;min-width:110px;font-size:0.9rem;font-weight:600">${esc(name)}</span>
      <span style="font-size:0.75rem;color:var(--muted)">${ops} ops</span>
      ${kindSel}
      <button type="button" data-action="account-rename" data-name="${esc(name)}" aria-label="Renommer le compte ${esc(name)}" style="padding:4px 8px;border:1px solid var(--border);border-radius:8px;background:var(--bg);font-size:0.75rem;cursor:pointer">✏️</button>
      <button type="button" data-action="account-delete" data-name="${esc(name)}" aria-label="Supprimer le compte ${esc(name)}" style="padding:4px 8px;border:1px solid var(--danger);border-radius:8px;background:var(--bg);font-size:0.75rem;cursor:pointer;color:var(--danger)">🗑</button>
    </div>`;
  }).join('');
  container.querySelectorAll('.cfg-kind').forEach(sel => sel.addEventListener('change', () => {
    const acc = appData.accounts.find(a => a.name === sel.dataset.account);
    if (!acc) return;
    if (sel.value) acc.kind = sel.value; else delete acc.kind;
    saveLocal();
    renderDashboard();
    renderAccountsConfig();
  }));
}

function forgetAccount(name) {
  appData.deletedAccounts = { ...appData.deletedAccounts, [name]: new Date().toISOString() };
}

window.renameAccount = function(oldName) {
  const newName = prompt(`Renommer "${oldName}" en :`, oldName);
  if (!newName || newName === oldName) return;
  const existing = appData.accounts.find(a => a.name === newName);
  if (existing) { toast('⚠️ Ce nom de compte existe déjà'); return; }
  const acc = appData.accounts.find(a => a.name === oldName);
  if (acc) acc.name = newName;
  forgetAccount(oldName);
  appData.operations.forEach(op => {
    if (op.account === oldName) op.account = newName;
    // Mettre à jour les libellés de virement [oldName]
    if (op.label === `[${oldName}]`) op.label = `[${newName}]`;
    if (op.virementDest === oldName) op.virementDest = newName;
  });
  saveLocal();
  renderAll();
  toast(`✅ Compte renommé : ${oldName} → ${newName}`);
  if (accessToken) uploadToDrive().catch(() => {});
};

window.deleteAccount = function(name) {
  const ops = appData.operations.filter(op => op.account === name).length;
  if (!confirm(`Supprimer le compte "${name}" et ses ${ops} opérations ?\n\nCette action est irréversible.`)) return;
  appData.accounts = appData.accounts.filter(a => a.name !== name);
  forgetAccount(name);
  dropOps(op => op.account !== name);
  saveLocal();
  renderAll();
  toast(`🗑 Compte "${name}" supprimé`);
  if (accessToken) uploadToDrive().catch(() => {});
};

document.getElementById('btn-add-account').addEventListener('click', () => {
  const name = document.getElementById('cfg-new-account').value.trim();
  if (!name) { toast('⚠️ Nom requis'); return; }
  const existing = appData.accounts.find(a => a.name === name);
  if (existing) { toast('⚠️ Ce nom existe déjà'); return; }
  appData.accounts.push({ id: appData.accounts.length + 1, name, initialBalance: 0 });
  document.getElementById('cfg-new-account').value = '';
  saveLocal();
  renderAll();
  toast(`✅ Compte "${name}" créé`);
  if (accessToken) uploadToDrive().catch(() => {});
});

// ── CONFIG COMPTES SOLDE TOTAL ───────────────────────────────────────────────
function populateTotalAccountsConfig() {
  const container = document.getElementById('cfg-total-accounts');
  const names = getAccountNames();
  container.innerHTML = names.map(name => {
    const acc = appData.accounts.find(a => a.name === name);
    const checked = !acc || acc.includeInTotal !== false ? 'checked' : '';
    return `<label style="display:flex;align-items:center;gap:8px;font-size:0.9rem;font-weight:400;color:var(--text);cursor:pointer">
      <input type="checkbox" ${checked} data-account="${esc(name)}" class="cfg-total-cb" style="width:18px;height:18px;accent-color:var(--primary)"/>
      ${esc(name)}
    </label>`;
  }).join('');

  container.querySelectorAll('.cfg-total-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const accName = cb.dataset.account;
      const acc = appData.accounts.find(a => a.name === accName);
      if (acc) acc.includeInTotal = cb.checked;
      saveLocal();
      renderDashboard();
      if (accessToken) uploadToDrive().catch(() => {});
    });
  });
}

// ── CATÉGORIES ET SOUS-CATÉGORIES ────────────────────────────────────────────
// Une catégorie d'opération s'écrit « Principale » ou « Principale/Sous-catégorie ». La liste proposée est celle de l'utilisateur
// (appData.categories et appData.subcategories) ; tant qu'il n'y a pas touché, ce sont les catégories de base. Toute catégorie encore
// utilisée par des opérations (anciens imports…) est proposée en plus : on peut la renommer, la fusionner ou la supprimer, et une
// opération ne perd jamais sa catégorie quand on la modifie. « Autre » (= sans catégorie) et « Virement » restent réservées.
const DEFAULT_CATEGORIES = ['Alimentation','Transport','Sante','Loisirs','Logement','Telecom','Revenus','Autre'];
const CAT_RESERVED = ['autre', 'virement', 'transfert'];                 // noms qui ont un sens pour l'application (comparés sans casse)
const CAT_PALETTE = ['#ef6c00', '#1565c0', '#c62828', '#6a1b9a', '#2e7d32', '#00838f', '#ad1457', '#4e342e', '#827717', '#283593'];

// « Principale/Sous » → { main, sub } (sub vide quand il n'y a pas de sous-catégorie)
function splitCategory(cat) {
  const s = cat === null || cat === undefined ? '' : String(cat);
  const i = s.indexOf('/');
  return i < 0 ? { main: s, sub: '' } : { main: s.slice(0, i), sub: s.slice(i + 1) };
}
function joinCategory(main, sub) {
  return sub ? `${main}/${sub}` : main;
}
// Clé de comparaison de deux noms : sans casse ni espaces en trop (« alimentation » = « Alimentation »)
function catKey(name) {
  return String(name === null || name === undefined ? '' : name).trim().replace(/\s+/g, ' ').toLowerCase();
}
function isReservedCategory(name) {
  return CAT_RESERVED.includes(catKey(name));
}
// Nom valide pour une catégorie (ou une sous-catégorie si isSub) : { name } nettoyé, ou { error } en français
function checkCategoryName(raw, isSub) {
  const name = String(raw === null || raw === undefined ? '' : raw).trim().replace(/\s+/g, ' ');
  if (!name) return { error: 'Donnez un nom.' };
  if (name.includes('/')) return { error: 'Le nom ne peut pas contenir « / ».' };
  if (name.length > 40) return { error: 'Nom trop long (40 caractères au plus).' };
  if (name === '__proto__') return { error: 'Nom non autorisé.' };
  if (!isSub && isReservedCategory(name)) return { error: `« ${name} » est réservé à l'application.` };
  if (/cat[ée]goris/i.test(name)) return { error: 'Ce nom est réservé aux opérations « à catégoriser ».' };
  return { name };
}

// Catalogue des catégories proposées, dans l'ordre d'affichage : [{ name, count, listed, subs: [{ name, count }] }].
// count = opérations qui l'utilisent (sous-catégories comprises) ; listed = figure dans la liste de l'utilisateur (sinon elle ne vient
// que des opérations). Les sous-catégories suivent la même règle. « Autre », « Virement » et les « à catégoriser » n'y figurent pas.
function getCategoryCatalog() {
  const mainCount = new Map();
  const subCount = new Map();                                            // principale → Map(sous-catégorie → opérations)
  for (const o of appData.operations) {
    const { main, sub } = splitCategory(o.category);
    if (!main.trim() || isReservedCategory(main) || /cat[ée]goris/i.test(main)) continue;
    mainCount.set(main, (mainCount.get(main) || 0) + 1);
    if (!sub) continue;
    if (!subCount.has(main)) subCount.set(main, new Map());
    const m = subCount.get(main);
    m.set(sub, (m.get(sub) || 0) + 1);
  }
  const listed = [];
  for (const c of Array.isArray(appData.categories) ? appData.categories : DEFAULT_CATEGORIES) {
    if (typeof c === 'string' && c.trim() && !isReservedCategory(c) && !listed.includes(c)) listed.push(c);
  }
  const orphans = [...mainCount.keys()].filter(c => !listed.includes(c))
    .sort((a, b) => mainCount.get(b) - mainCount.get(a) || a.localeCompare(b));
  const explicit = appData.subcategories || {};
  return [...listed, ...orphans].map(name => {
    const counts = subCount.get(name) || new Map();
    const names = [];
    for (const s of Array.isArray(explicit[name]) ? explicit[name] : []) if (typeof s === 'string' && s.trim() && !names.includes(s)) names.push(s);
    const extra = [...counts.keys()].filter(s => !names.includes(s)).sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b));
    return { name, count: mainCount.get(name) || 0, listed: listed.includes(name), subs: [...names, ...extra].map(s => ({ name: s, count: counts.get(s) || 0 })) };
  });
}

// La catégorie (ou « Principale/Sous ») existe-t-elle dans le catalogue ? « Autre » existe toujours.
function categoryExists(catalog, cat) {
  if (catKey(cat) === 'autre') return true;
  const { main, sub } = splitCategory(cat);
  const entry = catalog.find(c => c.name === main);
  return !!entry && (!sub || entry.subs.some(s => s.name === sub));
}

// Pictogramme d'une catégorie : choisi par l'utilisateur, sinon celui de base, sinon déduit du nom
function guessCatIcon(cat) {
  const c = String(cat || '').toLowerCase();
  if (/salaire|revenu|paie|rembours/.test(c)) return '💰';
  if (/aliment|course|restaur|supermarch/.test(c)) return '🛒';
  if (/carburant|essence|transport|voiture/.test(c)) return '🚗';
  if (/sant(é|e)|pharmac|m(é|e)decin|mutuelle/.test(c)) return '💊';
  if (/loisir|sport|cin(é|e)ma|vacances/.test(c)) return '🎉';
  if (/logement|loyer|(é|e)lectricit|gaz|syndicat/.test(c)) return '🏠';
  if (/t(é|e)l(é|e)phone|internet|mobile|redevance/.test(c)) return '📱';
  if (/assurance|imp(ô|o)t|taxe/.test(c)) return '🧾';
  return '';
}
function catIcon(name) {
  const main = splitCategory(name).main;
  return (appData.catIcons && appData.catIcons[main]) || CAT_ICONS[main] || guessCatIcon(main) || '📦';
}
// Couleur d'une catégorie (barres des analyses) : choisie à la création du nom, sinon celle de base, sinon tirée du nom
function hashColor(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return CAT_PALETTE[h % CAT_PALETTE.length];
}
function catColor(name) {
  const main = splitCategory(name).main;
  return (appData.catColors && appData.catColors[main]) || CAT_COLORS[main] || hashColor(main);
}

// ── Modifier le catalogue : créer, renommer (ou fusionner), supprimer ──
// Chaque fonction renvoie { error } sans rien modifier, ou { name, ops, undo } : ops = nombre d'opérations dont la catégorie a changé ;
// undo rétablit tout exactement (undoCategoryChange). Seule la catégorie des opérations change : jamais un montant, une date ni un solde.
function snapshotCatalog() {
  const s = {};
  for (const k of ['categories', 'subcategories', 'budgets', 'catIcons', 'catColors']) s[k] = appData[k] === undefined ? null : JSON.parse(JSON.stringify(appData[k]));
  return s;
}
function restoreCatalog(s) {
  for (const k of ['categories', 'subcategories', 'budgets', 'catIcons', 'catColors']) {
    if (s[k] === null) delete appData[k]; else appData[k] = JSON.parse(JSON.stringify(s[k]));
  }
}
function undoCategoryChange(u) {
  restoreCategories(u.ops);
  restoreCatalog(u.catalog);
}
// Fige la liste actuelle (celle de l'utilisateur + les catégories encore utilisées) dans appData, pour pouvoir la modifier
function materializeCatalog() {
  const cat = getCategoryCatalog();
  const subs = { ...(appData.subcategories || {}) };
  for (const c of cat) {
    if (c.subs.length) subs[c.name] = c.subs.map(s => s.name);
    else delete subs[c.name];
  }
  appData.categories = cat.map(c => c.name);
  appData.subcategories = subs;
}
// Change la catégorie de toutes les opérations pour lesquelles fn(catégorie) renvoie une autre valeur ; renvoie de quoi annuler
function remapCategories(fn) {
  const undo = [];
  for (const o of appData.operations) {
    if (typeof o.category !== 'string' || !o.category) continue;
    const next = fn(o.category);
    if (typeof next !== 'string' || next === o.category) continue;
    undo.push({ id: o.id, category: o.category });
    o.category = next;
  }
  return undo;
}
// Pictogramme choisi par l'utilisateur ('' = revenir à celui par défaut)
function setCategoryIcon(name, icon) {
  const t = Array.from(String(icon === null || icon === undefined ? '' : icon).trim()).slice(0, 6).join('');
  const icons = { ...(appData.catIcons || {}) };
  if (t) icons[name] = t; else delete icons[name];
  if (Object.keys(icons).length) appData.catIcons = icons; else delete appData.catIcons;
}
// L'aspect d'une catégorie (pictogramme, couleur) suit son nouveau nom
function moveCategoryStyle(from, to) {
  const icons = { ...(appData.catIcons || {}) }, colors = { ...(appData.catColors || {}) };
  const icon = icons[from] || CAT_ICONS[from];
  colors[to] = catColor(from);
  if (icon) icons[to] = icon;
  delete icons[from];
  delete colors[from];
  if (Object.keys(icons).length) appData.catIcons = icons; else delete appData.catIcons;
  appData.catColors = colors;
}
function dropCategoryStyle(name) {
  for (const k of ['catIcons', 'catColors']) {
    if (!appData[k] || !(name in appData[k])) continue;
    const m = { ...appData[k] };
    delete m[name];
    if (Object.keys(m).length) appData[k] = m; else delete appData[k];
  }
}

function addMainCategory(rawName, icon) {
  const v = checkCategoryName(rawName, false);
  if (v.error) return v;
  if (getCategoryCatalog().some(c => catKey(c.name) === catKey(v.name))) return { error: `« ${v.name} » existe déjà.` };
  const catalog = snapshotCatalog();
  materializeCatalog();
  appData.categories.push(v.name);
  if (icon) setCategoryIcon(v.name, icon);
  return { name: v.name, ops: 0, undo: { ops: [], catalog } };
}

function addSubCategory(main, rawName) {
  const v = checkCategoryName(rawName, true);
  if (v.error) return v;
  const entry = getCategoryCatalog().find(c => c.name === main);
  if (!entry) return { error: 'Catégorie introuvable.' };
  if (entry.subs.some(s => catKey(s.name) === catKey(v.name))) return { error: `« ${v.name} » existe déjà dans « ${main.trim()} ».` };
  const catalog = snapshotCatalog();
  materializeCatalog();
  appData.subcategories[main] = [...(appData.subcategories[main] || []), v.name];
  return { name: v.name, ops: 0, undo: { ops: [], catalog } };
}

// Renomme une catégorie principale (les opérations et leurs sous-catégories suivent). Si le nouveau nom est celui d'une autre
// catégorie, elles sont fusionnées dans celle-ci. icon : undefined = inchangé, '' = pictogramme par défaut.
function renameMainCategory(oldName, rawNew, icon) {
  const cat = getCategoryCatalog();
  if (!cat.some(c => c.name === oldName)) return { error: 'Catégorie introuvable.' };
  const v = checkCategoryName(rawNew, false);
  if (v.error) return v;
  const other = cat.find(c => c.name !== oldName && catKey(c.name) === catKey(v.name));
  const target = other ? other.name : v.name;
  if (target === oldName && icon === undefined) return { error: 'Aucun changement.' };
  const catalog = snapshotCatalog();
  materializeCatalog();
  let ops = [];
  if (target !== oldName) {
    ops = remapCategories(c => { const p = splitCategory(c); return p.main === oldName ? joinCategory(target, p.sub) : c; });
    const subs = appData.subcategories;
    const moved = subs[oldName] || [];
    delete subs[oldName];
    const i = appData.categories.indexOf(oldName);
    if (other) {
      appData.categories.splice(i, 1);
      const have = subs[target] || [];
      const union = [...have, ...moved.filter(s => !have.includes(s))];
      if (union.length) subs[target] = union;
    } else {
      appData.categories[i] = target;
      if (moved.length) subs[target] = moved;
    }
    const b = appData.budgets;
    if (b && b[oldName] !== undefined) {
      if (!other || b[target] === undefined) b[target] = b[oldName];
      delete b[oldName];
    }
    if (other) dropCategoryStyle(oldName); else moveCategoryStyle(oldName, target);
  }
  if (icon !== undefined && !other) setCategoryIcon(target, icon);
  return { name: target, merged: !!other, ops: ops.length, undo: { ops, catalog } };
}

// Renomme une sous-catégorie ; si le nom existe déjà dans la même catégorie, elles sont fusionnées.
function renameSubCategory(main, oldSub, rawNew) {
  const entry = getCategoryCatalog().find(c => c.name === main);
  if (!entry || !entry.subs.some(s => s.name === oldSub)) return { error: 'Sous-catégorie introuvable.' };
  const v = checkCategoryName(rawNew, true);
  if (v.error) return v;
  const other = entry.subs.find(s => s.name !== oldSub && catKey(s.name) === catKey(v.name));
  const target = other ? other.name : v.name;
  if (target === oldSub) return { error: 'Aucun changement.' };
  const catalog = snapshotCatalog();
  materializeCatalog();
  const from = joinCategory(main, oldSub), to = joinCategory(main, target);
  const ops = remapCategories(c => (c === from ? to : c));
  const list = appData.subcategories[main];
  const i = list.indexOf(oldSub);
  if (other) list.splice(i, 1); else list[i] = target;
  return { name: target, merged: !!other, ops: ops.length, undo: { ops, catalog } };
}

// Supprime une catégorie principale et ses sous-catégories. Aucune opération n'est supprimée : elles vont dans dest
// (« Autre » par défaut, ou une autre catégorie / sous-catégorie existante).
function deleteMainCategory(name, dest) {
  const cat = getCategoryCatalog();
  if (!cat.some(c => c.name === name)) return { error: 'Catégorie introuvable.' };
  const target = dest || 'Autre';
  if (splitCategory(target).main === name) return { error: 'Choisissez une autre destination.' };
  if (!categoryExists(cat, target)) return { error: 'Destination introuvable.' };
  const catalog = snapshotCatalog();
  materializeCatalog();
  const ops = remapCategories(c => (splitCategory(c).main === name ? target : c));
  appData.categories = appData.categories.filter(c => c !== name);
  delete appData.subcategories[name];
  if (appData.budgets) delete appData.budgets[name];
  dropCategoryStyle(name);
  return { name, dest: target, ops: ops.length, undo: { ops, catalog } };
}

// Supprime une sous-catégorie ; ses opérations vont dans dest (la catégorie principale par défaut).
function deleteSubCategory(main, sub, dest) {
  const cat = getCategoryCatalog();
  const entry = cat.find(c => c.name === main);
  if (!entry || !entry.subs.some(s => s.name === sub)) return { error: 'Sous-catégorie introuvable.' };
  const full = joinCategory(main, sub);
  const target = dest || main;
  if (target === full) return { error: 'Choisissez une autre destination.' };
  if (!categoryExists(cat, target)) return { error: 'Destination introuvable.' };
  const catalog = snapshotCatalog();
  materializeCatalog();
  const ops = remapCategories(c => (c === full ? target : c));
  appData.subcategories[main] = appData.subcategories[main].filter(s => s !== sub);
  if (!appData.subcategories[main].length) delete appData.subcategories[main];
  return { name: sub, dest: target, ops: ops.length, undo: { ops, catalog } };
}

// Options des listes de catégories (saisie, modification, filtre, import) : catégories, sous-catégories, puis « Autre » et « Virement »
function getAllCategoryOptions() {
  let html = '';
  for (const c of getCategoryCatalog()) {
    html += `<option value="${esc(c.name)}">${esc(catIcon(c.name))} ${esc(c.name.trim())}</option>`;
    for (const s of c.subs) html += `<option value="${esc(c.name)}/${esc(s.name)}">  ↳ ${esc(s.name.trim())}</option>`;
  }
  return html + `<option value="Autre">${esc(catIcon('Autre'))} Autre</option><option value="Virement">Virement</option>`;
}

function renderCategoriesConfig() {
  const el = document.getElementById('cfg-cat-summary');
  if (!el) return;
  const cat = getCategoryCatalog();
  const nSubs = cat.reduce((s, c) => s + c.subs.length, 0);
  el.textContent = `${cat.length} catégorie${cat.length > 1 ? 's' : ''} · ${nSubs} sous-catégorie${nSubs > 1 ? 's' : ''}`;
}

function updateCategorySelects() {
  const opts = getAllCategoryOptions();
  const filterOpts = '<option value="">Toutes catégories</option>' + opts;
  ['inp-category', 'edit-op-category', 'sch-category', 'paste-category'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      const cur = el.value;
      el.innerHTML = opts;
      if (cur) el.value = cur;
    }
  });
  const filterEl = document.getElementById('filter-category');
  if (filterEl) {
    const cur = filterEl.value;
    filterEl.innerHTML = filterOpts;
    if (cur) filterEl.value = cur;
  }
}

function getCategoryDisplay(cat) {
  if (!cat) return '';
  if (cat.includes('/')) {
    const { main, sub } = splitCategory(cat);
    return `${catIcon(main)} ${sub}`;
  }
  return cat;
}

// ── BUDGETS PAR CATÉGORIE ────────────────────────────────────────────────────
// Un budget mensuel par catégorie principale. Au-delà de 12 catégories, celles sans budget ni dépense sur les 12 derniers mois sont repliées.
function renderBudgetsConfig() {
  const budgets = appData.budgets || {};
  const names = [...getCategoryCatalog().map(c => c.name).filter(n => n !== 'Revenus'), 'Autre'];
  for (const k of Object.keys(budgets)) if (!names.includes(k)) names.push(k);       // un budget ne doit jamais devenir introuvable
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  const since = localDateStr(d);
  const recent = new Set();
  for (const o of appData.operations) {
    if (o.type === 'debit' && o.opType !== 'Programmee' && o.date >= since) recent.add(o.category ? splitCategory(o.category).main : 'Autre');
  }
  const row = cat => `<div style="display:flex;align-items:center;gap:8px">
      <span style="flex:1;font-size:0.85rem;overflow-wrap:anywhere">${esc(catIcon(cat))} ${esc(cat.trim())}</span>
      <input type="number" data-budget-cat="${esc(cat)}" value="${budgets[cat] || ''}" placeholder="—" min="0" inputmode="numeric" style="width:100px;padding:6px;text-align:right;font-size:0.85rem" aria-label="Budget mensuel : ${esc(cat.trim())}"/>
      <span style="font-size:0.78rem;color:var(--muted)">F</span>
    </div>`;
  const shown = names.length <= 12 ? names : names.filter(n => budgets[n] || recent.has(n));
  const hidden = names.filter(n => !shown.includes(n));
  document.getElementById('cfg-budgets').innerHTML = shown.map(row).join('')
    + (hidden.length ? `<details class="cfg-more"><summary>Autres catégories (${hidden.length})</summary><div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">${hidden.map(row).join('')}</div></details>` : '');
}

document.getElementById('btn-save-budgets').addEventListener('click', () => {
  if (!appData.budgets) appData.budgets = {};
  document.querySelectorAll('[data-budget-cat]').forEach(inp => {
    const cat = inp.dataset.budgetCat;
    const val = parseInt(inp.value, 10);
    if (val > 0) appData.budgets[cat] = val;
    else delete appData.budgets[cat];
  });
  saveLocal();
  renderAll();
  toast('✅ Budgets enregistrés');
  if (accessToken) uploadToDrive().catch(() => {});
});

// ── CONFIG CARTE DÉBIT DIFFÉRÉ ───────────────────────────────────────────────
function populateCardConfig() {
  const sel = document.getElementById('cfg-card-account');
  const names = getAccountNames();
  sel.innerHTML = names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  const deferred = appData.accounts.find(a => a.cardType === 'deferred');
  if (deferred) {
    sel.value = deferred.name;
    document.getElementById('cfg-card-cycle').value = deferred.billingCycleDay || '';
    document.getElementById('cfg-card-debit').value = deferred.billingDebitDay || '';
    document.getElementById('cfg-card-limit').value = deferred.cardLimit || '';
  }
}

document.getElementById('cfg-card-account').addEventListener('change', () => {
  const name = document.getElementById('cfg-card-account').value;
  const acc = appData.accounts.find(a => a.name === name);
  if (acc) {
    document.getElementById('cfg-card-cycle').value = acc.billingCycleDay || '';
    document.getElementById('cfg-card-debit').value = acc.billingDebitDay || '';
    document.getElementById('cfg-card-limit').value = acc.cardLimit || '';
  }
});

document.getElementById('btn-save-card-cfg').addEventListener('click', () => {
  const name = document.getElementById('cfg-card-account').value;
  const cycle = parseInt(document.getElementById('cfg-card-cycle').value, 10);
  const limit = parseInt(document.getElementById('cfg-card-limit').value, 10);
  if (!name || !cycle) { toast('⚠️ Compte et jour requis'); return; }
  const acc = appData.accounts.find(a => a.name === name);
  if (!acc) return;
  const debitDay = parseInt(document.getElementById('cfg-card-debit').value, 10) || 0;
  if (debitDay && debitDay !== cycle) {
    if (cycle !== acc.billingCycleDay || debitDay !== acc.billingDebitDay) applyCardRule(acc, { cut: cycle, debitDay }, today());
  } else {
    delete acc.billingDebitDay; delete acc.previousCycleDay; delete acc.debitRuleFrom;
    acc.billingCycleDay = cycle;
  }
  acc.cardType = 'deferred';
  acc.cardLimit = limit || 0;
  saveLocal();
  renderAll();
  toast('✅ Configuration carte enregistrée');
  if (accessToken) uploadToDrive().catch(() => {});
});

// ── AIDE CONTEXTUELLE ET GARDE-FOUS ──────────────────────────────────────────
// Boutons « i » : une explication courte à l'endroit où le chiffre s'affiche, avec les montants de l'utilisateur.
// Garde-fous : contrôles de bon sens avant d'enregistrer (jamais bloquants : on demande confirmation).

// Valeur d'un champ de l'écran (chaîne vide hors navigateur ou si le champ n'existe pas).
function fieldValue(id, fallback = '') {
  const el = typeof document !== 'undefined' ? document.getElementById(id) : null;
  return el && el.value !== undefined && el.value !== '' ? el.value : fallback;
}

// Écart en jours entre deux dates 'AAAA-MM-JJ'.
function daysBetween(fromStr, toStr) {
  return Math.round((new Date(toStr + 'T00:00:00') - new Date(fromStr + 'T00:00:00')) / 86400000);
}

// « aujourd'hui », « demain », « dans 12 jours », « il y a 3 jours ».
function describeDays(n) {
  if (n === 0) return "aujourd'hui";
  if (n === 1) return 'demain';
  if (n === -1) return 'hier';
  if (Math.abs(n) >= 730) {                                   // « dans 13149 jours » ne parle à personne : on passe aux années
    const years = Math.round(Math.abs(n) / 365.25);
    return n > 0 ? `dans environ ${years} ans` : `il y a environ ${years} ans`;
  }
  return n > 0 ? `dans ${n} jours` : `il y a ${-n} jours`;
}

// Aide sous un champ de saisie : montant lisible (pour repérer un zéro de trop) ou date en toutes lettres.
// Renvoie { text, warn } ; text vide = rien à afficher.
function hintText(kind, value, todayStr) {
  const v = String(value === null || value === undefined ? '' : value).trim();
  if (!v) return { text: '', warn: false };
  if (kind === 'amount') {
    const n = parseAmount(v);
    if (n === null) return { text: 'Entrez un nombre entier supérieur à 0 (sans signe ni virgule)', warn: true };
    const words = n >= 1000000
      ? ` — environ ${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n / 1000000)} million${n >= 2000000 ? 's' : ''}` : '';
    return { text: `${fmt(n)}${words}`, warn: false };
  }
  if (kind === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(new Date(v + 'T00:00:00'))) return { text: '', warn: false };
    const days = daysBetween(todayStr, v);
    const long = new Date(v + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return { text: `${long} (${describeDays(days)})`, warn: days > 60 || days < -366 };
  }
  return { text: '', warn: false };
}

// Contrôles de bon sens avant d'enregistrer une opération : doublon exact, date très éloignée d'aujourd'hui,
// montant bien supérieur à l'habitude pour le même libellé. Renvoie [{ code, text }] (texte déjà échappé).
// ── Doublons à la saisie ──
// Même commerçant : le premier mot d'un libellé se retrouve dans l'autre
function similarLabel(a, b) {
  const words = s => plainText(s).split(/[^a-z0-9]+/).filter(w => w.length >= 3);
  const x = words(a), y = words(b);
  return !!x.length && !!y.length && (y.includes(x[0]) || x.includes(y[0]));
}
// Un montant identique est-il significatif ? Même commerçant, montant pas « rond » ou gros montant : peu probable deux fois
function telltale(amount, a, b) {
  return similarLabel(a, b) || amount % 100 !== 0 || amount >= 10000;
}
// Déjà saisie ? Même compte, même sens, même montant : le même jour, ou à 3 jours près si la ressemblance est nette
function findDuplicates(op) {
  const gap = o => Math.abs(daysBetween(o.date, op.date));
  return appData.operations.filter(o => o.opType !== 'Programmee' && o.id !== op.id && o.account === op.account && o.type === op.type
    && o.amount === op.amount && !isTransferOp(o) && gap(o) <= 3 && (gap(o) === 0 || telltale(op.amount, o.label, op.label)))
    .sort((a, b) => gap(a) - gap(b));
}
// Échéance programmée déjà comptée dans les soldes à 7 jours près : la saisir aussi la compterait deux fois.
// dest : compte destinataire pour un virement programmé.
function findDueDuplicate(op, dest = null) {
  if (!op.date) return null;
  const month = monthIndexOf(op.date);
  return [month - 1, month, month + 1].flatMap(m => scheduledOpsInMonth(Math.floor(m / 12), m % 12, op.account)).find(o => {
    if (o.type !== op.type || Math.abs(daysBetween(o.date, op.date)) > 7) return false;
    if (dest) return scheduledDest(o) === dest && o.amount === op.amount;
    if (scheduledDest(o)) return false;
    return (o.amount === op.amount && telltale(op.amount, o.label, op.label))
      || (similarLabel(o.label, op.label) && Math.abs(o.amount - op.amount) <= o.amount * 0.15);
  }) || null;
}
function duplicateText(found, op) {
  const first = found[0], more = found.length > 1 ? ` (et ${found.length - 1} autre${found.length > 2 ? 's' : ''})` : '';
  const when = first.date === op.date ? 'à cette date' : `le ${formatDate(first.date)}`;
  return `Déjà saisie ? « ${esc(first.label || 'sans libellé')} » de ${fmt(first.amount)} est enregistrée ${when} sur « ${esc(first.account)} »${more}.`;
}
function dueText(due) {
  return `« ${esc(due.label)} » (${fmt(due.amount)}) est une opération programmée, déjà comptée le ${formatDate(due.date)}. La saisir ici la compterait deux fois : utilisez plutôt « Passer » dans l’onglet Programmées.`;
}
// Message affiché sous le formulaire dès que le montant et la date sont remplis
function entryDuplicateHint(op, dest = null) {
  if (!op.amount || !op.date) return '';
  if (dest) {
    const near = findTransferDuplicates(op.account, dest, op.amount, op.date);
    if (near.length) return transferDuplicateText(near[0], op.account, dest, op.date);
  } else {
    const found = findDuplicates(op);
    if (found.length) return duplicateText(found, op);
  }
  const due = findDueDuplicate(op, dest);
  return due ? dueText(due) : '';
}
function findTransferDuplicates(from, to, amount, date) {
  const gap = o => Math.abs(daysBetween(o.date, date));
  return appData.operations.filter(o => o.opType !== 'Programmee' && o.type === 'debit' && o.account === from && transferTarget(o) === to
    && o.amount === amount && gap(o) <= 3).sort((a, b) => gap(a) - gap(b));
}
function transferDuplicateText(o, from, to, date) {
  return `Un virement identique de ${fmt(o.amount)} de « ${esc(from)} » vers « ${esc(to)} » est déjà enregistré ${o.date === date ? 'à cette date' : 'le ' + formatDate(o.date)}.`;
}

function checkOperationRisks(op, todayStr) {
  const warnings = [];
  const norm = s => String(s || '').trim().toLowerCase();
  const real = appData.operations.filter(o => o.opType !== 'Programmee');
  const found = findDuplicates(op);
  if (found.length) warnings.push({ code: 'duplicate', text: duplicateText(found, op) });
  else {
    const due = findDueDuplicate(op);
    if (due) warnings.push({ code: 'scheduled', text: dueText(due) });
  }
  const days = daysBetween(todayStr, op.date);
  if (days > 60 || days < -366) {
    warnings.push({ code: 'date', text: `La date saisie (${formatDate(op.date)}) est ${days > 60 ? describeDays(days) : "à plus d'un an dans le passé"} : vérifiez le jour et l'année.` });
  }
  const label = norm(op.label);
  if (label) {
    const same = real.filter(o => o.type === op.type && norm(o.label) === label && o.amount > 0).map(o => o.amount).sort((a, b) => a - b);
    if (same.length >= 3) {
      const median = same[Math.floor(same.length / 2)];
      if (op.amount >= median * 5 && op.amount >= 5000) {
        warnings.push({ code: 'amount', text: `« ${esc(String(op.label).trim())} » fait d'habitude environ ${fmt(median)} (${same.length} opérations enregistrées) : vous saisissez ${fmt(op.amount)}. Un zéro de trop ?` });
      }
    }
  }
  return warnings;
}

// Mêmes contrôles pour un virement entre deux comptes, plus un avertissement si le compte source passerait en négatif.
function checkTransferRisks(from, to, amount, date, todayStr) {
  const warnings = [];
  const near = findTransferDuplicates(from, to, amount, date);
  if (near.length) warnings.push({ code: 'duplicate', text: transferDuplicateText(near[0], from, to, date) });
  else {
    const due = findDueDuplicate({ account: from, type: 'debit', amount, date, label: `[${to}]` }, to);
    if (due) warnings.push({ code: 'scheduled', text: dueText(due) });
  }
  const days = daysBetween(todayStr, date);
  if (days > 60 || days < -366) {
    warnings.push({ code: 'date', text: `La date saisie (${formatDate(date)}) est ${days > 60 ? describeDays(days) : "à plus d'un an dans le passé"} : vérifiez le jour et l'année.` });
  }
  const kind = getAccountKind(appData.accounts.find(a => a.name === from) || { name: from });
  if (kind === 'courant' || kind === 'epargne') {
    const before = calcBalanceAsOf(from, date);
    if (before >= 0 && before - amount < 0) {
      warnings.push({ code: 'negative', text: `Après ce virement, le solde de « ${esc(from)} » serait de ${fmt(before - amount)} (il est de ${fmt(before)} à cette date).` });
    }
  }
  return warnings;
}

// Nombre d'échéances déjà arrivées (date ≤ aujourd'hui) pour une opération programmée qui démarre à startStr :
// l'application compte chaque échéance depuis la date de départ, y compris dans le passé.
function countPastOccurrences(freq, startStr, endStr, todayStr) {
  const step = { mensuelle: 1, bimensuelle: 2, trimestrielle: 3, annuelle: 12 }[freq] || 1;
  const sy = +startStr.slice(0, 4), sm = +startStr.slice(5, 7) - 1, sd = +startStr.slice(8, 10);
  const endIdx = endStr ? +endStr.slice(0, 4) * 12 + (+endStr.slice(5, 7) - 1) : Infinity;
  let n = 0;
  for (let k = 0; k < 2400; k++) {
    const idx = sy * 12 + sm + k * step;
    if (idx > endIdx) break;
    const y = Math.floor(idx / 12), m = idx % 12;
    const day = Math.min(sd, new Date(y, m + 1, 0).getDate());
    if (`${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` > todayStr) break;
    n++;
    if (freq === 'ponctuelle') break;
  }
  return n;
}

// Contenu de l'aide : chaque entrée renvoie { title, lead, how: [...], example, tips: [...], go }.
// Les textes dynamiques reprennent les données de l'utilisateur (toujours échappées).
const HELP_TOPICS = {
  'solde-total': () => {
    const names = getAccountNames();
    const counted = names.filter(isAccountIncluded), apart = names.filter(n => !isAccountIncluded(n));
    return {
      title: '💰 Solde total',
      lead: "L'argent dont vous disposez, en additionnant les comptes comptés dans le total.",
      how: [
        "Pour chaque compte compté : solde de départ + opérations enregistrées jusqu'à la date choisie + échéances programmées déjà arrivées.",
        'Les comptes « hors total » (épargne, crédits, carte…) ne sont pas additionnés : ils restent dans la liste, avec leur propre solde.',
        '« Jour du solde » (dans la carte) lit le solde un autre jour du mois en cours : le 26, la fin de mois… ; « Solde au », sous la carte, permet n\'importe quelle date.',
        "Une date qui n'est pas encore arrivée donne un solde prévu : opérations déjà saisies et échéances programmées comprises.",
      ],
      example: counted.length
        ? `${counted.map(n => `${esc(n)} ${fmt(calcDashboardBalance(n))}`).join(' + ')}${counted.length > 1 ? ` = <b>${fmt(calcDashboardTotalBalance())}</b>` : ''}.${apart.length ? ` Non comptés : ${apart.map(esc).join(', ')}.` : ''}`
        : '',
      tips: ['Un compte manque dans le total ? Cochez-le dans Paramètres › Comptes.'],
      go: { label: 'Choisir les comptes comptés', tab: 'settings' },
    };
  },

  'fin-de-mois': () => {
    const [y, m] = today().split('-').map(Number);
    const total = calcDashboardTotalBalance();
    const eom = getAccountNames().filter(isAccountIncluded).reduce((s, n) => s + calcBalanceEndOfMonth(n, y, m - 1), 0);
    return {
      title: '📆 Fin de mois prévu',
      lead: 'Le solde total que vous aurez le dernier jour du mois si tout se passe comme programmé.',
      how: [
        'Solde total + les opérations programmées qui restent à venir ce mois-ci (loyer, salaire, prélèvements…).',
        'Les opérations déjà saisies avec une date plus tard dans le mois comptent aussi.',
        'Vos dépenses non programmées (courses, carte…) ne sont pas prévues.',
      ],
      example: `Solde total <b>${fmt(total)}</b> → fin de mois <b>${fmt(eom)}</b> (${signedFmt(eom - total)}).`,
      tips: ["L'écart vient des opérations à venir : voir la liste « À venir » (onglet Activité)."],
    };
  },

  'a-venir': () => {
    const items = getUpcomingOps(today(), 30);
    const shown = items.filter(o => !o.creditLeg);
    return {
      title: '🗓️ À venir · 30 jours',
      lead: 'Ce qui va encore bouger sur vos comptes pendant les 30 prochains jours.',
      how: [
        'Les échéances programmées et les opérations déjà saisies avec une date future.',
        'Le total ne compte que les comptes du solde total.',
        'Un virement vers un compte hors total (épargne, prêt…) est une sortie ; un virement entre deux comptes comptés ne change rien.',
      ],
      example: shown.length
        ? `${shown.length} opération${shown.length > 1 ? 's' : ''} à venir, pour un effet de <b>${signedFmt(upcomingNetForTotal(items))}</b> sur le solde total.`
        : 'Aucune opération à venir dans les 30 prochains jours.',
      tips: ['Pour changer ou arrêter une échéance : onglet Programmées.'],
      go: { label: 'Voir les programmées', tab: 'scheduled' },
    };
  },

  'types-comptes': () => {
    const names = getAccountNames();
    const counted = names.filter(isAccountIncluded);
    return {
      title: '🏦 Vos comptes',
      lead: 'Les comptes sont rangés par type, avec un sous-total pour chaque groupe.',
      how: [
        'Le type (courant, épargne, crédit, carte) est déduit du nom du compte ou choisi dans Paramètres › Comptes.',
        "« hors total » : ce compte n'est pas compté dans le Solde total de l'accueil.",
        '« fin de mois » : le solde que ce compte aura le dernier jour du mois, échéances programmées comprises.',
        'Touchez un compte pour voir ses opérations.',
      ],
      example: `${names.length} compte${names.length > 1 ? 's' : ''}, dont ${counted.length} compté${counted.length > 1 ? 's' : ''} dans le total${counted.length ? ` (${counted.map(esc).join(', ')})` : ''}.`,
      tips: [],
      go: { label: 'Gérer les comptes', tab: 'settings' },
    };
  },

  'carte-prelevement': (name) => {
    const acc = appData.accounts.find(a => a.name === name);
    const isCard = !!acc && acc.cardType === 'deferred';
    return {
      title: '💳 Prélèvement de la carte',
      lead: 'Avec une carte à débit différé, vos achats sont prélevés en une seule fois, le jour de « remise à zéro ».',
      how: [
        `Montant à prélever = achats − remboursements enregistrés depuis le dernier jour de remise à zéro${isCard && acc.billingCycleDay ? ` (le ${acc.billingCycleDay} du mois)` : ''}.`,
        'Le tableau liste les opérations de cette période, de la plus ancienne à la plus récente.',
        isCard && acc.billingDebitDay
          ? `Réglée comme votre banque : les achats sont arrêtés le ${acc.billingCycleDay} et prélevés le ${acc.billingDebitDay} du mois.${acc.billingDebitDay === 1 ? ' Un prélèvement du 1er compte dans les soldes à la fin du mois précédent.' : ' Chacun compte dans les soldes à son prélèvement.'} Autre jour ? Touchez l'achat et changez « Prélevé le ».`
          : `Dans les soldes, un achat fait avant le ${isCard && acc.billingCycleDay ? acc.billingCycleDay : 'jour de remise à zéro'} compte à sa date ; à partir de ce jour, il compte au prélèvement du mois suivant. Autre jour ? Touchez l'achat et changez « Prélevé le ».`,
        "Le règlement de la carte (virement du compte courant vers la carte) n'est pas un achat : il n'apparaît pas dans cette liste.",
      ],
      example: isCard ? `${esc(name)} : période ${esc(getBillingInfo(name).period)} → à prélever <b>${fmt(calcBillingBalance(name))}</b>.` : '',
      tips: [],
      go: { label: 'Régler la carte', tab: 'settings' },
    };
  },

  'encours-cartes': () => {
    const enc = getCardsEncours();
    const lines = enc.cards.map(c => {
      const n = c.ops.length;
      const spent = `${esc(c.name)} : <b>${fmt(c.total)}</b> dépensés en ${n} paiement${n > 1 ? 's' : ''}`;
      if (!c.limit) return `${spent} (plafond non renseigné).`;
      const pct = Math.round((c.total / c.limit) * 100);
      return c.total > c.limit
        ? `${spent} → plafond de ${fmt(c.limit)} dépassé de <b>${fmt(c.total - c.limit)}</b> (${pct} %).`
        : `${spent} → il reste <b>${fmt(c.limit - c.total)}</b> sur ${fmt(c.limit)} (${pct} %).`;
    });
    return {
      title: '📊 Encours des cartes',
      lead: 'Ce que vous avez dépensé par carte sur les 30 derniers jours, comparé au plafond de la carte.',
      how: [
        "Période glissante : de « aujourd'hui − 30 jours » à aujourd'hui, dates comprises. Elle avance chaque jour.",
        'Seuls les paiements comptent : virements, opérations programmées et remboursements sont exclus.',
        "Plafond restant = plafond − encours. La jauge passe à l'orange au-delà de 50 % du plafond, au rouge au-delà de 80 %.",
        'Dans la liste, sous chaque paiement : le plafond restant après ce paiement (carte par carte, du plus ancien au plus récent).',
      ],
      example: lines.join('<br>'),
      tips: ['Le plafond se règle dans Paramètres › Comptes › Carte à débit différé.'],
      go: { label: 'Régler le plafond', tab: 'settings' },
    };
  },

  'evolution-solde': () => ({
    title: '📈 Évolution du solde',
    lead: 'Le solde de chacun des 12 derniers mois, lu en fin de mois ou le jour de votre choix.',
    how: [
      "« Comptes du solde total » : le même périmètre que le Solde total de l'accueil.",
      '« Tous les comptes » : l\'ensemble de vos comptes, épargne et prêts compris — votre situation globale.',
      'Vous pouvez aussi choisir un seul compte.',
      'Le second choix fixe le jour où le solde est lu : « en fin de mois » (par défaut) ou un jour précis, par exemple le 26 si votre salaire arrive ce jour-là. Un jour absent du mois (le 30 en février) donne le solde de fin de mois.',
      'Survolez un mois avec la souris (ou touchez-le) pour voir son solde exact ; au clavier, utilisez les flèches gauche et droite.',
    ],
    example: '',
    tips: [
      'Un virement entre deux comptes de la sélection ne change pas le total : seule la répartition bouge.',
      "Pour le mois en cours, une date qui n'est pas encore arrivée donne un solde prévu (échéances comprises) : la bulle l'indique.",
    ],
  }),

  'revenus-depenses': () => {
    const f = calcFlowSummary(fieldValue('stats-account'), ...statsRange(statsYear, statsMonth));
    const label = new Date(statsYear, statsMonth, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    return {
      title: '🧮 Revenus, dépenses et solde du mois',
      lead: 'Ce que vous avez reçu et dépensé pendant le mois affiché.',
      how: [
        "Revenus = l'argent reçu ; dépenses = l'argent payé.",
        "Comme dans les soldes : vos opérations programmées comptent, et un achat par carte compte à sa date de prélèvement. Le mois en cours s'arrête à aujourd'hui.",
        'Les virements entre vos comptes ne sont ni des revenus ni des dépenses : ils sont listés à part, sous « Virements entre comptes ».',
        "Solde = revenus − dépenses. Ce n'est pas le solde d'un compte : c'est ce qu'il reste (ou manque) sur le mois.",
        'Les flèches ▲ ▼ comparent au mois précédent (à la même période si le mois est en cours). Pour les dépenses, une hausse est en rouge.',
      ],
      example: `${label} : revenus <b>${fmt(f.income)}</b>, dépenses <b>${fmt(f.expense)}</b> → <b>${signedFmt(f.net)}</b>.`,
      tips: ["Un achat enregistré comme virement n'est pas compté en dépense : saisissez-le comme Opération."],
    };
  },

  'flux-12-mois': () => {
    const now = new Date();
    const avg = averageCompleteMonths(calcMonthlyFlows(fieldValue('stats-account'), statsYear, statsMonth, 12), now.getFullYear(), now.getMonth());
    return {
      title: '📊 Revenus et dépenses sur 12 mois',
      lead: 'Une barre verte (revenus) et une barre rouge (dépenses) par mois. Le mois affiché est surligné.',
      how: [
        'La moyenne ne porte que sur les mois complets : le mois en cours est exclu, ainsi que les mois sans aucune opération.',
        "Taux d'épargne = (revenus − dépenses) ÷ revenus. S'il est négatif, vous dépensez plus que vous ne gagnez.",
        'Les virements entre comptes ne sont pas comptés.',
      ],
      example: avg.months
        ? `Sur ${avg.months} mois complet${avg.months > 1 ? 's' : ''} : revenus <b>${fmt(avg.income)}</b> et dépenses <b>${fmt(avg.expense)}</b> par mois → solde moyen <b>${signedFmt(avg.net)}</b>${avg.rate !== null ? `, taux d'épargne <b>${avg.rate} %</b>` : ''}.`
        : '',
      tips: [],
    };
  },

  'categories': () => ({
    title: '🏷️ Dépenses par catégorie',
    lead: 'Où part votre argent : chaque barre est une catégorie de dépenses du mois.',
    how: [
      'Le pourcentage est la part de la catégorie dans les dépenses du mois.',
      '▲ ▼ : variation par rapport au mois précédent (rouge = vous dépensez plus).',
      'Avec un budget défini (Paramètres › Catégories, budgets & alertes), la barre se remplit selon le budget : orange au-delà de 80 %, rouge au-delà de 100 %.',
    ],
    example: '',
    tips: ["Beaucoup de dépenses en « Autre » ? Choisissez une catégorie en saisissant ou en modifiant l'opération : les analyses seront plus précises."],
  }),

  'projection': () => ({
    title: '🔮 Projection',
    lead: 'Une simulation de vos soldes dans les mois à venir, à partir de ce qui est déjà programmé.',
    how: [
      'Comptées : les opérations programmées et les opérations déjà saisies avec une date future.',
      "Pas comptées : vos dépenses du quotidien non programmées (courses, carte…). La ligne « Constaté par mois » permet de juger l'écart.",
      "Cochez les comptes à additionner : un seul, plusieurs ou tous. Les boutons « Tous » et « Solde total » cochent d'un geste ; votre choix est retenu sur cet appareil.",
      'Un virement entre deux comptes du périmètre est neutre pour le total.',
    ],
    example: '',
    tips: ["Lisez-la comme un scénario « s'il ne se passe rien d'autre », pas comme une prévision exacte."],
  }),

  'prevu-reel': () => {
    const series = calcProjectionSeries(projScope(), parseInt(fieldValue('proj-horizon', '12'), 10) || 12, parseInt(fieldValue('proj-cutday'), 10) || 0);
    const sum = summarizeProjection(series);
    const real = calcRecentAverageFlows(series.names, 6);
    const planned = sum.avgIncome - sum.avgExpense, actual = real.income - real.expense;
    return {
      title: '⚖️ Prévu et constaté',
      lead: 'Deux moyennes mensuelles (entrées et sorties) pour comparer la projection à la réalité.',
      how: [
        'Prévu : ce que vos opérations programmées font entrer et sortir chaque mois à venir.',
        'Constaté : ce que vos comptes ont réellement enregistré chaque mois (vos opérations + les échéances automatiques non remplacées), en moyenne sur les 6 derniers mois complets.',
      ],
      example: `Prévu <b>${signedFmt(planned)}</b> par mois, constaté <b>${signedFmt(actual)}</b> par mois.${actual < planned ? ` Le constaté est inférieur de ${fmt(planned - actual)} au prévu, chaque mois.` : actual > planned ? ` Le constaté dépasse le prévu de ${fmt(actual - planned)} par mois.` : ''}`,
      tips: ['Un constaté très en dessous du prévu : programmez vos dépenses régulières (assurances, abonnements, courses…), sinon la projection les ignore.'],
    };
  },

  'gerer-categories': () => {
    const cat = getCategoryCatalog();
    const nSubs = cat.reduce((s, c) => s + c.subs.length, 0);
    const top = cat.slice().sort((a, b) => b.count - a.count)[0];
    return {
      title: '🏷️ Gérer les catégories',
      lead: "Vous choisissez ici les catégories et sous-catégories proposées partout dans l'application : en créer, les renommer, les supprimer.",
      how: [
        'Renommer une catégorie change son nom dans toutes les opérations qui l\'utilisent. Les montants, les dates et les soldes ne bougent pas.',
        "Si le nouveau nom existe déjà, les deux catégories sont fusionnées : la fenêtre vous le dit avant d'enregistrer.",
        "Supprimer une catégorie ne supprime aucune opération : vous choisissez où les placer (par défaut « Autre », pour les reclasser ensuite).",
        "« Autre » (opérations sans catégorie) et « Virement » sont réservées à l'application : elles ne se renomment pas et ne se suppriment pas.",
      ],
      example: cat.length
        ? `Vous avez ${cat.length} catégorie${cat.length > 1 ? 's' : ''} et ${nSubs} sous-catégorie${nSubs > 1 ? 's' : ''}${top && top.count ? ` ; la plus utilisée est « ${esc(top.name.trim())} » (${top.count} opération${top.count > 1 ? 's' : ''})` : ''}.`
        : "Vous n'avez encore aucune catégorie.",
      tips: [
        'Après chaque changement, « Annuler » (en bas de l\'écran) rétablit exactement l\'état précédent.',
        "Les anciennes catégories venues d'un import apparaissent aussi dans la liste : fusionnez celles qui font doublon, par exemple en donnant à « Frais alimentaires » le nom « Alimentation ».",
        "Le budget d'une catégorie suit son nouveau nom ; celui d'une catégorie supprimée est retiré.",
        'Vos catégories sont enregistrées avec vos données : elles suivent la synchronisation avec Drive.',
      ],
    };
  },

  'classer': () => {
    const q = getCategorizeQueue(typeof catSince === 'function' ? catSince() : '', new Set());
    const sure = q.filter(g => g.suggestion && g.suggestion.confident);
    return {
      title: '🏷️ Classer les opérations',
      lead: "Beaucoup d'opérations importées n'ont pas de vraie catégorie (« Dépenses à catégoriser », « Autre »…), ce qui fausse les analyses. Cet écran les regroupe par libellé pour les classer d'un coup.",
      how: [
        'Un seul choix classe toutes les opérations sans catégorie qui portent ce libellé, quelle que soit leur date.',
        "La catégorie proposée vient de votre historique : celle déjà donnée à des opérations de même libellé. Elle est « sûre » quand au moins deux opérations identiques déjà classées vont, à 80 % au moins, dans cette catégorie ; avec une seule, elle est proposée mais jamais appliquée en lot.",
        'Seule la catégorie change : les montants et les soldes restent identiques.',
        '« Ignorer » retire un libellé de la liste (sur cet appareil) ; vous pouvez les réafficher en bas de l\'écran.',
      ],
      example: q.length
        ? `${q.length} libellé${q.length > 1 ? 's' : ''} (${q.reduce((s, g) => s + g.count, 0)} opérations) à classer ; ${sure.length} suggestion${sure.length > 1 ? 's' : ''} sûre${sure.length > 1 ? 's' : ''} couvre${sure.length > 1 ? 'nt' : ''} ${sure.reduce((s, g) => s + g.count, 0)} opérations.`
        : 'Rien à classer pour le moment.',
      tips: [
        'Après un classement, « Annuler » rétablit les anciennes catégories.',
        'Les écritures de régularisation ou de règlement de carte ne sont pas des dépenses du quotidien : classez-les à part ou ignorez-les.',
      ],
    };
  },

  'mode-discret': () => ({
    title: '👁 Mode discret',
    lead: "Floute les montants à l'écran pour consulter l'application en public, ou la montrer à quelqu'un, sans dévoiler vos chiffres.",
    how: [
      "Touchez l'œil en haut à droite de la carte « Solde total » pour masquer ou afficher les montants : soldes, opérations, tableaux et valeurs des graphiques.",
      'Seule l\'affichage change : vos données restent identiques et se synchronisent normalement.',
      "Le choix est mémorisé. Avec « Démarrer en mode discret », les montants sont masqués à chaque ouverture de l'application.",
    ],
    example: '',
    tips: ['Les barres et les courbes restent visibles : seuls les chiffres sont floutés.'],
  }),

  'tendance-30j': () => {
    const tr = calcTrendSeries('__total', dashboardBalanceDate || today(), 30, 2);
    return {
      title: '📈 Tendance sur 30 jours',
      lead: 'Comment le solde total a évolué pendant les 30 derniers jours.',
      how: [
        "La courbe relie le solde total tous les 2 jours, jusqu'à aujourd'hui (ou la date choisie dans « Solde au »).",
        '▲ vert : le solde a augmenté ; ▼ rouge : il a baissé. Les échéances programmées déjà arrivées sont comptées, comme dans le solde.',
      ],
      example: `Il y a 30 jours : <b>${fmt(tr.first)}</b> → maintenant : <b>${fmt(tr.last)}</b> (${signedFmt(tr.delta)}).`,
      tips: [],
    };
  },

  'jour-releve': () => ({
    title: '📅 Jour du relevé',
    lead: "Pour lire vos soldes à une date précise du mois plutôt qu'en fin de mois.",
    how: [
      'Vide : le solde est lu le dernier jour de chaque mois.',
      'Exemple avec 25 : chaque point est le solde du 25, et les entrées et sorties de chaque période vont du 26 du mois précédent au 25. Pratique si votre salaire arrive le 26.',
    ],
    example: '',
    tips: [],
  }),

  'saisie-type': () => ({
    title: '✍️ Opération ou virement ?',
    lead: "Choisissez selon ce que devient l'argent.",
    how: [
      "<b>Opération</b> : un achat (Dépense) ou une entrée d'argent (Revenu). L'argent sort de vos comptes ou y entre.",
      '<b>Virement</b> : un déplacement entre deux de vos comptes (ex. courant → épargne). Il ne compte ni en dépense ni en revenu.',
      'Le règlement de votre carte à débit différé est un virement du compte courant vers la carte : les achats sont déjà enregistrés sur la carte.',
    ],
    example: '',
    tips: [
      "Si l'argent reste chez vous, c'est un virement.",
      'Le montant s\'affiche en clair sous la saisie : vérifiez le nombre de zéros.',
      "L'application vous demande confirmation en cas de doublon, de date très éloignée ou de montant inhabituel.",
      'Les « Fréquents » reprennent vos libellés les plus utilisés : un toucher préremplit le libellé, la catégorie et le compte (et le montant s\'il ne change jamais).',
      'Juste après un enregistrement, « Annuler » reste proposé quelques secondes.',
    ],
  }),

  'programmees': () => ({
    title: '🔁 Opérations programmées',
    lead: "Des opérations qui reviennent (loyer, salaire, abonnement…) : l'application les compte toute seule à chaque échéance.",
    how: [
      'Elles sont ajoutées automatiquement à vos soldes, sans que vous ayez à les saisir chaque mois.',
      'La liste montre la prochaine date de chaque échéance et le total moyen par mois (hors virements entre comptes).',
      "✅ Passer : enregistre le paiement réel à la place de l'échéance du mois choisi ; les autres mois ne changent pas. Si le paiement est déjà saisi, rien n'est ajouté.",
      '✏️ Modifier : par défaut à partir de la date indiquée, le passé ne change pas.',
      "🗑 Supprimer : vous pouvez arrêter l'échéance (le passé reste compté) ou tout effacer.",
      "Les échéances sont comptées depuis leur date de départ, même sans les « passer ».",
      'La date de fin arrête les échéances ; « Ponctuelle » = une seule fois.',
    ],
    example: '',
    tips: ["Choisissez une date de départ proche d'aujourd'hui : sinon des mois passés sont comptés d'un coup (l'application vous prévient)."],
  }),

  'inclus-total': () => {
    const counted = getAccountNames().filter(isAccountIncluded);
    return {
      title: '⚙️ Comptes inclus dans le solde total',
      lead: "Cochez les comptes dont l'argent est disponible au quotidien.",
      how: [
        "Les comptes cochés sont additionnés dans le Solde total, la « Fin de mois prévu » et « À venir » de l'accueil.",
        'Les autres restent visibles dans la liste, avec la mention « hors total ».',
      ],
      example: counted.length ? `Comptés aujourd'hui : ${counted.map(esc).join(', ')}.` : '',
      tips: ['Par exemple : compte courant coché ; épargne, prêts et carte décochés.'],
    };
  },

  'config-carte': () => ({
    title: '💳 Carte à débit différé',
    lead: 'À régler pour la carte dont les achats sont prélevés en une seule fois.',
    how: [
      "Jour de remise à zéro : le jour du mois où la banque prélève la carte (ex. 26). La période affichée va de ce jour à aujourd'hui.",
      'Plafond : le montant maximum de paiements par carte sur 30 jours glissants. Il sert à calculer le « plafond restant ».',
    ],
    example: '',
    tips: ["Après l'enregistrement, la carte apparaît avec son prélèvement et son encours dans l'onglet Comptes."],
  }),
};

// ── MODE DISCRET, TENDANCE, « DANS LES 7 JOURS », SUGGESTIONS DE SAISIE, ANNULATION ──────────────────────

// Mode discret : les montants sont floutés (la classe « privacy » est portée par <body> ; les sélecteurs sont dans style.css).
function setPrivacy(on, remember) {
  document.body.classList.toggle('privacy', on);
  const b = document.getElementById('btn-privacy');
  if (b) {
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.setAttribute('aria-label', on ? 'Afficher les montants' : 'Masquer les montants');
  }
  if (remember) { try { localStorage.setItem('finances_privacy', on ? '1' : '0'); } catch { /* ignoré */ } }
}
document.getElementById('btn-privacy').addEventListener('click', () => setPrivacy(!document.body.classList.contains('privacy'), true));
(function initPrivacy() {
  let last = false, start = false;
  try { last = localStorage.getItem('finances_privacy') === '1'; start = localStorage.getItem('finances_privacy_start') === '1'; } catch { /* stockage indisponible */ }
  const c = document.getElementById('cfg-privacy-start');
  if (c) {
    c.checked = start;
    c.addEventListener('change', () => {
      try { localStorage.setItem('finances_privacy_start', c.checked ? '1' : '0'); } catch { /* ignoré */ }
      toast(c.checked ? 'Les montants seront masqués à chaque ouverture' : "Les montants s'affichent à l'ouverture (selon le dernier choix)", 3000);
    });
  }
  setPrivacy(last || start, false);
})();

// Accueil : courbe du solde total sur 30 jours et variation (inspiré des applications de suivi de patrimoine)
function renderHeroTrend() {
  const box = document.getElementById('hero-trend');
  if (!box) return;
  const tr = calcTrendSeries('__total', dashboardBalanceDate || today(), 30, 2);
  const W = 300, H = 38, pad = 3;
  const vals = tr.points.map(p => p.balance);
  const min = Math.min(...vals), span = (Math.max(...vals) - min) || 1;
  const xy = vals.map((v, i) => [pad + i * (W - 2 * pad) / (vals.length - 1), H - pad - ((v - min) / span) * (H - 2 * pad)]);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const end = xy[xy.length - 1];
  const dir = tr.delta > 0 ? 'up' : tr.delta < 0 ? 'down' : '';
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><defs><linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity="0.35"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs><polygon points="${pad},${H} ${line} ${W - pad},${H}" fill="url(#sparkGrad)"/><polyline points="${line}" fill="none" stroke="currentColor" stroke-opacity="0.9" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${end[0].toFixed(1)}" cy="${end[1].toFixed(1)}" r="3" fill="currentColor"/></svg>
    <div class="trend-row"><span class="trend-chip ${dir}">${dir === 'up' ? '▲' : dir === 'down' ? '▼' : '●'} ${dir ? signedFmt(tr.delta) : 'stable'} <small>sur 30 jours</small></span>${infoBtn('tendance-30j')}</div>`;
}

// Accueil : les prochaines échéances (7 jours), sous le solde ; la carte disparaît quand il n'y a rien
function renderSoonCard() {
  const card = document.getElementById('soon-card');
  if (!card) return;
  const items = getUpcomingOps(today(), 7).filter(o => !o.creditLeg);
  card.classList.toggle('hidden', !items.length);
  if (!items.length) return;
  const shown = items.slice(0, 3);
  document.getElementById('soon-list').innerHTML = shown.map(upcomingRowHtml).join('');
  document.getElementById('soon-all').textContent = items.length > shown.length ? `Tout voir (${items.length}) ›` : 'Tout voir ›';
}
document.getElementById('soon-all').addEventListener('click', () => showDashTab('activite'));

// Saisie rapide : suggestions « Fréquents » (libellés les plus utilisés du même sens) et saisie semi-automatique
function setSelectValue(sel, value) {
  if (!value) return;
  if (![...sel.options].some(o => o.value === value)) sel.insertAdjacentHTML('beforeend', `<option value="${esc(value)}">${esc(value)}</option>`);
  sel.value = value;
}
function renderQuickSuggestions() {
  const box = document.getElementById('quick-suggest');
  const list = document.getElementById('label-suggestions');
  if (!box) return;
  const type = document.getElementById('inp-type').value || 'debit';
  const sugg = getQuickSuggestions(type, 40, today());
  box._data = sugg.slice(0, 8);
  box.innerHTML = box._data.length
    ? `<p class="chips-title">Fréquents</p><div class="chips">${box._data.map((x, i) =>
        `<button type="button" class="chip" data-i="${i}"><b>${esc(x.label)}</b><small>${esc(x.amount ? fmt(x.amount) : getCategoryDisplay(x.category) || x.account || '')}</small></button>`).join('')}</div>`
    : '';
  if (list) list.innerHTML = sugg.map(x => `<option value="${esc(x.label)}"></option>`).join('');
}
document.getElementById('quick-suggest').addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('.chip');
  const x = b && document.getElementById('quick-suggest')._data[+b.dataset.i];
  if (!x) return;
  const t = id => document.getElementById(id);
  t('inp-label').value = x.label;
  setSelectValue(t('inp-category'), x.category);
  t('inp-category').dataset.touched = '1';
  if (x.account && [...t('inp-account-name').options].some(o => o.value === x.account)) { t('inp-account-name').value = x.account; refreshEntryDebit(); }
  if (x.amount) t('inp-amount').value = x.amount;
  t('inp-amount').dispatchEvent(new Event('input', { bubbles: true }));       // met à jour l'aide sous le montant
  t(x.amount ? 'inp-label' : 'inp-amount').focus();
});
// libellé déjà connu (choisi dans la liste ou tapé en entier) : la catégorie habituelle est reprise, sauf choix manuel
document.getElementById('inp-label').addEventListener('change', () => {
  const cat = document.getElementById('inp-category');
  if (cat.dataset.touched === '1') return;
  const h = findLabelHistory(document.getElementById('inp-label').value, document.getElementById('inp-type').value);
  if (h && h.category) setSelectValue(cat, h.category);
});
document.getElementById('inp-category').addEventListener('change', (e) => { e.target.dataset.touched = '1'; });
document.getElementById('form-expense').addEventListener('reset', () => { delete document.getElementById('inp-category').dataset.touched; });

// Annuler une saisie qu'on vient d'enregistrer (opération ou virement)
function undoAdded(ids) {
  if (!removeAddedOps(ids)) return;
  saveLocal();
  renderAll();
  toast('↩️ Saisie annulée');
  if (accessToken) uploadToDrive().catch(() => {});
}

// ── CLASSER LES OPÉRATIONS SANS CATÉGORIE ─────────────────────────────────────
// Écran en feuille : les libellés sans catégorie, du montant le plus élevé au plus faible, avec la catégorie habituelle déjà choisie.
let _catScope = '12';          // '12' = les 12 derniers mois, 'all' = tout l'historique
let _catQueue = [];
let _catLimit = 40;
function catSince() {
  if (_catScope === 'all') return '';
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return localDateStr(d);
}
function getCatSkip() {
  try { return new Set(JSON.parse(localStorage.getItem('finances_cat_skip') || '[]')); } catch { return new Set(); }
}
function setCatSkip(set) {
  try { localStorage.setItem('finances_cat_skip', JSON.stringify([...set])); } catch { /* ignoré */ }
}
function renderCategorize() {
  const t = id => document.getElementById(id);
  const queue = getCategorizeQueue(catSince(), getCatSkip());
  _catQueue = queue;
  const nOps = queue.reduce((s, g) => s + g.count, 0);
  t('cat-summary').textContent = queue.length
    ? `${queue.length} libellé${queue.length > 1 ? 's' : ''} · ${nOps} opération${nOps > 1 ? 's' : ''} sans catégorie`
    : 'Tout est classé 🎉';
  const sure = queue.filter(g => g.suggestion && g.suggestion.confident);
  const sureOps = sure.reduce((s, g) => s + g.count, 0);
  const all = t('cat-apply-all');
  all.classList.toggle('hidden', !sure.length);
  all.textContent = `Appliquer les ${sure.length} suggestion${sure.length > 1 ? 's' : ''} sûre${sure.length > 1 ? 's' : ''} (${sureOps} opération${sureOps > 1 ? 's' : ''})`;
  const shown = queue.slice(0, _catLimit);
  const choices = {};
  t('cat-list').innerHTML = shown.map((g, i) => {
    const sug = g.suggestion ? g.suggestion.category : '';
    const list = choices[g.type] || (choices[g.type] = getCategoryChoices(g.type));
    const opts = [...new Set([...(sug ? [sug] : []), ...g.seen.map(x => x.category), ...list])];
    const why = g.suggestion
      ? `${Math.round(g.suggestion.share * 100)} % de ${g.suggestion.count} opération${g.suggestion.count > 1 ? 's' : ''} identique${g.suggestion.count > 1 ? 's' : ''} déjà classée${g.suggestion.count > 1 ? 's' : ''}`
      : g.seen.length ? 'Plusieurs catégories possibles : ' + g.seen.slice(0, 3).map(x => `${x.category} (${x.count})`).join(', ')
      : 'Aucune opération identique déjà classée';
    const d = g.lastDate;
    return `<div class="cat-row" data-i="${i}">
      <div class="cat-main">
        <b class="cat-label">${esc(g.label)}</b>
        <small>${g.count} opération${g.count > 1 ? 's' : ''} · <span class="pv">${fmt(g.total)}</span> · dernière le ${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}${g.type === 'credit' ? ' · revenu' : ''}</small>
        <small class="cat-why${g.suggestion && g.suggestion.confident ? ' sure' : ''}">${esc(why)}</small>
      </div>
      <div class="cat-controls">
        <select class="cat-select" aria-label="Catégorie pour ${esc(g.label)}"><option value="">Choisir une catégorie…</option>${opts.map(c => `<option value="${esc(c)}"${c === sug ? ' selected' : ''}>${esc(c.replace('/', ' › '))}</option>`).join('')}</select>
        <button type="button" class="btn-primary cat-go"${sug ? '' : ' disabled'}>Classer</button>
        <button type="button" class="link-btn cat-skip">Ignorer</button>
      </div>
    </div>`;
  }).join('') + (queue.length > shown.length ? `<button type="button" class="btn-secondary cat-more">Afficher plus (${queue.length - shown.length})</button>` : '');
  const skipped = getCatSkip().size;
  t('cat-skipped').innerHTML = skipped ? `${skipped} libellé${skipped > 1 ? 's' : ''} ignoré${skipped > 1 ? 's' : ''} · <button type="button" class="link-btn" id="cat-unskip">Les réafficher</button>` : '';
}
function openCategorize() {
  _catLimit = 40;
  renderCategorize();
  document.getElementById('modal-categorize').classList.remove('hidden');
}
function closeCategorize() { document.getElementById('modal-categorize').classList.add('hidden'); }
// Après un classement : on enregistre, on rafraîchit, et « Annuler » rétablit exactement les anciennes catégories
function finishCategorize(undo, message) {
  if (!undo.length) { toast('Rien à changer'); return; }
  saveLocal();
  renderAll();
  renderCategorize();
  toastAction(message, 'Annuler', () => {
    restoreCategories(undo);
    saveLocal();
    renderAll();
    if (!document.getElementById('modal-categorize').classList.contains('hidden')) renderCategorize();
    toast('↩️ Classement annulé');
  }, 9000);
}
document.getElementById('cat-list').addEventListener('click', (e) => {
  if (e.target.closest('.cat-more')) { _catLimit += 40; renderCategorize(); return; }
  const row = e.target.closest('.cat-row');
  const g = row && _catQueue[+row.dataset.i];
  if (!g) return;
  if (e.target.closest('.cat-go')) {
    const cat = row.querySelector('.cat-select').value;
    if (cat) finishCategorize(applyCategoryToOps(g.ids, cat), `✅ ${g.count} opération${g.count > 1 ? 's' : ''} classée${g.count > 1 ? 's' : ''} en « ${cat} »`);
  } else if (e.target.closest('.cat-skip')) {
    const skip = getCatSkip();
    skip.add(g.key);
    setCatSkip(skip);
    renderCategorize();
  }
});
document.getElementById('cat-list').addEventListener('change', (e) => {
  const row = e.target.closest('.cat-row');
  if (row && e.target.matches('.cat-select')) row.querySelector('.cat-go').disabled = !e.target.value;
});
document.getElementById('cat-apply-all').addEventListener('click', () => {
  let undo = [];
  for (const g of _catQueue) if (g.suggestion && g.suggestion.confident) undo = undo.concat(applyCategoryToOps(g.ids, g.suggestion.category));
  finishCategorize(undo, `✅ ${undo.length} opération${undo.length > 1 ? 's' : ''} classée${undo.length > 1 ? 's' : ''} d'après votre historique`);
});
document.querySelectorAll('[data-cat-scope]').forEach(b => b.addEventListener('click', () => {
  _catScope = b.dataset.catScope;
  _catLimit = 40;
  document.querySelectorAll('[data-cat-scope]').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
  renderCategorize();
}));
document.getElementById('cat-skipped').addEventListener('click', (e) => { if (e.target.closest('#cat-unskip')) { setCatSkip(new Set()); renderCategorize(); } });
document.getElementById('cat-close').addEventListener('click', closeCategorize);
document.getElementById('modal-categorize').addEventListener('click', (e) => { if (e.target.id === 'modal-categorize') closeCategorize(); });
document.getElementById('stat-categories').addEventListener('click', (e) => {
  if (e.target.closest('[data-open-categorize]')) openCategorize();
  else if (e.target.closest('[data-open-catmanager]')) openCatManager();
});

// ── GÉRER LES CATÉGORIES (écran en feuille) ──────────────────────────────────
// Liste des catégories et sous-catégories avec leur nombre d'opérations ; créer, renommer (ou fusionner) et supprimer, chaque
// changement pouvant être annulé tout de suite. La fenêtre « ce-… » sert de petit formulaire (nom, pictogramme, destination).
let _cmList = [];                                   // catalogue affiché, pour retrouver la catégorie touchée
let _ce = null;                                     // formulaire en cours : { title, name, icon, target, okLabel, danger, hint, onOk }

function renderCatManager() {
  const cat = getCategoryCatalog();
  _cmList = cat;
  const q = catKey(document.getElementById('cm-search').value);
  const todo = getCategorizeQueue('', new Set()).reduce((s, g) => s + g.count, 0);
  const box = document.getElementById('cm-todo');
  box.classList.toggle('hidden', !todo);
  box.innerHTML = todo ? `<span>${todo} opération${todo > 1 ? 's' : ''} sans catégorie</span><button type="button" class="link-btn" id="cm-classify">Les classer ›</button>` : '';
  const nSubs = cat.reduce((s, c) => s + c.subs.length, 0);
  document.getElementById('cm-summary').textContent = `${cat.length} catégorie${cat.length > 1 ? 's' : ''} · ${nSubs} sous-catégorie${nSubs > 1 ? 's' : ''}`;
  const rows = [];
  cat.forEach((c, i) => {
    if (q && !catKey(c.name).includes(q) && !c.subs.some(s => catKey(s.name).includes(q))) return;
    const name = esc(c.name.trim());
    rows.push(`<section class="cm-card" data-i="${i}">
      <div class="cm-head">
        <span class="cm-ico" aria-hidden="true">${esc(catIcon(c.name))}</span>
        <div class="cm-title"><b>${name}</b><small>${c.count} opération${c.count > 1 ? 's' : ''}</small></div>
        <button type="button" class="cm-btn" data-act="rename" aria-label="Renommer la catégorie ${name}">✏️</button>
        <button type="button" class="cm-btn" data-act="delete" aria-label="Supprimer la catégorie ${name}">🗑️</button>
      </div>
      ${c.subs.length ? `<ul class="cm-subs">${c.subs.map((s, j) => `<li data-j="${j}"><span>↳ ${esc(s.name.trim())} <small>${s.count}</small></span>
        <button type="button" class="cm-btn" data-act="rename-sub" aria-label="Renommer la sous-catégorie ${esc(s.name.trim())}">✏️</button>
        <button type="button" class="cm-btn" data-act="delete-sub" aria-label="Supprimer la sous-catégorie ${esc(s.name.trim())}">🗑️</button></li>`).join('')}</ul>` : ''}
      <button type="button" class="link-btn cm-add" data-act="add-sub">＋ Sous-catégorie</button>
    </section>`);
  });
  document.getElementById('cm-list').innerHTML = rows.join('') || `<p class="cat-summary">${cat.length ? 'Aucune catégorie ne correspond.' : 'Aucune catégorie pour le moment.'}</p>`;
}
function openCatManager() {
  document.getElementById('cm-search').value = '';
  renderCatManager();
  document.getElementById('modal-cats').classList.remove('hidden');
}
function closeCatManager() {
  document.getElementById('modal-cats').classList.add('hidden');
  if (!document.getElementById('modal-categorize').classList.contains('hidden')) renderCategorize();   // la liste de choix a pu changer
}
// Après une modification : enregistrement, affichage à jour, et « Annuler » pour tout rétablir
function finishCatChange(res, message) {
  saveLocal();
  renderAll();
  renderCatManager();
  if (!document.getElementById('modal-categorize').classList.contains('hidden')) renderCategorize();
  toastAction(message, 'Annuler', () => {
    undoCategoryChange(res.undo);
    saveLocal();
    renderAll();
    if (!document.getElementById('modal-cats').classList.contains('hidden')) renderCatManager();
    if (!document.getElementById('modal-categorize').classList.contains('hidden')) renderCategorize();
    toast('↩️ Modification annulée');
  }, 9000);
}

// Destinations possibles pour des opérations déplacées : « Autre » (ou la catégorie principale), puis les autres catégories
function catDestOptions(first, excludeMain, excludeFull) {
  const opts = [first];
  if (first.value !== 'Autre') opts.push({ value: 'Autre', label: 'Autre (sans catégorie, à reclasser)' });
  for (const c of getCategoryCatalog()) {
    if (c.name === excludeMain) continue;
    opts.push({ value: c.name, label: `${catIcon(c.name)} ${c.name.trim()}` });
    for (const s of c.subs) opts.push({ value: `${c.name}/${s.name}`, label: `    ↳ ${s.name.trim()}` });
  }
  const seen = new Set();
  return opts.filter(o => o.value !== excludeFull && !seen.has(o.value) && seen.add(o.value));
}

function openCatDialog(cfg) {
  _ce = cfg;
  const t = id => document.getElementById(id);
  t('ce-title').textContent = cfg.title;
  t('ce-intro').textContent = cfg.intro || '';
  t('ce-intro').classList.toggle('hidden', !cfg.intro);
  t('ce-name-wrap').classList.toggle('hidden', cfg.name === undefined);
  t('ce-name').value = cfg.name || '';
  t('ce-icon-wrap').classList.toggle('hidden', cfg.icon === undefined);
  t('ce-icon').value = cfg.icon || '';
  t('ce-target-wrap').classList.toggle('hidden', !cfg.target);
  if (cfg.target) {
    t('ce-target-label').textContent = cfg.target.label;
    t('ce-target').innerHTML = cfg.target.options.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
    t('ce-target').value = cfg.target.value;
  }
  t('ce-ok').classList.toggle('danger', !!cfg.danger);
  refreshCatDialog();
  t('modal-catedit').classList.remove('hidden');
  (cfg.name !== undefined ? t('ce-name') : cfg.target ? t('ce-target') : t('ce-cancel')).focus({ preventScroll: true });
}
function catDialogValues() {
  const t = id => document.getElementById(id);
  return { name: t('ce-name').value, icon: t('ce-icon').value.trim(), target: t('ce-target').value };
}
// Message sous le formulaire (conseil ou erreur) et libellé du bouton, selon ce qui est saisi
function refreshCatDialog() {
  if (!_ce) return;
  const h = (_ce.hint && _ce.hint(catDialogValues())) || {};
  const note = document.getElementById('ce-note');
  note.textContent = h.text || '';
  note.classList.toggle('warn', !!h.warn);
  note.classList.toggle('notice', !!h.notice);
  const ok = document.getElementById('ce-ok');
  ok.textContent = h.okLabel || _ce.okLabel;
  ok.disabled = !!h.block;
}
function closeCatDialog() {
  document.getElementById('modal-catedit').classList.add('hidden');
  _ce = null;
}
function submitCatDialog() {
  if (!_ce || document.getElementById('ce-ok').disabled) return;
  const err = _ce.onOk(catDialogValues());
  if (err) {
    const note = document.getElementById('ce-note');
    note.textContent = err;
    note.classList.remove('notice');
    note.classList.add('warn');
    return;
  }
  closeCatDialog();
}

function dlgNewMain() {
  openCatDialog({
    title: 'Nouvelle catégorie', name: '', icon: '', okLabel: 'Créer',
    hint: (v) => {
      if (!v.name.trim()) return { block: true };
      const chk = checkCategoryName(v.name, false);
      if (chk.error) return { text: chk.error, warn: true, block: true };
      const same = getCategoryCatalog().find(c => catKey(c.name) === catKey(chk.name));
      return same ? { text: `« ${same.name.trim()} » existe déjà.`, warn: true, block: true } : {};
    },
    onOk: (v) => {
      const r = addMainCategory(v.name, v.icon);
      if (r.error) return r.error;
      finishCatChange(r, `✅ Catégorie « ${r.name} » créée`);
    },
  });
}
function dlgAddSub(c) {
  openCatDialog({
    title: 'Nouvelle sous-catégorie', intro: `Dans « ${c.name.trim()} »`, name: '', okLabel: 'Créer',
    hint: (v) => {
      if (!v.name.trim()) return { block: true };
      const chk = checkCategoryName(v.name, true);
      if (chk.error) return { text: chk.error, warn: true, block: true };
      const same = c.subs.find(s => catKey(s.name) === catKey(chk.name));
      return same ? { text: `« ${same.name.trim()} » existe déjà dans « ${c.name.trim()} ».`, warn: true, block: true } : {};
    },
    onOk: (v) => {
      const r = addSubCategory(c.name, v.name);
      if (r.error) return r.error;
      finishCatChange(r, `✅ Sous-catégorie « ${r.name} » créée dans « ${c.name.trim()} »`);
    },
  });
}
function dlgRenameMain(c) {
  const shown = c.name.trim(), icon = catIcon(c.name);
  openCatDialog({
    title: 'Renommer la catégorie',
    intro: c.count ? `Les ${c.count} opération${c.count > 1 ? 's' : ''} de « ${shown} » suivront le nouveau nom. Les montants ne changent pas.` : '',
    name: shown, icon, okLabel: 'Renommer',
    hint: (v) => {
      const chk = checkCategoryName(v.name, false);
      if (chk.error) return v.name.trim() ? { text: chk.error, warn: true, block: true } : { block: true };
      const other = getCategoryCatalog().find(x => x.name !== c.name && catKey(x.name) === catKey(chk.name));
      if (other) return { text: `« ${other.name.trim()} » existe déjà : ${c.count ? `les ${c.count} opération${c.count > 1 ? 's' : ''} de « ${shown} » y seront ajoutées` : `« ${shown} » sera fusionnée avec elle`}.`, notice: true, okLabel: 'Fusionner' };
      return {};
    },
    onOk: (v) => {
      const r = renameMainCategory(c.name, v.name, v.icon === icon ? undefined : v.icon);
      if (r.error) return r.error;
      finishCatChange(r, r.merged
        ? `✅ « ${shown} » fusionnée dans « ${r.name.trim()} »${r.ops ? ` · ${r.ops} opération${r.ops > 1 ? 's' : ''}` : ''}`
        : `✅ « ${shown} » renommée en « ${r.name} »`);
    },
  });
}
function dlgRenameSub(c, s) {
  const shown = s.name.trim();
  openCatDialog({
    title: 'Renommer la sous-catégorie', intro: `Dans « ${c.name.trim()} »`, name: shown, okLabel: 'Renommer',
    hint: (v) => {
      const chk = checkCategoryName(v.name, true);
      if (chk.error) return v.name.trim() ? { text: chk.error, warn: true, block: true } : { block: true };
      const other = c.subs.find(x => x.name !== s.name && catKey(x.name) === catKey(chk.name));
      return other ? { text: `« ${other.name.trim()} » existe déjà : les ${s.count} opération${s.count > 1 ? 's' : ''} de « ${shown} » y seront ajoutées.`, notice: true, okLabel: 'Fusionner' } : {};
    },
    onOk: (v) => {
      const r = renameSubCategory(c.name, s.name, v.name);
      if (r.error) return r.error;
      finishCatChange(r, r.merged
        ? `✅ « ${shown} » fusionnée dans « ${r.name.trim()} »${r.ops ? ` · ${r.ops} opération${r.ops > 1 ? 's' : ''}` : ''}`
        : `✅ « ${shown} » renommée en « ${r.name} »`);
    },
  });
}
function dlgDeleteMain(c) {
  const shown = c.name.trim(), nSub = c.subs.length;
  const subs = nSub ? ` (et ses ${nSub} sous-catégorie${nSub > 1 ? 's' : ''})` : '';
  openCatDialog({
    title: `Supprimer « ${shown} » ?`,
    intro: c.count
      ? `${c.count} opération${c.count > 1 ? 's utilisent' : ' utilise'} cette catégorie${subs}. Aucune n'est supprimée : choisissez où les placer.`
      : `Aucune opération n'utilise cette catégorie${subs}.`,
    target: c.count ? { label: 'Placer ses opérations dans', options: catDestOptions({ value: 'Autre', label: 'Autre (sans catégorie, à reclasser)' }, c.name), value: 'Autre' } : undefined,
    okLabel: 'Supprimer', danger: true,
    onOk: (v) => {
      const r = deleteMainCategory(c.name, c.count ? v.target : 'Autre');
      if (r.error) return r.error;
      finishCatChange(r, `🗑️ « ${shown} » supprimée${r.ops ? ` · ${r.ops} opération${r.ops > 1 ? 's' : ''} déplacée${r.ops > 1 ? 's' : ''}` : ''}`);
    },
  });
}
function dlgDeleteSub(c, s) {
  const shown = s.name.trim(), full = `${c.name}/${s.name}`;
  openCatDialog({
    title: `Supprimer « ${shown} » ?`,
    intro: s.count
      ? `${s.count} opération${s.count > 1 ? 's utilisent' : ' utilise'} cette sous-catégorie. Aucune n'est supprimée : choisissez où les placer.`
      : "Aucune opération n'utilise cette sous-catégorie.",
    target: s.count ? { label: 'Placer ses opérations dans', options: catDestOptions({ value: c.name, label: `« ${c.name.trim()} » (sans sous-catégorie)` }, null, full), value: c.name } : undefined,
    okLabel: 'Supprimer', danger: true,
    onOk: (v) => {
      const r = deleteSubCategory(c.name, s.name, s.count ? v.target : c.name);
      if (r.error) return r.error;
      finishCatChange(r, `🗑️ « ${shown} » supprimée${r.ops ? ` · ${r.ops} opération${r.ops > 1 ? 's' : ''} déplacée${r.ops > 1 ? 's' : ''}` : ''}`);
    },
  });
}

document.getElementById('cm-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  const card = btn && btn.closest('.cm-card');
  const c = card && _cmList[+card.dataset.i];
  if (!c) return;
  const li = btn.closest('li');
  const s = li ? c.subs[+li.dataset.j] : null;
  const act = btn.dataset.act;
  if (act === 'rename') dlgRenameMain(c);
  else if (act === 'delete') dlgDeleteMain(c);
  else if (act === 'add-sub') dlgAddSub(c);
  else if (act === 'rename-sub' && s) dlgRenameSub(c, s);
  else if (act === 'delete-sub' && s) dlgDeleteSub(c, s);
});
document.getElementById('cm-search').addEventListener('input', renderCatManager);
document.getElementById('cm-new').addEventListener('click', dlgNewMain);
document.getElementById('cm-todo').addEventListener('click', (e) => {
  if (!e.target.closest('#cm-classify')) return;
  closeCatManager();
  if (document.getElementById('modal-categorize').classList.contains('hidden')) openCategorize();
});
document.getElementById('cm-close').addEventListener('click', closeCatManager);
document.getElementById('modal-cats').addEventListener('click', (e) => { if (e.target.id === 'modal-cats') closeCatManager(); });
document.getElementById('btn-manage-cats').addEventListener('click', openCatManager);
document.getElementById('cat-manage').addEventListener('click', openCatManager);
document.getElementById('ce-ok').addEventListener('click', submitCatDialog);
document.getElementById('ce-cancel').addEventListener('click', closeCatDialog);
document.getElementById('modal-catedit').addEventListener('click', (e) => { if (e.target.id === 'modal-catedit') closeCatDialog(); });
['ce-name', 'ce-icon'].forEach(id => {
  document.getElementById(id).addEventListener('input', refreshCatDialog);
  document.getElementById(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitCatDialog(); } });
});
document.getElementById('ce-target').addEventListener('change', refreshCatDialog);

// Bouton « i » pour le HTML construit en JavaScript (les boutons fixes sont écrits dans index.html).
function infoBtn(key, arg) {
  return `<button type="button" class="info-btn" data-help="${key}"${arg ? ` data-arg="${esc(arg)}"` : ''} aria-label="Aide" aria-haspopup="dialog">i</button>`;
}

let _helpTrigger = null;
function openHelp(key, arg, trigger) {
  const make = HELP_TOPICS[key];
  if (!make) return;
  const t = make(arg);
  const list = (title, items) => (items && items.length)
    ? `<div class="info-sec"><b>${title}</b><ul>${items.map(i => `<li>${i}</li>`).join('')}</ul></div>` : '';
  document.getElementById('info-title').textContent = t.title;
  document.getElementById('info-body').innerHTML =
    `<p class="info-lead">${t.lead}</p>`
    + list("Comment c'est calculé", t.how)
    + (t.example ? `<div class="info-ex"><b>Chez vous</b><p>${t.example}</p></div>` : '')
    + list('Pour éviter les erreurs', t.tips);
  const go = document.getElementById('info-go');
  go.classList.toggle('hidden', !t.go);
  if (t.go) { go.textContent = t.go.label; go.dataset.tab = t.go.tab; }
  _helpTrigger = trigger || null;
  document.getElementById('modal-info').classList.remove('hidden');
  document.getElementById('info-ok').focus({ preventScroll: true });
}
function closeHelp() {
  document.getElementById('modal-info').classList.add('hidden');
  if (_helpTrigger && document.body.contains(_helpTrigger)) _helpTrigger.focus();
  _helpTrigger = null;
}
// Phase de capture : le bouton « i » placé dans un titre dépliable ne doit pas aussi déplier le bloc.
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('.info-btn[data-help]');
  if (!b) return;
  e.preventDefault();
  e.stopPropagation();
  openHelp(b.dataset.help, b.dataset.arg, b);
}, true);
document.getElementById('info-ok').addEventListener('click', closeHelp);
document.getElementById('info-close').addEventListener('click', closeHelp);
document.getElementById('modal-info').addEventListener('click', (e) => { if (e.target.id === 'modal-info') closeHelp(); });
document.getElementById('info-go').addEventListener('click', () => {
  const tab = document.getElementById('info-go').dataset.tab;
  closeHelp();
  if (tab) showTab(tab);
});

// Confirmation avant d'enregistrer quelque chose d'inhabituel. Renvoie une promesse : true = enregistrer quand même.
let _confirmResolve = null;
function resolveConfirm(value) {
  document.getElementById('modal-confirm').classList.add('hidden');
  const r = _confirmResolve;
  _confirmResolve = null;
  if (r) r(value);
}
// newLabel : troisième bouton (« Nouvelle saisie ») ; la réponse est alors 'new'
function askConfirm({ title, lines, okLabel = 'Enregistrer quand même', cancelLabel = 'Corriger', newLabel = '' }) {
  if (_confirmResolve) resolveConfirm(false);
  return new Promise(resolve => {
    _confirmResolve = resolve;
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-body').innerHTML = `<ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px">${lines.map(l => `<li>${l}</li>`).join('')}</ul>`;
    document.getElementById('confirm-ok').textContent = okLabel;
    document.getElementById('confirm-cancel').textContent = cancelLabel;
    const another = document.getElementById('confirm-new');
    another.textContent = newLabel;
    another.classList.toggle('hidden', !newLabel);
    document.getElementById('modal-confirm').classList.remove('hidden');
    document.getElementById('confirm-cancel').focus({ preventScroll: true });   // par défaut on corrige : la touche Entrée n'enregistre pas
  });
}
document.getElementById('confirm-ok').addEventListener('click', () => resolveConfirm(true));
document.getElementById('confirm-cancel').addEventListener('click', () => resolveConfirm(false));
document.getElementById('confirm-new').addEventListener('click', () => resolveConfirm('new'));
document.getElementById('modal-confirm').addEventListener('click', (e) => { if (e.target.id === 'modal-confirm') resolveConfirm(false); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!document.getElementById('modal-confirm').classList.contains('hidden')) resolveConfirm(false);
  else if (!document.getElementById('modal-info').classList.contains('hidden')) closeHelp();
  else if (!document.getElementById('modal-catedit').classList.contains('hidden')) closeCatDialog();
  else if (!document.getElementById('modal-cats').classList.contains('hidden')) closeCatManager();
  else if (!document.getElementById('modal-categorize').classList.contains('hidden')) closeCategorize();
  else if (!document.getElementById('modal-print').classList.contains('hidden')) closePrintCenter();
  else if (!document.getElementById('modal-search').classList.contains('hidden') && document.getElementById('modal-edit-op').classList.contains('hidden')) closeSearch();
});

// ── FENÊTRES : toujours entières à l'écran ──────────────────────────────────
// Une fenêtre (ou une étape de l'import) qui s'ouvre commence en haut, pas à l'endroit où on l'avait laissée.
function scrollModalToTop(modal) {
  [modal, ...modal.querySelectorAll('*')].forEach(el => { if (el.scrollTop) el.scrollTop = 0; });
}
const modalOpening = new MutationObserver(records => records.forEach(r => {
  if (/\bhidden\b/.test(r.oldValue || '') && !r.target.classList.contains('hidden')) scrollModalToTop(r.target.closest('.modal'));
}));
document.querySelectorAll('.modal, #paste-step1, #paste-step2, #paste-step3, #paste-bank').forEach(el =>
  modalOpening.observe(el, { attributes: true, attributeFilter: ['class'], attributeOldValue: true }));

// Clavier à l'écran : les fenêtres se logent dans la partie encore visible, au-dessus du clavier.
function visibleAreaInsets(layoutHeight, vv) {
  const none = { top: 0, bottom: 0 };
  if (!vv || vv.scale > 1.01) return none;                       // zoom avec les doigts : on ne touche à rien
  const top = Math.max(0, Math.round(vv.offsetTop));
  const bottom = Math.max(0, Math.round(layoutHeight - vv.offsetTop - vv.height));
  return top + bottom < 100 ? none : { top, bottom };            // petits écarts (barre d'adresse) ignorés
}
function fitModalsToVisibleArea(e) {
  const { top, bottom } = visibleAreaInsets(window.innerHeight, window.visualViewport);
  const root = document.documentElement.style;
  root.setProperty('--vv-top', top + 'px');
  root.setProperty('--vv-bottom', bottom + 'px');
  document.documentElement.classList.toggle('kb', bottom > 0);                                    // boutons resserrés
  document.documentElement.classList.toggle('kb-tight', bottom > 0 && window.visualViewport.height < 280);
  if (e.type === 'resize' && bottom) keepFieldVisible(document.activeElement);
}
// Le champ en cours de saisie reste visible entre le titre et les boutons
function keepFieldVisible(field) {
  const box = field && field.closest && field.closest('.modal-content');
  if (!box) return;
  const shown = sel => [...box.querySelectorAll(sel)].find(el => el.offsetParent && getComputedStyle(el).position === 'sticky');
  const head = shown('.info-head, .modal-head'), foot = shown('.modal-buttons'), f = field.getBoundingClientRect();
  const top = (head ? head.getBoundingClientRect().bottom : box.getBoundingClientRect().top) + 6;
  const bottom = (foot ? foot.getBoundingClientRect().top : box.getBoundingClientRect().bottom) - 6;
  if (f.bottom > bottom) box.scrollTop += Math.min(f.bottom - bottom, f.top - top);
  else if (f.top < top) box.scrollTop -= top - f.top;
}
if (window.visualViewport) ['resize', 'scroll'].forEach(type => window.visualViewport.addEventListener(type, fitModalsToVisibleArea));

// Aides sous les champs de saisie : montant en clair (zéro de trop ?) et date en toutes lettres (bonne année ?)
const HINT_FIELDS = [['inp-amount', 'amount'], ['trf-amount', 'amount'], ['sch-amount', 'amount'],
  ['inp-date', 'date'], ['trf-date', 'date'], ['sch-next', 'date']];
function refreshHints() {
  for (const [id, kind] of HINT_FIELDS) {
    const input = document.getElementById(id);
    if (!input) continue;
    let hint = input.parentElement.querySelector(`.field-hint[data-for="${id}"]`);
    if (!hint) {
      hint = document.createElement('small');
      hint.className = 'field-hint';
      hint.dataset.for = id;
      hint.setAttribute('aria-live', 'polite');
      input.insertAdjacentElement('afterend', hint);
    }
    const h = hintText(kind, input.value, today());
    hint.textContent = h.text;
    hint.classList.toggle('warn', h.warn);
  }
  refreshDuplicateHints();
}
// Saisie et virement : « déjà saisie ? » s'affiche au-dessus du bouton, avant même de valider
function refreshDuplicateHints() {
  const value = id => document.getElementById(id)?.value || '';
  const show = (id, text, kind) => {
    const box = document.getElementById(id);
    if (!box || box.dataset.text === text) return;        // inchangé : le bouton n'est pas recréé pendant qu'on le touche
    box.dataset.text = text;
    box.innerHTML = text ? `⚠️ ${text}<button type="button" class="link-btn" data-new-entry="${kind}">🆕 Nouvelle saisie</button>` : '';
  };
  show('inp-dup-hint', entryDuplicateHint({ account: value('inp-account-name'), type: value('inp-type'), amount: parseAmount(value('inp-amount')), date: value('inp-date'), label: value('inp-label') }), 'expense');
  show('trf-dup-hint', value('trf-from') === value('trf-to') ? '' : entryDuplicateHint({ account: value('trf-from'), type: 'debit', amount: parseAmount(value('trf-amount')), date: value('trf-date'), label: `[${value('trf-to')}]` }, value('trf-to')), 'transfer');
}
// valeurs modifiées par l'utilisateur ou par le programme (remise à zéro, date par défaut) : on rafraîchit après chaque évènement
['input', 'change', 'reset', 'focusin', 'click'].forEach(ev => document.addEventListener(ev, () => setTimeout(refreshHints, 0), true));
refreshHints();

// Réglage : afficher ou masquer les boutons « i »
(function initHelpIconsSetting() {
  const c = document.getElementById('cfg-help-icons');
  let off = false;
  try { off = localStorage.getItem('finances_help_icons') === '0'; } catch { /* stockage indisponible : affichés */ }
  document.body.classList.toggle('no-help', off);
  if (!c) return;
  c.checked = !off;
  c.addEventListener('change', () => {
    try { localStorage.setItem('finances_help_icons', c.checked ? '1' : '0'); } catch { /* ignoré */ }
    document.body.classList.toggle('no-help', !c.checked);
    toast(c.checked ? "Boutons d'aide affichés" : "Boutons d'aide masqués : réactivez-les ici quand vous voulez", 3000);
  });
})();


// ── IMPRESSION ──────────────────────────────────────────────────────────────
function longDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}
function monthTitle(year, month) {
  const text = new Date(year, month, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return text.charAt(0).toUpperCase() + text.slice(1);
}
function fileDate(iso) {
  return formatDate(iso).split('/').join('-');
}

// Les opérations d'un compte entre deux dates (selon leur jour de prélèvement), échéances programmées comprises,
// avec le solde la veille, à la fin, et après chaque ligne. Pour un mois entier : les mêmes lignes qu'à l'écran.
function periodView(account, from, to) {
  const signed = op => (op.type === 'credit' ? op.amount : -op.amount);
  const ops = [];
  for (let m = monthIndexOf(from); m <= monthIndexOf(to); m++) {
    ops.push(...getMonthOps(account, Math.floor(m / 12), m % 12).filter(op => balanceDate(op) >= from && balanceDate(op) <= to));
  }
  ops.sort((a, b) => (a.nextPayment || a.date).localeCompare(b.nextPayment || b.date));
  const opening = calcBalanceAsOf(account, addDays(from, -1)), closing = calcBalanceAsOf(account, to);
  let running = opening;
  return { monthView: true, opening, closing, rows: ops.map(op => ({ op, balance: (running += signed(op)) })) };
}

// Dates d'achat d'un prélèvement : du jour de remise à zéro à la veille du prélèvement (à aujourd'hui s'il est en cours)
function cardStatementRange(account, debit) {
  const acc = appData.accounts.find(a => a.name === account), day = acc.billingCycleDay;
  const [y, m] = [+debit.slice(0, 4), +debit.slice(5, 7) - 1];
  // la période dont le prélèvement tombe à cette date
  const starts = [0, 1, 2, 3].map(back => localDateStr(new Date(y, m - back, day)));
  const start = starts.find(s => cardDebitDate(acc, s) === debit) || starts[1];
  const last = addDays(localDateStr(new Date(+start.slice(0, 4), +start.slice(5, 7), day)), -1);
  const now = today();
  const current = now >= start && now <= last;
  return { start, end: current ? now : last, current };
}
// Les prélèvements d'une carte à débit différé, du plus récent au plus ancien (celui en cours est toujours proposé)
function cardDebitDates(account) {
  const acc = appData.accounts.find(a => a.name === account);
  if (!acc || acc.cardType !== 'deferred' || !acc.billingCycleDay) return [];
  const day = acc.billingDebitDay || acc.billingCycleDay;
  const dates = new Set([cardDebitDate(acc, today())]);
  for (const op of appData.operations) {
    if (op.account !== account || op.opType === 'Programmee' || isTransferOp(op)) continue;
    const chosen = chosenDebitDate(op);
    dates.add(chosen ? chosen.slice(0, 8) + String(day).padStart(2, '0') : cardDebitDate(acc, op.date));
  }
  return [...dates].sort().reverse();
}

// ── Documents imprimés ──
// Options : comments, categories, balance, pointed (affichés sauf si false), ascending (ordre), limit (aperçu)
function printTable(rows, { account, balances, debit }, options) {
  if (!rows.length) return '<p>Aucune opération</p>';
  const shown = options.limit ? rows.slice(0, options.limit) : rows;
  const categories = options.categories !== false, running = balances && options.balance !== false;
  const lines = shown.map(({ op, balance }) => {
    // sur un relevé de carte, la date de prélèvement n'est rappelée que si elle diffère de celle du relevé
    const when = debit ? (chosenDebitDate(op) && chosenDebitDate(op) !== debit ? `prélevé le ${formatDate(chosenDebitDate(op))}` : '') : debitNote(op).replace(' · ', '');
    const note = [when, op.opType === 'Programmee' ? 'programmée' : '', op.pointed && options.pointed !== false ? '✓ pointée' : ''].filter(Boolean).join(' · ');
    return `<tr>
      <td class="nowrap">${formatDate(op.date)}</td>
      <td>${esc(op.label)}${note ? `<div class="print-note">${note}</div>` : ''}${options.comments !== false ? commentHtml(op) : ''}</td>
      ${account ? '' : `<td>${esc(op.account || '')}</td>`}
      ${categories ? `<td>${esc(op.category || '').split('/').join('/<wbr>')}</td>` : ''}
      <td class="right nowrap ${op.type}">${op.type === 'credit' ? '+' : '-'}${fmt(op.amount)}</td>
      ${running ? `<td class="right nowrap bold">${fmt(balance)}</td>` : ''}
    </tr>`;
  }).join('');
  const rest = rows.length - shown.length;
  return `<table>
    <thead><tr><th>Date</th><th>Libellé</th>${account ? '' : '<th>Compte</th>'}${categories ? '<th>Catégorie</th>' : ''}<th class="right">Montant</th>${running ? '<th class="right">Solde</th>' : ''}</tr></thead>
    <tbody>${lines}</tbody>
  </table>${rest ? `<p class="print-more">… et ${fmtInt(rest)} autres lignes, toutes imprimées.</p>` : ''}`;
}
function printSummary(lines) {
  return `<table class="summary"><tbody>${lines.map(([label, value, cls]) => `<tr><td>${label}</td><td class="right nowrap ${cls || ''}">${value}</td></tr>`).join('')}</tbody></table>`;
}
function printPage(subject, meta, body) {
  return `
    <h1>Finances Perso NC</h1>
    <h2>${esc(subject)}</h2>
    <p class="meta">${meta}</p>
    ${body}`;
}
function printCount(n) {
  return `${fmtInt(n)} opération${n > 1 ? 's' : ''} · imprimé le ${longDate(today())}`;
}
// Totaux d'un relevé (avec soldes) ou d'une liste filtrée
function printTotals(view, account, period) {
  const { income, expense } = operationTotals(view, account);
  const totals = [['Total des entrées', (income ? '+' : '') + fmt(income), 'credit'], ['Total des sorties', (expense ? '-' : '') + fmt(expense), 'debit']];
  return printSummary(view.monthView
    ? [[`Solde au début ${period}`, fmt(view.opening)], ...totals, [`Solde à la fin ${period}`, fmt(view.closing), 'bold']]
    : [...totals, ['Différence (entrées moins sorties)', signedFmt(income - expense), 'bold']]);
}

// La liste de l'onglet Opérations : les mêmes lignes qu'à l'écran (avec un compte et sans autre filtre : le mois)
function opsPrintDoc(filters, options = {}) {
  const view = selectOperations(filters);
  const account = filters.account;
  // sans choix, l'ordre de l'écran : le mois d'un compte du plus ancien au plus récent, une liste filtrée l'inverse
  const ascending = options.ascending ?? view.monthView;
  const rows = ascending === view.monthView ? view.rows : [...view.rows].reverse();

  const notes = [];
  if (!view.monthView && rows.some(r => r.op.opType === 'Programmee')) notes.push('Les opérations programmées sont listées mais ne sont pas comptées dans les totaux.');
  if (!account && rows.some(r => isTransferOp(r.op))) notes.push('Les virements entre vos comptes ne sont pas comptés dans les totaux.');

  const subject = view.monthView ? `${account} — ${monthTitle(filters.year, filters.month)}` : account || 'Toutes les opérations';
  const filterText = view.monthView ? '' : describeOpsFilters(filters);
  const html = printPage(subject, (filterText ? esc(filterText) + '<br>' : '') + printCount(rows.length),
    printTotals(view, account, 'du mois')
    + printTable(rows, { account, balances: view.monthView }, options)
    + (view.monthView && view.deferred.length ? `<h3>Faites ce mois, comptées plus tard</h3>${printTable(view.deferred.map(op => ({ op })), { account, balances: false }, options)}` : '')
    + notes.map(n => `<p class="footnote">${n}</p>`).join(''));

  // le titre sert de nom au fichier PDF
  const title = view.monthView
    ? `Relevé ${account} - ${monthTitle(filters.year, filters.month)}`
    : `Opérations ${account || 'tous les comptes'} - ${fileDate(today())}`;
  return { title, html, count: rows.length };
}

// Relevé d'un compte entre deux dates
function periodPrintDoc(account, from, to, options = {}) {
  const view = periodView(account, from, to);
  const rows = options.ascending === false ? [...view.rows].reverse() : view.rows;
  const html = printPage(`${account} — du ${formatDate(from)} au ${formatDate(to)}`, printCount(rows.length),
    printTotals(view, account, 'de la période') + printTable(rows, { account, balances: true }, options));
  return { title: `Relevé ${account} - du ${fileDate(from)} au ${fileDate(to)}`, html, count: rows.length };
}

// Relevé d'un prélèvement d'une carte : les achats et remboursements qu'il contient, comme sur l'accueil
function cardPrintDoc(account, debit, options = {}) {
  const { start, end, current } = cardStatementRange(account, debit);
  const period = cardPeriod(account, new Date(end + 'T00:00:00'));
  // plus les achats rattachés à la main à ce prélèvement mais datés après la période (le 25 lui-même, par exemple)
  const later = appData.operations.filter(op => op.account === account && op.opType !== 'Programmee' && !isTransferOp(op)
    && op.date > end && (chosenDebitDate(op) || '').slice(0, 7) === debit.slice(0, 7)).sort((a, b) => a.date.localeCompare(b.date));
  const ops = [...period.ops, ...later];
  const sum = type => ops.filter(o => o.type === type).reduce((s, o) => s + o.amount, 0);
  const purchases = sum('debit'), refunds = sum('credit');
  const rows = (options.ascending === false ? [...ops].reverse() : ops).map(op => ({ op }));
  const summary = [['Achats', fmt(purchases), 'debit'], ...(refunds ? [['Remboursements', '+' + fmt(refunds), 'credit']] : []), ['Total à prélever', fmt(purchases - refunds), 'bold']];
  const moved = period.moved.length
    ? `<p class="footnote">Achats de ces dates comptés sur un autre prélèvement : ${period.moved.map(o => `${formatDate(o.date)} ${esc(o.label)} ${fmt(o.amount)} (prélevé le ${formatDate(chosenDebitDate(o))})`).join(' ; ')}.</p>`
    : '';
  const dates = `Prélèvement du ${formatDate(debit)} · achats du ${formatDate(start)} au ${formatDate(end)}${current ? ' (en cours)' : ''}`;
  const html = printPage(`Relevé de carte — ${account}`, `${dates}<br>${printCount(rows.length)}`,
    printSummary(summary) + printTable(rows, { account, debit }, options) + moved);
  return { title: `Relevé ${account} - prélèvement du ${fileDate(debit)}`, html, count: rows.length };
}

// Les soldes à la date choisie, comme sur l'accueil
function accountsPrintDoc(refDate) {
  const names = groupAccountsByKind(getAccountNames()).flatMap(g => g.names);
  let total = 0;
  const rows = names.map(name => {
    const balance = calcBalanceAsOf(name, refDate);
    const included = isAccountIncluded(name);
    if (included) total += balance;
    const count = appData.operations.filter(op => op.account === name && op.opType !== 'Programmee').length;
    return `<tr>
      <td>${esc(name)}${included ? '' : ' <small>(hors total)</small>'}</td>
      <td class="right">${fmtInt(count)}</td>
      <td class="right nowrap bold ${balance >= 0 ? 'credit' : 'debit'}">${fmt(balance)}</td>
    </tr>`;
  }).join('');
  const html = printPage(`Soldes des comptes au ${longDate(refDate)}${refDate > today() ? ' (prévu)' : ''}`, `Imprimé le ${longDate(today())}`, `
    <table>
      <thead><tr><th>Compte</th><th class="right">Opérations</th><th class="right">Solde</th></tr></thead>
      <tbody>${rows}
        <tr class="total-row"><td>Solde total</td><td></td><td class="right nowrap">${fmt(total)}</td></tr>
      </tbody>
    </table>`);
  return { title: `Soldes des comptes au ${fileDate(refDate)}`, html, lines: names.length + 8, what: '' };
}

// ── Bilans ──
function scopeLabel(scope) {
  if (Array.isArray(scope)) return scope.length > 3 ? `${scope.length} comptes` : scope.join(' + ');
  return !scope ? 'Tous les comptes' : scope === '__total' ? 'Comptes du solde total' : scope;
}
// Dates d'un bilan : un mois ou une année, arrêtés à aujourd'hui s'ils sont en cours
function reportRange(span, year, month) {
  const mm = String(month + 1).padStart(2, '0');
  const from = span === 'annee' ? `${year}-01-01` : `${year}-${mm}-01`;
  const end = span === 'annee' ? `${year}-12-31` : localDateStr(new Date(year, month + 1, 0));
  const now = today();
  return { from, to: end > now ? now : end, current: from <= now && end > now };
}
// Les chiffres d'un bilan : ce que les comptes ont enregistré entre deux dates (opérations saisies et échéances
// programmées, comme dans les soldes). Les virements entre les comptes choisis se compensent.
function reportData(scope, from, to) {
  const names = getScopeNames(scope);
  const opening = names.reduce((s, n) => s + calcBalanceAsOf(n, addDays(from, -1)), 0);
  const r = { opening, income: { total: 0, categories: {} }, expense: { total: 0, categories: {} }, transfers: 0, adjustments: 0, months: {} };
  for (const op of names.flatMap(n => periodView(n, from, to).rows.map(row => row.op))) {
    const signed = op.type === 'credit' ? op.amount : -op.amount;
    const key = balanceDate(op).slice(0, 7);
    const month = r.months[key] || (r.months[key] = { income: 0, expense: 0, other: 0 });
    if (isTransferOp(op) || op.virementDest) { r.transfers += signed; month.other += signed; continue; }
    if (op.opType === 'Regularisation') { r.adjustments += signed; month.other += signed; continue; }
    const side = op.type === 'credit' ? r.income : r.expense;
    const [head, ...rest] = String(op.category || '').split('/');
    const name = head.trim() || 'Autre';
    const category = side.categories[name] || (side.categories[name] = { total: 0, subs: {} });
    category.total += op.amount;
    side.total += op.amount;
    if (rest.length) { const sub = rest.join('/').trim(); category.subs[sub] = (category.subs[sub] || 0) + op.amount; }
    month[op.type === 'credit' ? 'income' : 'expense'] += op.amount;
  }
  r.closing = r.opening + r.income.total - r.expense.total + r.transfers + r.adjustments;
  return r;
}
// Tableau d'une colonne de catégories, de la plus grosse à la plus petite, avec leur part
function categoryTable(title, side, detail) {
  const list = Object.entries(side.categories).sort((a, b) => b[1].total - a[1].total);
  if (!list.length) return { html: '', lines: 0 };
  let lines = 3;
  const rows = list.map(([name, c]) => {
    const subs = detail ? Object.entries(c.subs).sort((a, b) => b[1] - a[1]) : [];
    lines += 1 + subs.length;
    return `<tr><td>${esc(name)}</td><td class="right nowrap">${fmt(c.total)}</td><td class="right nowrap">${side.total ? Math.round(c.total / side.total * 100) + ' %' : ''}</td></tr>`
      + subs.map(([sub, v]) => `<tr class="sub"><td>${esc(sub)}</td><td class="right nowrap">${fmt(v)}</td><td></td></tr>`).join('');
  }).join('');
  return { lines, html: `<h3>${title}</h3><table class="cats">
    <thead><tr><th>Catégorie</th><th class="right">Montant</th><th class="right">Part</th></tr></thead>
    <tbody>${rows}<tr class="total-row"><td>Total</td><td class="right nowrap">${fmt(side.total)}</td><td></td></tr></tbody></table>` };
}

// Bilan d'un mois ou d'une année : totaux, catégories, mois par mois (année) et budgets
function reportPrintDoc(scope, span, year, month, options = {}) {
  const { from, to, current } = reportRange(span, year, month);
  if (from > today()) return { error: 'Cette période n’a pas encore commencé.' };
  const d = reportData(scope, from, to);
  const period = span === 'annee' ? `Année ${year}` : monthTitle(year, month);
  const plus = v => (v ? '+' : '') + fmt(v), minus = v => (v ? '-' : '') + fmt(v);
  const rest = d.income.total - d.expense.total;
  const summary = printSummary([
    ['Solde au début', fmt(d.opening)], ['Revenus', plus(d.income.total), 'credit'], ['Dépenses', minus(d.expense.total), 'debit'],
    ['Reste (revenus moins dépenses)', signedFmt(rest), 'bold'],
    ...(d.transfers ? [['Virements avec d’autres comptes', signedFmt(d.transfers)]] : []),
    ...(d.adjustments ? [['Régularisations', signedFmt(d.adjustments)]] : []),
    ['Solde à la fin', fmt(d.closing), 'bold'],
  ]);
  const expenses = categoryTable('Dépenses par catégorie', d.expense, options.sub !== false);
  const income = categoryTable('Revenus par catégorie', d.income, options.sub !== false);
  let lines = 8 + expenses.lines + income.lines;

  let months = '';
  if (span === 'annee') {
    let balance = d.opening;
    const rows = [];
    for (let m = 0; m < +to.slice(5, 7); m++) {
      const x = d.months[`${year}-${String(m + 1).padStart(2, '0')}`] || { income: 0, expense: 0, other: 0 };
      balance += x.income - x.expense + x.other;
      rows.push(`<tr><td>${monthTitle(year, m)}</td><td class="right nowrap credit">${plus(x.income)}</td><td class="right nowrap debit">${minus(x.expense)}</td><td class="right nowrap">${signedFmt(x.income - x.expense)}</td><td class="right nowrap bold">${fmt(balance)}</td></tr>`);
    }
    lines += rows.length + 3;
    months = `<h3>Mois par mois</h3><table class="whole">
      <thead><tr><th>Mois</th><th class="right">Revenus</th><th class="right">Dépenses</th><th class="right">Reste</th><th class="right">Solde à la fin</th></tr></thead>
      <tbody>${rows.join('')}</tbody></table>`;
  }

  // budgets mensuels, multipliés par le nombre de mois de la période
  const count = span === 'annee' ? +to.slice(5, 7) : 1;
  const budgets = Object.entries(appData.budgets || {}).filter(([, v]) => v > 0);
  let budgetTable = '';
  if (budgets.length) {
    const rows = budgets.map(([name, v]) => {
      const planned = v * count, spent = d.expense.categories[name.trim()]?.total || 0;
      return `<tr><td>${esc(name)}</td><td class="right nowrap">${fmt(planned)}</td><td class="right nowrap">${fmt(spent)}</td><td class="right nowrap bold ${spent > planned ? 'debit' : 'credit'}">${signedFmt(planned - spent)}</td></tr>`;
    }).join('');
    lines += budgets.length + 3;
    budgetTable = `<h3>Budgets${count > 1 ? ` (budget du mois × ${count})` : ''}</h3><table class="whole">
      <thead><tr><th>Catégorie</th><th class="right">Budget</th><th class="right">Dépensé</th><th class="right">Reste</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }

  const dates = `du ${formatDate(from)} au ${formatDate(to)}${current ? ' (en cours)' : ''} · imprimé le ${longDate(today())}`;
  const html = printPage(`Bilan — ${period} — ${scopeLabel(scope)}`, dates,
    summary + expenses.html + income.html + months + budgetTable
    + '<p class="footnote">Les échéances programmées sont comptées, comme dans les soldes. Les virements entre les comptes choisis se compensent.</p>');
  return { title: `Bilan ${period} - ${scopeLabel(scope)}`, html, lines, what: 'Bilan' };
}

// Les opérations programmées encore en cours
function schedulePrintDoc(scope, options = {}) {
  const now = today(), names = getScopeNames(scope);
  const concerned = op => !scope || names.includes(op.account) || names.includes(scheduledDest(op));
  const items = appData.operations.filter(op => op.opType === 'Programmee' && concerned(op))
    .map(op => ({ op, next: nextScheduledDate(op, now) })).filter(x => x.next)
    .sort((a, b) => a.next.localeCompare(b.next) || String(a.op.label).localeCompare(String(b.op.label)));
  const totals = monthlyScheduledTotals(now, scope ? names : null);
  const rows = items.map(({ op, next }) => {
    const dest = scheduledDest(op);
    return `<tr>
      <td class="nowrap">${formatDate(next)}</td>
      <td>${esc(dest ? `Virement vers ${dest}` : op.label)}${options.comments !== false ? commentHtml(op) : ''}</td>
      <td>${esc(op.account || '')}</td>
      <td>${esc(FREQ_LABELS[op.detail || 'mensuelle'] || op.detail || '')}</td>
      <td class="nowrap">${op.endDate ? formatDate(op.endDate) : '—'}</td>
      <td class="right nowrap ${op.type}">${op.type === 'credit' ? '+' : '-'}${fmt(op.amount)}</td>
    </tr>`;
  }).join('');
  const what = `${fmtInt(items.length)} échéance${items.length > 1 ? 's' : ''} en cours`;
  const html = printPage(`Opérations programmées — ${scopeLabel(scope)}`, `${what} · imprimé le ${longDate(today())}`,
    printSummary([['Revenus par mois', (totals.income ? '+' : '') + fmt(totals.income), 'credit'], ['Charges par mois', (totals.expense ? '-' : '') + fmt(totals.expense), 'debit'], ['Reste par mois', signedFmt(totals.income - totals.expense), 'bold']])
    + (items.length ? `<table>
      <thead><tr><th>Prochaine</th><th>Libellé</th><th>Compte</th><th>Fréquence</th><th>Fin</th><th class="right">Montant</th></tr></thead>
      <tbody>${rows}</tbody></table>` : '<p>Aucune échéance en cours</p>')
    + '<p class="footnote">Moyenne par mois des échéances, hors virements entre comptes.</p>');
  return { title: `Opérations programmées - ${scopeLabel(scope)} - ${fileDate(now)}`, html, lines: items.length + 8, what };
}

// La projection des soldes, fin de mois par fin de mois
function projectionPrintDoc(scope, horizon) {
  const series = calcProjectionSeries(scope, horizon, 0), sum = summarizeProjection(series);
  const monthName = i => monthTitle(series.months[i].year, series.months[i].month);
  const detail = series.names.length > 1 && series.names.length <= 5 ? series.names : [];
  const amount = v => `<td class="right nowrap${v < 0 ? ' debit' : ''}">${fmt(v)}</td>`;
  const rows = series.months.map((m, i) => {
    const flow = series.flows[i];
    return `<tr><td class="nowrap">${monthName(i)}</td>
      <td class="right nowrap credit">${flow ? (flow.income ? '+' : '') + fmt(flow.income) : '—'}</td><td class="right nowrap debit">${flow ? (flow.expense ? '-' : '') + fmt(flow.expense) : '—'}</td>
      ${detail.map(n => amount(series.perAccount[n][i])).join('')}
      <td class="right nowrap bold${series.totals[i] < 0 ? ' debit' : ''}">${fmt(series.totals[i])}</td></tr>`;
  }).join('');
  const length = horizon % 12 === 0 ? (horizon === 12 ? '1 an' : `${horizon / 12} ans`) : `${horizon} mois`;
  const html = printPage(`Projection des soldes — ${scopeLabel(scope)}`, `Sur ${length}, à la fin de chaque mois · imprimé le ${longDate(today())}`,
    printSummary([['Fin de ce mois', fmt(sum.start)], [`Dans ${length}`, fmt(sum.end), 'bold'], [`Point le plus bas (${monthName(sum.lowIndex).toLowerCase()})`, fmt(sum.lowValue), sum.lowValue < 0 ? 'debit' : '']])
    + `<table class="narrow">
      <thead><tr><th>Mois</th><th class="right">Entrées</th><th class="right">Sorties</th>${detail.map(n => `<th class="right">${esc(n)}</th>`).join('')}<th class="right">${detail.length ? 'Total' : 'Solde'}</th></tr></thead>
      <tbody>${rows}</tbody></table>`
    + '<p class="footnote">La projection ne contient que les opérations programmées et celles déjà saisies à une date future.</p>');
  return { title: `Projection ${scopeLabel(scope)} - ${fileDate(today())}`, html, lines: series.months.length + 8, what: 'Projection' };
}

// Feuille à cocher en regard du relevé de la banque
function checkSheetPrintDoc(account, from, to, subject, options = {}) {
  const view = periodView(account, from, to);
  let rows = options.unpointed ? view.rows.filter(r => !r.op.pointed) : view.rows;
  if (options.ascending === false) rows = [...rows].reverse();
  const categories = options.categories !== false;
  const lines = (options.limit ? rows.slice(0, options.limit) : rows).map(({ op }) => {
    const note = [debitNote(op).replace(' · ', ''), op.opType === 'Programmee' ? 'programmée' : ''].filter(Boolean).join(' · ');
    return `<tr>
      <td class="box">${op.pointed ? '☑' : '☐'}</td>
      <td class="nowrap">${formatDate(op.date)}</td>
      <td>${esc(op.label)}${note ? `<div class="print-note">${note}</div>` : ''}${options.comments !== false ? commentHtml(op) : ''}</td>
      ${categories ? `<td>${esc(op.category || '').split('/').join('/<wbr>')}</td>` : ''}
      <td class="right nowrap debit">${op.type === 'debit' ? fmt(op.amount) : ''}</td>
      <td class="right nowrap credit">${op.type === 'credit' ? fmt(op.amount) : ''}</td>
    </tr>`;
  }).join('');
  const rest = options.limit ? rows.length - Math.min(rows.length, options.limit) : 0;
  const what = `${fmtInt(rows.length)} opération${rows.length > 1 ? 's' : ''}${options.unpointed ? ' non pointées' : ''}`;
  const html = printPage(`Feuille de pointage — ${account} — ${subject}`, `${what} · imprimé le ${longDate(today())}`,
    printSummary([['Solde au début', fmt(view.opening)], ['Solde à la fin (application)', fmt(view.closing), 'bold']])
    + '<div class="bank-check"><p>Solde sur le relevé de la banque : ......................................</p><p>Écart avec l’application : ......................................</p></div>'
    + (rows.length ? `<table>
      <thead><tr><th>✓</th><th>Date</th><th>Libellé</th>${categories ? '<th>Catégorie</th>' : ''}<th class="right">Débit</th><th class="right">Crédit</th></tr></thead>
      <tbody>${lines}</tbody></table>` : '<p>Aucune opération à pointer</p>')
    + (rest ? `<p class="print-more">… et ${fmtInt(rest)} autres lignes, toutes imprimées.</p>` : ''));
  return { title: `Pointage ${account} - ${subject.split('/').join('-')}`, html, count: rows.length, what, lines: rows.length + 10 };
}

// Le document demandé au centre d'impression ; { error } si le choix est incomplet
function buildPrintDoc(choice, options = {}) {
  if (choice.type === 'soldes') return choice.date ? accountsPrintDoc(choice.date) : { error: 'Choisissez une date.' };
  if (choice.type === 'carte') return choice.card && choice.debit ? cardPrintDoc(choice.card, choice.debit, options) : { error: 'Choisissez une carte et un prélèvement.' };
  if (choice.type === 'liste') return opsPrintDoc(choice.filters, options);
  if (choice.type === 'bilan') return reportPrintDoc(choice.scope, choice.span, choice.reportYear, choice.reportMonth, options);
  if (choice.type === 'echeances') return schedulePrintDoc(choice.scope, options);
  if (choice.type === 'projection') return Array.isArray(choice.scope) && !choice.scope.length ? { error: 'Cochez au moins un compte.' } : projectionPrintDoc(choice.scope, choice.horizon);
  // relevé de compte et feuille de pointage : un compte, un mois ou une période
  if (!choice.account) return { error: 'Choisissez un compte.' };
  const free = choice.period === 'libre';
  if (free && (!choice.from || !choice.to || choice.from > choice.to)) return { error: 'Choisissez les deux dates, la première avant la seconde.' };
  if (choice.type === 'pointage') {
    const mm = String(choice.month + 1).padStart(2, '0');
    return free
      ? checkSheetPrintDoc(choice.account, choice.from, choice.to, `du ${formatDate(choice.from)} au ${formatDate(choice.to)}`, options)
      : checkSheetPrintDoc(choice.account, `${choice.year}-${mm}-01`, localDateStr(new Date(choice.year, choice.month + 1, 0)), monthTitle(choice.year, choice.month), options);
  }
  if (free) return periodPrintDoc(choice.account, choice.from, choice.to, options);
  const month = { account: choice.account, type: '', category: '', search: '', amountMin: 0, amountMax: 0, dateFrom: '', dateTo: '', year: choice.year, month: choice.month };
  return opsPrintDoc(month, options);
}

let titleBeforePrint = null;
function printContent(title, html) {
  // Imprime dans la page elle-même (pas de nouvelle fenêtre → pas de blocage en PWA)
  let area = document.getElementById('print-area');
  if (!area) {
    area = document.createElement('div');
    area.id = 'print-area';
    document.body.appendChild(area);
  }
  area.innerHTML = `<div class="print-doc">${html}</div>`;
  document.body.classList.add('printing');
  // le titre de la page est le nom proposé pour le fichier PDF
  if (titleBeforePrint === null) titleBeforePrint = document.title;
  document.title = title;

  const cleanup = () => {
    document.body.classList.remove('printing');
    area.innerHTML = '';
    if (titleBeforePrint !== null) document.title = titleBeforePrint;
    titleBeforePrint = null;
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  // Filet de sécurité si afterprint ne se déclenche pas
  setTimeout(() => { if (document.body.classList.contains('printing')) cleanup(); }, 60000);

  setTimeout(() => window.print(), 100);
}

// ── CENTRE D'IMPRESSION (fenêtre ouverte par les boutons 🖨️) ────────────────
const PRINT_PREVIEW_ROWS = 100;   // lignes montrées dans l'aperçu (l'impression les contient toutes)
const PRINT_ROWS_PER_PAGE = 29;   // estimation du nombre de pages
const PRINT_OPTION_NAMES = ['comments', 'categories', 'balance', 'pointed', 'sub'];   // réglages d'affichage retenus
const byId = id => document.getElementById(id);

function fillSelect(select, options, value) {
  select.innerHTML = options.map(([v, label]) => `<option value="${esc(String(v))}">${esc(label)}</option>`).join('');
  if (options.some(([v]) => String(v) === String(value))) select.value = value;
}
function monthOptions(first, last) {
  const options = [];
  for (let m = last; m >= first; m--) options.push([m, monthTitle(Math.floor(m / 12), m % 12)]);
  return options;
}
// Les mois proposés : du premier mois qui a des opérations jusqu'à trois mois après aujourd'hui (et le mois voulu)
function fillPrintMonths(wanted) {
  const account = byId('print-account').value;
  const now = monthIndexOf(today());
  const months = appData.operations.filter(op => op.account === account).map(op => monthIndexOf(op.date));
  fillSelect(byId('print-month'), monthOptions(Math.min(now, wanted, ...months), Math.max(now + 3, wanted, ...months)), wanted);
}
// Bilans : seulement des mois et des années commencés
function fillReportPeriods(wanted) {
  const now = monthIndexOf(today());
  const first = Math.min(now, ...appData.operations.map(op => monthIndexOf(op.date)));
  fillSelect(byId('print-report-month'), monthOptions(first, now), Math.min(wanted, now));
  const years = [];
  for (let y = Math.floor(now / 12); y >= Math.floor(first / 12); y--) years.push([y, String(y)]);
  fillSelect(byId('print-year'), years, Math.floor(Math.min(wanted, now) / 12));
}
function fillPrintDebits() {
  const card = byId('print-card').value, dates = cardDebitDates(card);
  const current = dates.length ? cardDebitDate(appData.accounts.find(a => a.name === card), today()) : '';
  fillSelect(byId('print-debit'), dates.map(d => [d, `Prélèvement du ${formatDate(d)}${d === current ? ' (en cours)' : ''}`]), current);
}
function readPrintChoice() {
  const month = +byId('print-month').value, report = +byId('print-report-month').value;
  const span = byId('print-span').value;
  return {
    type: byId('print-type').value, account: byId('print-account').value, period: byId('print-period').value,
    year: Math.floor(month / 12), month: month % 12, from: byId('print-from').value, to: byId('print-to').value,
    card: byId('print-card').value, debit: byId('print-debit').value, date: byId('print-date').value, filters: readOpsFilters(),
    scope: byId('print-type').value === 'projection' ? scopeFromChecked(readChecks(byId('print-proj-accounts'))) : byId('print-scope').value, span, reportYear: span === 'annee' ? +byId('print-year').value : Math.floor(report / 12), reportMonth: report % 12,
    horizon: +byId('print-horizon').value,
  };
}
function readPrintOptions() {
  const options = { ascending: byId('print-order').value === 'asc', unpointed: byId('print-opt-unpointed').checked };
  for (const name of PRINT_OPTION_NAMES) options[name] = byId('print-opt-' + name).checked;
  return options;
}
// Seuls les réglages utiles au document choisi sont montrés
function showPrintFields() {
  const type = byId('print-type').value;
  const period = byId(type === 'bilan' ? 'print-span' : 'print-period').value;
  document.querySelectorAll('#modal-print [data-print]').forEach(node => {
    const forType = node.dataset.print.split(' ').includes(type);
    node.classList.toggle('hidden', !forType || (!!node.dataset.period && node.dataset.period !== period));
  });
}
function refreshPrintPreview() {
  showPrintFields();
  const doc = buildPrintDoc(readPrintChoice(), { ...readPrintOptions(), limit: PRINT_PREVIEW_ROWS });
  const preview = byId('print-preview');
  preview.innerHTML = doc.error ? `<p class="print-empty">${esc(doc.error)}</p>` : `<div class="print-doc">${doc.html}</div>`;
  preview.scrollTop = 0;
  preview.scrollLeft = 0;
  if (doc.error) byId('print-info').textContent = '';
  else {
    const what = doc.what ?? `${fmtInt(doc.count)} opération${doc.count > 1 ? 's' : ''}`;
    const pages = Math.max(1, Math.ceil((doc.lines ?? doc.count + 8) / PRINT_ROWS_PER_PAGE));   // lines : en-tête compris
    byId('print-info').textContent = ['Aperçu', what].filter(Boolean).join(' — ') + ` · ${pages > 1 ? `environ ${fmtInt(pages)} pages` : '1 page'}`;
  }
  byId('print-go').disabled = !!doc.error;
}
// Ouvre le centre d'impression, réglé sur ce qui est à l'écran : 'accueil', 'operations' ou 'echeances'
function openPrintCenter(context) {
  const names = getAccountNames();
  const cards = names.filter(n => appData.accounts.some(a => a.name === n && a.cardType === 'deferred'));
  const filters = readOpsFilters();
  const monthShown = context === 'operations' && selectOperations(filters).monthView;
  const dashTab = document.querySelector('.dash-tab.active')?.dataset.dtab;
  const type = context === 'operations' ? (monthShown ? 'compte' : 'liste')
    : context === 'echeances' ? 'echeances' : dashTab === 'analyses' ? 'bilan' : dashTab === 'projection' ? 'projection' : 'soldes';
  fillSelect(byId('print-type'), [['compte', 'Relevé de compte'], ...(cards.length ? [['carte', 'Relevé de carte']] : []), ['pointage', 'Feuille de pointage'],
    ['soldes', 'Soldes à une date'], ['bilan', 'Bilan (mois ou année)'], ['echeances', 'Opérations programmées'], ['projection', 'Projection des soldes'],
    ...(context === 'operations' ? [['liste', 'Liste affichée (avec vos filtres)']] : [])], type);
  fillSelect(byId('print-account'), names.map(n => [n, n]), filters.account || names[0]);
  byId('print-period').value = 'mois';
  fillPrintMonths(monthShown ? opsYear * 12 + opsMonth : monthIndexOf(today()));
  byId('print-from').value = today().slice(0, 8) + '01';
  byId('print-to').value = today();
  fillSelect(byId('print-card'), cards.map(n => [n, n]), cards.includes(filters.account) ? filters.account : cards[0]);
  fillPrintDebits();
  byId('print-date').value = dashboardBalanceDate || today();
  byId('print-list-note').textContent = describeOpsFilters(filters) || (filters.account ? `Compte : ${filters.account}` : 'Toutes les opérations, sans filtre.');
  // bilan et échéances : le compte de l'onglet d'où l'on vient ; projection : les comptes cochés
  byId('print-proj-accounts').innerHTML = accountChecksHtml(checkedAccounts(projSaved(), names));
  const scopes = [['', 'Tous les comptes'], ...(names.some(n => !isAccountIncluded(n)) ? [['__total', 'Comptes du solde total']] : []), ...names.map(n => [n, n])];
  fillSelect(byId('print-scope'), scopes, type === 'bilan' ? byId('stats-account').value : '');
  byId('print-span').value = 'mois';
  fillReportPeriods(type === 'bilan' ? statsYear * 12 + statsMonth : monthIndexOf(today()));
  fillSelect(byId('print-horizon'), [[3, '3 mois'], [6, '6 mois'], [12, '1 an'], [24, '2 ans'], [60, '5 ans']], type === 'projection' ? byId('proj-horizon').value : 12);
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('finances_print_opts') || '{}') || {}; } catch { /* réglages illisibles : tout est affiché */ }
  for (const name of PRINT_OPTION_NAMES) byId('print-opt-' + name).checked = saved[name] !== false;
  byId('print-opt-unpointed').checked = false;
  byId('print-order').value = type === 'liste' || (monthShown && !opsSortAsc) ? 'desc' : 'asc';
  refreshPrintPreview();
  byId('modal-print').classList.remove('hidden');
  byId('print-go').focus({ preventScroll: true });
}
function closePrintCenter() {
  byId('modal-print').classList.add('hidden');
}
byId('print-type').addEventListener('change', () => {
  byId('print-order').value = byId('print-type').value === 'liste' ? 'desc' : 'asc';
  refreshPrintPreview();
});
byId('print-proj-accounts').addEventListener('change', refreshPrintPreview);
byId('print-proj-accounts').addEventListener('click', (e) => {
  const pick = e.target.closest && e.target.closest('[data-pick]');
  if (!pick) return;
  byId('print-proj-accounts').innerHTML = accountChecksHtml(pickedAccounts(pick.dataset.pick));
  refreshPrintPreview();
});
byId('print-account').addEventListener('change', () => { fillPrintMonths(+byId('print-month').value); refreshPrintPreview(); });
byId('print-card').addEventListener('change', () => { fillPrintDebits(); refreshPrintPreview(); });
['print-period', 'print-month', 'print-debit', 'print-order', 'print-from', 'print-to', 'print-date', 'print-scope', 'print-span', 'print-report-month', 'print-year', 'print-horizon', 'print-opt-unpointed']
  .forEach(id => byId(id).addEventListener('change', refreshPrintPreview));
PRINT_OPTION_NAMES.forEach(name => byId('print-opt-' + name).addEventListener('change', () => {
  try { localStorage.setItem('finances_print_opts', JSON.stringify(Object.fromEntries(PRINT_OPTION_NAMES.map(n => [n, byId('print-opt-' + n).checked])))); } catch { /* ignoré */ }
  refreshPrintPreview();
}));
byId('print-go').addEventListener('click', () => {
  const doc = buildPrintDoc(readPrintChoice(), readPrintOptions());
  if (!doc.error) printContent(doc.title, doc.html);
});
byId('print-cancel').addEventListener('click', closePrintCenter);
byId('print-close').addEventListener('click', closePrintCenter);
byId('modal-print').addEventListener('click', (e) => { if (e.target.id === 'modal-print') closePrintCenter(); });

document.getElementById('btn-print-dashboard').addEventListener('click', () => openPrintCenter('accueil'));
document.getElementById('btn-print-ops').addEventListener('click', () => openPrintCenter('operations'));
document.getElementById('btn-print-scheduled').addEventListener('click', () => openPrintCenter('echeances'));

// ── FENÊTRE « RECHERCHER » (bouton 🔍, disponible sur tous les onglets) ─────
const SEARCH_PAGE = 100;   // résultats montrés d'un coup
let searchLimit = SEARCH_PAGE;
function readSearchCriteria() {
  const value = id => document.getElementById(id).value;
  return { query: value('s-query'), period: value('s-period'), account: value('s-account'), type: value('s-type'), pointed: value('s-pointed') };
}
function searchRowHtml(op, showAccount) {
  const sign = op.type === 'credit' ? '+' : '-';
  const meta = [showAccount ? op.account : '', op.category, op.opType === 'Programmee' ? 'programmée' : '', op.pointed ? '✓ pointée' : ''].filter(Boolean).join(' · ');
  return `<li class="sr-row" role="button" tabindex="0" data-id="${esc(op.id)}" data-date="${esc(op.date)}">
    <span class="sr-date">${op.date.slice(8, 10)}/${op.date.slice(5, 7)}</span>
    <span class="sr-main"><span class="sr-label">${esc(op.label)}</span><small>${esc(meta)}</small>${commentHtml(op, 'span')}</span>
    <span class="sr-amt ${op.type}">${sign}${fmt(op.amount)}</span>
  </li>`;
}
// Résultats regroupés par mois, avec le total de chaque mois (calculé sur tous ses résultats)
function renderSearch() {
  const box = document.getElementById('modal-search');
  if (!box || box.classList.contains('hidden')) return;
  const criteria = readSearchCriteria(), ops = searchOperations(criteria);
  const total = totalsText(searchTotals(ops, criteria.account));
  document.getElementById('s-total').innerHTML = ops.length
    ? `<b>${fmtInt(ops.length)} opération${ops.length > 1 ? 's' : ''} trouvée${ops.length > 1 ? 's' : ''}</b>${total ? ` · <span class="sr-sum">${total}</span>` : ''}`
    : '<b>Aucune opération trouvée</b> : essayez un mot plus court ou une période plus large.';
  let left = searchLimit;
  const html = groupByMonth(ops).map(g => {
    if (left <= 0) return '';
    const shown = g.ops.slice(0, left);
    left -= shown.length;
    const sum = totalsText(searchTotals(g.ops, criteria.account));
    return `<li class="sr-month"><b>${g.title}</b><span class="sr-sum">${sum}</span></li>` + shown.map(op => searchRowHtml(op, !criteria.account)).join('');
  }).join('');
  const rest = ops.length - searchLimit;
  document.getElementById('s-results').innerHTML = html + (rest > 0 ? `<li class="more-row"><button type="button" id="s-more" class="btn-secondary">Afficher plus (${fmtInt(rest)} restantes)</button></li>` : '');
  document.getElementById('s-print').disabled = !ops.length;
}
function openSearch() {
  fillSelect(byId('s-account'), [['', 'Tous les comptes'], ...getAccountNames().map(n => [n, n])], byId('s-account').value);
  searchLimit = SEARCH_PAGE;
  byId('modal-search').classList.remove('hidden');
  renderSearch();
  byId('s-query').focus({ preventScroll: true });
  byId('s-query').select();
}
function closeSearch() {
  byId('modal-search').classList.add('hidden');
}
function openSearchResult(target) {
  const row = target.closest && target.closest('.sr-row');
  if (row) editOp(row.dataset.id, row.dataset.date);   // la fenêtre de modification s'ouvre par-dessus ; les résultats se mettent à jour
}
byId('btn-search').addEventListener('click', openSearch);
byId('s-close').addEventListener('click', closeSearch);
byId('s-cancel').addEventListener('click', closeSearch);
byId('modal-search').addEventListener('click', (e) => { if (e.target.id === 'modal-search') closeSearch(); });
const searchChanged = () => { searchLimit = SEARCH_PAGE; renderSearch(); };
byId('s-query').addEventListener('input', searchChanged);
['s-period', 's-account', 's-type', 's-pointed'].forEach(id => byId(id).addEventListener('change', searchChanged));
byId('s-results').addEventListener('click', (e) => {
  if (e.target.id === 's-more') { searchLimit += SEARCH_PAGE; renderSearch(); return; }
  openSearchResult(e.target);
});
byId('s-results').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSearchResult(e.target); } });
byId('s-print').addEventListener('click', () => {
  const doc = searchPrintDoc(readSearchCriteria());
  printContent(doc.title, doc.html);
});

// ── SAUVEGARDES LOCALES ──────────────────────────────────────────────────────
// Les copies de secours sont gardées dans la base de l'appareil (IndexedDB), bien plus grande que le petit stockage
// qui contient les données : elles ne peuvent plus le remplir.
const MAX_BACKUPS = 5;
let backupWork = Promise.resolve();      // les écritures se font l'une après l'autre

// Copies restées à l'ancien emplacement (versions précédentes de l'application)
function oldPlaceBackups() {
  try { return JSON.parse(localStorage.getItem('finances_backups') || '[]'); } catch { return []; }
}
// Les 5 états différents les plus récents, du plus ancien au plus récent (ouvrir l'application plusieurs fois sans rien
// changer ne chasse donc pas les copies plus anciennes)
function keepRecentBackups(list) {
  const sorted = list.filter(b => b && b.data).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const latest = new Map(sorted.map(b => [b.data, b]));          // contenu identique : la date la plus récente gagne
  return sorted.filter(b => latest.get(b.data) === b).slice(-MAX_BACKUPS);
}
// désigne une copie sans ambiguïté (date et empreinte du contenu)
function backupKey(b) {
  let sum = 0;
  for (let i = 0; i < b.data.length; i++) sum = (sum * 31 + b.data.charCodeAt(i)) | 0;
  return `${b.date}#${b.data.length}#${sum}`;
}
// Ajoute des copies et reprend au passage celles de l'ancien emplacement, qui est alors libéré
function storeBackups(added) {
  backupWork = backupWork.then(async () => {
    const old = oldPlaceBackups();
    await deviceDbRun('readwrite', store => {
      const read = store.get('backups');
      read.onsuccess = () => store.put(keepRecentBackups([...(read.result || []), ...old, ...added]), 'backups');
      return read;
    });
    localStorage.removeItem('finances_backups');
  }).catch(e => {
    console.warn('Copie de secours impossible :', (e && e.message) || e);
    // base indisponible : les 2 dernières copies restent à l'ancien emplacement, s'il y a la place
    if (added.length) setPref('finances_backups', JSON.stringify(keepRecentBackups([...oldPlaceBackups(), ...added]).slice(-2)));
  });
  return backupWork;
}
async function readBackups() {
  await backupWork;
  const stored = await deviceDbRun('readonly', s => s.get('backups')).catch(() => null);
  return keepRecentBackups([...(stored || []), ...oldPlaceBackups()]);
}
function autoBackup() {
  if (!appData.operations.length) return backupWork;
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  // les données sont copiées tout de suite (avant tout remplacement), l'écriture suit
  return storeBackups([{ date: stamp, ops: appData.operations.length, data: JSON.stringify(appData) }]);
}

async function renderBackupList() {
  const backups = await readBackups();
  const el = document.getElementById('backup-list');
  if (!backups.length) {
    el.textContent = 'Aucune sauvegarde';
    return;
  }
  el.innerHTML = backups.map(b => {
    // le nombre d'opérations est mémorisé à la création (inutile de ré-analyser des sauvegardes de ~450 Ko à chaque affichage)
    let ops = b.ops;
    if (ops === undefined) { try { const d = JSON.parse(b.data); ops = d.operations ? d.operations.length : 0; } catch { ops = 0; } }
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:2px 0">
      <span>📁 ${esc(b.date)}</span>
      <span style="display:flex;align-items:center;gap:8px">${Number(ops) || 0} ops <button type="button" class="act" style="min-height:38px;padding:0 12px" data-backup="${esc(backupKey(b))}">Restaurer</button></span>
    </div>`;
  }).join('');
}

// Restauration choisie par l'utilisateur : copie de secours de l'état actuel, puis remplacement.
// Ce qui disparaît est noté comme supprimé, pour que la synchronisation ne le fasse pas revenir.
function replaceData(next) {
  safeBackup();
  const now = new Date().toISOString();
  const tombstones = (list, key, field) => {
    const kept = new Set(next[list].map(x => x[key]));
    const out = { ...appData[field], ...next[field] };
    for (const x of appData[list] || []) if (!kept.has(x[key])) out[x[key]] = now;
    for (const k of kept) delete out[k];
    return out;
  };
  next.deletedIds = tombstones('operations', 'id', 'deletedIds');
  next.deletedAccounts = tombstones('accounts', 'name', 'deletedAccounts');
  next.keyTimes = { ...next.keyTimes, ...appData.keyTimes };
  appData = next;
  saveLocal();
}
function checkRestorable(data) {
  if (!isValidData(data) || !(data.operations.length || data.accounts.length)) {
    throw new Error('Ce fichier n’est pas une sauvegarde utilisable : rien n’a été modifié');
  }
  return cleanData(data);
}

async function restoreBackup(key) {
  // retrouvée par son contenu, pas par son rang : une nouvelle copie a pu s'ajouter depuis l'affichage de la liste
  const backup = (await readBackups()).find(b => backupKey(b) === key);
  if (!backup) { toast('⚠️ Cette copie n’existe plus'); renderBackupList(); return; }
  if (!confirm(`Restaurer la sauvegarde du ${backup.date} ? Les données actuelles seront remplacées.`)) return;
  try {
    replaceData(checkRestorable(JSON.parse(backup.data)));
    renderAll();
    toast(`✅ Sauvegarde du ${backup.date} restaurée`);
  } catch (e) {
    toast('❌ ' + e.message, 5000);
  }
}
document.getElementById('backup-list').addEventListener('click', (e) => {
  const button = e.target.closest('[data-backup]');
  if (button) restoreBackup(button.dataset.backup);
});

document.getElementById('btn-backup-download').addEventListener('click', async () => {
  const now = new Date();
  const defaultName = `finances-backup-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}.json`;
  const blob = new Blob([JSON.stringify(appData, null, 2)], { type: 'application/json' });

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: defaultName,
        types: [{ description: 'Fichier JSON', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      toast('💾 Sauvegarde enregistrée');
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultName;
  a.click();
  URL.revokeObjectURL(url);
  toast('💾 Sauvegarde téléchargée');
});

document.getElementById('btn-backup-restore').addEventListener('click', () => {
  document.getElementById('backup-file-input').click();
});

document.getElementById('backup-file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      let imported = null;
      try { imported = JSON.parse(reader.result); } catch { /* signalé ci-dessous */ }
      checkRestorable(imported);
      if (!confirm(`Restaurer depuis ${file.name} ? (${imported.operations.length} opérations)\n\nLes données actuelles seront remplacées (une copie de secours est faite avant).`)) return;
      replaceData(imported);
      renderAll();
      toast('✅ Données restaurées depuis le fichier');
    } catch (err) {
      toast('❌ ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ── MISE À JOUR ─────────────────────────────────────────────────────────────
// Numéro de version affiché = celui du cache du service worker (plus de « v86 » écrit en dur qui reste faux)
async function showAppVersion() {
  const el = document.getElementById('app-version');
  if (!el || !window.caches) return;
  try {
    const keys = await caches.keys();
    const v = keys.map(k => (k.match(/^finances-nc-v(\d+)$/) || [])[1]).filter(Boolean).map(Number).sort((a, b) => b - a)[0];
    if (v) el.textContent = 'Version v' + v;
  } catch { /* hors ligne / navigation privée : on laisse le texte par défaut */ }
}
showAppVersion();
document.getElementById('btn-check-update').addEventListener('click', async () => {
  const statusEl = document.getElementById('update-status');
  statusEl.textContent = '⏳ Recherche de mises à jour...';
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) {
      await reg.update();
      if (reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        statusEl.textContent = '✅ Nouvelle version trouvée — rechargement...';
        setTimeout(() => window.location.reload(), 1000);
      } else {
        statusEl.textContent = '✅ Vous avez la dernière version';
      }
    } else {
      statusEl.textContent = '⚠️ Service worker non trouvé';
    }
  } catch (e) {
    statusEl.textContent = '❌ ' + e.message;
  }
});

// ── MODE SOMBRE ─────────────────────────────────────────────────────────────
function applyDarkMode(dark) {
  document.body.classList.toggle('dark-mode', dark);
  const dot = document.getElementById('dark-toggle-dot');
  const bg = document.getElementById('dark-toggle');
  if (dot) dot.style.transform = dark ? 'translateX(22px)' : 'translateX(0)';
  if (bg) bg.style.background = dark ? 'var(--accent)' : 'var(--border)';
  const cb = document.getElementById('cfg-dark-mode');
  if (cb) cb.checked = dark;
}

(function() {
  const saved = localStorage.getItem('darkMode');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = saved !== null ? saved === 'true' : prefersDark;
  applyDarkMode(dark);
})();

document.getElementById('cfg-dark-mode').addEventListener('change', (e) => {
  const dark = e.target.checked;
  setPref('darkMode', dark);
  applyDarkMode(dark);
});

// ── FOND DE L'APPLICATION (propre à chaque appareil) ────────────────────────
// Les couleurs de chaque fond sont dans style.css (règles [data-bg="…"]), en clair et en sombre.
function backgroundChoices() {
  return [['defaut', 'Par défaut'], ['bleu', 'Bleu'], ['vert', 'Vert'], ['sable', 'Sable'], ['rose', 'Rose'], ['lagon', 'Lagon'], ['couchant', 'Couchant']];
}
function normalizeBackground(value, hasPhoto) {
  if (value === 'photo') return hasPhoto ? 'photo' : 'defaut';
  return backgroundChoices().some(([id]) => id === value) ? value : 'defaut';
}
let backgroundPhotoUrl = null;
// Visibilité de la photo, en % : 100 = photo nette, 10 = très voilée (70 si rien n'est choisi)
function photoVisibility(value) {
  const n = value === null || value === '' ? NaN : Number(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(10, Math.round(n / 5) * 5)) : 70;
}
function savedPhotoVisibility() {
  try { return photoVisibility(localStorage.getItem('finances_bg_visibility')); } catch { return 70; }
}
function applyPhotoVisibility(value) {
  const v = photoVisibility(value);
  document.documentElement.style.setProperty('--veil-a', ((100 - v) / 100).toFixed(2));
  document.getElementById('bg-visibility').value = v;
  document.getElementById('bg-visibility-value').textContent = v + ' %';
}
function savedBackground() {
  try { return localStorage.getItem('finances_background') || 'defaut'; } catch { return 'defaut'; }
}
function applyBackground(choice) {
  if (choice === 'defaut') delete document.body.dataset.bg;
  else document.body.dataset.bg = choice;
  const list = backgroundChoices().concat(backgroundPhotoUrl ? [['photo', 'Ma photo']] : []);
  document.getElementById('bg-choices').innerHTML = list.map(([id, name]) =>
    `<button type="button" class="bg-choice" role="radio" aria-checked="${id === choice}" data-bg-choice="${id}"><span class="bg-preview" data-bg="${id}"></span>${name}</button>`).join('');
  document.getElementById('btn-bg-photo').textContent = backgroundPhotoUrl ? '🖼️ Changer la photo' : '🖼️ Choisir une photo';
  document.getElementById('btn-bg-photo-remove').classList.toggle('hidden', !backgroundPhotoUrl);
  document.getElementById('bg-visibility-wrap').classList.toggle('hidden', choice !== 'photo');
}
function chooseBackground(choice) {
  setPref('finances_background', choice);
  applyBackground(choice);
}
function setBackgroundPhoto(blob) {
  if (backgroundPhotoUrl) URL.revokeObjectURL(backgroundPhotoUrl);
  backgroundPhotoUrl = blob ? URL.createObjectURL(blob) : null;
  if (blob) document.documentElement.style.setProperty('--photo', `url("${backgroundPhotoUrl}")`);
  else document.documentElement.style.removeProperty('--photo');
}
// La photo est réduite avant d'être gardée sur l'appareil (elle n'est ni envoyée ni synchronisée)
async function shrinkPhoto(file, maxSide = 1920) {
  const image = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('image illisible')), 'image/jpeg', 0.85));
}
async function initBackground() {
  applyPhotoVisibility(savedPhotoVisibility());
  const choice = savedBackground();
  applyBackground(normalizeBackground(choice, false));
  const blob = await deviceDbRun('readonly', s => s.get('backgroundPhoto')).catch(() => null);
  if (!blob) return;
  setBackgroundPhoto(blob);
  applyBackground(normalizeBackground(savedBackground(), true));
}
document.getElementById('bg-choices').addEventListener('click', e => {
  const b = e.target.closest('[data-bg-choice]');
  if (b) chooseBackground(b.dataset.bgChoice);
});
document.getElementById('bg-visibility').addEventListener('input', e => {
  setPref('finances_bg_visibility', photoVisibility(e.target.value));
  applyPhotoVisibility(e.target.value);
});
document.getElementById('btn-bg-photo').addEventListener('click', () => document.getElementById('bg-photo-input').click());
document.getElementById('bg-photo-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const blob = await shrinkPhoto(file);
    await deviceDbRun('readwrite', s => s.put(blob, 'backgroundPhoto'));
    setBackgroundPhoto(blob);
    chooseBackground('photo');
    toast('✅ Photo mise en fond');
  } catch (err) {
    console.error('Photo de fond :', err);
    toast('❌ Image non reconnue : choisissez une photo JPEG ou PNG', 5000);
  }
});
document.getElementById('btn-bg-photo-remove').addEventListener('click', async () => {
  await deviceDbRun('readwrite', s => s.delete('backgroundPhoto')).catch(err => console.error('Photo non effacée :', err));
  setBackgroundPhoto(null);
  chooseBackground(normalizeBackground(savedBackground(), false));
});

// ── CADRE « SOLDE TOTAL » : couleur au choix ou invisible (propre à chaque appareil) ──
// Les couleurs proposées sont dans style.css (règles [data-card="…"]).
function cardChoices() {
  return [['bleu', 'Bleu'], ['turquoise', 'Lagon'], ['vert', 'Vert'], ['violet', 'Violet'], ['bordeaux', 'Bordeaux'], ['orange', 'Orange'], ['ardoise', 'Ardoise'], ['invisible', 'Invisible']];
}
// Un choix connu, ou une couleur libre « #rrggbb » ; sinon le bleu d'origine
function normalizeCardColor(value) {
  const v = String(value || '').toLowerCase();
  if (v.length === 7 && v[0] === '#' && !Number.isNaN(Number('0x' + v.slice(1)))) return v;
  return cardChoices().some(([id]) => id === v) ? v : 'bleu';
}
// Couleur claire : on écrit en foncé dessus (contraste meilleur qu'en blanc)
function isLightColor(hex) {
  const [r, g, b] = [1, 3, 5].map(i => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.205;
}
// Couleur et visibilité mémorisées (« Invisible » = visibilité 0 ; l'ancien réglage « invisible » est repris)
function cardSettings(color, visibility) {
  const n = visibility === null || visibility === '' ? NaN : Number(visibility);
  const v = Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n / 5) * 5)) : null;
  if (color === 'invisible') return { color: 'bleu', visibility: v === null ? 0 : v };
  return { color: normalizeCardColor(color), visibility: v === null ? 100 : v };
}
function savedCard() {
  try { return cardSettings(localStorage.getItem('finances_card_color'), localStorage.getItem('finances_card_visibility')); }
  catch { return cardSettings(null, null); }
}
function applyCardLook({ color, visibility }) {
  const card = document.querySelector('.balance-card');
  const custom = color.startsWith('#');
  const faint = visibility < 65;                  // trop transparent pour du blanc : on écrit comme sur le fond
  card.dataset.card = custom ? 'perso' : color;
  card.classList.toggle('faint', faint);
  for (const p of ['--hero-bg', '--hero-ink', '--hero-up', '--hero-down', '--hero-shadow']) card.style.removeProperty(p);
  const set = (p, v) => card.style.setProperty(p, v);
  set('--hero-alpha', (visibility / 100).toFixed(2));
  if (custom) {
    const light = isLightColor(color);
    set('--hero-bg', light ? `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color}, white 35%))` : `linear-gradient(135deg, color-mix(in srgb, ${color}, black 35%), ${color})`);
    set('--hero-shadow', 'rgba(0, 0, 0, 0.18)');
    if (!faint) {
      set('--hero-ink', light ? '28, 28, 30' : '255, 255, 255');
      set('--hero-up', light ? '#1b5e20' : '#a5e8b0');
      set('--hero-down', light ? '#a31515' : '#ffb4ab');
    }
    document.getElementById('card-color').value = color;
  }
  document.getElementById('card-visibility').value = visibility;
  document.getElementById('card-visibility-value').textContent = visibility + ' %';
  const shown = visibility === 0 ? 'invisible' : color;
  for (const el of document.querySelectorAll('#card-choices .bg-choice')) {
    const on = el.dataset.cardChoice ? el.dataset.cardChoice === shown : shown.startsWith('#');
    el.classList.toggle('selected', on);
    if (el.dataset.cardChoice) el.setAttribute('aria-checked', on);
  }
}
function setCardLook(color, visibility) {
  const look = cardSettings(color, visibility);
  setPref('finances_card_color', look.color);
  setPref('finances_card_visibility', look.visibility);
  applyCardLook(look);
}
// Choisir une couleur rend le cadre visible ; « Invisible » met la visibilité à 0 sans oublier la couleur
function chooseCardColor(value) {
  const { color, visibility } = savedCard();
  if (value === 'invisible') setCardLook(color, 0);
  else setCardLook(value, visibility || 100);
}
function initCardColor() {
  document.getElementById('card-choices').innerHTML = cardChoices().map(([id, name]) =>
    `<button type="button" class="bg-choice" role="radio" aria-checked="false" data-card-choice="${id}"><span class="bg-preview card-preview" data-card="${id}"></span>${name}</button>`).join('')
    + '<label class="bg-choice"><input type="color" id="card-color" value="#1a237e" aria-label="Autre couleur"/>Au choix</label>';
  document.getElementById('card-color').addEventListener('input', e => chooseCardColor(e.target.value));
  applyCardLook(savedCard());
}
document.getElementById('card-choices').addEventListener('click', e => {
  const b = e.target.closest('[data-card-choice]');
  if (b) chooseCardColor(b.dataset.cardChoice);
});
document.getElementById('card-visibility').addEventListener('input', e => setCardLook(savedCard().color, e.target.value));

// ── AIDE ────────────────────────────────────────────────────────────────────
document.querySelectorAll('.help-toggle').forEach(button => button.addEventListener('click', () => {
  const body = button.nextElementSibling;
  body.classList.toggle('hidden');
  button.querySelector('.help-arrow').textContent = body.classList.contains('hidden') ? '▶' : '▼';
}));
document.getElementById('btn-help').addEventListener('click', () => {
  document.getElementById('modal-help').classList.remove('hidden');
});
document.getElementById('btn-help-close').addEventListener('click', () => {
  document.getElementById('modal-help').classList.add('hidden');
});

// ── EXPORT CSV ──────────────────────────────────────────────────────────────
function populateExportAccount() {
  const names = getAccountNames();
  const sel = document.getElementById('cfg-export-account');
  sel.innerHTML = '<option value="">Tous les comptes</option>' +
    names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
}

document.getElementById('btn-export-csv').addEventListener('click', () => {
  const accFilter = document.getElementById('cfg-export-account').value;
  let ops = [...appData.operations].sort((a, b) => a.date.localeCompare(b.date));
  if (accFilter) ops = ops.filter(op => op.account === accFilter);

  const BOM = '﻿';
  const header = 'Date;Libelle;Debit;Credit;Compte;Categorie;Type;Commentaire\n';
  const rows = ops.map(op => {
    const debit = op.type === 'debit' ? op.amount : '';
    const credit = op.type === 'credit' ? op.amount : '';
    return [op.date, csvField(op.label), debit, credit, csvField(op.account), csvField(op.category), csvField(op.opType), op.comment ? csvText(safeCell(op.comment)) : ''].join(';');
  }).join('\n');

  const blob = new Blob([BOM + header + rows], { type: 'text/csv;charset=utf-8' });
  const name = accFilter || 'tous-comptes';
  const fileName = `export-${name}-${today()}.csv`;

  if (window.showSaveFilePicker) {
    window.showSaveFilePicker({ suggestedName: fileName, types: [{ accept: { 'text/csv': ['.csv'] } }] })
      .then(async h => { const w = await h.createWritable(); await w.write(blob); await w.close(); toast('📊 CSV exporté'); })
      .catch(e => { if (e.name !== 'AbortError') toast('❌ ' + e.message); });
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('📊 CSV exporté');
  }
});

// ── ALERTES DE SOLDE ────────────────────────────────────────────────────────
function renderAlertsConfig() {
  const alerts = appData.alerts || {};
  const names = getAccountNames();
  const container = document.getElementById('cfg-alerts');
  container.innerHTML = names.map(name => {
    const val = alerts[name] !== undefined ? alerts[name] : '';
    return `<div style="display:flex;align-items:center;gap:8px">
      <span style="flex:1;font-size:0.85rem">${esc(name)}</span>
      <input type="number" data-alert-acc="${esc(name)}" value="${val}" placeholder="—" inputmode="numeric" style="width:100px;padding:6px;text-align:right;font-size:0.85rem"/>
      <span style="font-size:0.78rem;color:var(--muted)">F</span>
    </div>`;
  }).join('');
}

document.getElementById('btn-save-alerts').addEventListener('click', () => {
  if (!appData.alerts) appData.alerts = {};
  document.querySelectorAll('[data-alert-acc]').forEach(inp => {
    const acc = inp.dataset.alertAcc;
    const val = parseInt(inp.value, 10);
    if (!isNaN(val)) appData.alerts[acc] = val;
    else delete appData.alerts[acc];
  });
  saveLocal();
  renderAll();
  toast('✅ Alertes enregistrées');
  if (accessToken) uploadToDrive().catch(() => {});
});

function checkAlerts() {
  const alerts = appData.alerts || {};
  const names = getAccountNames();
  for (const name of names) {
    if (alerts[name] === undefined) continue;
    const bal = calcAccountBalance(name);
    if (bal < alerts[name]) {
      toast(`⚠️ ${name} : ${fmt(bal)} — sous le seuil de ${fmt(alerts[name])}`, 5000);
    }
  }
}

// ── SAUVEGARDE AUTO SUR DISQUE ───────────────────────────────────────────────
let backupDirHandle = null;      // dossier autorisé : la sauvegarde automatique est active
let backupDirStored = null;      // dossier mémorisé (autorisé ou non)
let backupDirNote = null;        // résultat de la dernière action : { text, ok }
const BACKUP_DB = 'finances_backup_db';

let backupDirFailed = false;     // la dernière copie automatique n'a pas pu être écrite
let backupAlertHidden = false;   // bandeau de l'accueil masqué jusqu'au prochain démarrage

// Petite base locale de l'appareil (dossier de sauvegarde, photo de fond)
async function deviceDbRun(mode, action) {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(BACKUP_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', mode);
    const req = action(tx.objectStore('handles'));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
const storeHandle = handle => deviceDbRun('readwrite', s => s.put(handle, 'backupDir'));
const forgetHandle = () => deviceDbRun('readwrite', s => s.delete('backupDir'));
const loadHandle = () => deviceDbRun('readonly', s => s.get('backupDir')).then(h => h || null, () => null);

// Boutons et message du bloc « Sauvegarde automatique » selon la situation
function backupDirView(supported, name, active) {
  const view = { main: '📁 Choisir le dossier', allow: false, clear: false, tone: 'muted', status: 'Aucun dossier configuré' };
  if (!supported) return { ...view, tone: 'warn', status: '⚠️ Ce navigateur ne permet pas de sauvegarder dans un dossier (il faut Chrome ou Edge). Le bouton « Télécharger » reste disponible.' };
  if (!name) return view;
  const known = { ...view, main: '📁 Changer de dossier', clear: true };
  if (!active) return { ...known, allow: true, tone: 'warn', status: `⚠️ Dossier « ${name} » : sauvegarde auto en pause (normal après un redémarrage). Réautorisez-le ou changez de dossier.` };
  return { ...known, tone: 'ok', status: `✅ Dossier : ${name} — sauvegarde auto active` };
}
// Message clair quand le dossier ne peut pas être choisi
function backupDirError(e) {
  const detail = `(${(e && e.name) || 'Erreur'} : ${(e && e.message) || '?'})`;
  if (e && e.name === 'AbortError') return `Aucun dossier choisi. Si Chrome refuse un dossier (« contient des fichiers système »), créez un dossier à l'intérieur de Documents et choisissez celui-là.`;
  if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) return `Chrome n'autorise pas l'accès au dossier : vérifiez les autorisations de l'application dans Chrome, puis réessayez. ${detail}`;
  return `Impossible d'utiliser ce dossier. ${detail}`;
}

// Une seule copie automatique par jour : le même fichier est réécrit dans la journée
function autoBackupName(date) {
  return `finances-auto-${localDateStr(date).split('-').join('')}.json`;
}
// Copies automatiques à effacer : on garde les jours les plus récents. Aucun autre fichier n'est jamais touché.
function oldAutoBackups(names, keepDays = 10) {
  const auto = names.filter(n => n.startsWith('finances-auto-') && n.length === 'finances-auto-AAAAMMJJ.json'.length && n.endsWith('.json'));
  return auto.sort().reverse().slice(keepDays);
}
// Bandeau de l'accueil quand la sauvegarde automatique ne fonctionne plus (rien à dire sinon)
function backupAlert(supported, stored, active, failed) {
  if (!supported || !stored) return null;
  if (!active) return { text: '⏸️ Sauvegarde automatique en pause', button: 'Réautoriser' };
  return failed ? { text: '⚠️ La dernière copie de sauvegarde a échoué', button: 'Réessayer' } : null;
}

async function initBackupDir() {
  backupDirStored = await loadHandle();
  try {
    if (backupDirStored && await backupDirStored.queryPermission({ mode: 'readwrite' }) === 'granted') backupDirHandle = backupDirStored;
  } catch { /* dossier inutilisable : « autorisation à redonner » */ }
  updateBackupDirStatus();
  await autoBackupToDir();                    // copie du jour dès l'ouverture
}

function updateBackupDirStatus() {
  const g = id => document.getElementById(id);
  const folder = backupDirHandle || backupDirStored;
  const view = backupDirView(!!window.showDirectoryPicker, folder && folder.name, !!backupDirHandle);
  g('btn-backup-dir').textContent = view.main;
  g('btn-backup-dir-allow').classList.toggle('hidden', !view.allow);
  g('btn-backup-dir-clear').classList.toggle('hidden', !view.clear);
  g('backup-dir-status').textContent = view.status;
  g('backup-dir-status').style.color = { ok: 'var(--accent)', warn: 'var(--warning)', muted: 'var(--muted)' }[view.tone];
  g('backup-dir-note').textContent = backupDirNote ? backupDirNote.text : '';
  g('backup-dir-note').classList.toggle('notice', !!backupDirNote && !backupDirNote.ok);
  const alert = backupAlertHidden ? null : backupAlert(!!window.showDirectoryPicker, !!folder, !!backupDirHandle, backupDirFailed);
  g('backup-alert').classList.toggle('hidden', !alert);
  if (alert) { g('backup-alert-text').textContent = alert.text; g('backup-alert-fix').textContent = alert.button; }
}
function setBackupDirNote(text, ok = false) {
  backupDirNote = text ? { text, ok } : null;
  updateBackupDirStatus();
}

// Première copie juste après un choix ou une réautorisation, avec un résultat visible
async function firstBackup(success) {
  try {
    await writeBackupToDir();
    setBackupDirNote(success, true);
    toast(success);
    return true;
  } catch (e) {
    backupDirHandle = null;
    toast('⚠️ La copie de sauvegarde n’a pas pu être écrite (voir Paramètres › Sauvegardes)', 5000);
    setBackupDirNote(`La copie n'a pas pu être écrite dans ce dossier (lecture seule ou protégé par l'antivirus ?). Choisissez-en un autre. (${e.name} : ${e.message})`);
  }
}

// Choisir ou changer le dossier. La fenêtre est demandée tout de suite, sans rien attendre avant :
// le navigateur ne l'ouvre qu'à la suite directe d'un clic.
async function chooseBackupDir() {
  if (!window.showDirectoryPicker) { setBackupDirNote(''); return; }
  let slow;
  try {
    const request = window.showDirectoryPicker({ id: 'finances-sauvegarde', mode: 'readwrite' });
    setBackupDirNote('⏳ Choisissez un dossier dans la fenêtre qui s’ouvre…', true);
    slow = setTimeout(() => setBackupDirNote('Vous ne voyez pas la fenêtre de choix ? Elle est peut-être hors de l’écran : faites Alt + Espace, « Déplacer », puis les flèches du clavier.'), 6000);
    const handle = await request;
    clearTimeout(slow);
    const previous = { handle: backupDirHandle, stored: backupDirStored };
    backupDirHandle = backupDirStored = handle;
    if (await firstBackup('✅ Dossier choisi : première copie enregistrée')) {
      await storeHandle(handle).catch(e => console.error('Dossier non mémorisé :', e));
    } else {                                    // dossier inutilisable : on garde l'ancien
      ({ handle: backupDirHandle, stored: backupDirStored } = previous);
      updateBackupDirStatus();
    }
  } catch (e) {
    clearTimeout(slow);
    setBackupDirNote(backupDirError(e));
  }
}

// Redonner l'accès au dossier mémorisé (Chrome le retire après un redémarrage)
async function allowBackupDir() {
  const folder = backupDirStored;
  if (!folder) return;
  try {
    setBackupDirNote('⏳ Répondez à la demande d’autorisation du navigateur (en haut de la fenêtre)…', true);
    if (await folder.requestPermission({ mode: 'readwrite' }) !== 'granted') {
      setBackupDirNote('Autorisation non accordée. Réessayez, ou choisissez un autre dossier avec « Changer de dossier ».');
      toast('⚠️ Autorisation non accordée');
      return;
    }
    backupDirHandle = folder;
    await firstBackup('✅ Accès rétabli : copie enregistrée');
  } catch (e) {
    setBackupDirNote(`Ce dossier n'est plus utilisable (déplacé ou supprimé ?). Choisissez-en un autre. (${e.name} : ${e.message})`);
  }
}

async function clearBackupDir() {
  backupDirHandle = backupDirStored = null;
  await forgetHandle().catch(e => console.error('Dossier non oublié :', e));
  setBackupDirNote('');
  toast('Dossier de sauvegarde retiré');
}

document.getElementById('btn-backup-dir').addEventListener('click', chooseBackupDir);
document.getElementById('btn-backup-dir-allow').addEventListener('click', allowBackupDir);
document.getElementById('btn-backup-dir-clear').addEventListener('click', clearBackupDir);
document.getElementById('backup-alert-fix').addEventListener('click', allowBackupDir);
document.getElementById('backup-alert-close').addEventListener('click', () => { backupAlertHidden = true; updateBackupDirStatus(); });

// Deux écritures ne se chevauchent jamais : une demande reçue pendant une écriture en provoque une autre juste après
function oneAtATime(task) {
  let running = null, again = false;
  return function () {
    again = !!running;
    if (!running) running = (async () => { do { again = false; await task(); } while (again); })().finally(() => { running = null; });
    return running;
  };
}
// Copie automatique : à l'ouverture, après chaque modification et au passage en arrière-plan. Écrire seulement à la
// fermeture ne suffit pas : l'écriture est coupée avant la fin et laisse un fichier vide. Un échec est signalé.
async function dirBackupOnce() {
  if (!backupDirHandle || !appData.operations.length) return;
  try {
    const failedBefore = backupDirFailed;
    await writeBackupToDir();
    if (failedBefore) backupDirNote = null;     // l’ancien message d’échec n’a plus lieu d’être
    updateBackupDirStatus();
  } catch (e) {
    console.error('Backup auto erreur:', e);
    backupDirFailed = true;
    setBackupDirNote(`La dernière copie n'a pas pu être écrite. (${e.name} : ${e.message})`);
  }
}
const autoBackupToDir = oneAtATime(dirBackupOnce);
// Après une modification : on écrit dès 3 secondes de calme
function scheduleDirBackup() {
  clearTimeout(scheduleDirBackup.timer);
  scheduleDirBackup.timer = setTimeout(() => autoBackupToDir(), 3000);
}

// Écrit la copie du jour dans le dossier autorisé, puis efface les copies automatiques de plus de 10 jours
async function writeBackupToDir() {
  if (!backupDirHandle) return;
  const fileHandle = await backupDirHandle.getFileHandle(autoBackupName(new Date()), { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(appData, null, 2));
  await writable.close();
  backupDirFailed = false;

  const names = [];
  for await (const name of backupDirHandle.keys()) names.push(name);
  for (const old of oldAutoBackups(names)) {
    await backupDirHandle.removeEntry(old).catch(e => console.error('Ancienne copie non effacée :', e));
  }
}

// ── RÉINITIALISATION ─────────────────────────────────────────────────────────
// Tout ce qui contient des données ou des noms de comptes ; les réglages d'apparence restent
const DATA_KEYS = ['finances_data', 'finances_backups', 'finances_pwd', 'finances_driverev', 'finances_basesync', 'finances_pending', 'finances_lastdrive',
  'finances_bank_cards', 'finances_last_account', 'finances_cat_skip', 'finances_proj_accounts', 'lastImportUndo', 'lastImportIds', 'userEmail', 'gToken', 'gTokenExp'];
function eraseDeviceData() {
  for (const key of DATA_KEYS) localStorage.removeItem(key);
  damagedData = null;
  // à la suite des copies en cours d'écriture, pour qu'aucune ne réapparaisse
  backupWork = backupWork.then(() => deviceDbRun('readwrite', store => { store.delete('damaged'); return store.delete('backups'); }))
    .catch(e => console.warn('Copies non effacées :', (e && e.message) || e));
}
document.getElementById('btn-reset').addEventListener('click', () => {
  if (!confirm('Effacer toutes les données de cet appareil, y compris ses copies de secours ?\n\nGoogle Drive et les fichiers déjà téléchargés ne sont pas touchés. Cette action est irréversible.')) return;
  eraseDeviceData();
  appData = structuredClone(defaultData);
  accessToken = null;
  driveFileId = null;
  updateConnBadge();
  updatePwdStatus();
  showScreen('screen-login');
  toast('✅ Données effacées');
});

// ── STATISTIQUES ─────────────────────────────────────────────────────────────
// Un virement entre comptes (jambe débit ou crédit) n'est ni un revenu ni une dépense.
function isTransferOp(op) {
  return op.opType === 'Virement' || /^\[.+\]$/.test(op.label || '');
}

// ── Comptes cochés (projection) ──
// saved : null = tous les comptes (y compris les futurs), sinon la liste cochée. Des noms disparus : tous.
function checkedAccounts(saved, names) {
  if (!Array.isArray(saved)) return [...names];
  const kept = names.filter(n => saved.includes(n));
  return saved.length && !kept.length ? [...names] : kept;
}
// Le périmètre correspondant : tous ('') , ceux du solde total ('__total') ou la liste choisie
function scopeFromChecked(selected) {
  const names = getAccountNames();
  if (selected.length === names.length) return '';
  const total = names.filter(isAccountIncluded);
  if (selected.length && selected.length === total.length && total.every(n => selected.includes(n))) return '__total';
  return selected;
}
function accountChecksHtml(selected) {
  const names = getAccountNames(), hasExcluded = names.some(n => !isAccountIncluded(n));
  return `<legend>Comptes à additionner</legend>
    <button type="button" class="chip-btn" data-pick="all">Tous</button>${hasExcluded ? '<button type="button" class="chip-btn" data-pick="total">Solde total</button>' : ''}`
    + names.map(n => `<label class="acc-check"><input type="checkbox" value="${esc(n)}"${selected.includes(n) ? ' checked' : ''}/> ${esc(n)}</label>`).join('');
}
function readChecks(box) {
  return [...box.querySelectorAll('input[type=checkbox]:checked')].map(i => i.value);
}
// Les comptes choisis par un bouton rapide
function pickedAccounts(pick) {
  const names = getAccountNames();
  return pick === 'total' ? names.filter(isAccountIncluded) : names;
}

// Comptes d'un périmètre d'affichage : '' = tous les comptes, '__total' = ceux comptés dans le solde total,
// sinon le compte désigné.
function getScopeNames(scope) {
  const names = getAccountNames();
  if (Array.isArray(scope)) return names.filter(n => scope.includes(n));   // comptes cochés
  if (scope === '__total') return names.filter(isAccountIncluded);
  if (!scope) return names;
  return names.includes(scope) ? [scope] : [];
}

// Solde de fin de mois d'un périmètre de comptes (voir getScopeNames).
function calcScopeBalanceEndOfMonth(scope, year, month) {
  return getScopeNames(scope).reduce((s, n) => s + calcBalanceEndOfMonth(n, year, month), 0);
}

// Solde d'un périmètre de comptes à une date donnée ('AAAA-MM-JJ').
function calcScopeBalanceAsOf(scope, dateStr) {
  return getScopeNames(scope).reduce((s, n) => s + calcBalanceAsOf(n, dateStr), 0);
}

// Évolution du solde d'un périmètre sur les `days` derniers jours : un point tous les `step` jours, le dernier à la date de fin.
function calcTrendSeries(scope, endStr, days, step) {
  const end = new Date(endStr + 'T00:00:00');
  const points = [];
  for (let back = days; back > 0; back -= step) {
    const d = new Date(end);
    d.setDate(d.getDate() - back);
    const date = localDateStr(d);
    points.push({ date, balance: calcScopeBalanceAsOf(scope, date) });
  }
  points.push({ date: endStr, balance: calcScopeBalanceAsOf(scope, endStr) });
  const first = points[0].balance, last = points[points.length - 1].balance;
  return { points, first, last, delta: last - first };
}

// Suggestions de saisie rapide : les libellés les plus utiles pour une dépense (debit) ou un revenu (credit), d'après l'historique
// de l'appareil. Score = fréquence pondérée par la récence (demi-vie de 60 jours). Le montant n'est proposé que s'il se répète à
// l'identique (les trois derniers, au moins deux) : un montant variable ne se devine pas.
function getQuickSuggestions(type, limit, todayStr) {
  const norm = s => String(s || '').trim().toLowerCase();
  const groups = new Map();
  for (const o of appData.operations) {
    if (o.opType === 'Programmee' || o.opType === 'Virement' || o.type !== type || !o.label || !o.date) continue;
    if (/^\[.+\]$/.test(o.label) || !(o.amount > 0)) continue;
    const k = norm(o.label);
    let g = groups.get(k);
    if (!g) groups.set(k, g = { ops: [], score: 0 });
    g.ops.push(o);
    g.score += Math.pow(0.5, Math.max(0, daysBetween(o.date, todayStr)) / 60);
  }
  return [...groups.values()]
    .map(g => {
      const ops = g.ops.slice().sort((a, b) => b.date.localeCompare(a.date));
      const last = ops[0];
      const recent = ops.slice(0, 3);
      const fixed = recent.length >= 2 && recent.every(o => o.amount === last.amount);
      return { label: String(last.label).trim(), category: last.category || '', account: last.account, count: ops.length, score: g.score, amount: fixed ? last.amount : null };
    })
    .sort((a, b) => b.score - a.score || b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

// Dernière catégorie et dernier compte utilisés avec ce libellé (même sens), ou null : sert à préremplir la saisie.
function findLabelHistory(label, type) {
  const k = String(label || '').trim().toLowerCase();
  if (!k) return null;
  let best = null;
  for (const o of appData.operations) {
    if (o.opType === 'Programmee' || o.type !== type || !o.date || String(o.label || '').trim().toLowerCase() !== k) continue;
    if (!best || o.date >= best.date) best = o;
  }
  return best ? { category: best.category || '', account: best.account } : null;
}

// Une opération « sans catégorie » : catégorie vide, « Autre » ou « … à catégoriser » (valeurs par défaut des imports).
function isUnclassified(op) {
  const c = String(op.category || '').trim().toLowerCase();
  return !c || c === 'autre' || /cat[ée]goris/.test(c);
}

// File « À classer » : les opérations sans catégorie regroupées par libellé (et par sens : dépense / revenu), avec la catégorie
// habituelle de ce libellé quand des opérations identiques ont déjà été classées. since : seuls les libellés qui ont au moins une
// opération depuis cette date ('AAAA-MM-JJ', '' = tout l'historique) ; skip : clés à ne pas proposer. Le groupe contient TOUTES les
// opérations sans catégorie de ce libellé (toutes dates), triées du montant total le plus élevé au plus faible.
// suggestion : catégorie la plus fréquente parmi les opérations déjà classées de même libellé si elle pèse au moins 60 % ;
// confident : au moins 80 % et au moins deux opérations déjà classées (une seule ne suffit pas pour appliquer en lot).
function getCategorizeQueue(since, skip) {
  const norm = x => String(x || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const skipSet = skip instanceof Set ? skip : new Set(skip || []);
  const groups = new Map();
  const seen = new Map();
  for (const o of appData.operations) {
    if (o.opType === 'Programmee' || o.opType === 'Regularisation' || isTransferOp(o) || !o.label || !o.date) continue;
    if (o.type !== 'debit' && o.type !== 'credit') continue;
    const k = `${o.type}|${norm(o.label)}`;
    if (isUnclassified(o)) {
      let g = groups.get(k);
      if (!g) groups.set(k, g = { key: k, label: String(o.label).trim(), type: o.type, ids: [], count: 0, total: 0, lastDate: '', recent: false });
      g.ids.push(o.id);
      g.count++;
      g.total += o.amount;
      if (o.date >= g.lastDate) { g.lastDate = o.date; g.label = String(o.label).trim(); }
      if (!since || o.date >= since) g.recent = true;
    } else {
      const m = seen.get(k) || {};
      m[o.category] = (m[o.category] || 0) + 1;
      seen.set(k, m);
    }
  }
  const out = [];
  for (const g of groups.values()) {
    if (!g.recent || skipSet.has(g.key)) continue;
    const list = Object.entries(seen.get(g.key) || {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([category, count]) => ({ category, count }));
    const total = list.reduce((sum, x) => sum + x.count, 0);
    const share = total ? list[0].count / total : 0;
    g.seen = list;
    g.suggestion = share >= 0.6 ? { category: list[0].category, count: total, share, confident: share >= 0.8 && total >= 2 } : null;
    out.push(g);
  }
  return out.sort((a, b) => b.total - a.total || b.count - a.count || a.label.localeCompare(b.label));
}

// Catégories à proposer pour un sens (dépense / revenu) : celles déjà utilisées par des opérations classées de ce sens, de la plus à la
// moins fréquente, puis les catégories de la liste de l'utilisateur (et leurs sous-catégories) pas encore utilisées. « Revenus » n'est
// proposée en base que pour un revenu (et en premier) ; « Autre » jamais : c'est justement ce qu'on cherche à quitter.
function getCategoryChoices(type) {
  const counts = new Map();
  const mine = new Set(), theirs = new Set();                  // catégories principales utilisées par ce sens / par l'autre sens
  for (const o of appData.operations) {
    if (o.opType === 'Programmee' || o.opType === 'Regularisation' || (o.type !== 'debit' && o.type !== 'credit') || isUnclassified(o) || isTransferOp(o)) continue;
    if (o.type !== type) { theirs.add(splitCategory(o.category).main); continue; }
    mine.add(splitCategory(o.category).main);
    counts.set(o.category, (counts.get(o.category) || 0) + 1);
  }
  const used = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c);
  // une catégorie qui ne sert qu'à l'autre sens (ex. « Salaires » pour une dépense) n'est pas proposée en base
  const listed = getCategoryCatalog().filter(c => c.listed && (mine.has(c.name) || !theirs.has(c.name)));
  const revenue = listed.filter(c => c.name === 'Revenus'), others = listed.filter(c => c.name !== 'Revenus');
  const base = [];
  for (const c of type === 'credit' ? [...revenue, ...others] : others) {
    base.push(c.name);
    for (const s of c.subs) base.push(`${c.name}/${s.name}`);
  }
  return [...used, ...base.filter(c => !counts.has(c))];
}

// Donne une catégorie à des opérations (par identifiant). Renvoie de quoi annuler : [{ id, category }] (anciennes valeurs).
function applyCategoryToOps(ids, category) {
  const set = new Set(ids);
  const undo = [];
  for (const o of appData.operations) {
    if (!set.has(o.id) || o.category === category) continue;
    undo.push({ id: o.id, category: o.category === undefined ? null : o.category });
    o.category = category;
  }
  return undo;
}

// Rétablit les anciennes catégories (résultat de applyCategoryToOps) ; renvoie le nombre d'opérations rétablies.
function restoreCategories(undo) {
  const byId = new Map(undo.map(u => [u.id, u.category]));
  let n = 0;
  for (const o of appData.operations) {
    if (!byId.has(o.id)) continue;
    const c = byId.get(o.id);
    if (c === null) delete o.category; else o.category = c;
    n++;
  }
  return n;
}

// Retire des opérations qu'on vient d'ajouter (bouton « Annuler »). Une trace de suppression est gardée : la synchronisation ne les rend pas.
function removeAddedOps(ids) {
  return dropOps(o => !ids.includes(o.id));
}

// Revenus, dépenses et virements réels d'une période (dates 'AAAA-MM-JJ' incluses) pour un compte ('' = tous).
// Comme les soldes : opérations saisies (un achat par carte à sa date de prélèvement) et échéances programmées ;
// les régularisations sont ignorées. Un virement entre comptes n'est ni un revenu ni
// une dépense : il est listé à part (transfers : { 'source → destination': montant }) — pour « tous les comptes »
// seule la jambe débit est comptée (une fois par virement), pour un compte ses deux jambes.
function calcFlowSummary(accountFilter, fromStr, toStr) {
  const r = { income: 0, expense: 0, net: 0, byCategory: {}, expenses: [], transfers: {} };
  const ops = [];
  for (let m = monthIndexOf(fromStr); m <= monthIndexOf(toStr); m++) ops.push(...getMonthOps(accountFilter, Math.floor(m / 12), m % 12));
  for (const op of ops) {
    const day = balanceDate(op);
    if (day < fromStr || day > toStr || op.opType === 'Regularisation') continue;
    if (isTransferOp(op) || op.virementDest) {
      const other = (/^\[(.+)\]$/.exec(op.label || '') || [])[1] || (op.type === 'debit' ? op.virementDest : null);
      if (other && (op.type === 'debit' || accountFilter)) {
        const key = op.type === 'credit' ? `${other} → ${op.account}` : `${op.account} → ${other}`;
        r.transfers[key] = (r.transfers[key] || 0) + op.amount;
      }
      continue;
    }
    if (op.type === 'credit') {
      r.income += op.amount;
    } else if (op.type === 'debit') {
      r.expense += op.amount;
      const cat = op.category && op.category.includes('/') ? op.category.split('/')[0] : (op.category || 'Autre');
      r.byCategory[cat] = (r.byCategory[cat] || 0) + op.amount;
      r.expenses.push(op);
    }
  }
  r.net = r.income - r.expense;
  return r;
}

// Dates d'un mois pour les analyses : le mois en cours s'arrête à aujourd'hui, comme le bilan imprimé
function statsRange(year, month) {
  const key = `${year}-${String(month + 1).padStart(2, '0')}`, now = today();
  return [`${key}-01`, now.slice(0, 7) === key ? now : `${key}-31`];
}

// Revenus / dépenses de chacun des `count` mois qui se terminent au mois (endYear, endMonth), du plus ancien au plus récent.
function calcMonthlyFlows(accountFilter, endYear, endMonth, count) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(endYear, endMonth - i, 1);
    const f = calcFlowSummary(accountFilter, ...statsRange(d.getFullYear(), d.getMonth()));
    out.push({ year: d.getFullYear(), month: d.getMonth(), income: f.income, expense: f.expense, net: f.net });
  }
  return out;
}

// Effet d'une opération sur un périmètre de comptes (ensemble de noms) : +montant (entrée), −montant (sortie),
// 0 pour un virement dont les deux comptes sont dans le périmètre (l'argent n'en sort pas).
function opFlowInScope(op, inScope) {
  const m = /^\[(.+)\]$/.exec(op.label || '');
  if (m && inScope.has(m[1]) && inScope.has(op.account)) return 0;
  return op.type === 'credit' ? op.amount : op.type === 'debit' ? -op.amount : 0;
}

// Entrées et sorties d'un périmètre (liste de noms de comptes) pendant la période d'un mois : opérations saisies + échéances
// non remplacées, virements entre comptes du périmètre neutres. Sert aux mois passés comme aux mois projetés.
function calcProjectedFlow(names, year, month, cutDay, scheduledList) {
  const inScope = new Set(names);
  let income = 0, expense = 0;
  for (const op of getProjectedOps(names, year, month, cutDay, scheduledList)) {
    const f = opFlowInScope(op, inScope);
    if (f > 0) income += f; else expense -= f;
  }
  return { income, expense };
}

// Moyenne mensuelle constatée (entrées, sorties) des `months` derniers mois complets : ce que les comptes ont enregistré
// (opérations saisies + échéances automatiques non remplacées), virements entre comptes du périmètre exclus.
function calcRecentAverageFlows(names, months) {
  const now = new Date();
  let income = 0, expense = 0;
  for (let i = 1; i <= months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const f = calcProjectedFlow(names, d.getFullYear(), d.getMonth(), 0);
    income += f.income;
    expense += f.expense;
  }
  return { income: Math.round(income / months), expense: Math.round(expense / months) };
}

const CAT_COLORS = {
  Alimentation:'#ef6c00', Transport:'#1565c0', Sante:'#c62828',
  Loisirs:'#6a1b9a', Logement:'#2e7d32', Telecom:'#00838f',
  Revenus:'#43a047', Autre:'#546e7a',
};

let statsMonth = new Date().getMonth();
let statsYear  = new Date().getFullYear();

// Variation en % entre deux montants (null si la valeur de comparaison est nulle).
function calcChangePct(cur, prev) {
  if (!prev) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 100);
}

// Moyenne mensuelle d'une série de mois { year, month, income, expense } sur les mois complets (strictement avant le
// mois en cours) qui contiennent au moins une opération ; taux d'épargne = (revenus − dépenses) / revenus.
function averageCompleteMonths(flows, nowYear, nowMonth) {
  const current = nowYear * 12 + nowMonth;
  const used = flows.filter(f => f.year * 12 + f.month < current && (f.income || f.expense));
  const k = used.length;
  if (!k) return { months: 0, income: 0, expense: 0, net: 0, rate: null };
  const income = Math.round(used.reduce((s, f) => s + f.income, 0) / k);
  const expense = Math.round(used.reduce((s, f) => s + f.expense, 0) / k);
  return { months: k, income, expense, net: income - expense, rate: income > 0 ? Math.round(((income - expense) / income) * 100) : null };
}

// Pastille « ▲ 12 % » : en rouge si la hausse est mauvaise (dépenses), en vert sinon.
function changeChip(cur, prev, upIsBad) {
  const p = calcChangePct(cur, prev);
  if (p === null || p === 0) return '';
  const up = p > 0;
  return `<span class="chg ${up === upIsBad ? 'bad' : 'good'}">${up ? '▲' : '▼'} ${Math.abs(p)} %</span>`;
}

function renderStats() {
  const y = statsYear, m = statsMonth;
  const label = new Date(y, m, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  document.getElementById('stats-month-label').textContent = label.charAt(0).toUpperCase() + label.slice(1);

  const accFilter = document.getElementById('stats-account').value;
  const range = (yy, mm) => { const k = `${yy}-${String(mm + 1).padStart(2, '0')}`; return [`${k}-01`, `${k}-31`]; };
  const cur = calcFlowSummary(accFilter, ...statsRange(y, m));
  // Mois précédent ; pour le mois en cours (incomplet), on le compare à la même période du mois précédent
  const pd = new Date(y, m - 1, 1);
  const now = new Date();
  const sameMonth = y === now.getFullYear() && m === now.getMonth();
  const [prevFrom, prevEnd] = range(pd.getFullYear(), pd.getMonth());
  const prevDays = new Date(pd.getFullYear(), pd.getMonth() + 1, 0).getDate();
  const prevTo = sameMonth ? prevEnd.slice(0, 8) + String(Math.min(now.getDate(), prevDays)).padStart(2, '0') : prevEnd;
  const prev = calcFlowSummary(accFilter, prevFrom, prevTo);
  const prevName = pd.toLocaleDateString('fr-FR', { month: 'long' }) + (sameMonth ? ` (1er au ${Math.min(now.getDate(), prevDays)})` : '');
  const { income, expense, net } = cur;

  document.getElementById('stat-income').textContent  = fmt(income);
  document.getElementById('stat-expense').textContent = fmt(expense);
  const netEl = document.getElementById('stat-net');
  netEl.textContent = (net >= 0 ? '+' : '') + fmt(net);
  netEl.style.color = net >= 0 ? 'var(--accent)' : 'var(--danger)';

  // Comparaison avec le mois précédent
  const parts = [];
  const ci = changeChip(income, prev.income, false), ce = changeChip(expense, prev.expense, true);
  if (ci) parts.push(`revenus ${ci}`);
  if (ce) parts.push(`dépenses ${ce}`);
  document.getElementById('stat-compare').innerHTML = parts.length
    ? `<span class="muted">par rapport à ${esc(prevName)} :</span> ${parts.join(' · ')}` : '';

  // Dépenses par catégorie (les 8 premières), avec la part du total et la variation par rapport au mois précédent
  const sorted = Object.entries(cur.byCategory).sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 8);
  const maxVal = top[0]?.[1] || 1;
  const budgets = appData.budgets || {};
  const catHtml = top.length ? top.map(([cat, val]) => {
    const budget = budgets[cat];
    const col = catColor(cat);
    let barHtml;
    if (budget) {
      const pct = Math.min(Math.round((val / budget) * 100), 100);
      const barCol = val > budget ? 'var(--danger)' : val > budget * 0.8 ? '#ef9f27' : col;
      barHtml = `<div style="background:var(--border);border-radius:4px;height:8px;overflow:hidden;position:relative">
        <div style="width:${pct}%;height:100%;background:${barCol};border-radius:4px;transition:width 0.4s"></div>
      </div>`;
    } else {
      const pct = Math.round((val / maxVal) * 100);
      barHtml = `<div style="background:var(--border);border-radius:4px;height:8px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${col};border-radius:4px;transition:width 0.4s"></div>
      </div>`;
    }
    const budgetLabel = budget ? ` / ${fmt(budget)}${val > budget ? ' ⚠️' : ''}` : '';
    const chip = changeChip(val, prev.byCategory[cat] || 0, true);
    return `<div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:0.8rem;margin-bottom:3px">
        <span>${esc(catIcon(cat))} ${esc(cat.trim())}</span>
        <span style="font-weight:600;${val > budget && budget ? 'color:var(--danger)' : ''}">${fmt(val)}${budgetLabel}</span>
      </div>
      ${barHtml}
      <div class="cat-meta">${expense ? Math.round((val / expense) * 100) : 0} % des dépenses${chip ? ' · ' + chip : ''}</div>
    </div>`;
  }).join('') : '<div style="color:var(--muted);font-size:0.85rem;text-align:center;padding:8px">Aucune dépense ce mois</div>';
  const more = sorted.length > top.length
    ? `<div class="cat-meta">… et ${sorted.length - top.length} autre${sorted.length - top.length > 1 ? 's' : ''} catégorie${sorted.length - top.length > 1 ? 's' : ''} : <span class="pv">${fmt(sorted.slice(top.length).reduce((s, [, v]) => s + v, 0))}</span></div>` : '';

  const unc = cur.expenses.filter(o => o.opType !== 'Programmee' && isUnclassified(o));   // les échéances ne se classent pas ici
  const uncHtml = unc.length
    ? `<div class="cat-todo"><span>${unc.length} dépense${unc.length > 1 ? 's' : ''} (<span class="pv">${fmt(unc.reduce((s, o) => s + o.amount, 0))}</span>) sans catégorie ce mois-ci</span><button type="button" class="link-btn" data-open-categorize>Les classer ›</button></div>` : '';
  document.getElementById('stat-categories').innerHTML =
    `<div style="font-size:0.75rem;color:var(--muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px">Dépenses par catégorie${infoBtn('categories')}</div>` + catHtml + more + uncHtml
    + '<div class="cat-manage"><button type="button" class="link-btn" data-open-catmanager>🏷️ Gérer les catégories</button></div>';

  // Blocs dépliables : plus grosses dépenses, virements entre comptes (hors revenus et dépenses)
  const open = key => { try { return localStorage.getItem(key) === '1' ? ' open' : ''; } catch { return ''; } };
  const biggest = cur.expenses.slice().sort((a, b) => b.amount - a.amount).slice(0, 5);
  const biggestHtml = biggest.length ? `<details class="kv-more" data-stat-fold="finances_stat_top"${open('finances_stat_top')}>
      <summary>Plus grosses dépenses (${biggest.length})</summary>
      <div class="tbl-wrap"><table class="op-table"><tbody>${biggest.map(o => `<tr>
        <td class="c-date">${o.date.slice(8, 10)}/${o.date.slice(5, 7)}</td>
        <td class="c-label">${esc(o.label)}${accFilter ? '' : `<small class="c-card">${esc(o.account)}</small>`}</td>
        <td class="c-amt debit">-${fmt(o.amount)}</td></tr>`).join('')}</tbody></table></div>
    </details>` : '';
  const transfers = Object.entries(cur.transfers).sort((a, b) => b[1] - a[1]);
  const transfersHtml = transfers.length ? `<details class="kv-more" data-stat-fold="finances_stat_transfers"${open('finances_stat_transfers')}>
      <summary>Virements entre comptes (${transfers.length})</summary>
      <p class="cat-meta" style="margin:0 0 6px">Ni revenus ni dépenses : ces mouvements ne sont pas comptés dans les montants ci-dessus.</p>
      <div class="tbl-wrap"><table class="op-table"><tbody>${transfers.map(([k, v]) => `<tr>
        <td class="c-label">${esc(k)}</td><td class="c-amt">${fmt(v)}</td></tr>`).join('')}</tbody></table></div>
    </details>` : '';
  document.getElementById('stat-extra').innerHTML = biggestHtml + transfersHtml;

  if (getActiveDashTab() === 'analyses') renderFlowChart();
}

// Revenus et dépenses des 12 mois qui se terminent au mois affiché (même compte que les statistiques)
function renderFlowChart() {
  const box = document.getElementById('flow-chart');
  if (!box) return;
  const accFilter = document.getElementById('stats-account').value;
  const flows = calcMonthlyFlows(accFilter, statsYear, statsMonth, 12);
  const n = flows.length;
  const fmtK = v => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(v);
  const W = Math.max(300, Math.round(box.clientWidth) || 340);
  const H = 200;
  const pad = { top: 14, right: 10, bottom: 44, left: 62 };
  const cw = W - pad.left - pad.right;
  const ch = H - pad.top - pad.bottom;
  const maxV = Math.max(1, ...flows.map(f => Math.max(f.income, f.expense)));
  const yScale = v => pad.top + ch - (v / maxV) * ch;
  const gap = cw / n;
  const bw = Math.max(4, Math.min(14, gap * 0.36));
  const baseY = yScale(0);

  const grid = [0, 0.5, 1].map(r => {
    const y = yScale(r * maxV);
    return `<line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" stroke="var(--border)" stroke-dasharray="3,3"/>
            <text x="${pad.left - 4}" y="${y + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${fmtK(r * maxV)}</text>`;
  }).join('');
  // le mois affiché (dernier) est mis en évidence
  const hl = `<rect x="${pad.left + (n - 1) * gap}" y="${pad.top}" width="${gap}" height="${ch}" fill="var(--primary)" opacity="0.08" rx="4"/>`;
  const bars = flows.map((f, i) => {
    const cx = pad.left + i * gap + gap / 2;
    const bar = (v, x, col) => v > 0 ? `<rect x="${x}" y="${yScale(v)}" width="${bw}" height="${baseY - yScale(v)}" fill="${col}" rx="2" opacity="0.9"/>` : '';
    return bar(f.income, cx - bw - 1, '#43a047') + bar(f.expense, cx + 1, '#e53935');
  }).join('');
  const labels = flows.map((f, i) => {
    const cx = pad.left + i * gap + gap / 2;
    const d = new Date(f.year, f.month, 1);
    const txt = d.toLocaleDateString('fr-FR', f.month === 0 || i === 0 ? { month: 'short', year: 'numeric' } : { month: 'short' });
    return `<text x="${cx}" y="${H - pad.bottom + 14}" text-anchor="end" font-size="10" fill="var(--muted)" transform="rotate(-45 ${cx} ${H - pad.bottom + 14})">${txt}</text>`;
  }).join('');
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;min-width:300px">
    ${grid}${hl}${bars}
    <line x1="${pad.left}" y1="${baseY}" x2="${W - pad.right}" y2="${baseY}" stroke="var(--text)" stroke-width="0.5" opacity="0.3"/>
    ${labels}
  </svg>`;

  const now = new Date();
  const avg = averageCompleteMonths(flows, now.getFullYear(), now.getMonth());
  document.getElementById('flow-avg').innerHTML = avg.months
    ? `<span class="muted">Moyenne sur ${avg.months} mois complet${avg.months > 1 ? 's' : ''} :</span>
       revenus <b class="pos">+${fmt(avg.income)}</b> · dépenses <b class="neg">-${fmt(avg.expense)}</b> ·
       solde <b class="${avg.net < 0 ? 'neg' : 'pos'}">${signedFmt(avg.net)}</b>${avg.rate !== null ? ` · épargne <b>${avg.rate} %</b> des revenus` : ''}`
    : '';
}

document.getElementById('stats-account').addEventListener('change', renderStats);
document.getElementById('wealth-account').addEventListener('change', renderWealthChart);
// Jour du mois où le solde est lu (graphique d'évolution) : « fin de mois » ou 1 à 30 ; le choix est mémorisé sur cet appareil
(function initWealthDay() {
  const sel = document.getElementById('wealth-day');
  if (!sel) return;
  sel.innerHTML = '<option value="">Solde en fin de mois</option>'
    + Array.from({ length: 30 }, (_, i) => `<option value="${i + 1}">Solde au ${i === 0 ? '1er' : i + 1}</option>`).join('');
  let saved = '';
  try { saved = localStorage.getItem('finances_wealth_day') || ''; } catch { /* ignoré */ }
  const day = normalizePointDay(saved);
  sel.value = day ? String(day) : '';
  sel.addEventListener('change', () => {
    try { localStorage.setItem('finances_wealth_day', sel.value); } catch { /* ignoré */ }
    renderWealthChart();
  });
})();
// Les blocs dépliables des statistiques se souviennent de leur état (la clé de stockage est portée par le bloc)
document.getElementById('stat-extra').addEventListener('toggle', (e) => {
  const key = e.target.dataset && e.target.dataset.statFold;
  if (key) { try { localStorage.setItem(key, e.target.open ? '1' : '0'); } catch { /* ignoré */ } }
}, true);
document.getElementById('btn-stats-prev').addEventListener('click', () => {
  statsMonth--; if (statsMonth < 0) { statsMonth = 11; statsYear--; }
  renderStats();
});
document.getElementById('btn-stats-next').addEventListener('click', () => {
  statsMonth++; if (statsMonth > 11) { statsMonth = 0; statsYear++; }
  renderStats();
});

// ── PROJECTION ───────────────────────────────────────────────────────────────
// scheduledList (facultatif) : la liste des opérations programmées déjà extraite, pour ne pas la recalculer à chaque appel
// quand on enchaîne beaucoup de mois et de comptes (projection).
function scheduledOpsInMonth(year, month, accountFilter, scheduledList) {
  // Chercher les ops programmées qui concernent ce compte
  // (soit comme compte source, soit comme destination d'un virement)
  const allScheduled = scheduledList || appData.operations.filter(op => op.opType === 'Programmee');
  const result = [];

  for (const op of allScheduled) {
    const base = op.nextPayment || op.date;
    if (!base) continue;
    const freq = op.detail || 'mensuelle';
    // dates 'AAAA-MM-JJ' lues par découpage : bien plus rapide qu'un « new Date » à chaque appel (la projection en enchaîne des milliers)
    const baseDay = +base.slice(8, 10);
    const diffMonths = (year - +base.slice(0, 4)) * 12 + (month - (+base.slice(5, 7) - 1));
    if (diffMonths < 0) continue;
    if (op.endDate && year * 12 + month > +op.endDate.slice(0, 4) * 12 + (+op.endDate.slice(5, 7) - 1)) continue;
    let applies = false;
    if (freq === 'ponctuelle') applies = diffMonths === 0;
    else if (freq === 'mensuelle') applies = diffMonths >= 0;
    else if (freq === 'bimensuelle') applies = diffMonths >= 0 && diffMonths % 2 === 0;
    else if (freq === 'trimestrielle') applies = diffMonths >= 0 && diffMonths % 3 === 0;
    else if (freq === 'annuelle') applies = diffMonths >= 0 && diffMonths % 12 === 0;
    if (!applies) continue;

    // Vérifier les exceptions (mois où l'occurrence a été modifiée individuellement)
    const exMonth = `${year}-${String(month+1).padStart(2,'0')}`;
    if (op.exceptions && op.exceptions.includes(exMonth)) continue;

    const lastDayOfTarget = new Date(year, month + 1, 0).getDate();
    const adjustedDay = Math.min(baseDay, lastDayOfTarget);
    const adjustedDate = `${year}-${String(month+1).padStart(2,'0')}-${String(adjustedDay).padStart(2,'0')}`;

    // Détecter si c'est un virement
    const destMatch = op.label && op.label.match(/^\[(.+)\]$/);
    const dest = op.virementDest || (destMatch ? destMatch[1] : null);
    const isVirement = !!dest;

    if (isVirement) {
      // Côté débit (source)
      if (!accountFilter || op.account === accountFilter) {
        result.push({ ...op, date: adjustedDate, nextPayment: adjustedDate });
      }
      // Côté crédit (destination)
      if (!accountFilter || dest === accountFilter) {
        result.push({
          ...op,
          id: op.id + '_credit',
          date: adjustedDate,
          nextPayment: adjustedDate,
          label: `[${op.account}]`,
          type: 'credit',
          account: dest,
        });
      }
    } else {
      // Opération simple
      if (!accountFilter || op.account === accountFilter) {
        result.push({ ...op, date: adjustedDate, nextPayment: adjustedDate });
      }
    }
  }
  return result;
}

// Calcul du solde entre deux dates de cycle
// cutDay = 0 ou vide → fin de mois classique
// cutDay = 25 → le solde au 25 du mois = toutes ops du 25 du mois précédent+1 au 25 de ce mois
// Premier mois (année*12+mois) où une opération programmée du compte peut s'appliquer.
// Sert de borne basse pour compter les échéances programmées, même sur des mois déjà passés.
function getEarliestScheduledMonth(accountFilter) {
  let min = null;
  for (const op of appData.operations) {
    if (op.opType !== 'Programmee') continue;
    // Un virement programmé concerne aussi son compte DESTINATION (côté crédit)
    if (accountFilter && op.account !== accountFilter) {
      const destMatch = op.label && op.label.match(/^\[(.+)\]$/);
      const dest = op.virementDest || (destMatch ? destMatch[1] : null);
      if (dest !== accountFilter) continue;
    }
    const base = op.nextPayment || op.date;
    if (!base) continue;
    const d = new Date(base + 'T00:00:00');
    const m = d.getFullYear() * 12 + d.getMonth();
    if (min === null || m < min) min = m;
  }
  return min;
}

function calcBalanceAtDate(accountFilter, year, month, cutDay, scheduledList) {
  // Date de fin du cycle pour ce mois
  let cutDate;
  if (cutDay && cutDay > 0 && cutDay < 31) {
    cutDate = `${year}-${String(month+1).padStart(2,'0')}-${String(cutDay).padStart(2,'0')}`;
  } else {
    const lastDay = new Date(year, month + 1, 0).getDate();
    cutDate = `${year}-${String(month+1).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
  }

  const now = new Date();
  const currentMonth = now.getFullYear() * 12 + now.getMonth();
  const targetMonth = year * 12 + month;

  if (accountFilter) {
    const acc = appData.accounts.find(a => a.name === accountFilter);
    const initial = acc ? (acc.initialBalance || 0) : 0;
    const realOps = appData.operations.filter(op =>
      op.account === accountFilter && op.opType !== 'Programmee' && balanceDate(op) <= cutDate);
    let bal = initial + realOps.reduce((s, op) =>
      op.type === 'credit' ? s + op.amount : s - op.amount, 0);
    const earliestSched = getEarliestScheduledMonth(accountFilter);
    const loopStart = earliestSched !== null ? Math.min(earliestSched, currentMonth) : currentMonth;
    for (let m = loopStart; m <= targetMonth; m++) {
      const y2 = Math.floor(m/12), m2 = m%12;
      const schOps = scheduledOpsInMonth(y2, m2, accountFilter, scheduledList);
      let mCut;
      if (cutDay && cutDay > 0 && cutDay < 31) {
        mCut = `${y2}-${String(m2+1).padStart(2,'0')}-${String(cutDay).padStart(2,'0')}`;
      } else {
        const ld = new Date(y2, m2 + 1, 0).getDate();
        mCut = `${y2}-${String(m2+1).padStart(2,'0')}-${String(ld).padStart(2,'0')}`;
      }
      // Pour le mois cible, ne compter que les ops dont la date <= cutDate
      const filtered = (m === targetMonth && cutDay) ? schOps.filter(op => {
        const opDay = parseInt((op.nextPayment || op.date).split('-')[2]);
        return opDay <= cutDay;
      }) : schOps;
      bal += filtered.reduce((s, op) => op.type === 'credit' ? s + op.amount : s - op.amount, 0);
    }
    return bal;
  } else {
    return appData.accounts
      .filter(a => a.includeInTotal !== false)
      .reduce((total, a) => {
        return total + calcBalanceAtDate(a.name, year, month, cutDay, scheduledList);
      }, 0);
  }
}

// Soldes d'UN compte à la fin de chacun des mois demandés (`months` : { year, month } consécutifs, ordre croissant),
// ou au jour de relevé cutDay : mêmes valeurs que calcBalanceAtDate mois par mois, mais les échéances programmées ne sont
// parcourues qu'une seule fois (une projection à 5 ans enchaîne des centaines de soldes).
function calcBalanceSeries(accountName, months, cutDay, scheduledList) {
  const acc = appData.accounts.find(a => a.name === accountName);
  const initial = acc ? (acc.initialBalance || 0) : 0;
  const now = new Date();
  const currentMonth = now.getFullYear() * 12 + now.getMonth();
  const earliest = getEarliestScheduledMonth(accountName);
  const loopStart = earliest !== null ? Math.min(earliest, currentMonth) : currentMonth;
  const signed = op => (op.type === 'credit' ? op.amount : -op.amount);
  const pad = n => String(n).padStart(2, '0');
  const real = appData.operations.filter(op => op.account === accountName && op.opType !== 'Programmee');
  const out = [];
  let prefix = 0;                 // échéances complètes des mois [loopStart, mois en cours de traitement[
  let m = loopStart;
  for (const p of months) {
    const target = p.year * 12 + p.month;
    for (; m < target; m++) {
      prefix += scheduledOpsInMonth(Math.floor(m / 12), m % 12, accountName, scheduledList).reduce((s, op) => s + signed(op), 0);
    }
    const cutDate = cutDay > 0 && cutDay < 31
      ? `${p.year}-${pad(p.month + 1)}-${pad(cutDay)}`
      : `${p.year}-${pad(p.month + 1)}-${pad(new Date(p.year, p.month + 1, 0).getDate())}`;
    let bal = initial + real.filter(op => balanceDate(op) <= cutDate).reduce((s, op) => s + signed(op), 0);
    if (target >= loopStart) {
      let cur = scheduledOpsInMonth(p.year, p.month, accountName, scheduledList);
      if (cutDay) cur = cur.filter(op => parseInt((op.nextPayment || op.date).split('-')[2]) <= cutDay);
      bal += prefix + cur.reduce((s, op) => s + signed(op), 0);
    }
    out.push(bal);
  }
  return out;
}

function calcBalanceEndOfMonth(accountFilter, year, month) {
  return calcBalanceAtDate(accountFilter, year, month, 0);
}

// Opérations d'un mois donné (réelles + programmées si futur)
function getMonthOps(accountFilter, year, month, scheduledList) {
  const mStart = `${year}-${String(month+1).padStart(2,'0')}-01`;
  const mEnd = `${year}-${String(month+1).padStart(2,'0')}-31`;

  const realOps = appData.operations.filter(op =>
    (!accountFilter || op.account === accountFilter) &&
    op.opType !== 'Programmee' &&
    balanceDate(op) >= mStart && balanceDate(op) <= mEnd
  );

  const scheduled = scheduledOpsInMonth(year, month, accountFilter, scheduledList);
  // le mois dépend du jour de prélèvement, mais l’affichage suit la date de l’opération (celle qu’on lit)
  if (!scheduled.length) return realOps.sort((a, b) => a.date.localeCompare(b.date));

  // Les échéances programmées comptent dans le solde quel que soit le mois
  // (passé, courant ou futur), tant qu'elles n'ont pas été explicitement
  // exclues (voir "exceptions" dans scheduledOpsInMonth).
  return [
    ...realOps,
    ...scheduled.map(op => ({ ...op, opType: 'Programmee' })),
  ].sort((a, b) => (a.nextPayment || a.date).localeCompare(b.nextPayment || b.date));
}

// Opérations projetées (échéances programmées + opérations réelles datées dans le futur) d'un périmètre (liste de noms
// de comptes) pour la période d'un mois : le mois civil, ou — avec un jour de relevé (cutDay) — du lendemain de ce jour
// le mois précédent à ce jour. Triées par date.
function getProjectedOps(names, year, month, cutDay, scheduledList) {
  const pad = n => String(n).padStart(2, '0');
  const cut = cutDay > 0 && cutDay < 31 ? cutDay : 0;
  const prev = new Date(year, month - 1, 1);
  const endStr = `${year}-${pad(month + 1)}-${pad(cut || new Date(year, month + 1, 0).getDate())}`;
  const startStr = `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-${pad(cut || 31)}`;   // exclu
  const scan = cut ? [prev, new Date(year, month, 1)] : [new Date(year, month, 1)];
  const ops = [];
  for (const n of names) {
    for (const d of scan) {
      for (const op of getMonthOps(n, d.getFullYear(), d.getMonth(), scheduledList)) {
        const day = op.nextPayment || balanceDate(op);
        if (day && day > startStr && day <= endStr) ops.push(op);
      }
    }
  }
  return ops.sort((a, b) => (a.nextPayment || balanceDate(a)).localeCompare(b.nextPayment || balanceDate(b)));
}

// Projection mois par mois d'un périmètre ('' = tous les comptes, '__total' = comptes du solde total, ou un compte) :
// months[0] = mois en cours (point de départ) puis `horizonMonths` mois à venir ; soldes par compte (perAccount) et
// total ; entrées / sorties de chaque mois (flows, null au départ) ; détail des opérations avec le solde du périmètre
// après chacune (opLines). cutDay = jour de relevé du solde (0 = fin de mois).
function calcProjectionSeries(scope, horizonMonths, cutDay) {
  const names = getScopeNames(scope);
  const inScope = new Set(names);
  const now = new Date();
  const months = [];
  for (let i = 0; i <= horizonMonths; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth() });
  }
  const sched = appData.operations.filter(op => op.opType === 'Programmee');   // extraite une seule fois pour tous les mois et comptes
  const perAccount = {};
  for (const n of names) perAccount[n] = calcBalanceSeries(n, months, cutDay, sched);
  const totals = months.map((p, i) => names.reduce((s, n) => s + perAccount[n][i], 0));
  const flows = [null];
  const opLines = [];
  let balance = totals[0];
  for (let i = 1; i < months.length; i++) {
    const p = months[i];
    let income = 0, expense = 0;
    for (const op of getProjectedOps(names, p.year, p.month, cutDay, sched)) {
      const f = opFlowInScope(op, inScope);
      if (f > 0) income += f; else expense -= f;
      if (f === 0 && op.type === 'credit') continue;        // virement interne au périmètre : on ne garde que la jambe débit
      balance += f;
      opLines.push({ op, balance, month: new Date(p.year, p.month, 1) });
    }
    flows.push({ income, expense });
  }
  return { names, months, perAccount, totals, flows, opLines };
}

// Synthèse d'une projection : départ, arrivée, variation, point le plus bas, premier solde négatif, flux moyens par mois.
function summarizeProjection(series) {
  const t = series.totals;
  const last = t.length - 1;
  let low = 0;
  for (let i = 1; i <= last; i++) if (t[i] < t[low]) low = i;
  const firstNegativeIndex = t.findIndex(v => v < 0);
  const fl = series.flows.filter(Boolean);
  const n = fl.length || 1;
  return {
    start: t[0], end: t[last], delta: t[last] - t[0],
    lowIndex: low, lowValue: t[low], firstNegativeIndex,
    avgIncome: Math.round(fl.reduce((s, f) => s + f.income, 0) / n),
    avgExpense: Math.round(fl.reduce((s, f) => s + f.expense, 0) / n),
  };
}

// Projection : synthèse, graphique, tableau par compte, entrées / sorties par mois et détail des opérations.
// « Tous les comptes » = tous les comptes ; « Comptes du solde total » = ceux comptés dans le solde de l'accueil.
function renderProjection() {
  const scope = projScope();
  if (Array.isArray(scope) && !scope.length) {
    hideChartTip();
    document.getElementById('proj-summary').innerHTML = '<div class="proj-alert warn">Cochez au moins un compte pour voir la projection.</div>';
    document.getElementById('proj-chart').innerHTML = '';
    document.getElementById('proj-table').innerHTML = '';
    return;
  }
  const horizon = parseInt(document.getElementById('proj-horizon').value, 10) || 12;
  const cutDay = parseInt(document.getElementById('proj-cutday').value, 10) || 0;
  const useCut = cutDay > 0 && cutDay < 31;
  const series = calcProjectionSeries(scope, horizon, cutDay);
  const sum = summarizeProjection(series);

  const num = v => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(v);
  const sign = v => (v < 0 ? 'neg' : v > 0 ? 'pos' : '');
  const lowCls = v => (v < 0 ? 'neg' : '');
  const monthYear = i => new Date(series.months[i].year, series.months[i].month, 1)
    .toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
  // libellés des points du graphique : « actuel », puis « déc. 2026 » (ou « 25 déc. 2026 » avec un jour de relevé)
  const labels = series.months.map((p, i) => {
    if (i === 0) return 'actuel';
    return useCut ? `${cutDay} ${monthYear(i)}` : monthYear(i);
  });

  // ── Synthèse ──
  const horizonText = horizon % 12 === 0 ? (horizon === 12 ? '1 an' : `${horizon / 12} ans`) : `${horizon} mois`;
  const kpi = (title, value, sub, c) => `<div class="kpi"><span>${title}</span><b class="${c}">${value}</b><small>${sub}</small></div>`;
  const alertHtml = sum.firstNegativeIndex === -1
    ? '<div class="proj-alert ok">✅ Solde jamais négatif sur la période</div>'
    : `<div class="proj-alert warn">⚠️ Solde négatif ${sum.firstNegativeIndex === 0 ? 'dès maintenant' : 'dès ' + monthYear(sum.firstNegativeIndex)}</div>`;
  const real = calcRecentAverageFlows(series.names, 6);                     // moyenne constatée sur les 6 derniers mois complets
  const plus = v => (v >= 0 ? '+' : '-') + fmt(Math.abs(v));
  const minus = v => (v >= 0 ? '-' : '+') + fmt(Math.abs(v));
  const avgRow = (title, sub, inc, exp, info) =>
    `<div class="proj-avg-row"><span><span class="t">${title}${info}</span><small>${sub}</small></span><b class="pos">${plus(inc)}</b><b class="neg">${minus(exp)}</b></div>`;
  document.getElementById('proj-summary').innerHTML = `
    <div class="kpi-grid">
      ${kpi('Solde actuel', fmt(sum.start), useCut ? `au ${cutDay} du mois` : 'fin de ce mois', lowCls(sum.start))}
      ${kpi('Dans ' + horizonText, fmt(sum.end), monthYear(series.months.length - 1), lowCls(sum.end))}
      ${kpi('Variation', signedFmt(sum.delta), `<span class="pv">${signedFmt(Math.round(sum.delta / horizon))}</span> / mois`, sign(sum.delta))}
      ${kpi('Point le plus bas', fmt(sum.lowValue), sum.lowIndex === 0 ? 'dès maintenant' : monthYear(sum.lowIndex), lowCls(sum.lowValue))}
    </div>
    ${alertHtml}
    <div class="proj-avg">
      ${avgRow('Prévu par mois', 'opérations programmées', sum.avgIncome, sum.avgExpense, infoBtn('prevu-reel'))}
      ${avgRow('Constaté par mois', 'moyenne des 6 derniers mois', real.income, real.expense, '')}
    </div>`;

  // ── Graphique : barres + courbe du solde total ──
  const fmtK = v => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(v);
  const endBalances = series.totals.map((v, i) => ({ label: labels[i], balance: v }));
  const n = endBalances.length;
  const W = Math.max(400, n * 55);
  const H = 240;
  const pad = { top: 30, right: 15, bottom: 60, left: 70 };
  const cw = W - pad.left - pad.right;
  const ch = H - pad.top - pad.bottom;

  const allBals = endBalances.map(e => e.balance);
  const minB = Math.min(0, ...allBals);
  const maxB = Math.max(0, ...allBals);
  const range = maxB - minB || 1;

  const yScale = (v) => pad.top + ch - ((v - minB) / range) * ch;
  const barW = Math.max(12, Math.min(35, (cw / n) * 0.6));
  const gap = cw / n;

  const zeroY = yScale(0);

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(r => {
    const v = minB + r * range;
    const y = yScale(v);
    return `<line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" stroke="var(--border)" stroke-dasharray="3,3"/>
            <text x="${pad.left - 4}" y="${y + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${fmtK(v)}</text>`;
  }).join('');

  const bars = endBalances.map((e, i) => {
    const x = pad.left + i * gap + (gap - barW) / 2;
    const y = yScale(e.balance);
    const h = Math.abs(y - zeroY);
    const top = e.balance >= 0 ? y : zeroY;
    const col = e.balance >= 0 ? '#43a047' : '#e53935';
    const valY = e.balance >= 0 ? top - 6 : top + h + 12;
    return `<rect x="${x}" y="${top}" width="${barW}" height="${h}" fill="${col}" rx="3" opacity="0.8"/>
            <text x="${x + barW/2}" y="${valY}" text-anchor="middle" font-size="9" font-weight="600" fill="${col}">${fmtK(e.balance)}</text>`;
  }).join('');

  const polyPts = endBalances.map((e, i) => {
    const x = pad.left + i * gap + gap / 2;
    const y = yScale(e.balance);
    return `${x},${y}`;
  }).join(' ');

  const dots = endBalances.map((e, i) => {
    const x = pad.left + i * gap + gap / 2;
    const y = yScale(e.balance);
    return `<circle cx="${x}" cy="${y}" r="3.5" fill="var(--primary)" stroke="white" stroke-width="1.5"/>`;
  }).join('');

  const skip = n > 12 ? Math.ceil(n / 12) : 1;
  const xLabels = endBalances.map((e, i) => {
    if (i % skip !== 0 && i !== 0) return '';
    const x = pad.left + i * gap + gap / 2;
    return `<text x="${x}" y="${H - pad.bottom + 12}" text-anchor="end" font-size="10" fill="var(--muted)" transform="rotate(-45 ${x} ${H - pad.bottom + 12})">${e.label}</text>`;
  }).join('');

  // échelle 1:1 (le conteneur défile horizontalement) : le texte reste lisible au lieu d'être réduit de moitié
  hideChartTip();
  document.getElementById('proj-chart').innerHTML = `<svg class="chart-hover" tabindex="0" role="group" aria-label="Projection du solde. Survolez ou touchez un mois pour voir son solde ; flèches gauche et droite au clavier." viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:${W}px;min-width:100%;max-width:none">
    ${gridLines}
    <line x1="${pad.left}" y1="${zeroY}" x2="${W - pad.right}" y2="${zeroY}" stroke="var(--text)" stroke-width="0.5" opacity="0.3"/>
    ${bars}
    <line class="ct-guide" y1="${pad.top}" y2="${H - pad.bottom}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3,3" visibility="hidden" pointer-events="none"/>
    <polyline points="${polyPts}" fill="none" stroke="var(--primary)" stroke-width="2" opacity="0.6"/>
    ${dots}
    <circle class="ct-dot" r="6" fill="var(--primary)" stroke="white" stroke-width="2" visibility="hidden" pointer-events="none"/>
    ${xLabels}
  </svg>`;
  const longMonth = i => new Date(series.months[i].year, series.months[i].month, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  enableChartTooltip(document.querySelector('#proj-chart svg'), {
    items: endBalances.map((e, i) => ({
      x: pad.left + i * gap + gap / 2, y: yScale(e.balance), value: e.balance,
      title: i === 0 ? (useCut ? `Actuel · au ${cutDay} du mois` : 'Actuel · fin de ce mois') : (useCut ? `Au ${labels[i]}` : `Fin ${longMonth(i)}`),
    })),
    first: pad.left + gap / 2, step: gap, left: pad.left, right: W - pad.right,
  });

  // ── Tableau par compte (plusieurs comptes) : chaque compte du périmètre, même hors solde total ──
  const cell = v => `<td class="${sign(v)}">${num(v)}</td>`;
  let accountTable = '';
  if (series.names.length > 1) {
    const head = labels.map((l, i) => `<th>${i === 0 ? 'Actuel' : l}</th>`).join('');
    const rows = series.names.map(name => {
      const hors = scope !== '__total' && !isAccountIncluded(name)
        ? '<small class="hint" title="Ce compte n\'est pas compté dans le solde total">hors total</small>' : '';
      return `<tr><th scope="row">${esc(name)}${hors}</th>${series.perAccount[name].map(cell).join('')}</tr>`;
    }).join('');
    let totalRows = `<tr class="tot"><th scope="row">Total</th>${series.totals.map(cell).join('')}</tr>`;
    const incl = series.names.filter(isAccountIncluded);
    if (scope !== '__total' && incl.length && incl.length < series.names.length) {
      const sub = series.totals.map((_, i) => incl.reduce((s, name) => s + series.perAccount[name][i], 0));
      totalRows += `<tr class="sub"><th scope="row">dont solde total</th>${sub.map(cell).join('')}</tr>`;
    }
    accountTable = `<div class="tbl-wrap"><table class="proj-tbl">
      <thead><tr><th>Compte</th>${head}</tr></thead>
      <tbody>${rows}${totalRows}</tbody>
    </table></div>`;
  }

  // ── Entrées et sorties de chaque mois (virements entre comptes du périmètre exclus) ──
  const state = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const flowOpen = state('finances_proj_flows') !== '0';
  const flowRows = series.months.slice(1).map((p, k) => {
    const i = k + 1, f = series.flows[i], net = f.income - f.expense;
    return `<tr><th scope="row">${monthYear(i)}</th>
      <td class="pos">${f.income ? '+' + num(f.income) : '–'}</td>
      <td class="neg">${f.expense ? '-' + num(f.expense) : '–'}</td>
      <td class="bal ${sign(series.totals[i])}">${num(series.totals[i])}<small class="${sign(net)}">${net > 0 ? '+' : ''}${num(net)}</small></td>
    </tr>`;
  }).join('');
  const flowTable = `<details class="kv-more" data-proj-flows${flowOpen ? ' open' : ''}>
    <summary>Entrées et sorties par mois</summary>
    <div class="tbl-wrap"><table class="flow-tbl">
      <thead><tr><th>Mois</th><th>Entrées</th><th>Sorties</th><th>Solde${useCut ? ` au ${cutDay}` : ''}</th></tr></thead>
      <tbody>${flowRows}</tbody>
    </table></div>
  </details>`;

  // ── Détail des opérations projetées (une ligne par opération avec le solde du périmètre après chacune) ──
  const inScope = new Set(series.names);
  let prevMonth = '';
  const opRows = series.opLines.map(({ op, balance: bal, month }) => {
    const monthLabel = month.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    const monthSep = monthLabel !== prevMonth
      ? `<tr><td colspan="3" style="padding:8px 8px 4px;font-size:0.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;background:var(--bg)">${monthLabel}</td></tr>`
      : '';
    prevMonth = monthLabel;
    const bracket = /^\[(.+)\]$/.exec(op.label || '');
    const title = bracket ? (op.type === 'credit' ? `Virement de ${bracket[1]}` : `Virement vers ${bracket[1]}`) : op.label;
    const internal = opFlowInScope(op, inScope) === 0;
    const amount = internal
      ? `<span style="color:var(--muted)" title="Virement entre deux comptes de ce périmètre : sans effet sur le total">↔ ${num(op.amount)} F</span>`
      : `<span style="color:${op.type === 'credit' ? 'var(--accent)' : 'var(--danger)'}">${op.type === 'credit' ? '+' : '-'}${num(op.amount)} F</span>`;
    return `${monthSep}<tr style="border-top:1px solid var(--border)">
      <td style="padding:5px 8px;font-size:0.83rem">${esc(title)}<br><span style="font-size:0.72rem;color:var(--muted)">${esc(op.account)}</span></td>
      <td class="pv" style="padding:5px 8px;text-align:right;font-size:0.85rem;white-space:nowrap">${amount}</td>
      <td class="pv" style="padding:5px 8px;text-align:right;font-size:0.85rem;font-weight:700;color:${bal >= 0 ? 'var(--accent)' : 'var(--danger)'};white-space:nowrap">${num(bal)} F</td>
    </tr>`;
  }).join('');
  const startRow = `<tr style="background:var(--bg)">
    <td colspan="2" style="padding:8px;font-size:0.8rem;font-weight:700;color:var(--muted)">📍 Solde actuel</td>
    <td class="pv" style="padding:8px;text-align:right;font-weight:700;font-size:0.9rem;color:${sum.start >= 0 ? 'var(--accent)' : 'var(--danger)'}">${num(sum.start)} F</td>
  </tr>`;

  // La liste détaillée (une ligne par opération projetée, parfois plusieurs centaines) est repliée par défaut :
  // le graphique et le récapitulatif par compte tiennent à l'écran. Le choix ouvert / replié est mémorisé.
  const projOpen = state('finances_proj_detail') === '1';
  document.getElementById('proj-table').innerHTML = `
    ${accountTable}
    ${flowTable}
    ${series.opLines.length ? `<details class="kv-more" data-proj-detail${projOpen ? ' open' : ''}>
      <summary>Détail des opérations projetées (${series.opLines.length})</summary>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="border-bottom:2px solid var(--border)">
          <th style="padding:6px 8px;text-align:left;font-size:0.75rem;color:var(--muted)">Opération</th>
          <th style="padding:6px 8px;text-align:right;font-size:0.75rem;color:var(--muted)">Montant</th>
          <th style="padding:6px 8px;text-align:right;font-size:0.75rem;color:var(--muted)">Solde après</th>
        </tr></thead>
        <tbody>${startRow}${opRows}</tbody>
      </table>
    </details>` : '<div style="color:var(--muted);font-size:0.85rem;text-align:center;padding:16px">Aucune opération programmée sur cette période</div>'}
    <p class="proj-note">Projection fondée uniquement sur les opérations programmées et les opérations déjà saisies à une date future : les dépenses non programmées (achats par carte, courses…) ne sont pas comptées. Comparez avec la ligne « Constaté par mois ».</p>`;
}
// (l'évènement « toggle » ne remonte pas : écoute en phase de capture, sur le conteneur qui est recréé à chaque calcul)
document.getElementById('proj-table').addEventListener('toggle', (e) => {
  if (!e.target.matches) return;
  const key = e.target.matches('details[data-proj-detail]') ? 'finances_proj_detail'
    : e.target.matches('details[data-proj-flows]') ? 'finances_proj_flows' : null;
  if (key) { try { localStorage.setItem(key, e.target.open ? '1' : '0'); } catch { /* ignoré */ } }
}, true);

window.toggleProjDetail = function(id) {
  const row = document.getElementById(id);
  if (!row) return;
  const visible = row.style.display !== 'none';
  row.style.display = visible ? 'none' : 'table-row';
  // rotate arrow
  const prev = row.previousElementSibling;
  if (prev) {
    const cell = prev.firstElementChild;
    if (cell) cell.textContent = cell.textContent.replace(visible ? '▼' : '▶', visible ? '▶' : '▼');
  }
};

// choix des comptes de la projection, retenu sur cet appareil
let _projSaved;
function projSaved() {
  if (_projSaved === undefined) {
    try { _projSaved = JSON.parse(localStorage.getItem('finances_proj_accounts')); } catch { _projSaved = null; }
  }
  return _projSaved;
}
function projScope() {
  return scopeFromChecked(checkedAccounts(projSaved(), getAccountNames()));
}
function renderProjAccounts() {
  document.getElementById('proj-accounts').innerHTML = accountChecksHtml(checkedAccounts(projSaved(), getAccountNames()));
}
function saveProjAccounts(selected) {
  _projSaved = selected.length === getAccountNames().length ? null : selected;
  try { localStorage.setItem('finances_proj_accounts', JSON.stringify(_projSaved)); } catch { /* ignoré */ }
  renderProjection();
}
document.getElementById('proj-accounts').addEventListener('change', (e) => saveProjAccounts(readChecks(e.currentTarget)));
document.getElementById('proj-accounts').addEventListener('click', (e) => {
  const pick = e.target.closest && e.target.closest('[data-pick]');
  if (!pick) return;
  saveProjAccounts(pickedAccounts(pick.dataset.pick));
  renderProjAccounts();
});
document.getElementById('proj-horizon').addEventListener('change', renderProjection);
document.getElementById('proj-cutday').addEventListener('input', renderProjection);

// ── OPÉRATIONS PROGRAMMÉES ───────────────────────────────────────────────────
const FREQ_LABELS = {
  mensuelle: 'Mensuelle', bimensuelle: 'Bimensuelle',
  trimestrielle: 'Trimestrielle', annuelle: 'Annuelle', ponctuelle: 'Ponctuelle'
};

// ── ÉCHÉANCES PROGRAMMÉES : calculs ──────────────────────────────────────────
// Une échéance est comptée automatiquement à chaque période depuis sa date de départ ; les mois listés dans « exceptions » sont
// remplacés par une opération réelle. Passer, modifier ou supprimer ne doit jamais changer ce qui est déjà compté dans le passé,
// sauf demande explicite.

// Rang d'un mois (année × 12 + mois) d'une date 'AAAA-MM-JJ'
function monthIndexOf(dateStr) {
  return +dateStr.slice(0, 4) * 12 + (+dateStr.slice(5, 7) - 1);
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return localDateStr(d);
}
// Compte destinataire d'une échéance de virement, sinon null
function scheduledDest(op) {
  return op.virementDest || (/^\[(.+)\]$/.exec(op.label || '') || [])[1] || null;
}
// Dates d'un modèle depuis son départ jusqu'au mois de rang `toIdx` : sans les mois remplacés, ou avec (withReplaced)
function scheduledDates(template, toIdx, withReplaced) {
  const base = template.nextPayment || template.date;
  if (!base) return [];
  const list = [withReplaced ? { ...template, exceptions: [] } : template];
  const out = [];
  for (let idx = monthIndexOf(base); idx <= toIdx; idx++) {
    const occ = scheduledOpsInMonth(Math.floor(idx / 12), idx % 12, '', list).find(o => o.id === template.id);
    if (occ) out.push(occ.date);
  }
  return out;
}
// Prochaine échéance à partir d'aujourd'hui (comprise), ou null quand l'échéance est terminée
function nextScheduledDate(template, todayStr) {
  return scheduledDates(template, monthIndexOf(todayStr) + 120).find(d => d >= todayStr) || null;
}
// Échéances déjà comptées dans les soldes (jusqu'à aujourd'hui compris)
function countedOccurrences(template, todayStr) {
  return scheduledDates(template, monthIndexOf(todayStr)).filter(d => d <= todayStr);
}

// Échéance qu'un paiement daté `dateStr` vient régler : la dernière prévue au plus tard 7 jours après cette date ; si elle est
// déjà remplacée, la suivante encore ouverte. choices : les échéances ouvertes autour (3 avant, 3 après).
function occurrenceChoices(template, dateStr) {
  const to = monthIndexOf(dateStr) + 48;
  const open = scheduledDates(template, to);
  if (!open.length) return { guess: null, choices: [] };
  const limit = addDays(dateStr, 7);
  const natural = scheduledDates(template, to, true).filter(d => d <= limit).pop() || open[0];
  let i = open.indexOf(natural);
  if (i < 0) i = open.findIndex(d => d > natural);
  if (i < 0) i = open.length - 1;
  return { guess: open[i], choices: open.slice(Math.max(0, i - 3), i + 4) };
}

// Opération réelle qui ressemble déjà au paiement d'une échéance pendant le mois `monthKey` ('AAAA-MM') : même compte, même sens,
// libellé concordant (ou virement vers le même compte), montant à 25 % près ; la plus proche en montant, sinon null
function findRecordedPayment(template, monthKey) {
  const dest = scheduledDest(template);
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const name = norm(template.label);
  const same = label => {
    const l = norm(label);
    if (!l || !name) return false;
    const [short, long] = l.length < name.length ? [l, name] : [name, l];
    return l === name || (short.length >= 3 && ` ${long} `.includes(` ${short} `));
  };
  return appData.operations
    .filter(o => o.opType !== 'Programmee' && o.account === template.account && o.date && o.date.startsWith(monthKey)
      && o.type === (dest ? 'debit' : template.type) && Math.abs(o.amount - template.amount) <= template.amount * 0.25
      && (dest ? o.label === `[${dest}]` : same(o.label)))
    .sort((a, b) => Math.abs(a.amount - template.amount) - Math.abs(b.amount - template.amount))[0] || null;
}

// « Passer » : enregistre le paiement réel (rien s'il est déjà saisi) et remplace UNIQUEMENT l'échéance du mois choisi ; le départ
// et les autres mois ne bougent pas. Renvoie de quoi annuler (undoPass).
function passScheduled(id, { monthKey, date, amount, type, alreadyRecorded, comment }) {
  const t = appData.operations.find(o => o.id === id && o.opType === 'Programmee');
  if (!t || !monthKey) return null;
  const note = comment === undefined ? t.comment : cleanComment(comment);   // celui de l'échéance par défaut
  const undo = { id, exceptions: t.exceptions ? [...t.exceptions] : null, added: [], removed: null };
  if (!alreadyRecorded) {
    const dest = scheduledDest(t);
    const ops = dest
      ? [{ id: uid(), date, label: `[${dest}]`, amount, type: 'debit', account: t.account, category: 'Virement', opType: 'Virement', comment: note },
         { id: uid(), date, label: `[${t.account}]`, amount, type: 'credit', account: dest, category: 'Virement', opType: 'Virement', comment: note }]
      : [{ id: uid(), date, label: t.label, amount, type, account: t.account, category: t.category || 'Autre', opType: 'Operation', comment: note }];
    appData.operations.push(...ops);
    undo.added = ops.map(o => o.id);
  }
  if (t.detail === 'ponctuelle') {
    undo.removed = { ...t };
    dropOps(o => o.id !== id);
  } else if (!(t.exceptions || []).includes(monthKey)) {
    t.exceptions = [...(t.exceptions || []), monthKey];
  }
  return undo;
}
function undoPass(undo) {
  if (undo.added.length) dropOps(o => !undo.added.includes(o.id));
  if (undo.removed) { appData.operations.push({ ...undo.removed, id: uid() }); return; }   // nouvel identifiant : la trace de suppression ne l'efface pas
  const t = appData.operations.find(o => o.id === undo.id);
  if (!t) return;
  if (undo.exceptions) t.exceptions = undo.exceptions; else delete t.exceptions;
}

// Fait s'arrêter une échéance avant le mois de `fromStr` : tout ce qui précède reste compté
function endBeforeMonth(template, fromStr) {
  template.endDate = localDateStr(new Date(+fromStr.slice(0, 4), +fromStr.slice(5, 7) - 1, 0));
}
// Modification « à partir de » : l'ancien modèle s'arrête avant ce mois (le passé garde ses valeurs) ; un nouveau reprend à
// `fromStr` avec les changements, la même date de fin (sauf changement) et les mois déjà remplacés à partir de là
function splitScheduled(template, fromStr, changes) {
  const next = { ...template, ...changes, id: uid(), date: fromStr, nextPayment: fromStr };
  const kept = (template.exceptions || []).filter(m => m >= fromStr.slice(0, 7));
  if (kept.length) next.exceptions = kept; else delete next.exceptions;
  endBeforeMonth(template, fromStr);
  appData.operations.push(next);
  return next;
}

// Total moyen par mois des échéances en cours (revenus et charges) ; virements entre comptes, ponctuelles, échéances terminées ou
// commençant dans plus d'un mois exclus
function monthlyScheduledTotals(todayStr, names) {
  const months = { mensuelle: 1, bimensuelle: 2, trimestrielle: 3, annuelle: 12 };
  const soon = addDays(todayStr, 31);
  let income = 0, expense = 0;
  for (const t of appData.operations) {
    if (t.opType !== 'Programmee' || scheduledDest(t) || t.detail === 'ponctuelle') continue;
    if (names && !names.includes(t.account)) continue;
    if ((t.nextPayment || t.date) > soon || !nextScheduledDate(t, todayStr)) continue;
    const v = t.amount / (months[t.detail || 'mensuelle'] || 1);
    if (t.type === 'credit') income += v; else expense += v;
  }
  return { income: Math.round(income), expense: Math.round(expense) };
}

function renderScheduled() {
  const todayStr = today();
  const list = document.getElementById('list-scheduled');
  const items = appData.operations
    .filter(op => op.opType === 'Programmee')
    .map(op => ({ op, next: nextScheduledDate(op, todayStr) }));
  if (!items.length) {
    list.innerHTML = '<li class="empty-state">Aucune opération programmée</li>';
    return;
  }
  const byDate = (a, b) => (a.next || '').localeCompare(b.next || '') || String(a.op.label).localeCompare(String(b.op.label));
  const active = items.filter(x => x.next).sort(byDate), ended = items.filter(x => !x.next).sort(byDate);
  const item = ({ op, next }) => {
    const sign = op.type === 'credit' ? '+' : '-';
    // sans fréquence enregistrée (opérations importées), l'échéance est comptée chaque mois : on l'affiche tel quel
    const freq = FREQ_LABELS[op.detail || 'mensuelle'] || op.detail || '';
    const days = next ? daysBetween(todayStr, next) : 0;
    const when = next ? `prochaine : <b>${formatDate(next)}</b>${days <= 31 ? ` (${describeDays(days)})` : ''}` : 'terminée';
    const endInfo = op.endDate && next ? ` · jusqu'au ${formatDate(op.endDate)}` : '';
    const canPass = !!occurrenceChoices(op, todayStr).guess;
    return `<li class="sched-item">
      <div class="sched-main">
        <span class="op-icon">🔁</span>
        <div class="op-info">
          <div class="op-label">${esc(op.label)}</div>
          <div class="op-meta">${esc(op.account)} · ${esc(freq)} · ${when}${endInfo}</div>
          ${commentHtml(op)}
        </div>
        <span class="op-amount ${op.type}">${sign}${fmt(op.amount)}</span>
      </div>
      <div class="sched-actions">
        <button type="button" class="act act-ok" data-action="pass" data-id="${esc(op.id)}"${canPass ? '' : ' disabled'}>✅ Passer</button>
        <button type="button" class="act" data-action="sched-edit" data-id="${esc(op.id)}">✏️ Modifier</button>
        <button type="button" class="act act-danger" data-action="sched-delete" data-id="${esc(op.id)}">🗑 Supprimer</button>
      </div>
    </li>`;
  };
  const tot = monthlyScheduledTotals(todayStr);
  const rest = tot.income - tot.expense;
  const summary = `<li class="sched-summary">
      <div class="kpi-grid kpi-3">
        <div class="kpi"><span>Revenus / mois</span><b class="pos">+${fmt(tot.income)}</b></div>
        <div class="kpi"><span>Charges / mois</span><b class="neg">-${fmt(tot.expense)}</b></div>
        <div class="kpi"><span>Reste / mois</span><b class="${rest < 0 ? 'neg' : 'pos'}">${signedFmt(rest)}</b></div>
      </div>
      <small>Moyenne des échéances en cours, hors virements entre comptes.</small>
    </li>`;
  list.innerHTML = summary + active.map(item).join('')
    + (ended.length ? `<li class="sched-ended"><details><summary>Terminées (${ended.length})</summary><ul class="op-list">${ended.map(item).join('')}</ul></details></li>` : '');
}

// ── « Passer » une échéance : choix du mois réglé, paiement déjà saisi détecté ──
let _passerOpId = null;
function monthName(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}
function refreshPasser(keepChoice) {
  const t = appData.operations.find(o => o.id === _passerOpId);
  if (!t) return;
  const g = id => document.getElementById(id);
  const { choices, guess } = occurrenceChoices(t, g('modal-passer-date').value || today());
  const sel = g('modal-passer-occ');
  const current = keepChoice && choices.includes(sel.value) ? sel.value : guess;
  sel.innerHTML = choices.map(d => `<option value="${d}">${esc(monthName(d))} (le ${d.slice(8, 10)}/${d.slice(5, 7)})</option>`).join('');
  if (current) sel.value = current;
  const found = current ? findRecordedPayment(t, current.slice(0, 7)) : null;
  const box = g('modal-passer-already');
  g('modal-passer-match').classList.toggle('hidden', !found);
  if (box.dataset.match !== (found ? found.id : '')) { box.checked = !!found; box.dataset.match = found ? found.id : ''; }
  g('modal-passer-found').textContent = found ? `Déjà saisie : « ${found.label} » du ${formatDate(found.date)} (${fmt(found.amount)}). Ne rien ajouter.` : '';
  const done = !!found && box.checked;
  g('modal-passer-amount').disabled = done;
  g('modal-passer-comment').disabled = done;
  g('modal-passer-type').disabled = done || !!scheduledDest(t);
  g('modal-passer-hint').textContent = !current ? 'Toutes les échéances de cette opération sont déjà passées.'
    : done ? `Rien ne sera ajouté : l'échéance de ${monthName(current)} sera marquée comme payée.`
    : `Cette opération remplacera l'échéance de ${monthName(current)}. Les autres mois ne changent pas.`;
  g('modal-passer-confirm').disabled = !current;
}
window.passerScheduled = function(id) {
  const op = appData.operations.find(o => o.id === id);
  if (!op) return;
  _passerOpId = id;
  document.getElementById('modal-passer-label').textContent = op.label + ' — ' + op.account;
  document.getElementById('modal-passer-date').value = today();
  document.getElementById('modal-passer-amount').value = op.amount;
  document.getElementById('modal-passer-type').value = op.type;
  document.getElementById('modal-passer-comment').value = op.comment || '';
  document.getElementById('modal-passer-already').dataset.match = '';
  document.getElementById('modal-passer-already').checked = false;
  refreshPasser(false);
  document.getElementById('modal-passer').classList.remove('hidden');
};
document.getElementById('modal-passer-date').addEventListener('change', () => refreshPasser(false));
document.getElementById('modal-passer-occ').addEventListener('change', () => refreshPasser(true));
document.getElementById('modal-passer-already').addEventListener('change', () => refreshPasser(true));

document.getElementById('modal-passer-cancel').addEventListener('click', () => {
  document.getElementById('modal-passer').classList.add('hidden');
  _passerOpId = null;
});

document.getElementById('modal-passer-confirm').addEventListener('click', () => {
  const g = id => document.getElementById(id);
  const date = g('modal-passer-date').value;
  const amount = parseAmount(g('modal-passer-amount').value);
  const occ = g('modal-passer-occ').value;
  const already = !g('modal-passer-match').classList.contains('hidden') && g('modal-passer-already').checked;
  if (!date || !occ || (!already && amount === null)) { toast('⚠️ Date et montant valide (> 0) requis'); return; }
  const undo = passScheduled(_passerOpId, { monthKey: occ.slice(0, 7), date, amount, type: g('modal-passer-type').value, alreadyRecorded: already, comment: g('modal-passer-comment').value });
  if (!undo) return;
  saveLocal();
  renderAll();
  g('modal-passer').classList.add('hidden');
  _passerOpId = null;
  toastAction(already ? `✅ Échéance de ${monthName(occ)} marquée comme payée` : `✅ Opération passée le ${formatDate(date)}`, 'Annuler', () => {
    undoPass(undo);
    saveLocal();
    renderAll();
    toast('↩️ Annulé');
  }, 9000);
});

window.editScheduled = function(id) {
  const op = appData.operations.find(o => o.id === id);
  if (!op) return;
  const wrap = document.getElementById('form-scheduled-wrap');
  wrap.classList.remove('hidden');
  wrap.dataset.editId = id;
  wrap.querySelector('h3').textContent = 'Modifier l\'opération programmée';
  const names = getAccountNames();
  const opts = names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  document.getElementById('sch-account').innerHTML = opts;
  document.getElementById('sch-dest').innerHTML = opts;
  document.getElementById('sch-label').value = op.label;
  document.getElementById('sch-comment').value = op.comment || '';
  document.getElementById('sch-amount').value = op.amount;
  const isVirement = op.opType === 'Virement' || op.virementDest || (op.label && op.label.startsWith('['));
  document.getElementById('sch-type').value = isVirement ? 'virement' : op.type;
  document.getElementById('sch-account').value = op.account;
  if (isVirement && op.virementDest) {
    document.getElementById('sch-dest').value = op.virementDest;
  } else if (isVirement && op.label) {
    const destMatch = op.label.match(/^\[(.+)\]$/);
    if (destMatch) document.getElementById('sch-dest').value = destMatch[1];
  }
  setSelectValue(document.getElementById('sch-category'), op.category || 'Autre');
  document.getElementById('sch-freq').value = op.detail || 'mensuelle';
  // « Prochaine échéance » : la vraie prochaine date (la date de départ reste inchangée tant qu'on n'y touche pas)
  const next = nextScheduledDate(op, today());
  document.getElementById('sch-next').value = next || op.nextPayment || op.date;
  wrap.dataset.shownDate = document.getElementById('sch-next').value;
  const apply = document.getElementById('sch-apply');
  document.getElementById('sch-apply-wrap').classList.toggle('hidden', !countedOccurrences(op, today()).length);
  apply.querySelector('option[value="future"]').disabled = !next;
  apply.value = next ? 'future' : 'all';
  document.getElementById('sch-end').value = op.endDate || '';
  toggleSchDest();
  wrap.scrollIntoView({ behavior: 'smooth' });
};

// Supprimer une échéance : quand des mois passés sont déjà comptés, on peut l'arrêter (le passé reste) plutôt que tout effacer
window.deleteScheduled = function(id) {
  const op = appData.operations.find(o => o.id === id);
  if (!op) return;
  const todayStr = today();
  const counted = countedOccurrences(op, todayStr);
  const done = (message, undo) => {
    saveLocal();
    renderAll();
    toastAction(message, 'Annuler', () => { undo(); saveLocal(); renderAll(); toast('↩️ Annulé'); }, 9000);
  };
  const removeAll = () => {
    const copy = { ...(appData.operations.find(o => o.id === id) || op) };
    dropOps(o => o.id !== id);
    done(`🗑 « ${copy.label} » supprimée`, () => appData.operations.push({ ...copy, id: uid() }));
  };
  if (!counted.length) {
    if (confirm(`Supprimer « ${op.label} » ? Aucune échéance passée n'est comptée.`)) removeAll();
    return;
  }
  const stopFrom = scheduledDates(op, monthIndexOf(todayStr) + 120).find(d => d > todayStr) || null;
  openCatDialog({
    title: `Supprimer « ${op.label} » ?`,
    intro: `${counted.length > 1 ? `${counted.length} échéances passées sont comptées` : 'Une échéance passée est comptée'} dans vos soldes (${fmt(counted.length * op.amount)}).`,
    target: {
      label: 'Que faire ?',
      options: [
        ...(stopFrom ? [{ value: 'stop', label: `Arrêter dès le ${stopFrom.slice(8, 10)}/${stopFrom.slice(5, 7)}/${stopFrom.slice(2, 4)} (passé gardé)` }] : []),
        { value: 'all', label: 'Tout effacer (soldes modifiés)' },
      ],
      value: stopFrom ? 'stop' : 'all',
    },
    okLabel: 'Confirmer', danger: true,
    onOk: (v) => {
      if (v.target !== 'stop') { removeAll(); return; }
      const live = appData.operations.find(o => o.id === id);        // relue ici : une synchronisation a pu passer
      if (!live) { toast('⚠️ Cette échéance n’existe plus'); renderAll(); return; }
      const before = live.endDate;
      endBeforeMonth(live, stopFrom);
      done(`⏹ « ${live.label} » arrêtée : le passé reste compté`, () => {
        const o = appData.operations.find(x => x.id === id);
        if (o) { if (before !== undefined) o.endDate = before; else delete o.endDate; }
      });
    },
  });
};

document.getElementById('btn-add-scheduled').addEventListener('click', () => {
  closeScheduledForm();                       // un formulaire neuf, jamais la modification restée ouverte
  document.getElementById('form-scheduled-wrap').classList.remove('hidden');
  document.getElementById('sch-next').value = today();
  const names = getAccountNames();
  const opts = names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  document.getElementById('sch-account').innerHTML = opts;
  document.getElementById('sch-dest').innerHTML = opts;
  if (names.length > 1) document.getElementById('sch-dest').selectedIndex = 1;
  toggleSchDest();
});

function toggleSchDest() {
  const isVirement = document.getElementById('sch-type').value === 'virement';
  document.getElementById('sch-dest-wrap').classList.toggle('hidden', !isVirement);
}
document.getElementById('sch-type').addEventListener('change', toggleSchDest);

function closeScheduledForm() {
  const wrap = document.getElementById('form-scheduled-wrap');
  wrap.classList.add('hidden');
  delete wrap.dataset.editId;
  delete wrap.dataset.shownDate;
  document.getElementById('sch-apply-wrap').classList.add('hidden');
  wrap.querySelector('h3').textContent = 'Nouvelle opération programmée';
  document.getElementById('form-scheduled').reset();
}

document.getElementById('btn-cancel-scheduled').addEventListener('click', closeScheduledForm);

document.getElementById('form-scheduled').addEventListener('submit', async (e) => {
  e.preventDefault();
  const wrap = document.getElementById('form-scheduled-wrap');
  const editId = wrap.dataset.editId;
  const typeVal = document.getElementById('sch-type').value;
  const account = document.getElementById('sch-account').value;
  const dest = document.getElementById('sch-dest').value;
  const amount = parseAmount(document.getElementById('sch-amount').value);
  const nextDate = document.getElementById('sch-next').value;
  const freq = document.getElementById('sch-freq').value;
  if (amount === null) { toast('⚠️ Montant invalide (nombre supérieur à 0)'); return; }
  if (!nextDate) { toast('⚠️ Date de prochaine échéance requise'); return; }
  if (typeVal === 'virement' && account === dest) { toast('⚠️ Source et destination identiques'); return; }

  const endDate = document.getElementById('sch-end').value || null;
  const original = editId ? appData.operations.find(o => o.id === editId) : null;
  const counted = original ? countedOccurrences(original, today()) : [];
  // « à partir de la date » : le passé reste tel quel ; sinon la modification vaut aussi pour les échéances passées
  const future = counted.length > 0 && document.getElementById('sch-apply').value === 'future';
  if (future) {
    const last = counted[counted.length - 1];
    if (nextDate !== last && monthIndexOf(nextDate) <= monthIndexOf(last)) {
      toast(`⚠️ L'échéance du ${formatDate(last)} est déjà comptée : choisissez une date après ce mois, ou « Aussi le passé »`, 7000);
      return;
    }
  }
  // en modifiant aussi le passé, la date de départ ne change que si la date affichée a été modifiée
  const startDate = original && !future && nextDate === wrap.dataset.shownDate ? (original.nextPayment || original.date) : nextDate;

  // garde-fou : l'application compte chaque échéance depuis la date de départ, y compris dans le passé.
  // On prévient quand une NOUVELLE date de départ (ou une date modifiée) fait entrer plusieurs mois passés d'un coup.
  if (!future && (!original || (original.nextPayment || original.date) !== startDate)) {
    const past = countPastOccurrences(freq, startDate, endDate, today());
    if (past >= 2) {
      const total = past * amount * (typeVal === 'credit' ? 1 : -1);
      const keep = await askConfirm({
        title: 'Échéances déjà passées',
        lines: [
          `Cette opération démarre le ${formatDate(startDate)} : ${past} échéances déjà passées seront comptées d'un coup dans vos soldes (${signedFmt(total)} au total).`,
          "Pour qu'elle ne compte qu'à partir de maintenant, choisissez une prochaine échéance à venir.",
        ],
        okLabel: 'Garder cette date', cancelLabel: 'Changer la date',
      });
      if (!keep) return;
    }
  }

  const fields = typeVal === 'virement'
    ? { amount, category: 'Virement', detail: freq, opType: 'Programmee', endDate, label: `[${dest}]`, type: 'debit', account, virementDest: dest }
    : { label: document.getElementById('sch-label').value.trim(), amount, type: typeVal, account,
        category: document.getElementById('sch-category').value, detail: freq, opType: 'Programmee', endDate };
  fields.comment = cleanComment(document.getElementById('sch-comment').value);
  let target;
  if (future) {
    target = splitScheduled(original, nextDate, fields);
  } else if (original) {
    // relue ici : une synchronisation a pu passer pendant la question
    target = Object.assign(appData.operations.find(o => o.id === original.id) || original, fields, { date: startDate, nextPayment: startDate });
  } else {
    target = { id: uid(), ...fields, date: startDate, nextPayment: startDate };
    appData.operations.push(target);
  }
  if (typeVal !== 'virement') delete target.virementDest;
  saveLocal();
  renderAll();
  closeScheduledForm();
  toast(future ? `✅ Modifié à partir du ${formatDate(nextDate)} : le passé ne change pas`
    : original ? '✅ Opération programmée modifiée' : '✅ Opération programmée enregistrée', 4000);
});

// ── IMPORT PAR COLLAGE BANCAIRE ──────────────────────────────────────────────
let pasteData = { rows: [], headers: [], colRoles: [], removedCols: [] };
let pasteBatches = []; // stocke les collages multiples

document.getElementById('btn-open-paste-import').addEventListener('click', () => {
  document.getElementById('modal-paste-import').classList.remove('hidden');
  document.getElementById('paste-step1').classList.remove('hidden');
  document.getElementById('paste-step2').classList.add('hidden');
  document.getElementById('paste-step3').classList.add('hidden');
  document.getElementById('paste-bank').classList.add('hidden');
  document.getElementById('paste-input').value = '';
  pasteBatches = [];
  updateBatchesDisplay();
  const names = getAccountNames();
  document.getElementById('paste-account').innerHTML = names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
});

// Ajouter un collage à la pile
document.getElementById('btn-paste-add').addEventListener('click', () => {
  const raw = document.getElementById('paste-input').value.trim();
  if (!raw) { toast('⚠️ Collez des données d\'abord'); return; }
  const skipRows = parseInt(document.getElementById('paste-skip-rows').value) || 0;
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean).slice(skipRows);
  pasteBatches.push(lines);
  document.getElementById('paste-input').value = '';
  updateBatchesDisplay();
  toast(`✅ Collage ${pasteBatches.length} ajouté (${lines.length} lignes)`);
});

function updateBatchesDisplay() {
  const el = document.getElementById('paste-batches');
  if (!pasteBatches.length) { el.textContent = ''; return; }
  const total = pasteBatches.reduce((s, b) => s + b.length, 0);
  el.innerHTML = `📋 ${pasteBatches.length} collage(s) en attente — ${total} lignes au total`;
}

document.getElementById('btn-paste-cancel').addEventListener('click', () => {
  if (!confirm('Quitter l\'import ? Les données collées seront conservées.')) return;
  document.getElementById('modal-paste-import').classList.add('hidden');
});

document.getElementById('btn-paste-parse').addEventListener('click', () => {
  // Ajouter le collage actuel s'il y en a un
  const raw = document.getElementById('paste-input').value.trim();
  if (raw) {
    const skipRows = parseInt(document.getElementById('paste-skip-rows').value) || 0;
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean).slice(skipRows);
    pasteBatches.push(lines);
  }
  if (!pasteBatches.length) { toast('⚠️ Collez des données d\'abord'); return; }

  // Fusionner tous les collages
  const lines = pasteBatches.flat();
  if (!lines.length) {
    pasteBatches = [];
    updateBatchesDisplay();
    toast('⚠️ Aucune ligne à analyser : vérifiez le nombre de lignes à ignorer', 5000);
    return;
  }
  // format du site bancaire (date, libellé, prélèvement, montant, XPF, Débit) : pas de colonnes à régler
  const bank = parseBankText(lines.join('\n'));
  if (bank.length) { openBankReview(bank); return; }
  let sep = '\t';
  if (lines[0].includes('\t')) sep = '\t';
  else if (lines[0].includes(';')) sep = ';';
  else if (lines[0].includes(',')) sep = ',';

  const allRows = lines.map(l => l.split(sep).map(c => c.trim()));
  const maxCols = Math.max(...allRows.map(r => r.length));

  // Normaliser les lignes (même nombre de colonnes)
  allRows.forEach(r => { while (r.length < maxCols) r.push(''); });

  // Détecter si la première ligne est un header
  const firstRow = allRows[0];
  const hasHeader = firstRow.some(c => /date|libellé|label|montant|débit|crédit|description|ref/i.test(c));

  if (hasHeader) {
    pasteData.headers = firstRow;
    pasteData.rows = allRows.slice(1);
  } else {
    // Pas de titre : utiliser la 1ère valeur comme indice
    pasteData.headers = firstRow.map((val, i) => {
      const short = val.length > 15 ? val.substring(0, 15) + '…' : val;
      return `Col ${i + 1} (${short || '—'})`;
    });
    pasteData.rows = allRows;
  }

  // Auto-détecter les rôles à partir des données si pas de header
  if (!hasHeader && pasteData.rows.length > 0) {
    pasteData.colRoles = firstRow.map((val, i) => {
      // Détecter par le contenu
      if (/^\d{1,2}[/\-.]/.test(val)) return 'date';
      if (/^d[ée]bit$/i.test(val) || /^cr[ée]dit$/i.test(val)) return 'typecol';
      const num = parseFloat(val.replace(/\s/g, '').replace(',', '.'));
      if (!isNaN(num) && num !== 0) {
        // Colonne numérique — deviner si débit ou crédit
        const allVals = allRows.map(r => parseFloat((r[i]||'').replace(/\s/g, '').replace(',', '.')) || 0);
        const hasNeg = allVals.some(v => v < 0);
        const hasMix = allVals.some(v => v > 0) && hasNeg;
        if (hasMix) return 'montant';
        return '';
      }
      if (val.length > 3 && isNaN(num)) return 'label';
      return '';
    });
  }

  // Auto-détecter les rôles des colonnes
  pasteData.colRoles = pasteData.headers.map(h => {
    const hl = h.toLowerCase();
    if (/date/.test(hl)) return 'date';
    if (/libellé|label|description|intitulé|désignation/.test(hl)) return 'label';
    if (/^débit$|^debit$/.test(hl)) return 'debit';
    if (/^crédit$|^credit$/.test(hl)) return 'credit';
    if (/montant|somme|valeur/.test(hl)) return 'montant';
    if (/type|sens|opération/.test(hl)) return 'typecol';
    return '';
  });

  pasteData.removedCols = [];
  renderPasteStep2();
});

function renderPasteStep2() {
  document.getElementById('paste-step1').classList.add('hidden');
  document.getElementById('paste-step2').classList.remove('hidden');

  const roles = ['', 'date', 'label', 'debit', 'credit', 'montant', 'typecol', 'ignorer'];
  const roleLabels = { '': '— Choisir —', date: '📅 Date', label: '📝 Libellé', debit: '🔴 Débit', credit: '🟢 Crédit', montant: '💰 Montant', typecol: '↕️ Type (Débit/Crédit)', ignorer: '⏭ Ignorer' };

  // En-têtes avec sélecteur de rôle et bouton supprimer
  const colsHtml = pasteData.headers.map((h, i) => {
    if (pasteData.removedCols.includes(i)) return '';
    const selOpts = roles.map(r => `<option value="${r}" ${pasteData.colRoles[i] === r ? 'selected' : ''}>${roleLabels[r]}</option>`).join('');
    return `<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:6px 8px;font-size:0.78rem;display:flex;flex-direction:column;gap:4px;min-width:100px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <b style="font-size:0.75rem">${esc(h)}</b>
        <span data-paste-remove="${i}" role="button" tabindex="0" aria-label="Retirer la colonne" style="cursor:pointer;color:var(--danger);font-size:0.9rem">✕</span>
      </div>
      <select data-paste-role="${i}" aria-label="Rôle de la colonne" style="padding:4px;font-size:0.75rem">${selOpts}</select>
    </div>`;
  }).join('');
  document.getElementById('paste-columns').innerHTML = colsHtml;

  // Avertissements
  const warnings = [];
  const hasDate = pasteData.colRoles.some((r, i) => r === 'date' && !pasteData.removedCols.includes(i));
  const hasLabel = pasteData.colRoles.some((r, i) => r === 'label' && !pasteData.removedCols.includes(i));
  const hasAmount = pasteData.colRoles.some((r, i) => ['debit','credit','montant'].includes(r) && !pasteData.removedCols.includes(i));
  if (!hasDate) warnings.push('⚠️ Pas de colonne Date assignée');
  if (!hasLabel) warnings.push('⚠️ Pas de colonne Libellé assignée');
  if (!hasAmount) warnings.push('⚠️ Pas de colonne Montant/Débit/Crédit assignée');
  document.getElementById('paste-col-warning').textContent = warnings.join(' · ');

  // Aperçu tableau (5 premières lignes)
  const visibleCols = pasteData.headers.map((_, i) => i).filter(i => !pasteData.removedCols.includes(i));
  const previewRows = pasteData.rows.slice(0, 15);
  const thHtml = `<th style="padding:4px 6px;font-size:0.7rem;border-bottom:1px solid var(--border);color:var(--muted)">#</th>` + visibleCols.map(i => `<th style="padding:4px 6px;font-size:0.7rem;white-space:nowrap;border-bottom:1px solid var(--border);color:var(--muted)">${esc(pasteData.headers[i])}</th>`).join('');
  const trHtml = previewRows.map((row, idx) =>
    `<tr><td style="padding:3px 6px;font-size:0.7rem;color:var(--muted);border-bottom:1px solid var(--border)">${idx+1}</td>${visibleCols.map(i => `<td style="padding:3px 6px;font-size:0.75rem;white-space:nowrap;border-bottom:1px solid var(--border)">${row[i] ? esc(row[i]) : '<span style="color:var(--danger)">vide</span>'}</td>`).join('')}</tr>`
  ).join('');

  document.getElementById('paste-preview').innerHTML = `
    <table style="border-collapse:collapse;width:100%">
      <thead><tr>${thHtml}</tr></thead>
      <tbody>${trHtml}</tbody>
    </table>`;

  document.getElementById('paste-count').textContent = pasteData.rows.length;
}

window.removePasteCol = function(idx) {
  pasteData.removedCols.push(idx);
  renderPasteStep2();
};

document.getElementById('paste-columns').addEventListener('click', (e) => {
  const cross = e.target.closest('[data-paste-remove]');
  if (cross) removePasteCol(+cross.dataset.pasteRemove);
});
document.getElementById('paste-columns').addEventListener('change', (e) => {
  if (e.target.dataset.pasteRole !== undefined) setPasteRole(+e.target.dataset.pasteRole, e.target.value);
});
document.getElementById('paste-review').addEventListener('change', (e) => {
  const { pasteKeep, pasteCategory } = e.target.dataset;
  if (pasteKeep !== undefined) parsedOps[+pasteKeep].skip = !e.target.checked;
  if (pasteCategory !== undefined) parsedOps[+pasteCategory].category = e.target.value;
});

window.setPasteRole = function(idx, role) {
  // Un seul rôle par colonne (sauf ignorer)
  if (role && role !== 'ignorer') {
    pasteData.colRoles.forEach((r, i) => { if (r === role && i !== idx) pasteData.colRoles[i] = ''; });
  }
  pasteData.colRoles[idx] = role;
  renderPasteStep2();
};

// Étape 2 → Étape 3 : revue des opérations avec catégories
let parsedOps = [];

document.getElementById('btn-paste-next').addEventListener('click', () => {
  const account = document.getElementById('paste-account').value;
  const defaultCat = document.getElementById('paste-category').value;
  if (!account) { toast('⚠️ Sélectionnez un compte'); return; }

  const dateCol = pasteData.colRoles.indexOf('date');
  const labelCol = pasteData.colRoles.indexOf('label');
  const debitCol = pasteData.colRoles.indexOf('debit');
  const creditCol = pasteData.colRoles.indexOf('credit');
  const montantCol = pasteData.colRoles.indexOf('montant');

  const typeCol = pasteData.colRoles.indexOf('typecol');

  if (dateCol < 0) { toast('⚠️ Assignez une colonne Date'); return; }
  if (labelCol < 0) { toast('⚠️ Assignez une colonne Libellé'); return; }
  if (debitCol < 0 && creditCol < 0 && montantCol < 0) { toast('⚠️ Assignez une colonne Débit, Crédit ou Montant'); return; }

  parsedOps = [];
  let skipDate = 0, skipLabel = 0, skipAmount = 0;
  for (const row of pasteData.rows) {
    let dateStr = (row[dateCol] || '').trim();
    const dm = dateStr.match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
    if (!dm) { skipDate++; continue; }
    let [_, dd, mm, yy] = dm;
    if (yy.length === 2) yy = '20' + yy;
    dateStr = `${yy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;

    const label = (row[labelCol] || '').trim();
    if (!label) { skipLabel++; continue; }

    let amount = 0, type = 'debit';

    // Déterminer le type depuis la colonne Type si elle existe
    let typeFromCol = false;
    if (typeCol >= 0) {
      const typeRaw = (row[typeCol] || '').trim().toLowerCase();
      if (/cr[ée]dit/.test(typeRaw)) { type = 'credit'; typeFromCol = true; }
      else { type = 'debit'; typeFromCol = true; }
    }

    // Déterminer le montant (sans écraser le type si la colonne Type l'a défini)
    if (montantCol >= 0) {
      const val = parseFloat((row[montantCol] || '').replace(/\s/g, '').replace(',', '.')) || 0;
      if (val === 0) { skipAmount++; continue; }
      amount = Math.round(Math.abs(val));
      if (!typeFromCol) type = val < 0 ? 'debit' : 'credit';
    } else if (debitCol >= 0 && creditCol >= 0) {
      const dRaw = (row[debitCol] || '').trim();
      const cRaw = (row[creditCol] || '').trim();
      const dVal = parseFloat(dRaw.replace(/\s/g, '').replace(',', '.')) || 0;
      const cVal = parseFloat(cRaw.replace(/\s/g, '').replace(',', '.')) || 0;
      if (cVal > 0) { amount = Math.round(cVal); type = 'credit'; }
      else if (dVal > 0) { amount = Math.round(dVal); type = 'debit'; }
      else { skipAmount++; continue; }
    } else if (debitCol >= 0) {
      const dRaw = (row[debitCol] || '').trim();
      // Si la colonne contient "Débit"/"Crédit" (texte), chercher le montant ailleurs
      if (/d[ée]bit/i.test(dRaw)) {
        type = 'debit';
        // Chercher le montant dans la colonne montant ou une autre colonne numérique
        if (montantCol >= 0) {
          amount = Math.round(Math.abs(parseFloat((row[montantCol] || '').replace(/\s/g, '').replace(',', '.')) || 0));
        }
      } else if (/cr[ée]dit/i.test(dRaw)) {
        type = 'credit';
        if (montantCol >= 0) {
          amount = Math.round(Math.abs(parseFloat((row[montantCol] || '').replace(/\s/g, '').replace(',', '.')) || 0));
        }
      } else {
        amount = Math.round(Math.abs(parseFloat(dRaw.replace(/\s/g, '').replace(',', '.')) || 0));
        type = 'debit';
      }
      if (!amount) { skipAmount++; continue; }
    } else if (creditCol >= 0) {
      amount = Math.round(Math.abs(parseFloat((row[creditCol] || '').replace(/\s/g, '').replace(',', '.')) || 0));
      if (!amount) { skipAmount++; continue; }
      type = 'credit';
    }

    // Vérification doublon : même date + même montant + même compte
    const isDuplicate = appData.operations.some(op =>
      op.account === account &&
      op.date === dateStr &&
      op.amount === amount &&
      op.type === type
    );

    // Vérification doublon dans le lot actuel (collage en double)
    const isDuplicateInBatch = parsedOps.some(op =>
      op.date === dateStr &&
      op.amount === amount &&
      op.type === type &&
      op.label === label
    );

    if (isDuplicateInBatch) continue; // doublon dans le même collage → ignorer silencieusement

    parsedOps.push({ date: dateStr, label, amount, type, category: defaultCat, duplicate: isDuplicate, skip: isDuplicate });
  }

  if (!parsedOps.length) {
    let msg = '⚠️ Aucune opération valide.';
    if (skipDate > 0) msg += ` ${skipDate} lignes sans date valide (colonne ${dateCol+1}).`;
    if (skipLabel > 0) msg += ` ${skipLabel} lignes sans libellé (colonne ${labelCol+1}).`;
    if (skipAmount > 0) msg += ` ${skipAmount} lignes sans montant.`;
    toast(msg, 8000);
    return;
  }
  renderPasteStep3();
});

function renderPasteStep3() {
  document.getElementById('paste-step2').classList.add('hidden');
  document.getElementById('paste-step3').classList.remove('hidden');

  const catOptions = getAllCategoryOptions();

  const dupeCount = parsedOps.filter(op => op.duplicate).length;
  const activeCount = parsedOps.filter(op => !op.skip).length;
  const dupeWarning = dupeCount > 0 ? `<div style="background:var(--warning);color:white;padding:8px 12px;border-radius:8px;margin-bottom:8px;font-size:0.82rem">⚠️ ${dupeCount} doublon(s) détecté(s) et exclu(s) — recochez pour les inclure</div>` : '';

  const rows = parsedOps.map((op, i) => {
    const sign = op.type === 'credit' ? '+' : '-';
    const col = op.type === 'credit' ? 'var(--accent)' : 'var(--danger)';
    const dupeStyle = op.duplicate ? 'background:rgba(239,108,0,0.1);border-left:3px solid var(--warning);' : '';
    const checked = op.skip ? '' : 'checked';
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 4px;border-bottom:1px solid var(--border);flex-wrap:wrap;${dupeStyle}">
      <input type="checkbox" ${checked} data-paste-keep="${i}" aria-label="Importer cette ligne" style="width:18px;height:18px;accent-color:var(--primary)"/>
      <span style="font-size:0.78rem;color:var(--muted);min-width:65px">${formatDate(op.date)}</span>
      <span style="flex:1;font-size:0.82rem;font-weight:600;min-width:80px">${esc(op.label)}${op.duplicate ? ' <span style="color:var(--warning);font-size:0.72rem">⚠️ doublon</span>' : ''}</span>
      <span style="font-weight:700;color:${col};font-size:0.85rem;min-width:70px;text-align:right">${sign}${fmt(op.amount)}</span>
      <select data-paste-category="${i}" aria-label="Catégorie" style="padding:4px 6px;font-size:0.75rem;min-width:90px">${catOptions.replace(`value="${esc(op.category)}"`, m => m + ' selected')}</select>
    </div>`;
  }).join('');

  document.getElementById('paste-review').innerHTML = dupeWarning + rows;
  document.getElementById('paste-count').textContent = parsedOps.length;
}

document.getElementById('btn-paste-back2').addEventListener('click', () => {
  document.getElementById('paste-step3').classList.add('hidden');
  document.getElementById('paste-step2').classList.remove('hidden');
});

document.getElementById('btn-paste-back').addEventListener('click', () => {
  document.getElementById('paste-step1').classList.remove('hidden');
  document.getElementById('paste-step2').classList.add('hidden');
});

document.getElementById('btn-paste-import').addEventListener('click', () => {
  const account = document.getElementById('paste-account').value;
  if (!account) { toast('⚠️ Sélectionnez un compte'); return; }
  if (!parsedOps.length) { toast('⚠️ Aucune opération'); return; }

  let imported = 0;
  for (const op of parsedOps) {
    if (op.skip) continue;
    appData.operations.push({
      id: uid(),
      date: op.date,
      label: op.label,
      amount: op.amount,
      type: op.type,
      account,
      category: op.category,
      opType: 'Operation',
    });
    imported++;
  }

  if (imported > 0) {
    const importedIds = appData.operations.slice(-imported).map(op => op.id);
    setPref('lastImportIds', JSON.stringify(importedIds));
    saveLocal();
    renderAll();
    document.getElementById('modal-paste-import').classList.add('hidden');

    // Afficher la barre de validation
    document.getElementById('import-bar-text').textContent = `⏳ ${imported} opérations importées dans ${account} — vérifiez puis validez ou annulez`;
    document.getElementById('import-validation-bar').classList.remove('hidden');
    document.getElementById('import-validation-bar').style.display = 'flex';

    // Aller sur le compte pour vérifier
    document.getElementById('filter-account').value = account;
    opsMonth = new Date().getMonth();
    opsYear = new Date().getFullYear();
    renderOperations();
    showTab('operations');

    toast(`📋 ${imported} opérations importées — vérifiez puis validez`);
  } else {
    toast('⚠️ Aucune opération valide trouvée');
  }
});

document.getElementById('btn-import-validate').addEventListener('click', () => {
  localStorage.removeItem('lastImportIds');
  localStorage.removeItem('lastImportUndo');
  document.getElementById('import-validation-bar').classList.add('hidden');
  document.getElementById('import-validation-bar').style.display = 'none';
  toast('✅ Import validé');
});

document.getElementById('btn-import-cancel').addEventListener('click', () => {
  let bankUndo = null;
  try { bankUndo = JSON.parse(localStorage.getItem('lastImportUndo')); } catch { /* ignoré */ }
  if (bankUndo) {
    undoBankImport(bankUndo);
    localStorage.removeItem('lastImportUndo');
    document.getElementById('import-validation-bar').classList.add('hidden');
    document.getElementById('import-validation-bar').style.display = 'none';
    saveLocal();
    renderAll();
    toast('↩️ Import annulé : tout est comme avant');
    return;
  }
  const ids = JSON.parse(localStorage.getItem('lastImportIds') || '[]');
  const count = ids.length;
  dropOps(op => !ids.includes(op.id));
  localStorage.removeItem('lastImportIds');
  document.getElementById('import-validation-bar').classList.add('hidden');
  document.getElementById('import-validation-bar').style.display = 'none';
  saveLocal();
  renderAll();
  toast(`↩️ ${count} opérations retirées — vous pouvez modifier et réimporter`);

  // Rouvrir le modal à l'étape 3 (revue) si les données sont encore là
  if (parsedOps.length) {
    document.getElementById('modal-paste-import').classList.remove('hidden');
    document.getElementById('paste-step1').classList.add('hidden');
    document.getElementById('paste-step2').classList.add('hidden');
    renderPasteStep3();
  }
});

// ── IMPORT DU SITE BANCAIRE (une opération sur plusieurs lignes, avec sa date de prélèvement) ──
// Texte copié : [n° de carte] date, libellé, [date de prélèvement], montant, XPF, Débit / Crédit
function parseBankText(text) {
  const cells = String(text || '').split(/[\t\r\n]+/).map(c => c.trim()).filter(Boolean);
  const iso = c => { const m = /^(\d{2})[-/.](\d{2})[-/.](\d{4})$/.exec(c || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
  const ops = [];
  for (let i = 0; i < cells.length; i++) {
    const date = iso(cells[i]), label = cells[i + 1];
    if (!date || !label || iso(label)) continue;
    let j = i + 2;
    const debitDate = iso(cells[j]);
    if (debitDate) j++;
    if (!/^-?\d{1,3}(?:\s?\d{3})*(?:[.,]\d{1,2})?$/.test(cells[j] || '')) continue;
    const amount = Math.round(Math.abs(parseFloat(cells[j].replace(/\s/g, '').replace(',', '.'))));
    const tail = cells.slice(j + 1, j + 3);
    if (!amount || !tail.some(c => /^(xpf|f ?cfp|cfp|d[ée]bit|cr[ée]dit)$/i.test(c))) continue;
    const card = /\d\*+\d/.test(cells[i - 1] || '') ? cells[i - 1] : '';
    ops.push({ card, date, label: label.replace(/\s+/g, ' '), debitDate, amount, type: tail.some(c => /^cr[ée]dit$/i.test(c)) ? 'credit' : 'debit' });
    i = j;
  }
  return ops;
}
// La règle de la carte qui explique toutes les dates de prélèvement de la banque : jour d'arrêté et jour de prélèvement.
// null si les dates ne permettent pas de trancher.
function inferCardRule(bankOps) {
  const dated = bankOps.filter(o => o.debitDate);
  if (!dated.length) return null;
  const debitDay = +dated[0].debitDate.slice(8);
  if (dated.some(o => +o.debitDate.slice(8) !== debitDay)) return null;
  const days = [];
  for (let cut = 1; cut <= 28; cut++) if (dated.every(o => billingDebitDate(o.date, cut, 0, debitDay) === o.debitDate)) days.push(cut);
  return days.length === 1 ? { cut: days[0], debitDay } : null;
}
// Applique cette règle à la carte à partir du premier achat importé : ce qui précède (et que la banque ne confirme pas,
// une régularisation par exemple) ne change pas
function applyCardRule(acc, { cut, debitDay }, firstDate) {
  acc.previousCycleDay = acc.previousCycleDay || acc.billingCycleDay;
  acc.cardType = 'deferred';
  acc.billingCycleDay = cut;
  acc.billingDebitDay = debitDay;
  acc.debitRuleFrom = firstDate;
}
// Chaque ligne de la banque : déjà saisie (même montant, à 3 jours près), échéance programmée, ou nouvelle
function matchBankOps(bankOps, account) {
  const days = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;
  const real = appData.operations.filter(o => o.account === account && o.opType !== 'Programmee' && !isTransferOp(o));
  const used = new Set();
  const rows = bankOps.map(bank => ({ bank, status: 'new', match: null }));
  for (const tolerance of [0, 3]) {          // d'abord la même date, puis les dates voisines
    for (const r of rows) {
      if (r.match) continue;
      const words = plainText(r.bank.label).split(' ')[0];
      const found = real.filter(o => !used.has(o.id) && o.amount === r.bank.amount && o.type === r.bank.type && days(o.date, r.bank.date) <= tolerance)
        .sort((x, y) => days(x.date, r.bank.date) - days(y.date, r.bank.date) || plainText(y.label).includes(words) - plainText(x.label).includes(words))[0];
      if (found) { used.add(found.id); r.match = found; r.status = 'known'; }
    }
  }
  const taken = new Set();
  for (const r of rows.filter(x => x.status === 'new')) {
    const month = monthIndexOf(r.bank.date);
    const due = [month - 1, month, month + 1].flatMap(m => scheduledOpsInMonth(Math.floor(m / 12), m % 12, account)
      .map(o => ({ o, key: `${Math.floor(m / 12)}-${String(m % 12 + 1).padStart(2, '0')}` })))
      .find(({ o, key }) => !scheduledDest(o) && o.type === r.bank.type && o.amount === r.bank.amount && days(o.date, r.bank.date) <= 5 && !taken.has(o.id + key));
    if (due) { taken.add(due.o.id + due.key); r.status = 'scheduled'; r.match = due.o; r.monthKey = due.key; }
    else r.category = bankCategory(r.bank);
  }
  return rows;
}
// Catégorie habituelle du commerçant : même libellé, sinon mêmes premiers mots
function bankCategory(bank) {
  const same = findLabelHistory(bank.label, bank.type);
  if (same && same.category) return same.category;
  const start = plainText(bank.label).split(' ').slice(0, 2).join(' ');
  const near = appData.operations.filter(o => o.opType !== 'Programmee' && o.type === bank.type && !isUnclassified(o) && plainText(o.label).startsWith(start))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return near ? near.category : 'Autre';
}
function setBankDebit(op, debitDate) {
  if (!debitDate) return;
  delete op.billingShift;
  if (debitDate === autoDebitDate(op.account, op.date)) delete op.debitDate;
  else op.debitDate = debitDate;
}
// Enregistre les lignes retenues ; renvoie de quoi tout annuler
function applyBankImport(rows, account, rule) {
  const undo = { added: [], updated: [], passes: [], account: null };
  const acc = appData.accounts.find(a => a.name === account);
  if (rule && acc && rows.length) {
    const keys = ['cardType', 'billingCycleDay', 'billingDebitDay', 'previousCycleDay', 'debitRuleFrom'];
    undo.account = { name: account, values: Object.fromEntries(keys.map(k => [k, acc[k] === undefined ? null : acc[k]])) };
    applyCardRule(acc, rule, rows.map(r => r.bank.date).sort()[0]);
  }
  for (const r of rows) {
    const b = r.bank;
    if (r.status === 'known') {
      const op = appData.operations.find(o => o.id === r.match.id);
      if (!op) continue;
      undo.updated.push({ id: op.id, pointed: op.pointed || false, debitDate: op.debitDate || null, billingShift: op.billingShift || null });
      op.pointed = true;
      setBankDebit(op, b.debitDate);
      continue;
    }
    let op;
    if (r.status === 'scheduled') {
      const pass = passScheduled(r.match.id.replace(/_credit$/, ''), { monthKey: r.monthKey, date: b.date, amount: b.amount, type: b.type });
      if (!pass) continue;
      undo.passes.push(pass);
      op = appData.operations.find(o => o.id === pass.added[0]);
    } else {
      op = { id: uid(), date: b.date, label: b.label, amount: b.amount, type: b.type, account, category: r.category || 'Autre', opType: 'Operation' };
      appData.operations.push(op);
      undo.added.push(op.id);
    }
    if (op) { op.pointed = true; setBankDebit(op, b.debitDate); }
  }
  return undo;
}
function undoBankImport(undo) {
  if (undo.added.length) dropOps(o => !undo.added.includes(o.id));
  for (const pass of undo.passes) undoPass(pass);
  for (const u of undo.updated) {
    const op = appData.operations.find(o => o.id === u.id);
    if (!op) continue;
    for (const k of ['pointed', 'debitDate', 'billingShift']) if (u[k]) op[k] = u[k]; else delete op[k];
  }
  const acc = undo.account && appData.accounts.find(a => a.name === undo.account.name);
  if (acc) for (const [k, v] of Object.entries(undo.account.values)) if (v === null) delete acc[k]; else acc[k] = v;
}

// ── Écran de vérification ──
let bankState = null;   // { ops, rows, account, rule, excluded:Set }
function bankCards() {
  try { return JSON.parse(localStorage.getItem('finances_bank_cards') || '{}') || {}; } catch { return {}; }
}
function openBankReview(ops) {
  const names = getAccountNames();
  const known = bankCards()[ops[0].card];
  const card = appData.accounts.find(a => a.cardType === 'deferred');
  const account = names.includes(known) ? known : ops[0].card && card ? card.name : names[0];
  bankState = { ops };
  fillSelect(document.getElementById('bank-account'), names.map(n => [n, n]), account);
  ['paste-step1', 'paste-step2', 'paste-step3'].forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById('paste-bank').classList.remove('hidden');
  prepareBankReview();
}
function prepareBankReview() {
  const account = document.getElementById('bank-account').value;
  const acc = appData.accounts.find(a => a.name === account);
  const rule = acc && acc.cardType === 'deferred' ? inferCardRule(bankState.ops) : null;
  const differs = rule && (acc.billingCycleDay !== rule.cut || (acc.billingDebitDay || acc.billingCycleDay) !== rule.debitDay);
  bankState = { ops: bankState.ops, account, rule: differs ? rule : null, rows: matchBankOps(bankState.ops, account), excluded: new Set() };
  const wrap = document.getElementById('bank-rule-wrap');
  wrap.classList.toggle('hidden', !differs);
  if (differs) {
    document.getElementById('bank-rule').checked = true;
    const day = n => n === 1 ? '1er' : String(n);
    document.getElementById('bank-rule-text').textContent = `Régler la carte comme votre banque : achats arrêtés le ${day(rule.cut)}, prélevés le ${day(rule.debitDay)} (aujourd'hui : le ${day(acc.billingCycleDay)}). S'applique à partir du ${formatDate(bankState.ops.map(o => o.date).sort()[0])} ; ce qui précède ne change pas.`;
  }
  renderBankReview();
}
function renderBankReview() {
  const { rows, excluded } = bankState;
  const count = s => rows.filter(r => r.status === s).length;
  document.getElementById('bank-summary').textContent = [`${rows.length} opération${rows.length > 1 ? 's' : ''} reconnue${rows.length > 1 ? 's' : ''}`,
    count('known') && `${count('known')} déjà saisie${count('known') > 1 ? 's' : ''}`, count('scheduled') && `${count('scheduled')} échéance${count('scheduled') > 1 ? 's' : ''}`,
    count('new') && `${count('new')} nouvelle${count('new') > 1 ? 's' : ''}`].filter(Boolean).join(' · ');
  const categories = getAllCategoryOptions();
  document.getElementById('bank-list').innerHTML = rows.map((r, i) => {
    const b = r.bank;
    // la date ou le libellé saisis ne sont rappelés que s'ils diffèrent de ceux de la banque
    const differs = r.status === 'known' ? [r.match.date !== b.date && `le ${formatDate(r.match.date)}`, plainText(r.match.label) !== plainText(b.label) && `« ${esc(r.match.label)} »`].filter(Boolean).join(' ') : '';
    const state = r.status === 'known' ? `<span class="bank-tag known">✓ déjà saisie${differs ? ' ' + differs : ''} : sera pointée</span>`
      : r.status === 'scheduled' ? `<span class="bank-tag due">🔁 échéance « ${esc(r.match.label)} » : sera marquée passée</span>`
        : '<span class="bank-tag new">➕ nouvelle</span>';
    return `<div class="bank-row">
      <input type="checkbox" data-bank="${i}" aria-label="Importer cette ligne"${excluded.has(i) ? '' : ' checked'}/>
      <span class="bank-date">${b.date.slice(8)}/${b.date.slice(5, 7)}</span>
      <span class="bank-main"><b>${esc(b.label)}</b>${state}${b.debitDate ? `<small>prélevé le ${formatDate(b.debitDate)}</small>` : ''}</span>
      <span class="bank-amt ${b.type}">${b.type === 'credit' ? '+' : '-'}${fmt(b.amount)}</span>
      ${r.status === 'new' ? `<select data-bankcat="${i}" aria-label="Catégorie">${categories.replace(`value="${esc(r.category)}"`, m => m + ' selected')}</select>` : ''}
    </div>`;
  }).join('');
  const n = rows.length - excluded.size;
  const button = document.getElementById('bank-import');
  button.textContent = `✅ Valider ${n} ligne${n > 1 ? 's' : ''}`;
  button.disabled = !n;
}
document.getElementById('bank-account').addEventListener('change', prepareBankReview);
document.getElementById('bank-list').addEventListener('change', (e) => {
  const check = e.target.dataset.bank, cat = e.target.dataset.bankcat;
  if (check !== undefined) { e.target.checked ? bankState.excluded.delete(+check) : bankState.excluded.add(+check); renderBankReview(); }
  if (cat !== undefined) bankState.rows[+cat].category = e.target.value;
});
document.getElementById('bank-back').addEventListener('click', () => {
  document.getElementById('paste-bank').classList.add('hidden');
  document.getElementById('paste-step1').classList.remove('hidden');
  pasteBatches = [];
  updateBatchesDisplay();
});
document.getElementById('bank-import').addEventListener('click', () => {
  const { rows, excluded, account, rule, ops } = bankState;
  const kept = rows.filter((_, i) => !excluded.has(i));
  const useRule = rule && document.getElementById('bank-rule').checked ? rule : null;
  const undo = applyBankImport(kept, account, useRule);
  if (ops[0].card) try { localStorage.setItem('finances_bank_cards', JSON.stringify({ ...bankCards(), [ops[0].card]: account })); } catch { /* ignoré */ }
  setPref('lastImportUndo', JSON.stringify(undo));
  localStorage.removeItem('lastImportIds');
  saveLocal();
  renderAll();
  document.getElementById('modal-paste-import').classList.add('hidden');
  const added = undo.added.length + undo.passes.length;
  document.getElementById('import-bar-text').textContent = `⏳ ${account} : ${added} ajoutée${added > 1 ? 's' : ''}, ${undo.updated.length} pointée${undo.updated.length > 1 ? 's' : ''}, classées au mois de leur prélèvement — vérifiez puis validez ou annulez`;
  document.getElementById('import-validation-bar').classList.remove('hidden');
  document.getElementById('import-validation-bar').style.display = 'flex';
  // le mois où comptent la plupart des lignes (celui de leur prélèvement)
  const months = kept.map(r => (r.bank.debitDate || r.bank.date).slice(0, 7));
  const main = months.sort((a, b) => months.filter(m => m === b).length - months.filter(m => m === a).length || a.localeCompare(b))[0];
  document.getElementById('filter-account').value = account;
  if (main) { opsYear = +main.slice(0, 4); opsMonth = +main.slice(5, 7) - 1; }
  renderOperations();
  showTab('operations');
});

// ── POINTAGE ────────────────────────────────────────────────────────────────
window.togglePointed = function(id) {
  const op = appData.operations.find(o => o.id === id);
  if (!op) return;
  op.pointed = !op.pointed;
  saveLocal();
  renderOperations();
  renderDashboard();
};

// ── VIREMENTS : deux côtés (débit sur un compte, crédit sur l'autre), libellés « [autre compte] » ───────
function transferTarget(op) {
  const label = op.label || '';
  return label.length > 2 && label.startsWith('[') && label.endsWith(']') ? label.slice(1, -1) : null;
}
function isTransferLeg(op) {
  return op.opType !== 'Programmee' && transferTarget(op) !== null;
}
// L'autre côté d'un virement : même montant, comptes en miroir, sens opposé. La même date d'abord, sinon la plus
// proche (7 jours au plus). Un côté en double, ou dont le partenaire sert déjà à un autre, n'en a pas.
function findTransferPartner(op, ops, maxDays = 7) {
  const other = transferTarget(op);
  if (other === null || op.opType === 'Programmee') return null;
  const side = (account, target, type) => ops.filter(o => o.opType !== 'Programmee' && o.account === account
    && transferTarget(o) === target && o.type === type && o.amount === op.amount);
  const mine = side(op.account, other, op.type), theirs = side(other, op.account, op.type === 'debit' ? 'credit' : 'debit');
  const on = (list, date) => list.filter(o => o.date === date);
  const same = on(theirs, op.date);
  if (same.length) return same.length >= on(mine, op.date).length ? same[0] : null;
  const days = o => Math.abs(Date.parse(o.date) - Date.parse(op.date)) / 86400000;
  const others = mine.filter(o => o.id !== op.id);
  return theirs.filter(o => days(o) <= maxDays && on(theirs, o.date).length > on(others, o.date).length)
    .sort((a, b) => days(a) - days(b))[0] || null;
}
// Reporte la modification sur les deux côtés. Modifier un virement ne crée jamais d'opération : seule la conversion
// d'une opération simple en virement crée l'autre côté. Renvoie { created }, { alone: true } ou {}.
function applyTransferEdit(op, partner, converting, { date, amount, from, to, comment }) {
  const role = !converting ? op.type : op.account === to ? 'credit' : op.account === from ? 'debit' : op.type;
  const otherRole = role === 'debit' ? 'credit' : 'debit';
  const dateChanged = date !== op.date, commentChanged = (comment || '') !== (op.comment || '');
  const leg = r => ({ date, amount, account: r === 'debit' ? from : to, label: `[${r === 'debit' ? to : from}]`, type: r, category: 'Virement', opType: 'Virement', comment, debitDate: undefined, billingShift: undefined });
  Object.assign(op, leg(role));
  if (partner) {
    Object.assign(partner, leg(otherRole), { date: dateChanged ? date : partner.date, comment: commentChanged ? comment : partner.comment });
    return {};
  }
  return converting ? { created: { id: uid(), ...leg(otherRole) } } : { alone: true };
}

// ── MODIFICATION OPÉRATION ───────────────────────────────────────────────────
let _editOpId = null;
let _editOpDate = null; // date de l'occurrence cliquée

window.editOp = function(id, occurrenceDate) {
  // le côté « crédit » d'un virement programmé porte un identifiant dérivé : on ouvre son modèle
  const op = appData.operations.find(o => o.id === id) || appData.operations.find(o => o.id + '_credit' === id);
  if (!op) return;
  _editOpId = op.id;
  _editOpDate = occurrenceDate || op.nextPayment || op.date;
  // une échéance ne commence jamais avant son départ (la liste montre parfois son ancienne date)
  if (op.opType === 'Programmee' && _editOpDate < (op.nextPayment || op.date)) _editOpDate = op.nextPayment || op.date;

  // Si c'est une opération programmée, demander le scope
  if (op.opType === 'Programmee') {
    document.getElementById('modal-edit-scope').classList.remove('hidden');
    return;
  }
  openEditModal(op);
};

function openEditModal(op) {
  const names = getAccountNames();
  const opts = names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  document.getElementById('edit-op-account').innerHTML = opts;
  document.getElementById('edit-op-dest').innerHTML = opts;
  document.getElementById('edit-op-date').value     = op.date;
  document.getElementById('edit-op-label').value    = op.label;
  document.getElementById('edit-op-amount').value   = op.amount;
  document.getElementById('edit-op-comment').value  = op.comment || '';
  const isVir = op.opType === 'Virement' || (op.label && op.label.match(/^\[.+\]$/));
  document.getElementById('edit-op-type').value     = isVir ? 'virement' : op.type;
  document.getElementById('edit-op-account').value  = op.account;
  setSelectValue(document.getElementById('edit-op-category'), op.category || 'Autre');
  toggleEditDest();
  const target = transferTarget(op);
  if (isVir && target !== null) {            // « Compte » = d'où part l'argent, quel que soit le côté touché
    const credit = op.type === 'credit';
    document.getElementById('edit-op-account').value = credit ? target : op.account;
    document.getElementById('edit-op-dest').value = credit ? op.account : target;
  }
  setDebitField('edit-op-debit', chosenDebitDate(op));   // toujours remis : jamais le choix de l'opération ouverte avant
  refreshEditDebit();
  document.getElementById('modal-edit-op').classList.remove('hidden');
}

// Handlers pour le choix de scope (programmée)
document.getElementById('btn-scope-cancel').addEventListener('click', () => {
  document.getElementById('modal-edit-scope').classList.add('hidden');
  _editOpId = null;
});

document.getElementById('btn-scope-all').addEventListener('click', () => {
  document.getElementById('modal-edit-scope').classList.add('hidden');
  const op = appData.operations.find(o => o.id === _editOpId);
  if (!op) return;
  openEditModal(op);
  // la date affichée est celle de l'échéance touchée (et non la date de départ) : la nouvelle série commence là
  document.getElementById('edit-op-date').value = _editOpDate;
});

document.getElementById('btn-scope-one').addEventListener('click', () => {
  document.getElementById('modal-edit-scope').classList.add('hidden');
  const op = appData.operations.find(o => o.id === _editOpId);
  if (!op) return;

  // Créer une copie modifiable pour cette occurrence
  const newOp = {
    id: uid(),
    date: _editOpDate,
    label: op.label,
    amount: op.amount,
    type: op.type,
    account: op.account,
    category: op.category || 'Autre',
    opType: 'Operation',
    comment: op.comment,
  };
  appData.operations.push(newOp);

  // Si c'est un virement, créer aussi le crédit
  const destMatch = op.label && op.label.match(/^\[(.+)\]$/);
  const dest = op.virementDest || (destMatch ? destMatch[1] : null);
  if (dest) {
    appData.operations.push({
      id: uid(),
      date: _editOpDate,
      label: `[${op.account}]`,
      amount: op.amount,
      type: 'credit',
      account: dest,
      category: 'Virement',
      opType: 'Virement',
      comment: op.comment,
    });
    newOp.opType = 'Virement';
  }

  // Ajouter une exception sur l'op programmée pour ce mois
  if (!op.exceptions) op.exceptions = [];
  const exMonth = _editOpDate.substring(0, 7); // "2026-08"
  if (!op.exceptions.includes(exMonth)) op.exceptions.push(exMonth);

  saveLocal();
  renderAll();

  // Ouvrir le modal sur la nouvelle opération pour la modifier
  _editOpId = newOp.id;
  openEditModal(newOp);
});

function toggleEditDest() {
  const isVirement = document.getElementById('edit-op-type').value === 'virement';
  document.getElementById('edit-op-dest-wrap').classList.toggle('hidden', !isVirement);
  if (isVirement) {
    const catSel = document.getElementById('edit-op-category');
    if (!catSel.querySelector('option[value="Virement"]')) {
      catSel.innerHTML += '<option value="Virement">Virement</option>';
    }
    catSel.value = 'Virement';
  }
}
document.getElementById('edit-op-type').addEventListener('change', toggleEditDest);
for (const id of ['edit-op-type', 'edit-op-account', 'edit-op-date']) document.getElementById(id).addEventListener('change', refreshEditDebit);
for (const id of ['inp-account-name', 'inp-date']) document.getElementById(id).addEventListener('change', refreshEntryDebit);
// une date saisie à la main est gardée ; un champ vidé reprend la règle automatique
for (const [id, refresh] of [['inp-debit', refreshEntryDebit], ['edit-op-debit', refreshEditDebit]]) {
  document.getElementById(id).addEventListener('change', e => {
    if (e.target.value) e.target.dataset.manual = '1';
    else { delete e.target.dataset.manual; refresh(); }
  });
}

document.getElementById('edit-op-cancel').addEventListener('click', () => {
  document.getElementById('modal-edit-op').classList.add('hidden');
  _editOpId = null;
});

document.getElementById('edit-op-confirm').addEventListener('click', () => {
  let op = appData.operations.find(o => o.id === _editOpId);
  if (!op) return;
  const typeVal = document.getElementById('edit-op-type').value;
  const date    = document.getElementById('edit-op-date').value;
  const label   = document.getElementById('edit-op-label').value.trim();
  const amount  = parseAmount(document.getElementById('edit-op-amount').value);
  const account = document.getElementById('edit-op-account').value;
  const category = document.getElementById('edit-op-category').value;
  const comment = cleanComment(document.getElementById('edit-op-comment').value);
  if (amount === null) { toast('⚠️ Montant invalide (nombre supérieur à 0)'); return; }
  if (!date) { toast('⚠️ Date requise'); return; }

  const isScheduled = op.opType === 'Programmee';

  // "Toutes les occurrences futures" : les échéances déjà passées (mois antérieur
  // à celui édité) gardent leurs anciennes valeurs — on scinde le modèle en deux :
  // l'ancien s'arrête à la fin du mois précédent (valeurs inchangées), un nouveau
  // modèle reprend à partir du mois édité avec les nouvelles valeurs.
  if (isScheduled && _editOpDate) {
    const baseDate = op.nextPayment || op.date;
    const baseMonth = baseDate.substring(0, 7);
    const editMonth = _editOpDate.substring(0, 7);
    // l'ancien modèle s'arrête avant ce mois ; le nouveau garde la date de fin et les mois déjà remplacés ; la suite modifie le nouveau
    if (editMonth > baseMonth) {
      if (date.slice(0, 7) < editMonth) { toast('⚠️ Choisissez une date à partir du mois de cette échéance : les mois passés ne sont pas modifiés', 5000); return; }
      op = splitScheduled(op, _editOpDate, {});
    }
  }

  if (typeVal === 'virement' && isScheduled) {
    // Modèle programmé : les deux jambes (débit/crédit) sont générées à la volée
    // par scheduledOpsInMonth à partir de ce seul modèle — on ne touche PAS à
    // opType (doit rester 'Programmee') et on ne crée/cherche aucune opération
    // stockée pour le crédit, sinon le modèle sort du calendrier récurrent.
    const dest = document.getElementById('edit-op-dest').value;
    if (account === dest) { toast('⚠️ Source et destination identiques'); return; }
    op.date = date;
    op.label = `[${dest}]`;
    op.virementDest = dest;
    op.amount = amount;
    op.type = 'debit';
    op.account = account;
    op.category = 'Virement';
    op.comment = comment;
    toast(`✅ Virement programmé modifié : ${account} → ${dest}`);
  } else if (typeVal === 'virement') {
    const dest = document.getElementById('edit-op-dest').value;
    if (account === dest) { toast('⚠️ Source et destination identiques'); return; }
    const converting = !isTransferLeg(op) && op.opType !== 'Virement';
    const partner = converting ? null : findTransferPartner(op, appData.operations);
    const result = applyTransferEdit(op, partner, converting, { date, amount, from: account, to: dest, comment });
    if (result.created) appData.operations.push(result.created);
    if (result.alone) toast(`⚠️ Seul le côté « ${op.account} » est modifié : l'autre côté de ce virement est introuvable`, 7000);
    else toast(result.created ? `✅ Converti en virement : ${account} → ${dest}` : `✅ Virement modifié : ${account} → ${dest}`);
  } else {
    const partner = !isScheduled && isTransferLeg(op) ? findTransferPartner(op, appData.operations) : null;   // avant modification
    op.date     = date;
    op.label    = label;
    op.amount   = amount;
    op.type     = typeVal;
    op.account  = account;
    op.category = category;
    op.comment = comment;
    op.debitDate = debitDateOf('edit-op-debit', account, date);
    op.billingShift = undefined;
    if (isScheduled) delete op.virementDest; // au cas où le modèle était un virement avant
    if (partner) toast(`✅ Modifiée. Ce n'est plus un virement : l'autre côté reste sur « ${partner.account} », supprimez-le si besoin`, 7000);
    else toast('✅ Opération modifiée');
  }

  if (isScheduled) op.nextPayment = date;

  saveLocal();
  // Conserver le compte et le mois actif
  const currentFilter = document.getElementById('filter-account').value;
  renderAll();
  if (currentFilter) {
    document.getElementById('filter-account').value = currentFilter;
    renderOperations();
  }
  document.getElementById('modal-edit-op').classList.add('hidden');
  _editOpId = null;
});

document.getElementById('edit-op-delete').addEventListener('click', () => {
  const op = appData.operations.find(o => o.id === _editOpId);
  if (!op) return;
  const partner = isTransferLeg(op) ? findTransferPartner(op, appData.operations) : null;
  const question = partner
    ? `Supprimer ce virement de ${fmt(op.amount)} ? Les deux côtés seront supprimés (${op.account} et ${partner.account}).`
    : 'Supprimer cette opération ?';
  if (!confirm(question)) return;
  const ids = [op.id, partner && partner.id];
  dropOps(o => !ids.includes(o.id));
  saveLocal();
  renderAll();
  document.getElementById('modal-edit-op').classList.add('hidden');
  _editOpId = null;
  toast(partner ? '🗑 Virement supprimé (les deux côtés)' : '🗑 Opération supprimée');
  if (accessToken) uploadToDrive().catch(() => {});
});

// ── DÉCONNEXION ──────────────────────────────────────────────────────────────
document.getElementById('btn-logout').addEventListener('click', () => {
  if (accessToken) google.accounts.oauth2.revoke(accessToken, () => {});
  accessToken = null;
  driveFileId = null;
  localStorage.removeItem('gToken'); localStorage.removeItem('gTokenExp');
  updateConnBadge();
  showScreen('screen-login');
  toast('Déconnecté');
});

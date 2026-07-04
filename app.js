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
const today = () => new Date().toISOString().split('T')[0];
const uid   = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function toast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
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
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.querySelector(`[data-tab="${name}"]`).classList.add('active');
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
    // Initialiser Google et sync silencieuse
    if (typeof google !== 'undefined' && google.accounts && !tokenClient) initGoogleAuth();
    const saved = localStorage.getItem('gToken');
    if (saved && tokenClient) {
      accessToken = saved;
      syncFromDrive().catch(() => { accessToken = null; });
    }
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
  localStorage.setItem('finances_pwd', hash);
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
// touch=true (défaut) → horodate la version des données (modification utilisateur)
// touch=false → conserve l'horodatage existant (ex: après téléchargement depuis Drive)
function saveLocal(touch = true) {
  if (touch) {
    const now = new Date();
    appData.lastSync = now.toISOString();
    appData.lastSyncLocal = now.toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' });
  }
  localStorage.setItem('finances_data', JSON.stringify(appData));
  // Auto-upload vers Drive si connecté (silencieux, pas de popup)
  if (touch && accessToken) uploadToDrive().catch(() => {});
}
function loadLocal() {
  const raw = localStorage.getItem('finances_data');
  if (raw) { try { appData = JSON.parse(raw); return true; } catch {} }
  return false;
}

// ── GOOGLE AUTH ──────────────────────────────────────────────────────────────
function initGoogleAuth() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: onTokenReceived,
  });
}
let unlocked = false;
function onTokenReceived(resp) {
  if (resp.error) return;
  accessToken = resp.access_token;
  localStorage.setItem('gToken', accessToken);
  syncFromDrive();
}
document.getElementById('btn-login').addEventListener('click', () => {
  if (!tokenClient) { toast('Google API pas encore chargée, patientez…'); return; }
  tokenClient.requestAccessToken({ prompt: '' });
});

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
    writeBackupToDir();
  }
});

// Re-synchronise automatiquement quand la connexion revient
window.addEventListener('online', () => {
  toast('🌐 Connexion rétablie');
  if (accessToken) syncFromDrive();
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

  if (locked) return;
  // Initialiser Google et tenter une sync silencieuse avec le token sauvegardé
  const waitGoogle = setInterval(() => {
    if (typeof google !== 'undefined' && google.accounts) {
      clearInterval(waitGoogle);
      initGoogleAuth();
      const saved = localStorage.getItem('gToken');
      if (saved) {
        accessToken = saved;
        syncFromDrive().catch(() => { accessToken = null; });
      }
    }
  }, 200);
});

// ── GOOGLE DRIVE ─────────────────────────────────────────────────────────────
async function driveRequest(method, url, body = null) {
  const opts = { method, headers: { Authorization: 'Bearer ' + accessToken } };
  if (body !== null) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (res.status === 401) { accessToken = null; localStorage.removeItem('gToken'); throw new Error('Token expiré — resynchronisez depuis Paramètres'); }
  return res;
}
async function findOrCreateFile() {
  const search = await driveRequest('GET',
    `https://www.googleapis.com/drive/v3/files?q=name='${FILE_NAME}'+and+trashed=false&fields=files(id,name)`);
  const { files } = await search.json();
  if (files && files.length > 0) { driveFileId = files[0].id; return; }
  const meta = await driveRequest('POST', 'https://www.googleapis.com/drive/v3/files',
    { name: FILE_NAME, mimeType: 'application/json' });
  const { id } = await meta.json();
  driveFileId = id;
}
async function downloadFromDrive() {
  if (!driveFileId) await findOrCreateFile();
  const res = await driveRequest('GET',
    `https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`);
  if (res.status === 404) return null;
  const text = await res.text();
  if (!text || text.trim() === '') return null;
  return JSON.parse(text);
}
async function uploadToDrive() {
  if (!driveFileId) await findOrCreateFile();
  // On envoie appData tel quel — son horodatage = date de dernière modification.
  await fetch(`https://www.googleapis.com/upload/drive/v3/files/${driveFileId}?uploadType=media`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(appData, null, 2),
  });
  localStorage.setItem('finances_lastdrive', new Date().toISOString());
  updateSyncStatus();
}
async function syncFromDrive() {
  document.getElementById('sync-status').textContent = '⏳ Synchronisation…';
  try {
    const remote = await downloadFromDrive();
    if (remote) {
      const localTime = appData.lastSync ? new Date(appData.lastSync).getTime() : 0;
      const remoteTime = remote.lastSync ? new Date(remote.lastSync).getTime() : 0;
      if (remoteTime > localTime || !appData.operations.length) {
        appData = remote;
        saveLocal(false);
        toast('✅ Données récupérées depuis Drive');
      } else if (localTime > remoteTime) {
        await uploadToDrive();
        toast('✅ Modifications locales envoyées vers Drive');
      } else {
        // Mêmes données, rien à faire
      }
    } else {
      await uploadToDrive();
      toast('✅ Données envoyées vers Drive');
    }
    if (appData.pwdHash) localStorage.setItem('finances_pwd', appData.pwdHash);
    if (getPwdHash() && !unlocked) {
      checkLockScreen();
      return;
    }
    renderAll();
    showScreen('screen-main');
    updateSyncStatus();
  } catch (e) {
    console.warn('Sync erreur:', e.message);
    // Ne pas afficher l'erreur dans le bandeau bleu si on a des données locales
    if (appData.lastSync) {
      updateSyncStatus();
    } else {
      document.getElementById('sync-status').textContent = 'Non synchronisé';
    }
  }
}
function updateSyncStatus() {
  const el = document.getElementById('sync-status');
  const ls = document.getElementById('display-lastsync');
  if (appData.lastSync) {
    const str = appData.lastSyncLocal || new Date(appData.lastSync).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' });
    const online = navigator.onLine ? '' : ' (hors ligne)';
    el.textContent = '📊 Données du ' + str + online;
    if (ls) ls.textContent = str;
  }
}

// ── CALCULS ──────────────────────────────────────────────────────────────────
const CAT_ICONS = {
  Alimentation:'🛒', Transport:'🚗', Sante:'💊', Loisirs:'🎉',
  Logement:'🏠', Telecom:'📱', Revenus:'💰', Autre:'📦',
};

function calcAccountBalance(accountName, maxDate) {
  if (maxDate) {
    // Cas avec date précise (ex: impression, historique) : calcul direct sans ops programmées
    const acc = appData.accounts.find(a => a.name === accountName);
    const initial = acc ? (acc.initialBalance || 0) : 0;
    const ops = appData.operations.filter(op =>
      (!accountName || op.account === accountName) &&
      op.opType !== 'Programmee' &&
      op.date <= maxDate
    );
    return initial + ops.reduce((sum, op) =>
      op.type === 'credit' ? sum + op.amount : sum - op.amount, 0);
  }
  // Cas par défaut : solde de fin de mois courant, cohérent avec la vue Opérations
  const now = new Date();
  return calcBalanceEndOfMonth(accountName, now.getFullYear(), now.getMonth());
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

function calcBillingBalance(accountName, refDate) {
  const acc = appData.accounts.find(a => a.name === accountName);
  if (!acc || acc.cardType !== 'deferred') return null;
  const d = refDate || new Date();
  const cycleStart = getBillingCycleStart(acc.billingCycleDay, d);
  const startStr = localDateStr(cycleStart);
  const endStr = localDateStr(d);

  const ops = appData.operations.filter(op =>
    op.account === accountName &&
    op.opType !== 'Programmee' &&
    op.opType !== 'Virement' &&
    !(op.label && op.label.match(/^\[.+\]$/)) &&
    op.date >= startStr && op.date <= endStr
  );
  return ops.reduce((sum, op) =>
    op.type === 'debit' ? sum + op.amount : sum - op.amount, 0);
}

function getBillingInfo(accountName) {
  const acc = appData.accounts.find(a => a.name === accountName);
  if (!acc || acc.cardType !== 'deferred') return { period: '', detail: '' };
  const d = new Date();
  const cycleStart = getBillingCycleStart(acc.billingCycleDay, d);
  const startStr = localDateStr(cycleStart);
  const endStr = localDateStr(d);

  const ops = appData.operations.filter(op =>
    op.account === accountName &&
    op.opType !== 'Programmee' &&
    op.opType !== 'Virement' &&
    !(op.label && op.label.match(/^\[.+\]$/)) &&
    op.date >= startStr && op.date <= endStr
  );

  const startFmt = cycleStart.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  const endFmt = d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  const period = `${startFmt} → ${endFmt}`;
  const detail = ops.map(op => {
    const sign = op.type === 'credit' ? '+' : '-';
    return `${op.date.substring(8,10)}/${op.date.substring(5,7)} ${sign}${op.amount} ${op.label}`;
  }).join(' | ');
  return { period, detail: ops.length + ' ops : ' + detail };
}

function calcEncours(accountName, refDate) {
  const acc = appData.accounts.find(a => a.name === accountName);
  if (!acc || acc.cardType !== 'deferred') return null;
  const d = refDate || new Date();
  const cutoff = new Date(d);
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = localDateStr(cutoff);
  const endStr = localDateStr(d);

  const ops = appData.operations.filter(op =>
    op.account === accountName &&
    op.opType !== 'Programmee' &&
    op.opType !== 'Virement' &&
    !(op.label && op.label.match(/^\[.+\]$/)) &&
    op.type === 'debit' &&
    op.date >= cutoffStr && op.date <= endStr
  );
  return ops.reduce((sum, op) => sum + op.amount, 0);
}

function getAccountNames() {
  if (appData.accounts && appData.accounts.length > 0) {
    return appData.accounts.map(a => a.name).filter(n => n !== 'Mon compte');
  }
  return [...new Set(appData.operations.map(op => op.account).filter(Boolean))];
}

// ── RENDU ────────────────────────────────────────────────────────────────────
function calcTotalBalance() {
  const names = getAccountNames();
  if (names.length > 0) {
    return names
      .filter(n => { const a = appData.accounts.find(x => x.name === n); return !a || a.includeInTotal !== false; })
      .reduce((sum, n) => sum + calcAccountBalance(n), 0);
  }
  return calcAccountBalance('');
}

let dashboardBalanceDate = null; // null = aujourd'hui (fin du mois courant)

function calcBalanceAsOf(accountName, dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return calcBalanceAtDate(accountName, y, m - 1, d);
}

function calcDashboardBalance(name) {
  if (dashboardBalanceDate) return calcBalanceAsOf(name, dashboardBalanceDate);
  return calcAccountBalance(name);
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

function renderDashboard() {
  document.getElementById('display-balance').textContent = fmt(calcDashboardTotalBalance());
  const dateLabel = document.getElementById('balance-date-label');
  if (dashboardBalanceDate) {
    const d = new Date(dashboardBalanceDate + 'T00:00:00');
    dateLabel.textContent = `(au ${d.toLocaleDateString('fr-FR')})`;
  } else {
    dateLabel.textContent = '';
  }

  const accNames = getAccountNames();
  const listAcc = document.getElementById('list-accounts');
  if (!accNames.length) {
    listAcc.innerHTML = '<li class="empty-state">Aucun compte</li>';
  } else {
    listAcc.innerHTML = accNames.map(name => {
      const bal = calcDashboardBalance(name);
      const cls = bal >= 0 ? 'credit' : 'debit';
      const ops = appData.operations.filter(op => op.account === name).length;
      const acc = appData.accounts.find(a => a.name === name);
      const isDeferred = acc && acc.cardType === 'deferred';

      let extraHtml = '';
      if (isDeferred) {
        const billing = calcBillingBalance(name);
        const billingInfo = getBillingInfo(name);
        const encours = calcEncours(name);
        const limit = acc.cardLimit || 0;
        const remaining = limit - encours;
        const pct = limit ? Math.round((encours / limit) * 100) : 0;
        const barCol = pct > 80 ? 'var(--danger)' : pct > 50 ? '#ef9f27' : 'var(--accent)';
        extraHtml = `
          <div style="width:100%;margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:0.78rem;display:flex;flex-direction:column;gap:6px">
            <div style="display:flex;justify-content:space-between">
              <span style="color:var(--muted)">Prélèvement (${billingInfo.period})</span>
              <span style="font-weight:700;color:var(--danger)">${fmt(billing)}</span>
            </div>
            <div style="font-size:0.7rem;color:var(--muted)">${billingInfo.detail}</div>
            <div style="display:flex;justify-content:space-between">
              <span style="color:var(--muted)">Encours informatique (30j)</span>
              <span style="font-weight:700;color:var(--primary)">${fmt(encours)}</span>
            </div>
            ${limit ? `<div>
              <div style="display:flex;justify-content:space-between;margin-bottom:3px">
                <span style="color:var(--muted)">Plafond restant</span>
                <span style="font-weight:600;color:${barCol}">${fmt(remaining)} / ${fmt(limit)}</span>
              </div>
              <div style="background:var(--border);border-radius:4px;height:6px;overflow:hidden">
                <div style="width:${pct}%;height:100%;background:${barCol};border-radius:4px"></div>
              </div>
            </div>` : ''}
          </div>`;
      }

      return `<li class="account-item" onclick="filterByAccount('${name.replace(/'/g,"\\'")}')">
        <span class="acc-icon">${isDeferred ? '💳' : '🏦'}</span>
        <div class="op-info" style="flex:1">
          <div class="op-label">${name}</div>
          <div class="op-meta">${ops} opérations${(appData.alerts && appData.alerts[name] !== undefined && bal < appData.alerts[name]) ? ' · ⚠️ sous le seuil' : ''}</div>
        </div>
        <span class="op-amount ${cls}">${fmt(bal)}</span>
        ${extraHtml}
      </li>`;
    }).join('');
  }

  const sorted = [...appData.operations].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15);
  const listRec = document.getElementById('list-recent');
  if (!sorted.length) {
    listRec.innerHTML = '<li class="empty-state">Aucune opération</li>';
  } else {
    listRec.innerHTML = sorted.map(op => opHtml(op)).join('');
  }
}

let opsMonth = new Date().getMonth();
let opsYear  = new Date().getFullYear();
let opsSortAsc = true; // true = croissant (ancien→récent), false = décroissant

function renderOperations() {
  const accFilter  = document.getElementById('filter-account').value;
  const typeFilter = document.getElementById('filter-type').value;
  const catFilter  = document.getElementById('filter-category').value;
  const search     = document.getElementById('filter-search').value.trim().toLowerCase();
  const amountMin = parseInt(document.getElementById('filter-amount-min').value) || 0;
  const amountMax = parseInt(document.getElementById('filter-amount-max').value) || 0;
  const dateFrom   = document.getElementById('filter-date-from').value;
  const dateTo     = document.getElementById('filter-date-to').value;

  const monthNav = document.getElementById('ops-month-nav');
  const useMonthView = !!accFilter && !search && !amountMin && !amountMax && !dateFrom && !dateTo && !typeFilter && !catFilter;

  if (useMonthView) {
    monthNav.style.display = 'flex';
    monthNav.classList.remove('hidden');
    const monthLabel = new Date(opsYear, opsMonth, 1)
      .toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    document.getElementById('ops-month-label').textContent =
      monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
  } else {
    monthNav.style.display = 'none';
  }

  let ops = [...appData.operations].sort((a, b) => a.date.localeCompare(b.date));
  if (accFilter)  ops = ops.filter(op => op.account === accFilter);
  if (typeFilter) ops = ops.filter(op => op.type === typeFilter);
  if (catFilter)  ops = ops.filter(op => op.category === catFilter || (op.category && op.category.startsWith(catFilter + '/')));
  if (search)     ops = ops.filter(op => op.label.toLowerCase().includes(search));
  if (amountMin && amountMax) ops = ops.filter(op => op.amount >= amountMin && op.amount <= amountMax);
  else if (amountMin) ops = ops.filter(op => op.amount >= amountMin);
  else if (amountMax) ops = ops.filter(op => op.amount <= amountMax);

  if (useMonthView) {
    // Solde de fin de mois = calcul direct (même fonction que la projection)
    const endOfMonthBal = calcBalanceEndOfMonth(accFilter, opsYear, opsMonth);
    // Opérations du mois
    const monthOps = getMonthOps(accFilter, opsYear, opsMonth);
    // Solde de début = solde fin - delta des ops du mois
    const monthDelta = monthOps.reduce((s, op) =>
      op.type === 'credit' ? s + op.amount : s - op.amount, 0);
    const balanceStart = endOfMonthBal - monthDelta;

    // Afficher solde début de mois
    const fmtN = v => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(v);
    document.getElementById('ops-month-balance').textContent =
      `Solde début de mois : ${fmtN(balanceStart)} F`;

    const title = accFilter;
    document.getElementById('ops-title').textContent = title + ` (${monthOps.length})`;

    const list = document.getElementById('list-operations');
    if (!monthOps.length) {
      list.innerHTML = '<li class="empty-state">Aucune opération ce mois</li>';
      return;
    }

    // Calculer le solde cumulé dans l'ordre croissant (toujours)
    let running = balanceStart;
    const opsWithBalance = monthOps.map(op => {
      const delta = op.type === 'credit' ? op.amount : -op.amount;
      running += delta;
      return { op, balance: running };
    });

    // Afficher dans l'ordre choisi
    const displayOps = opsSortAsc ? opsWithBalance : [...opsWithBalance].reverse();

    list.innerHTML = displayOps.map(({ op, balance }) => {
      const sign = op.type === 'credit' ? '+' : '-';
      const balCol = balance >= 0 ? 'var(--accent)' : 'var(--danger)';
      const pointed = op.pointed ? 'opacity:0.5;' : '';
      const checkIcon = op.pointed ? '✅' : '⬜';
      const isProgrammee = op.opType === 'Programmee';
      return `<li style="flex-direction:column;align-items:stretch;gap:6px;padding:12px 16px;cursor:pointer;${pointed}" onclick="editOp('${op.id}','${op.date}')">
        <div style="display:flex;align-items:center;gap:12px">
          ${isProgrammee ? '<span class="op-icon">🔁</span>' : `<span class="op-check" onclick="event.stopPropagation();togglePointed('${op.id}')" style="font-size:1.1rem;cursor:pointer;padding:4px">${checkIcon}</span>`}
          <div class="op-info">
            <div class="op-label">${op.label}</div>
            <div class="op-meta">${formatDate(op.date)} · ${op.category || ''}${isProgrammee ? ' · programmée' : ''}${op.pointed ? ' · ✓ pointée' : ''}</div>
          </div>
          <span class="op-amount ${op.type}">${sign}${fmt(op.amount)}</span>
        </div>
        <div style="text-align:right;font-size:0.78rem;color:${balCol};font-weight:600;border-top:1px solid var(--border);padding-top:5px">
          Solde : ${fmtN(balance)} F
        </div>
      </li>`;
    }).join('');
    return;
  }

  // Vue normale sans filtre de mois
  ops = ops.reverse(); // tri décroissant
  if (dateFrom) ops = ops.filter(op => op.date >= dateFrom);
  if (dateTo)   ops = ops.filter(op => op.date <= dateTo);

  const title = accFilter ? accFilter : 'Toutes les opérations';
  document.getElementById('ops-title').textContent = title + ` (${ops.length})`;

  const list = document.getElementById('list-operations');
  if (!ops.length) { list.innerHTML = '<li class="empty-state">Aucune opération</li>'; return; }
  list.innerHTML = ops.map(op => opHtml(op, !accFilter)).join('');
}

function opHtml(op, showAccount = false) {
  const sign = op.type === 'credit' ? '+' : '-';
  const meta = showAccount
    ? `${formatDate(op.date)} · ${op.account || ''} · ${op.category}`
    : `${formatDate(op.date)} · ${op.category}`;
  const pointed = op.pointed ? 'opacity:0.5;' : '';
  const checkIcon = op.pointed ? '✅' : '⬜';
  return `<li style="cursor:pointer;${pointed}" onclick="editOp('${op.id}','${op.date}')">
    <span class="op-check" onclick="event.stopPropagation();togglePointed('${op.id}')" style="font-size:1.1rem;cursor:pointer;padding:4px">${checkIcon}</span>
    <div class="op-info">
      <div class="op-label">${op.label}</div>
      <div class="op-meta">${meta}</div>
    </div>
    <span class="op-amount ${op.type}">${sign}${fmt(op.amount)}</span>
  </li>`;
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function populateAccountFilters() {
  const names = getAccountNames();
  const opts = names.map(n => `<option value="${n}">${n}</option>`).join('');
  const allOpt = '<option value="">Tous les comptes</option>';
  document.getElementById('filter-account').innerHTML = allOpt + opts;
  document.getElementById('proj-account').innerHTML = allOpt + opts;
  document.getElementById('stats-account').innerHTML = allOpt + opts;
  document.getElementById('inp-account-name').innerHTML = opts || '<option value="courant">courant</option>';
}

function renderAll() {
  renderDashboard();
  renderStats();
  renderOperations();
  renderScheduled();
  populateAccountFilters();
  document.getElementById('display-email').textContent = localStorage.getItem('userEmail') || '—';
  updateSyncStatus();
  renderBackupList();
  renderAccountsConfig();
  renderSubcategoriesConfig();
  renderBudgetsConfig();
  renderAlertsConfig();
  populateExportAccount();
  updateCategorySelects();
  updatePwdStatus();
  populateTotalAccountsConfig();
  populateCardConfig();
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
  const picker = document.getElementById('balance-date-picker');
  if (picker && !picker.value) picker.value = today();
}
document.getElementById('form-expense').addEventListener('submit', async (e) => {
  e.preventDefault();
  const accountName = document.getElementById('inp-account-name').value;
  const op = {
    id: uid(),
    date: document.getElementById('inp-date').value,
    label: document.getElementById('inp-label').value.trim(),
    amount: parseInt(document.getElementById('inp-amount').value, 10),
    category: document.getElementById('inp-category').value,
    type: document.getElementById('inp-type').value,
    account: accountName,
    accountId: 0,
  };
  appData.operations.push(op);
  saveLocal();
  renderAll();
  const fb = document.getElementById('save-feedback');
  fb.classList.remove('hidden');
  setTimeout(() => fb.classList.add('hidden'), 2000);
  e.target.reset();
  setDefaultDate();
  if (accessToken) uploadToDrive().catch(err => toast('⚠️ ' + err.message));
});

// ── TOGGLE DÉPENSE / VIREMENT ────────────────────────────────────────────────
document.getElementById('btn-mode-expense').addEventListener('click', () => {
  document.getElementById('form-expense').classList.remove('hidden');
  document.getElementById('form-transfer').classList.add('hidden');
  document.getElementById('btn-mode-expense').style.background = 'var(--primary)';
  document.getElementById('btn-mode-expense').style.color = 'white';
  document.getElementById('btn-mode-transfer').style.background = 'var(--bg)';
  document.getElementById('btn-mode-transfer').style.color = 'var(--text)';
});

document.getElementById('btn-mode-transfer').addEventListener('click', () => {
  document.getElementById('form-expense').classList.add('hidden');
  document.getElementById('form-transfer').classList.remove('hidden');
  document.getElementById('btn-mode-transfer').style.background = 'var(--primary)';
  document.getElementById('btn-mode-transfer').style.color = 'white';
  document.getElementById('btn-mode-expense').style.background = 'var(--bg)';
  document.getElementById('btn-mode-expense').style.color = 'var(--text)';
  // Remplir les selects
  const names = getAccountNames();
  const opts = names.map(n => `<option value="${n}">${n}</option>`).join('');
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
  const amount = parseInt(document.getElementById('trf-amount').value, 10);
  const date   = document.getElementById('trf-date').value;
  const label  = document.getElementById('trf-label').value.trim() || `[${to}]`;

  if (from === to) { toast('⚠️ Les comptes source et destination doivent être différents'); return; }
  if (!amount || amount <= 0) { toast('⚠️ Montant invalide'); return; }

  // Débit sur le compte source
  appData.operations.push({
    id: uid(),
    date,
    label: `[${to}]`,
    amount,
    type: 'debit',
    account: from,
    category: 'Virement',
    opType: 'Virement',
  });

  // Crédit sur le compte destination
  appData.operations.push({
    id: uid(),
    date,
    label: `[${from}]`,
    amount,
    type: 'credit',
    account: to,
    category: 'Virement',
    opType: 'Virement',
  });

  saveLocal();
  renderAll();
  e.target.reset();
  document.getElementById('trf-date').value = today();
  toast(`✅ Virement de ${fmt(amount)} : ${from} → ${to}`);
  if (accessToken) uploadToDrive().catch(err => toast('⚠️ ' + err.message));
});

// ── IMPORT ───────────────────────────────────────────────────────────────────
document.getElementById('btn-import-bdu').addEventListener('click', async () => {
  const statusEl = document.getElementById('import-status');
  statusEl.classList.remove('hidden');
  statusEl.textContent = '⏳ Chargement...';
  try {
    const res = await fetch('/comptes_data.json');
    if (!res.ok) throw new Error('Fichier introuvable sur le serveur local');
    const imported = await res.json();
    if (!imported.operations || !Array.isArray(imported.operations)) throw new Error('Format invalide');
    appData.operations = imported.operations;
    appData.accounts   = imported.accounts || [];
    appData.recurring  = imported.recurring || [];
    saveLocal();
    renderAll();
    statusEl.textContent = `✅ ${imported.operations.length} opérations importées dans ${(imported.accounts||[]).length} comptes`;
    if (accessToken) uploadToDrive().catch(() => {});
    toast(`✅ Import terminé`);
  } catch (e) {
    statusEl.textContent = '❌ ' + e.message;
  }
});

// ── NAVIGATION ───────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});
document.getElementById('btn-sync').addEventListener('click', () => {
  if (!accessToken) {
    if (tokenClient) { tokenClient.requestAccessToken({ prompt: '' }); return; }
    toast('⚠️ Google API pas encore chargée'); return;
  }
  syncFromDrive();
});

document.getElementById('btn-force-upload').addEventListener('click', async () => {
  if (!accessToken) {
    if (tokenClient) { tokenClient.requestAccessToken({ prompt: '' }); toast('⏳ Connexion Google...'); return; }
    toast('⚠️ Google API pas encore chargée'); return;
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
    if (tokenClient) { tokenClient.requestAccessToken({ prompt: '' }); toast('⏳ Connexion Google...'); return; }
    toast('⚠️ Google API pas encore chargée'); return;
  }
  try {
    document.getElementById('sync-detail').textContent = '⏳ Téléchargement...';
    const remote = await downloadFromDrive();
    if (remote) {
      appData = remote;
      saveLocal(false);
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
  container.innerHTML = names.map(name => {
    const ops = appData.operations.filter(op => op.account === name).length;
    return `<div style="display:flex;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid var(--border)">
      <span style="flex:1;font-size:0.9rem;font-weight:600">${name}</span>
      <span style="font-size:0.75rem;color:var(--muted)">${ops} ops</span>
      <button onclick="renameAccount('${name.replace(/'/g, "\\'")}')" style="padding:4px 8px;border:1px solid var(--border);border-radius:8px;background:var(--bg);font-size:0.75rem;cursor:pointer">✏️</button>
      <button onclick="deleteAccount('${name.replace(/'/g, "\\'")}')" style="padding:4px 8px;border:1px solid var(--danger);border-radius:8px;background:var(--bg);font-size:0.75rem;cursor:pointer;color:var(--danger)">🗑</button>
    </div>`;
  }).join('');
}

window.renameAccount = function(oldName) {
  const newName = prompt(`Renommer "${oldName}" en :`, oldName);
  if (!newName || newName === oldName) return;
  const existing = appData.accounts.find(a => a.name === newName);
  if (existing) { toast('⚠️ Ce nom de compte existe déjà'); return; }
  const acc = appData.accounts.find(a => a.name === oldName);
  if (acc) acc.name = newName;
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
  appData.operations = appData.operations.filter(op => op.account !== name);
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
      <input type="checkbox" ${checked} data-account="${name}" class="cfg-total-cb" style="width:18px;height:18px;accent-color:var(--primary)"/>
      ${name}
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

// ── SOUS-CATÉGORIES ─────────────────────────────────────────────────────────
const MAIN_CATEGORIES = ['Alimentation','Transport','Sante','Loisirs','Logement','Telecom','Revenus','Autre'];

function getSubcategories() {
  return appData.subcategories || {};
}

function getAllCategoryOptions() {
  const subs = getSubcategories();
  let html = '';
  for (const cat of MAIN_CATEGORIES) {
    html += `<option value="${cat}">${CAT_ICONS[cat] || '📦'} ${cat}</option>`;
    if (subs[cat]) {
      for (const sub of subs[cat]) {
        html += `<option value="${cat}/${sub}">  ↳ ${sub}</option>`;
      }
    }
  }
  html += '<option value="Virement">Virement</option>';
  return html;
}

function renderSubcategoriesConfig() {
  const subs = getSubcategories();
  const container = document.getElementById('cfg-subcategories');
  let html = '';
  for (const cat of MAIN_CATEGORIES) {
    if (!subs[cat] || !subs[cat].length) continue;
    html += `<div style="margin-bottom:6px"><span style="font-size:0.85rem;font-weight:600">${CAT_ICONS[cat] || '📦'} ${cat}</span>`;
    html += `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">`;
    for (const sub of subs[cat]) {
      html += `<span style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:3px 8px;font-size:0.78rem;display:flex;align-items:center;gap:4px">${sub}<span onclick="removeSubcat('${cat}','${sub.replace(/'/g,"\\'")}')" style="cursor:pointer;color:var(--danger);font-weight:700">✕</span></span>`;
    }
    html += `</div></div>`;
  }
  container.innerHTML = html || '<span style="font-size:0.82rem;color:var(--muted)">Aucune sous-catégorie</span>';

  const parentSel = document.getElementById('cfg-subcat-parent');
  parentSel.innerHTML = MAIN_CATEGORIES.map(c => `<option value="${c}">${CAT_ICONS[c] || '📦'} ${c}</option>`).join('');
}

document.getElementById('btn-add-subcat').addEventListener('click', () => {
  const parent = document.getElementById('cfg-subcat-parent').value;
  const name = document.getElementById('cfg-subcat-name').value.trim();
  if (!name) { toast('⚠️ Nom requis'); return; }
  if (!appData.subcategories) appData.subcategories = {};
  if (!appData.subcategories[parent]) appData.subcategories[parent] = [];
  if (appData.subcategories[parent].includes(name)) { toast('⚠️ Existe déjà'); return; }
  appData.subcategories[parent].push(name);
  document.getElementById('cfg-subcat-name').value = '';
  saveLocal();
  renderAll();
  toast(`✅ ${parent}/${name} ajouté`);
});

window.removeSubcat = function(parent, name) {
  if (!appData.subcategories || !appData.subcategories[parent]) return;
  appData.subcategories[parent] = appData.subcategories[parent].filter(s => s !== name);
  if (!appData.subcategories[parent].length) delete appData.subcategories[parent];
  saveLocal();
  renderAll();
  toast(`🗑 ${parent}/${name} supprimé`);
};

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
    const [parent, sub] = cat.split('/');
    return `${CAT_ICONS[parent] || '📦'} ${sub}`;
  }
  return cat;
}

// ── BUDGETS PAR CATÉGORIE ────────────────────────────────────────────────────
const ALL_CATEGORIES = ['Alimentation','Transport','Sante','Loisirs','Logement','Telecom','Revenus','Autre','Virement'];

function renderBudgetsConfig() {
  const budgets = appData.budgets || {};
  const container = document.getElementById('cfg-budgets');
  container.innerHTML = ALL_CATEGORIES.filter(c => c !== 'Revenus' && c !== 'Virement').map(cat => {
    const val = budgets[cat] || '';
    return `<div style="display:flex;align-items:center;gap:8px">
      <span style="flex:1;font-size:0.85rem">${CAT_ICONS[cat] || '📦'} ${cat}</span>
      <input type="number" data-budget-cat="${cat}" value="${val}" placeholder="—" min="0" inputmode="numeric" style="width:100px;padding:6px;text-align:right;font-size:0.85rem"/>
      <span style="font-size:0.78rem;color:var(--muted)">F</span>
    </div>`;
  }).join('');
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
  sel.innerHTML = names.map(n => `<option value="${n}">${n}</option>`).join('');
  const deferred = appData.accounts.find(a => a.cardType === 'deferred');
  if (deferred) {
    sel.value = deferred.name;
    document.getElementById('cfg-card-cycle').value = deferred.billingCycleDay || '';
    document.getElementById('cfg-card-limit').value = deferred.cardLimit || '';
  }
}

document.getElementById('cfg-card-account').addEventListener('change', () => {
  const name = document.getElementById('cfg-card-account').value;
  const acc = appData.accounts.find(a => a.name === name);
  if (acc) {
    document.getElementById('cfg-card-cycle').value = acc.billingCycleDay || '';
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
  acc.cardType = 'deferred';
  acc.billingCycleDay = cycle;
  acc.cardLimit = limit || 0;
  saveLocal();
  renderAll();
  toast('✅ Configuration carte enregistrée');
  if (accessToken) uploadToDrive().catch(() => {});
});

// ── IMPRESSION ──────────────────────────────────────────────────────────────
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

  const cleanup = () => {
    document.body.classList.remove('printing');
    area.innerHTML = '';
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  // Filet de sécurité si afterprint ne se déclenche pas
  setTimeout(() => { if (document.body.classList.contains('printing')) cleanup(); }, 60000);

  setTimeout(() => window.print(), 100);
}

document.getElementById('btn-print-dashboard').addEventListener('click', () => {
  const now = new Date();
  const dateStr = now.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  const names = getAccountNames();
  let rows = '';
  let total = 0;
  for (const name of names) {
    const bal = calcAccountBalance(name);
    const acc = appData.accounts.find(a => a.name === name);
    const included = !acc || acc.includeInTotal !== false;
    if (included) total += bal;
    const cls = bal >= 0 ? 'credit' : 'debit';
    const ops = appData.operations.filter(op => op.account === name && op.opType !== 'Programmee').length;
    rows += `<tr>
      <td>${name}</td>
      <td class="right">${ops}</td>
      <td class="right ${cls} bold">${fmt(bal)}</td>
    </tr>`;
  }

  const html = `
    <h1>Finances Perso NC</h1>
    <h2>Résumé des comptes au ${dateStr}</h2>
    <table>
      <thead><tr><th>Compte</th><th class="right">Opérations</th><th class="right">Solde</th></tr></thead>
      <tbody>${rows}
        <tr class="total-row"><td>Solde total</td><td></td><td class="right">${fmt(total)}</td></tr>
      </tbody>
    </table>`;
  printContent('Résumé comptes - ' + dateStr, html);
});

document.getElementById('btn-print-ops').addEventListener('click', () => {
  const accFilter = document.getElementById('filter-account').value;
  const now = new Date();
  const dateStr = now.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

  let ops = [...appData.operations].sort((a, b) => a.date.localeCompare(b.date));
  if (accFilter) ops = ops.filter(op => op.account === accFilter);

  const useMonth = !!accFilter;
  if (useMonth) {
    const monthStart = `${opsYear}-${String(opsMonth+1).padStart(2,'0')}-01`;
    const monthEnd   = `${opsYear}-${String(opsMonth+1).padStart(2,'0')}-31`;
    ops = ops.filter(op => op.date >= monthStart && op.date <= monthEnd && op.opType !== 'Programmee');

    const acc = appData.accounts.find(a => a.name === accFilter);
    const initial = acc ? (acc.initialBalance || 0) : 0;
    const beforeOps = appData.operations.filter(op =>
      op.account === accFilter && op.date < monthStart && op.opType !== 'Programmee');
    let running = initial + beforeOps.reduce((s, op) =>
      op.type === 'credit' ? s + op.amount : s - op.amount, 0);

    const monthLabel = new Date(opsYear, opsMonth, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    let rows = '';
    for (const op of ops) {
      const delta = op.type === 'credit' ? op.amount : -op.amount;
      running += delta;
      const sign = op.type === 'credit' ? '+' : '-';
      const cls = op.type === 'credit' ? 'credit' : 'debit';
      rows += `<tr>
        <td>${formatDate(op.date)}</td>
        <td>${op.label}</td>
        <td>${op.category || ''}</td>
        <td class="right ${cls}">${sign}${fmt(op.amount)}</td>
        <td class="right bold">${fmt(running)}</td>
      </tr>`;
    }

    const html = `
      <h1>${accFilter}</h1>
      <h2>${monthLabel} — ${ops.length} opérations</h2>
      <table>
        <thead><tr><th>Date</th><th>Libellé</th><th>Catégorie</th><th class="right">Montant</th><th class="right">Solde</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    printContent(`${accFilter} - ${monthLabel}`, html);
  } else {
    const typeFilter = document.getElementById('filter-type').value;
    const catFilter = document.getElementById('filter-category').value;
    if (typeFilter) ops = ops.filter(op => op.type === typeFilter);
    if (catFilter) ops = ops.filter(op => op.category === catFilter);
    ops = ops.reverse();

    let rows = '';
    for (const op of ops.slice(0, 500)) {
      const sign = op.type === 'credit' ? '+' : '-';
      const cls = op.type === 'credit' ? 'credit' : 'debit';
      rows += `<tr>
        <td>${formatDate(op.date)}</td>
        <td>${op.label}</td>
        <td>${op.account}</td>
        <td>${op.category || ''}</td>
        <td class="right ${cls}">${sign}${fmt(op.amount)}</td>
      </tr>`;
    }

    const html = `
      <h1>Opérations</h1>
      <h2>${ops.length} opérations — imprimé le ${dateStr}</h2>
      <table>
        <thead><tr><th>Date</th><th>Libellé</th><th>Compte</th><th>Catégorie</th><th class="right">Montant</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    printContent('Opérations - ' + dateStr, html);
  }
});

// ── SAUVEGARDES LOCALES ──────────────────────────────────────────────────────
const MAX_BACKUPS = 5;

function autoBackup() {
  if (!appData.operations.length) return;
  const backups = JSON.parse(localStorage.getItem('finances_backups') || '[]');
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  backups.push({ date: stamp, data: JSON.stringify(appData) });
  while (backups.length > MAX_BACKUPS) backups.shift();
  localStorage.setItem('finances_backups', JSON.stringify(backups));
}

function renderBackupList() {
  const backups = JSON.parse(localStorage.getItem('finances_backups') || '[]');
  const el = document.getElementById('backup-list');
  if (!backups.length) {
    el.textContent = 'Aucune sauvegarde';
    return;
  }
  el.innerHTML = backups.map((b, i) => {
    const d = JSON.parse(b.data);
    const ops = d.operations ? d.operations.length : 0;
    return `<div style="display:flex;justify-content:space-between;padding:2px 0">
      <span>📁 ${b.date}</span>
      <span>${ops} ops <a href="#" onclick="restoreBackup(${i});return false" style="color:var(--primary);margin-left:8px">restaurer</a></span>
    </div>`;
  }).join('');
}

window.restoreBackup = function(index) {
  const backups = JSON.parse(localStorage.getItem('finances_backups') || '[]');
  if (!backups[index]) return;
  if (!confirm(`Restaurer la sauvegarde du ${backups[index].date} ? Les données actuelles seront remplacées.`)) return;
  appData = JSON.parse(backups[index].data);
  saveLocal();
  renderAll();
  toast(`✅ Sauvegarde du ${backups[index].date} restaurée`);
};

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
      const imported = JSON.parse(reader.result);
      if (!imported.operations) throw new Error('Format invalide');
      if (!confirm(`Restaurer depuis ${file.name} ? (${imported.operations.length} opérations)`)) return;
      appData = imported;
      saveLocal();
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
  localStorage.setItem('darkMode', dark);
  applyDarkMode(dark);
});

// ── AIDE ────────────────────────────────────────────────────────────────────
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
    names.map(n => `<option value="${n}">${n}</option>`).join('');
}

document.getElementById('btn-export-csv').addEventListener('click', () => {
  const accFilter = document.getElementById('cfg-export-account').value;
  let ops = [...appData.operations].sort((a, b) => a.date.localeCompare(b.date));
  if (accFilter) ops = ops.filter(op => op.account === accFilter);

  const BOM = '﻿';
  const header = 'Date;Libelle;Debit;Credit;Compte;Categorie;Type\n';
  const rows = ops.map(op => {
    const debit = op.type === 'debit' ? op.amount : '';
    const credit = op.type === 'credit' ? op.amount : '';
    return `${op.date};${op.label};${debit};${credit};${op.account};${op.category || ''};${op.opType || ''}`;
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
      <span style="flex:1;font-size:0.85rem">${name}</span>
      <input type="number" data-alert-acc="${name}" value="${val}" placeholder="—" inputmode="numeric" style="width:100px;padding:6px;text-align:right;font-size:0.85rem"/>
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
let backupDirHandle = null;
const BACKUP_DB = 'finances_backup_db';

async function storeHandle(handle) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BACKUP_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => {
      const tx = req.result.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(handle, 'backupDir');
      tx.oncomplete = () => resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

async function loadHandle() {
  return new Promise((resolve) => {
    const req = indexedDB.open(BACKUP_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => {
      const tx = req.result.transaction('handles', 'readonly');
      const get = tx.objectStore('handles').get('backupDir');
      get.onsuccess = () => resolve(get.result || null);
      get.onerror = () => resolve(null);
    };
    req.onerror = () => resolve(null);
  });
}

async function initBackupDir() {
  const handle = await loadHandle();
  if (handle) {
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      backupDirHandle = handle;
      updateBackupDirStatus();
    } else {
      updateBackupDirStatus();
    }
  } else {
    updateBackupDirStatus();
  }
}

function updateBackupDirStatus() {
  const el = document.getElementById('backup-dir-status');
  const clearBtn = document.getElementById('btn-backup-dir-clear');
  if (backupDirHandle) {
    el.textContent = `✅ Dossier : ${backupDirHandle.name} — sauvegarde auto active`;
    el.style.color = 'var(--accent)';
    clearBtn.classList.remove('hidden');
  } else {
    loadHandle().then(h => {
      if (h) {
        el.textContent = '⚠️ Dossier configuré mais permission expirée — recliquez "📁 Choisir"';
        el.style.color = '#ef9f27';
      } else {
        el.textContent = 'Aucun dossier configuré';
        el.style.color = 'var(--muted)';
      }
      clearBtn.classList.toggle('hidden', !h);
    });
  }
}

document.getElementById('btn-backup-dir').addEventListener('click', async () => {
  if (!window.showDirectoryPicker) {
    toast('⚠️ Non disponible sur ce navigateur (uniquement Chrome PC)');
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    backupDirHandle = handle;
    await storeHandle(handle);
    updateBackupDirStatus();
    toast('✅ Dossier de sauvegarde configuré');
    await writeBackupToDir();
  } catch (e) {
    if (e.name !== 'AbortError') toast('❌ ' + e.message);
  }
});

document.getElementById('btn-backup-dir-clear').addEventListener('click', async () => {
  backupDirHandle = null;
  const req = indexedDB.open(BACKUP_DB, 1);
  req.onsuccess = () => {
    const tx = req.result.transaction('handles', 'readwrite');
    tx.objectStore('handles').delete('backupDir');
  };
  updateBackupDirStatus();
  toast('Dossier de sauvegarde supprimé');
});

async function writeBackupToDir() {
  if (!backupDirHandle) return;
  try {
    const perm = await backupDirHandle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return;

    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
    const fileName = `finances-backup-${stamp}.json`;

    // Écrire le nouveau fichier
    const fileHandle = await backupDirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(appData, null, 2));
    await writable.close();

    // Nettoyer : garder seulement les 5 derniers fichiers
    const files = [];
    for await (const [name, handle] of backupDirHandle) {
      if (name.startsWith('finances-backup-') && name.endsWith('.json')) {
        files.push({ name, handle });
      }
    }
    files.sort((a, b) => b.name.localeCompare(a.name));
    for (let i = 5; i < files.length; i++) {
      await backupDirHandle.removeEntry(files[i].name);
    }
  } catch (e) {
    console.error('Backup auto erreur:', e);
  }
}

// ── RÉINITIALISATION ─────────────────────────────────────────────────────────
document.getElementById('btn-reset').addEventListener('click', () => {
  if (!confirm('Effacer toutes les données locales ? Cette action est irréversible.')) return;
  localStorage.removeItem('finances_data');
  localStorage.removeItem('gToken');
  appData = structuredClone(defaultData);
  accessToken = null;
  driveFileId = null;
  showScreen('screen-login');
  toast('✅ Données effacées');
});

// ── STATISTIQUES ─────────────────────────────────────────────────────────────
const CAT_COLORS = {
  Alimentation:'#ef6c00', Transport:'#1565c0', Sante:'#c62828',
  Loisirs:'#6a1b9a', Logement:'#2e7d32', Telecom:'#00838f',
  Revenus:'#43a047', Autre:'#546e7a',
};

let statsMonth = new Date().getMonth();
let statsYear  = new Date().getFullYear();

function renderStats() {
  const y = statsYear, m = statsMonth;
  const label = new Date(y, m, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  document.getElementById('stats-month-label').textContent = label.charAt(0).toUpperCase() + label.slice(1);

  const accFilter = document.getElementById('stats-account').value;
  const ops = appData.operations.filter(op => {
    if (op.opType === 'Programmee' || op.opType === 'Regularisation') return false;
    if (accFilter && op.account !== accFilter) return false;
    const d = new Date(op.date + 'T00:00:00');
    return d.getFullYear() === y && d.getMonth() === m;
  });

  const income  = ops.filter(o => o.type === 'credit').reduce((s, o) => s + o.amount, 0);
  const expense = ops.filter(o => o.type === 'debit').reduce((s, o) => s + o.amount, 0);
  const net = income - expense;

  document.getElementById('stat-income').textContent  = fmt(income);
  document.getElementById('stat-expense').textContent = fmt(expense);
  const netEl = document.getElementById('stat-net');
  netEl.textContent = (net >= 0 ? '+' : '') + fmt(net);
  netEl.style.color = net >= 0 ? 'var(--accent)' : 'var(--danger)';

  // Top catégories (dépenses)
  const bycat = {};
  ops.filter(o => o.type === 'debit').forEach(o => {
    const cat = o.category && o.category.includes('/') ? o.category.split('/')[0] : (o.category || 'Autre');
    bycat[cat] = (bycat[cat] || 0) + o.amount;
  });
  const sorted = Object.entries(bycat).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxVal = sorted[0]?.[1] || 1;

  const budgets = appData.budgets || {};
  const catHtml = sorted.length ? sorted.map(([cat, val]) => {
    const budget = budgets[cat];
    const col = CAT_COLORS[cat] || '#546e7a';
    let barHtml;
    if (budget) {
      const pct = Math.min(Math.round((val / budget) * 100), 100);
      const overPct = val > budget ? Math.min(Math.round(((val - budget) / budget) * 100), 100) : 0;
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
    return `<div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:0.8rem;margin-bottom:3px">
        <span>${CAT_ICONS[cat] || '📦'} ${cat}</span>
        <span style="font-weight:600;${val > budget && budget ? 'color:var(--danger)' : ''}">${fmt(val)}${budgetLabel}</span>
      </div>
      ${barHtml}
    </div>`;
  }).join('') : '<div style="color:var(--muted);font-size:0.85rem;text-align:center;padding:8px">Aucune dépense ce mois</div>';

  document.getElementById('stat-categories').innerHTML =
    `<div style="font-size:0.75rem;color:var(--muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px">Top dépenses par catégorie</div>` + catHtml;
}

document.getElementById('stats-account').addEventListener('change', renderStats);
document.getElementById('btn-stats-prev').addEventListener('click', () => {
  statsMonth--; if (statsMonth < 0) { statsMonth = 11; statsYear--; }
  renderStats();
});
document.getElementById('btn-stats-next').addEventListener('click', () => {
  statsMonth++; if (statsMonth > 11) { statsMonth = 0; statsYear++; }
  renderStats();
});

// ── PROJECTION ───────────────────────────────────────────────────────────────
function addMonths(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setMonth(d.getMonth() + n);
  return d.toISOString().split('T')[0];
}

function scheduledOpsInMonth(year, month, accountFilter) {
  // Chercher les ops programmées qui concernent ce compte
  // (soit comme compte source, soit comme destination d'un virement)
  const allScheduled = appData.operations.filter(op => op.opType === 'Programmee');
  const result = [];

  for (const op of allScheduled) {
    const base = op.nextPayment || op.date;
    if (!base) continue;
    const freq = op.detail || 'mensuelle';
    const baseDate = new Date(base + 'T00:00:00');
    const diffMonths = (year - baseDate.getFullYear()) * 12 + (month - baseDate.getMonth());
    if (diffMonths < 0) continue;
    if (op.endDate) {
      if (new Date(year, month, 1) > new Date(op.endDate + 'T00:00:00')) continue;
    }
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

    const baseDay = baseDate.getDate();
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
function calcBalanceAtDate(accountFilter, year, month, cutDay) {
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
      op.account === accountFilter && op.opType !== 'Programmee' && op.date <= cutDate);
    let bal = initial + realOps.reduce((s, op) =>
      op.type === 'credit' ? s + op.amount : s - op.amount, 0);
    for (let m = currentMonth; m <= targetMonth; m++) {
      const y2 = Math.floor(m/12), m2 = m%12;
      const schOps = scheduledOpsInMonth(y2, m2, accountFilter);
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
        return total + calcBalanceAtDate(a.name, year, month, cutDay);
      }, 0);
  }
}

function calcBalanceEndOfMonth(accountFilter, year, month) {
  return calcBalanceAtDate(accountFilter, year, month, 0);
}

// Opérations d'un mois donné (réelles + programmées si futur)
function getMonthOps(accountFilter, year, month) {
  const mStart = `${year}-${String(month+1).padStart(2,'0')}-01`;
  const mEnd = `${year}-${String(month+1).padStart(2,'0')}-31`;
  const now = new Date();
  const currentMonth = now.getFullYear() * 12 + now.getMonth();
  const targetMonth = year * 12 + month;
  // Inclure les opérations programmées pour le mois courant ET les mois futurs
  // (une opération programmée reste affichée jusqu'à ce qu'elle soit "passée" via ✅ Passer)
  const includeScheduled = targetMonth >= currentMonth;

  const realOps = appData.operations.filter(op =>
    (!accountFilter || op.account === accountFilter) &&
    op.opType !== 'Programmee' &&
    op.date >= mStart && op.date <= mEnd
  );

  if (includeScheduled) {
    const scheduled = scheduledOpsInMonth(year, month, accountFilter);
    return [
      ...realOps,
      ...scheduled.map(op => ({ ...op, opType: 'Programmee' })),
    ].sort((a, b) => (a.nextPayment || a.date).localeCompare(b.nextPayment || b.date));
  }
  return realOps.sort((a, b) => a.date.localeCompare(b.date));
}

function calcProjection(accountFilter, horizonMonths) {
  const now = new Date();

  // Solde de départ = solde fin du mois courant
  const startBalance = calcBalanceEndOfMonth(accountFilter, now.getFullYear(), now.getMonth());

  const points  = [];
  const opLines = [];
  let balance = startBalance;

  for (let i = 1; i <= horizonMonths; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const y = d.getFullYear(), m = d.getMonth();

    const monthOps = getMonthOps(accountFilter, y, m);

    let monthDelta = 0;
    for (const op of monthOps) {
      const delta = op.type === 'credit' ? op.amount : -op.amount;
      balance += delta;
      monthDelta += delta;
      opLines.push({ op, balance, month: d });
    }
    const label = d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
    points.push({ label, balance, delta: monthDelta, ops: monthOps });
  }
  return { startBalance, points, opLines };
}

function renderProjection() {
  const accountFilter = document.getElementById('proj-account').value;
  const horizonMonths = parseInt(document.getElementById('proj-horizon').value);
  const { startBalance, points, opLines } = calcProjection(accountFilter, horizonMonths);

  // Calcul des soldes par mois
  const cutDay = parseInt(document.getElementById('proj-cutday').value) || 0;
  const fmtK = v => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(v);
  const fmtN0 = v => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(v);

  const now2 = new Date();

  // Si "Tous les comptes", calculer par compte d'abord pour avoir les vrais totaux
  const names = getAccountNames();
  const includedNames = names.filter(name => {
    const acc = appData.accounts.find(a => a.name === name);
    return !acc || acc.includeInTotal !== false;
  });

  const endBalances = [];
  // Point actuel
  if (!accountFilter) {
    let t = 0;
    for (const name of includedNames) t += calcBalanceAtDate(name, now2.getFullYear(), now2.getMonth(), cutDay);
    endBalances.push({ label: 'actuel', balance: t });
  } else {
    endBalances.push({ label: 'actuel', balance: calcBalanceAtDate(accountFilter, now2.getFullYear(), now2.getMonth(), cutDay) });
  }

  // Points futurs
  const accBalancesPerMonth = {};
  for (const name of includedNames) accBalancesPerMonth[name] = [];

  for (let i = 0; i < points.length; i++) {
    const d = new Date(now2.getFullYear(), now2.getMonth() + i + 1, 1);
    let lbl = points[i].label;
    if (cutDay && cutDay > 0 && cutDay < 31) {
      const mShort = d.toLocaleDateString('fr-FR', { month: 'short' });
      lbl = `${cutDay} ${mShort}`;
    }
    if (!accountFilter) {
      let t = 0;
      for (const name of includedNames) {
        const bal = calcBalanceAtDate(name, d.getFullYear(), d.getMonth(), cutDay);
        accBalancesPerMonth[name].push(bal);
        t += bal;
      }
      endBalances.push({ label: lbl, balance: t });
    } else {
      endBalances.push({ label: lbl, balance: calcBalanceAtDate(accountFilter, d.getFullYear(), d.getMonth(), cutDay) });
    }
  }

  // Graphique : barres + courbe

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
            <text x="${pad.left - 4}" y="${y + 4}" text-anchor="end" font-size="9" fill="var(--muted)">${fmtK(v)}</text>`;
  }).join('');

  const bars = endBalances.map((e, i) => {
    const x = pad.left + i * gap + (gap - barW) / 2;
    const y = yScale(e.balance);
    const h = Math.abs(y - zeroY);
    const top = e.balance >= 0 ? y : zeroY;
    const col = e.balance >= 0 ? '#43a047' : '#e53935';
    const valY = e.balance >= 0 ? top - 6 : top + h + 12;
    return `<rect x="${x}" y="${top}" width="${barW}" height="${h}" fill="${col}" rx="3" opacity="0.8"/>
            <text x="${x + barW/2}" y="${valY}" text-anchor="middle" font-size="8" font-weight="600" fill="${col}">${fmtK(e.balance)}</text>`;
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
    return `<text x="${x}" y="${H - pad.bottom + 12}" text-anchor="end" font-size="8" fill="var(--muted)" transform="rotate(-45 ${x} ${H - pad.bottom + 12})">${e.label}</text>`;
  }).join('');

  const svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;min-width:300px">
    ${gridLines}
    <line x1="${pad.left}" y1="${zeroY}" x2="${W - pad.right}" y2="${zeroY}" stroke="var(--text)" stroke-width="0.5" opacity="0.3"/>
    ${bars}
    <polyline points="${polyPts}" fill="none" stroke="var(--primary)" stroke-width="2" opacity="0.6"/>
    ${dots}
    ${xLabels}
  </svg>`;
  document.getElementById('proj-chart').innerHTML = svg;

  // Tableau récapitulatif par compte (si "Tous les comptes")
  let accountSummaryHtml = '';
  if (!accountFilter) {
    const fmtS = v => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(v);
    const months = endBalances.slice(1);

    const headerCols = months.map(e => `<th style="padding:4px 6px;text-align:right;font-size:0.7rem;color:var(--muted);white-space:nowrap">${e.label}</th>`).join('');

    const accRows = includedNames.map(name => {
      const cells = (accBalancesPerMonth[name] || []).map(bal => {
        const col = bal >= 0 ? 'var(--accent)' : 'var(--danger)';
        return `<td style="padding:4px 6px;text-align:right;font-size:0.78rem;font-weight:600;color:${col};white-space:nowrap">${fmtS(bal)}</td>`;
      }).join('');
      return `<tr style="border-top:1px solid var(--border)">
        <td style="padding:4px 6px;font-size:0.8rem;font-weight:600;white-space:nowrap">${name}</td>
        ${cells}
      </tr>`;
    }).join('');

    const totalCells = months.map(e => {
      const col = e.balance >= 0 ? 'var(--accent)' : 'var(--danger)';
      return `<td style="padding:4px 6px;text-align:right;font-size:0.8rem;font-weight:700;color:${col};white-space:nowrap">${fmtS(e.balance)}</td>`;
    }).join('');

    accountSummaryHtml = `
      <div style="overflow-x:auto;margin-bottom:12px">
        <table style="width:100%;border-collapse:collapse;font-size:0.8rem">
          <thead><tr style="border-bottom:2px solid var(--border)">
            <th style="padding:4px 6px;text-align:left;font-size:0.72rem;color:var(--muted)">Compte</th>
            ${headerCols}
          </tr></thead>
          <tbody>
            ${accRows}
            <tr style="border-top:2px solid var(--primary)">
              <td style="padding:4px 6px;font-size:0.8rem;font-weight:700">Total</td>
              ${totalCells}
            </tr>
          </tbody>
        </table>
      </div>`;
  }

  // Table : une ligne par opération avec solde courant
  const fmtN = v => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(v);
  let prevMonth = '';
  const rows = opLines.map(({ op, balance: bal, month }) => {
    const monthLabel = month.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    const sign = op.type === 'credit' ? '+' : '-';
    const amtCol = op.type === 'credit' ? 'var(--accent)' : 'var(--danger)';
    const balCol = bal >= 0 ? 'var(--accent)' : 'var(--danger)';
    const monthSep = monthLabel !== prevMonth
      ? `<tr><td colspan="3" style="padding:8px 8px 4px;font-size:0.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;background:var(--bg)">${monthLabel}</td></tr>`
      : '';
    prevMonth = monthLabel;
    return `${monthSep}<tr style="border-top:1px solid var(--border)">
      <td style="padding:5px 8px;font-size:0.83rem">${op.label}<br><span style="font-size:0.72rem;color:var(--muted)">${op.account}</span></td>
      <td style="padding:5px 8px;text-align:right;font-size:0.85rem;color:${amtCol};white-space:nowrap">${sign}${fmtN(op.amount)} F</td>
      <td style="padding:5px 8px;text-align:right;font-size:0.85rem;font-weight:700;color:${balCol};white-space:nowrap">${fmtN(bal)} F</td>
    </tr>`;
  }).join('');

  const fmtN2 = v => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(v);
  const startCol = startBalance >= 0 ? 'var(--accent)' : 'var(--danger)';
  const startRow = `<tr style="background:var(--bg)">
    <td colspan="2" style="padding:8px;font-size:0.8rem;font-weight:700;color:var(--muted)">📍 Solde actuel</td>
    <td style="padding:8px;text-align:right;font-weight:700;font-size:0.9rem;color:${startCol}">${fmtN2(startBalance)} F</td>
  </tr>`;

  document.getElementById('proj-table').innerHTML = `
    ${accountSummaryHtml}
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="border-bottom:2px solid var(--border)">
        <th style="padding:6px 8px;text-align:left;font-size:0.75rem;color:var(--muted)">Opération</th>
        <th style="padding:6px 8px;text-align:right;font-size:0.75rem;color:var(--muted)">Montant</th>
        <th style="padding:6px 8px;text-align:right;font-size:0.75rem;color:var(--muted)">Solde après</th>
      </tr></thead>
      <tbody>${startRow}${rows}</tbody>
    </table>
    ${!opLines.length ? '<div style="color:var(--muted);font-size:0.85rem;text-align:center;padding:16px">Aucune opération programmée sur cette période</div>' : ''}`;
}

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

document.getElementById('btn-toggle-projection').addEventListener('click', () => {
  const panel = document.getElementById('projection-panel');
  const hidden = panel.classList.toggle('hidden');
  if (!hidden) renderProjection();
});
document.getElementById('proj-account').addEventListener('change', renderProjection);
document.getElementById('proj-horizon').addEventListener('change', renderProjection);
document.getElementById('proj-cutday').addEventListener('input', renderProjection);

// ── OPÉRATIONS PROGRAMMÉES ───────────────────────────────────────────────────
const FREQ_LABELS = {
  mensuelle: 'Mensuelle', bimensuelle: 'Bimensuelle',
  trimestrielle: 'Trimestrielle', annuelle: 'Annuelle', ponctuelle: 'Ponctuelle'
};

function renderScheduled() {
  const ops = appData.operations
    .filter(op => op.opType === 'Programmee')
    .sort((a, b) => (a.nextPayment || a.date).localeCompare(b.nextPayment || b.date));

  const list = document.getElementById('list-scheduled');
  if (!ops.length) {
    list.innerHTML = '<li class="empty-state">Aucune opération programmée</li>';
    return;
  }
  list.innerHTML = ops.map(op => {
    const sign = op.type === 'credit' ? '+' : '-';
    const next = op.nextPayment ? formatDate(op.nextPayment) : '—';
    const freq = FREQ_LABELS[op.detail] || op.detail || '';
    const endInfo = op.endDate ? ` · fin : ${formatDate(op.endDate)}` : '';
    return `<li>
      <span class="op-icon">🔁</span>
      <div class="op-info">
        <div class="op-label">${op.label}</div>
        <div class="op-meta">${op.account} · ${freq} · prochain : ${next}${endInfo}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
        <span class="op-amount ${op.type}">${sign}${fmt(op.amount)}</span>
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
          <button onclick="passerScheduled('${op.id}')" style="font-size:0.7rem;background:none;border:none;color:var(--accent);cursor:pointer">✅ Passer</button>
          <button onclick="editScheduled('${op.id}')" style="font-size:0.7rem;background:none;border:none;color:var(--primary);cursor:pointer">✏️ Modif.</button>
          <button onclick="deleteScheduled('${op.id}')" style="font-size:0.7rem;background:none;border:none;color:var(--danger);cursor:pointer">🗑 Suppr.</button>
        </div>
      </div>
    </li>`;
  }).join('');
}

let _passerOpId = null;
window.passerScheduled = function(id) {
  const op = appData.operations.find(o => o.id === id);
  if (!op) return;
  _passerOpId = id;
  document.getElementById('modal-passer-label').textContent = op.label + ' — ' + op.account;
  document.getElementById('modal-passer-date').value = today();
  document.getElementById('modal-passer-amount').value = op.amount;
  document.getElementById('modal-passer-type').value = op.type;
  document.getElementById('modal-passer').classList.remove('hidden');
};

document.getElementById('modal-passer-cancel').addEventListener('click', () => {
  document.getElementById('modal-passer').classList.add('hidden');
  _passerOpId = null;
});

document.getElementById('modal-passer-confirm').addEventListener('click', () => {
  const op = appData.operations.find(o => o.id === _passerOpId);
  if (!op) return;
  const dateStr = document.getElementById('modal-passer-date').value;
  const amount  = parseInt(document.getElementById('modal-passer-amount').value, 10);
  const type    = document.getElementById('modal-passer-type').value;
  if (!dateStr || !amount) { toast('⚠️ Date et montant requis'); return; }

  const isVirement = op.virementDest || (op.label && op.label.startsWith('['));
  const dest = op.virementDest || (op.label.match(/^\[(.+)\]$/) || [])[1];

  if (isVirement && dest) {
    appData.operations.push({
      id: uid(), date: dateStr, label: `[${dest}]`,
      amount, type: 'debit',
      account: op.account, category: 'Virement',
      opType: 'Virement',
    });
    appData.operations.push({
      id: uid(), date: dateStr, label: `[${op.account}]`,
      amount, type: 'credit',
      account: dest, category: 'Virement',
      opType: 'Virement',
    });
  } else {
    appData.operations.push({
      id: uid(), date: dateStr, label: op.label,
      amount, type,
      account: op.account, category: op.category || 'Autre',
      opType: 'Operation',
    });
  }

  // Avancer la prochaine échéance (montant de base inchangé)
  const freq = op.detail || 'mensuelle';
  const freqMonths = { mensuelle:1, bimensuelle:2, trimestrielle:3, annuelle:12 };
  const next = op.nextPayment || op.date;
  if (freq === 'ponctuelle') {
    appData.operations = appData.operations.filter(o => o.id !== _passerOpId);
  } else {
    op.nextPayment = addMonths(next, freqMonths[freq] || 1);
    op.date = op.nextPayment;
  }

  saveLocal();
  renderAll();
  document.getElementById('modal-passer').classList.add('hidden');
  _passerOpId = null;
  toast(`✅ Opération passée le ${dateStr}`);
  if (accessToken) uploadToDrive().catch(() => {});
});

window.editScheduled = function(id) {
  const op = appData.operations.find(o => o.id === id);
  if (!op) return;
  const wrap = document.getElementById('form-scheduled-wrap');
  wrap.classList.remove('hidden');
  wrap.dataset.editId = id;
  wrap.querySelector('h3').textContent = 'Modifier l\'opération programmée';
  const names = getAccountNames();
  const opts = names.map(n => `<option value="${n}">${n}</option>`).join('');
  document.getElementById('sch-account').innerHTML = opts;
  document.getElementById('sch-dest').innerHTML = opts;
  document.getElementById('sch-label').value = op.label;
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
  document.getElementById('sch-category').value = op.category || 'Autre';
  document.getElementById('sch-freq').value = op.detail || 'mensuelle';
  document.getElementById('sch-next').value = op.nextPayment || op.date;
  document.getElementById('sch-end').value = op.endDate || '';
  toggleSchDest();
  wrap.scrollIntoView({ behavior: 'smooth' });
};

window.deleteScheduled = function(id) {
  if (!confirm('Supprimer cette opération programmée ?')) return;
  appData.operations = appData.operations.filter(op => op.id !== id);
  saveLocal();
  renderScheduled();
  if (accessToken) uploadToDrive().catch(() => {});
};

document.getElementById('btn-add-scheduled').addEventListener('click', () => {
  document.getElementById('form-scheduled-wrap').classList.remove('hidden');
  document.getElementById('sch-next').value = today();
  const names = getAccountNames();
  const opts = names.map(n => `<option value="${n}">${n}</option>`).join('');
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
  const amount = parseInt(document.getElementById('sch-amount').value, 10);
  const nextDate = document.getElementById('sch-next').value;

  const endDate = document.getElementById('sch-end').value || null;

  if (typeVal === 'virement') {
    if (account === dest) { toast('⚠️ Source et destination identiques'); return; }
    const baseFields = {
      date: nextDate,
      nextPayment: nextDate,
      amount,
      category: 'Virement',
      detail: document.getElementById('sch-freq').value,
      opType: 'Programmee',
      endDate,
    };
    if (editId) {
      const idx = appData.operations.findIndex(o => o.id === editId);
      if (idx !== -1) {
        appData.operations[idx] = { ...appData.operations[idx], ...baseFields, label: `[${dest}]`, type: 'debit', account, virementDest: dest };
      }
      toast('✅ Virement programmé modifié');
    } else {
      // Créer le débit programmé (source)
      appData.operations.push({ id: uid(), ...baseFields, label: `[${dest}]`, type: 'debit', account, virementDest: dest });
      toast('✅ Virement programmé enregistré');
    }
  } else {
    const fields = {
      date: nextDate,
      nextPayment: nextDate,
      label: document.getElementById('sch-label').value.trim(),
      amount,
      type: typeVal,
      account,
      category: document.getElementById('sch-category').value,
      detail: document.getElementById('sch-freq').value,
      opType: 'Programmee',
      endDate,
    };
    if (editId) {
      const idx = appData.operations.findIndex(o => o.id === editId);
      if (idx !== -1) appData.operations[idx] = { ...appData.operations[idx], ...fields };
      toast('✅ Opération modifiée');
    } else {
      appData.operations.push({ id: uid(), ...fields });
      toast('✅ Opération programmée enregistrée');
    }
  }
  saveLocal();
  renderScheduled();
  closeScheduledForm();
  if (accessToken) uploadToDrive().catch(() => {});
});

// ── IMPORT PAR COLLAGE BANCAIRE ──────────────────────────────────────────────
let pasteData = { rows: [], headers: [], colRoles: [], removedCols: [] };
let pasteBatches = []; // stocke les collages multiples

document.getElementById('btn-open-paste-import').addEventListener('click', () => {
  document.getElementById('modal-paste-import').classList.remove('hidden');
  document.getElementById('paste-step1').classList.remove('hidden');
  document.getElementById('paste-step2').classList.add('hidden');
  document.getElementById('paste-step3').classList.add('hidden');
  document.getElementById('paste-input').value = '';
  pasteBatches = [];
  updateBatchesDisplay();
  const names = getAccountNames();
  document.getElementById('paste-account').innerHTML = names.map(n => `<option value="${n}">${n}</option>`).join('');
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
        <b style="font-size:0.75rem">${h}</b>
        <span onclick="removePasteCol(${i})" style="cursor:pointer;color:var(--danger);font-size:0.9rem">✕</span>
      </div>
      <select onchange="setPasteRole(${i},this.value)" style="padding:4px;font-size:0.75rem">${selOpts}</select>
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
  const thHtml = `<th style="padding:4px 6px;font-size:0.7rem;border-bottom:1px solid var(--border);color:var(--muted)">#</th>` + visibleCols.map(i => `<th style="padding:4px 6px;font-size:0.7rem;white-space:nowrap;border-bottom:1px solid var(--border);color:var(--muted)">${pasteData.headers[i]}</th>`).join('');
  const trHtml = previewRows.map((row, idx) =>
    `<tr><td style="padding:3px 6px;font-size:0.7rem;color:var(--muted);border-bottom:1px solid var(--border)">${idx+1}</td>${visibleCols.map(i => `<td style="padding:3px 6px;font-size:0.75rem;white-space:nowrap;border-bottom:1px solid var(--border)">${row[i] || '<span style="color:var(--danger)">vide</span>'}</td>`).join('')}</tr>`
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

  const catOptions = ['Alimentation','Transport','Sante','Loisirs','Logement','Telecom','Revenus','Autre','Virement']
    .map(c => `<option value="${c}">${CAT_ICONS[c] || '📦'} ${c}</option>`).join('');

  const dupeCount = parsedOps.filter(op => op.duplicate).length;
  const activeCount = parsedOps.filter(op => !op.skip).length;
  const dupeWarning = dupeCount > 0 ? `<div style="background:var(--warning);color:white;padding:8px 12px;border-radius:8px;margin-bottom:8px;font-size:0.82rem">⚠️ ${dupeCount} doublon(s) détecté(s) et exclu(s) — recochez pour les inclure</div>` : '';

  const rows = parsedOps.map((op, i) => {
    const sign = op.type === 'credit' ? '+' : '-';
    const col = op.type === 'credit' ? 'var(--accent)' : 'var(--danger)';
    const dupeStyle = op.duplicate ? 'background:rgba(239,108,0,0.1);border-left:3px solid var(--warning);' : '';
    const checked = op.skip ? '' : 'checked';
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 4px;border-bottom:1px solid var(--border);flex-wrap:wrap;${dupeStyle}">
      <input type="checkbox" ${checked} onchange="parsedOps[${i}].skip=!this.checked" style="width:18px;height:18px;accent-color:var(--primary)"/>
      <span style="font-size:0.78rem;color:var(--muted);min-width:65px">${formatDate(op.date)}</span>
      <span style="flex:1;font-size:0.82rem;font-weight:600;min-width:80px">${op.label}${op.duplicate ? ' <span style="color:var(--warning);font-size:0.72rem">⚠️ doublon</span>' : ''}</span>
      <span style="font-weight:700;color:${col};font-size:0.85rem;min-width:70px;text-align:right">${sign}${fmt(op.amount)}</span>
      <select onchange="parsedOps[${i}].category=this.value" style="padding:4px 6px;font-size:0.75rem;min-width:90px">${catOptions.replace(`value="${op.category}"`, `value="${op.category}" selected`)}</select>
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
    localStorage.setItem('lastImportIds', JSON.stringify(importedIds));
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
  document.getElementById('import-validation-bar').classList.add('hidden');
  document.getElementById('import-validation-bar').style.display = 'none';
  toast('✅ Import validé');
});

document.getElementById('btn-import-cancel').addEventListener('click', () => {
  const ids = JSON.parse(localStorage.getItem('lastImportIds') || '[]');
  const count = ids.length;
  appData.operations = appData.operations.filter(op => !ids.includes(op.id));
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

// ── POINTAGE ────────────────────────────────────────────────────────────────
window.togglePointed = function(id) {
  const op = appData.operations.find(o => o.id === id);
  if (!op) return;
  op.pointed = !op.pointed;
  saveLocal();
  renderOperations();
  renderDashboard();
};

// ── MODIFICATION OPÉRATION ───────────────────────────────────────────────────
let _editOpId = null;
let _editOpDate = null; // date de l'occurrence cliquée

window.editOp = function(id, occurrenceDate) {
  const op = appData.operations.find(o => o.id === id);
  if (!op) return;
  _editOpId = id;
  _editOpDate = occurrenceDate || op.date;

  // Si c'est une opération programmée, demander le scope
  if (op.opType === 'Programmee') {
    document.getElementById('modal-edit-scope').classList.remove('hidden');
    return;
  }
  openEditModal(op);
};

function openEditModal(op) {
  const names = getAccountNames();
  const opts = names.map(n => `<option value="${n}">${n}</option>`).join('');
  document.getElementById('edit-op-account').innerHTML = opts;
  document.getElementById('edit-op-dest').innerHTML = opts;
  document.getElementById('edit-op-date').value     = op.date;
  document.getElementById('edit-op-label').value    = op.label;
  document.getElementById('edit-op-amount').value   = op.amount;
  const isVir = op.opType === 'Virement' || (op.label && op.label.match(/^\[.+\]$/));
  document.getElementById('edit-op-type').value     = isVir ? 'virement' : op.type;
  document.getElementById('edit-op-account').value  = op.account;
  document.getElementById('edit-op-category').value = op.category || 'Autre';
  toggleEditDest();
  if (isVir) {
    const destMatch = op.label.match(/^\[(.+)\]$/);
    if (destMatch) document.getElementById('edit-op-dest').value = destMatch[1];
  }
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
  if (op) openEditModal(op);
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
  const amount  = parseInt(document.getElementById('edit-op-amount').value, 10);
  const account = document.getElementById('edit-op-account').value;
  const category = document.getElementById('edit-op-category').value;

  // Si c'est une opération programmée modifiée "pour toutes les occurrences futures"
  // et que le mois édité n'est pas le tout premier de la série, on scinde en deux :
  // l'ancien modèle continue jusqu'au mois précédent, un nouveau modèle démarre à partir du mois édité.
  if (op.opType === 'Programmee' && _editOpDate) {
    const baseDate = op.nextPayment || op.date;
    const baseMonth = baseDate.substring(0, 7);
    const editMonth = _editOpDate.substring(0, 7);
    if (editMonth > baseMonth) {
      const [ey, em] = editMonth.split('-').map(Number);
      const prevMonthDate = new Date(ey, em - 2, 1);
      const endYear = prevMonthDate.getFullYear();
      const endMonthNum = prevMonthDate.getMonth() + 1;
      const lastDay = new Date(endYear, endMonthNum, 0).getDate();
      op.endDate = `${endYear}-${String(endMonthNum).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;

      const newTemplate = { ...op, id: uid(), date: _editOpDate, nextPayment: _editOpDate };
      delete newTemplate.endDate;
      delete newTemplate.exceptions;
      appData.operations.push(newTemplate);
      op = newTemplate; // les modifications ci-dessous s'appliquent au nouveau modèle
    }
  }

  if (typeVal === 'virement') {
    const dest = document.getElementById('edit-op-dest').value;
    if (account === dest) { toast('⚠️ Source et destination identiques'); return; }

    // Trouver l'ancien crédit correspondant (même date, même montant, label miroir)
    const oldDestMatch = op.label.match(/^\[(.+)\]$/);
    const oldDest = oldDestMatch ? oldDestMatch[1] : null;
    let existingCredit = null;
    if (oldDest) {
      existingCredit = appData.operations.find(o =>
        o.id !== op.id &&
        o.date === op.date &&
        o.amount === op.amount &&
        o.account === oldDest &&
        o.type === 'credit' &&
        o.label === `[${op.account}]`
      );
    }

    // Modifier l'opération débit (source)
    op.date = date;
    op.label = `[${dest}]`;
    op.amount = amount;
    op.type = 'debit';
    op.account = account;
    op.category = 'Virement';
    op.opType = 'Virement';

    if (existingCredit) {
      // Mettre à jour le crédit existant
      existingCredit.date = date;
      existingCredit.label = `[${account}]`;
      existingCredit.amount = amount;
      existingCredit.account = dest;
      toast(`✅ Virement modifié : ${account} → ${dest}`);
    } else {
      // Créer le crédit (conversion depuis débit/crédit simple)
      appData.operations.push({
        id: uid(), date, label: `[${account}]`, amount,
        type: 'credit', account: dest, category: 'Virement', opType: 'Virement',
      });
      toast(`✅ Converti en virement : ${account} → ${dest}`);
    }
  } else {
    op.date     = date;
    op.label    = label;
    op.amount   = amount;
    op.type     = typeVal;
    op.account  = account;
    op.category = category;
    toast('✅ Opération modifiée');
  }

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
  if (!confirm('Supprimer cette opération ?')) return;
  appData.operations = appData.operations.filter(o => o.id !== _editOpId);
  saveLocal();
  renderAll();
  document.getElementById('modal-edit-op').classList.add('hidden');
  _editOpId = null;
  toast('🗑 Opération supprimée');
  if (accessToken) uploadToDrive().catch(() => {});
});

// ── DÉCONNEXION ──────────────────────────────────────────────────────────────
document.getElementById('btn-logout').addEventListener('click', () => {
  if (accessToken) google.accounts.oauth2.revoke(accessToken, () => {});
  accessToken = null;
  driveFileId = null;
  localStorage.removeItem('gToken');
  showScreen('screen-login');
  toast('Déconnecté');
});

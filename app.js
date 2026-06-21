if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
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
    // Sync Drive silencieuse
    const waitG = setInterval(() => {
      if (typeof google !== 'undefined' && google.accounts) {
        clearInterval(waitG);
        initGoogleAuth();
        const saved = localStorage.getItem('gToken');
        if (saved) tokenClient.requestAccessToken({ prompt: '' });
      }
    }, 200);
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
  toast('🔒 Mot de passe défini');
  if (accessToken) uploadToDrive().catch(() => {});
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

function updatePwdStatus() {
  const has = !!getPwdHash();
  document.getElementById('pwd-status').innerHTML = has
    ? '<span style="color:var(--accent)">🔒 Mot de passe actif</span>'
    : '<span style="color:var(--muted)">🔓 Aucun mot de passe</span>';
  document.getElementById('btn-pwd-remove').style.display = has ? '' : 'none';
}

// ── STOCKAGE LOCAL ───────────────────────────────────────────────────────────
function saveLocal() {
  localStorage.setItem('finances_data', JSON.stringify(appData));
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
  if (resp.error) { toast('Erreur auth : ' + resp.error); return; }
  accessToken = resp.access_token;
  localStorage.setItem('gToken', accessToken);
  syncFromDrive();
}
document.getElementById('btn-login').addEventListener('click', () => {
  if (!tokenClient) { toast('Google API pas encore chargée, patientez…'); return; }
  tokenClient.requestAccessToken({ prompt: '' });
});
document.getElementById('btn-skip-login').addEventListener('click', () => {
  showScreen('screen-main');
  if (loadLocal()) renderAll();
});
window.addEventListener('load', () => {
  const hasData = loadLocal();
  const locked = checkLockScreen();
  if (!locked) {
    unlocked = true;
    if (hasData) {
      autoBackup();
      renderAll();
      showScreen('screen-main');
    }
  }
  setDefaultDate();
  updatePwdStatus();

  if (locked) return;
  const waitGoogle = setInterval(() => {
    if (typeof google !== 'undefined' && google.accounts) {
      clearInterval(waitGoogle);
      initGoogleAuth();
      tokenClient.requestAccessToken({ prompt: '' });
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
  if (res.status === 401) { tokenClient.requestAccessToken({ prompt: '' }); throw new Error('Token expiré'); }
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
  await fetch(`https://www.googleapis.com/upload/drive/v3/files/${driveFileId}?uploadType=media`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(appData, null, 2),
  });
  appData.lastSync = new Date().toISOString();
  saveLocal();
  updateSyncStatus();
}
async function syncFromDrive() {
  document.getElementById('sync-status').textContent = '⏳ Synchronisation…';
  try {
    const remote = await downloadFromDrive();
    if (remote) {
      const localTime = appData.lastSync ? new Date(appData.lastSync).getTime() : 0;
      const remoteTime = remote.lastSync ? new Date(remote.lastSync).getTime() : 0;
      if (remoteTime >= localTime || !appData.operations.length) {
        appData = remote;
        saveLocal();
        toast('✅ Données récupérées depuis Drive');
      } else {
        await uploadToDrive();
        toast('✅ Données locales envoyées vers Drive');
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
    toast('⚠️ ' + e.message);
    document.getElementById('sync-status').textContent = '⚠️ Erreur sync';
  }
}
function updateSyncStatus() {
  const el = document.getElementById('sync-status');
  const ls = document.getElementById('display-lastsync');
  if (appData.lastSync) {
    const d = new Date(appData.lastSync);
    const str = d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    el.textContent = '✅ Sync ' + str;
    if (ls) ls.textContent = str;
  }
}

// ── CALCULS ──────────────────────────────────────────────────────────────────
const CAT_ICONS = {
  Alimentation:'🛒', Transport:'🚗', Sante:'💊', Loisirs:'🎉',
  Logement:'🏠', Telecom:'📱', Revenus:'💰', Autre:'📦',
};

function calcAccountBalance(accountName, maxDate) {
  const acc = appData.accounts.find(a => a.name === accountName);
  const initial = acc ? (acc.initialBalance || 0) : 0;
  let cutoff;
  if (maxDate) {
    cutoff = maxDate;
  } else {
    const now = new Date();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    cutoff = `${endOfMonth.getFullYear()}-${String(endOfMonth.getMonth()+1).padStart(2,'0')}-${String(endOfMonth.getDate()).padStart(2,'0')}`;
  }

  const ops = appData.operations.filter(op =>
    (!accountName || op.account === accountName) &&
    op.opType !== 'Programmee' &&
    op.date <= cutoff
  );

  return initial + ops.reduce((sum, op) =>
    op.type === 'credit' ? sum + op.amount : sum - op.amount, 0);
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

function calcBillingBalance(accountName, refDate) {
  const acc = appData.accounts.find(a => a.name === accountName);
  if (!acc || acc.cardType !== 'deferred') return null;
  const d = refDate || new Date();
  const cycleStart = getBillingCycleStart(acc.billingCycleDay, d);
  const startStr = cycleStart.toISOString().split('T')[0];
  const endStr = d.toISOString().split('T')[0];

  const ops = appData.operations.filter(op =>
    op.account === accountName &&
    op.opType !== 'Programmee' &&
    op.date >= startStr && op.date <= endStr
  );
  return ops.reduce((sum, op) =>
    op.type === 'debit' ? sum + op.amount : sum - op.amount, 0);
}

function calcEncours(accountName, refDate) {
  const acc = appData.accounts.find(a => a.name === accountName);
  if (!acc || acc.cardType !== 'deferred') return null;
  const d = refDate || new Date();
  const cutoff = new Date(d);
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  const endStr = d.toISOString().split('T')[0];

  const ops = appData.operations.filter(op =>
    op.account === accountName &&
    op.opType !== 'Programmee' &&
    op.date >= cutoffStr && op.date <= endStr
  );
  return ops.reduce((sum, op) =>
    op.type === 'debit' ? sum + op.amount : sum - op.amount, 0);
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

function renderDashboard() {
  document.getElementById('display-balance').textContent = fmt(calcTotalBalance());

  const accNames = getAccountNames();
  const listAcc = document.getElementById('list-accounts');
  if (!accNames.length) {
    listAcc.innerHTML = '<li class="empty-state">Aucun compte</li>';
  } else {
    listAcc.innerHTML = accNames.map(name => {
      const bal = calcAccountBalance(name);
      const cls = bal >= 0 ? 'credit' : 'debit';
      const ops = appData.operations.filter(op => op.account === name).length;
      const acc = appData.accounts.find(a => a.name === name);
      const isDeferred = acc && acc.cardType === 'deferred';

      let extraHtml = '';
      if (isDeferred) {
        const billing = calcBillingBalance(name);
        const encours = calcEncours(name);
        const limit = acc.cardLimit || 0;
        const remaining = limit - encours;
        const pct = limit ? Math.round((encours / limit) * 100) : 0;
        const barCol = pct > 80 ? 'var(--danger)' : pct > 50 ? '#ef9f27' : 'var(--accent)';
        extraHtml = `
          <div style="width:100%;margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:0.78rem;display:flex;flex-direction:column;gap:6px">
            <div style="display:flex;justify-content:space-between">
              <span style="color:var(--muted)">Prochain prélèvement</span>
              <span style="font-weight:700;color:var(--danger)">${fmt(billing)}</span>
            </div>
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
          <div class="op-meta">${ops} opérations</div>
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

function renderOperations() {
  const accFilter  = document.getElementById('filter-account').value;
  const typeFilter = document.getElementById('filter-type').value;
  const catFilter  = document.getElementById('filter-category').value;
  const search     = document.getElementById('filter-search').value.trim().toLowerCase();
  const dateFrom   = document.getElementById('filter-date-from').value;
  const dateTo     = document.getElementById('filter-date-to').value;

  const monthNav = document.getElementById('ops-month-nav');
  const useMonthView = !!accFilter && !search && !dateFrom && !dateTo && !typeFilter && !catFilter;

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
  if (catFilter)  ops = ops.filter(op => op.category === catFilter);
  if (search)     ops = ops.filter(op => op.label.toLowerCase().includes(search));

  if (useMonthView) {
    // Solde en début de mois
    const monthStart = `${opsYear}-${String(opsMonth+1).padStart(2,'0')}-01`;
    const monthEnd   = `${opsYear}-${String(opsMonth+1).padStart(2,'0')}-31`;
    const acc = appData.accounts.find(a => a.name === accFilter);
    const initial = acc ? (acc.initialBalance || 0) : 0;
    const beforeOps = ops.filter(op => op.date < monthStart && op.opType !== 'Programmee');
    const balanceStart = initial + beforeOps.reduce((s, op) =>
      op.type === 'credit' ? s + op.amount : s - op.amount, 0);

    const now = new Date();
    const isFuture = opsYear > now.getFullYear() ||
      (opsYear === now.getFullYear() && opsMonth > now.getMonth());

    let monthOps;
    if (isFuture) {
      // Opérations programmées du mois
      const scheduled = scheduledOpsInMonth(opsYear, opsMonth, accFilter);
      scheduled.sort((a, b) => (a.nextPayment || a.date).localeCompare(b.nextPayment || b.date));
      monthOps = scheduled.map(op => ({ ...op, opType: 'Programmee' }));
    } else {
      monthOps = ops.filter(op => op.date >= monthStart && op.date <= monthEnd && op.opType !== 'Programmee');
    }

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

    let running = balanceStart;
    list.innerHTML = monthOps.map(op => {
      const delta = op.type === 'credit' ? op.amount : -op.amount;
      running += delta;
      const sign = op.type === 'credit' ? '+' : '-';
      const balCol = running >= 0 ? 'var(--accent)' : 'var(--danger)';
      return `<li style="flex-direction:column;align-items:stretch;gap:6px;padding:12px 16px;cursor:pointer" onclick="editOp('${op.id}')">
        <div style="display:flex;align-items:center;gap:12px">
          <span class="op-icon">${op.opType === 'Programmee' ? '🔁' : (CAT_ICONS[op.category] || '📦')}</span>
          <div class="op-info">
            <div class="op-label">${op.label}</div>
            <div class="op-meta">${formatDate(op.date)} · ${op.category || ''}${op.opType === 'Programmee' ? ' · programmée' : ''}</div>
          </div>
          <span class="op-amount ${op.type}">${sign}${fmt(op.amount)}</span>
        </div>
        <div style="text-align:right;font-size:0.78rem;color:${balCol};font-weight:600;border-top:1px solid var(--border);padding-top:5px">
          Solde : ${fmtN(running)} F
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
  return `<li style="cursor:pointer" onclick="editOp('${op.id}')">
    <span class="op-icon">${CAT_ICONS[op.category] || '📦'}</span>
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
document.getElementById('btn-filter-reset').addEventListener('click', () => {
  ['filter-account','filter-type','filter-category','filter-date-from','filter-date-to'].forEach(id =>
    document.getElementById(id).value = '');
  document.getElementById('filter-search').value = '';
  opsMonth = new Date().getMonth();
  opsYear  = new Date().getFullYear();
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
      saveLocal();
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
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>${title}</title>
    <style>
      body { font-family: -apple-system, sans-serif; padding: 20px; color: #1c1c1e; font-size: 12px; }
      h1 { font-size: 18px; margin-bottom: 4px; }
      h2 { font-size: 14px; color: #6b7280; margin-bottom: 12px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
      th { text-align: left; padding: 6px 8px; border-bottom: 2px solid #1a237e; font-size: 11px; color: #6b7280; }
      td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; }
      .right { text-align: right; }
      .debit { color: #e53935; }
      .credit { color: #43a047; }
      .bold { font-weight: 700; }
      .total-row { border-top: 2px solid #1a237e; font-weight: 700; font-size: 13px; }
      .section { margin-top: 20px; }
      @media print { body { padding: 0; } }
    </style>
  </head><body>${html}
    <script>window.print();window.onafterprint=()=>window.close();<\/script>
  </body></html>`);
  win.document.close();
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
    bycat[o.category] = (bycat[o.category] || 0) + o.amount;
  });
  const sorted = Object.entries(bycat).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxVal = sorted[0]?.[1] || 1;

  const catHtml = sorted.length ? sorted.map(([cat, val]) => {
    const pct = Math.round((val / maxVal) * 100);
    const col = CAT_COLORS[cat] || '#546e7a';
    return `<div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:0.8rem;margin-bottom:3px">
        <span>${CAT_ICONS[cat] || '📦'} ${cat}</span>
        <span style="font-weight:600">${fmt(val)}</span>
      </div>
      <div style="background:var(--border);border-radius:4px;height:8px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${col};border-radius:4px;transition:width 0.4s"></div>
      </div>
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
  const scheduled = appData.operations.filter(op =>
    op.opType === 'Programmee' &&
    (!accountFilter || op.account === accountFilter)
  );
  const result = [];
  for (const op of scheduled) {
    const base = op.nextPayment || op.date;
    if (!base) continue;
    const freq = op.detail || 'mensuelle';
    const baseDate = new Date(base + 'T00:00:00');
    const baseYear = baseDate.getFullYear();
    const baseMonth = baseDate.getMonth(); // 0-indexed
    const targetMonth = month; // 0-indexed
    const targetYear = year;
    const diffMonths = (targetYear - baseYear) * 12 + (targetMonth - baseMonth);
    if (diffMonths < 0) continue;
    if (op.endDate) {
      const endD = new Date(op.endDate + 'T00:00:00');
      const lastMonth = new Date(targetYear, targetMonth, 1);
      if (lastMonth > endD) continue;
    }
    let applies = false;
    if (freq === 'ponctuelle') applies = diffMonths === 0;
    else if (freq === 'mensuelle') applies = diffMonths >= 0;
    else if (freq === 'bimensuelle') applies = diffMonths >= 0 && diffMonths % 2 === 0;
    else if (freq === 'trimestrielle') applies = diffMonths >= 0 && diffMonths % 3 === 0;
    else if (freq === 'annuelle') applies = diffMonths >= 0 && diffMonths % 12 === 0;
    if (applies) result.push(op);
  }
  return result;
}

function calcProjection(accountFilter, horizonMonths) {
  // Solde de départ = solde au 1er du mois prochain (exclut les ops futures non encore passées)
  const now = new Date();
  const firstMonthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
  const nextMonthStart  = addMonths(firstMonthStart, 1);

  const allOps = appData.operations.filter(op =>
    (!accountFilter || op.account === accountFilter) &&
    op.opType !== 'Programmee'
  );

  const startOps = allOps.filter(op => op.date < nextMonthStart);
  const acc = accountFilter ? appData.accounts.find(a => a.name === accountFilter) : null;

  let startBalance;
  if (accountFilter) {
    const initial = acc ? (acc.initialBalance || 0) : 0;
    startBalance = initial + startOps.reduce((s, op) =>
      op.type === 'credit' ? s + op.amount : s - op.amount, 0);
  } else {
    // Tous les comptes
    startBalance = appData.accounts.reduce((total, a) => {
      const initial = a.initialBalance || 0;
      const ops2 = allOps.filter(op => op.account === a.name && op.date < nextMonthStart);
      return total + initial + ops2.reduce((s, op) =>
        op.type === 'credit' ? s + op.amount : s - op.amount, 0);
    }, 0);
  }

  const points  = [];
  const opLines = [];
  let balance = startBalance;

  for (let i = 1; i <= horizonMonths; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const mStart = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
    const mEnd   = addMonths(mStart, 1).slice(0,-2) + '31';

    // Opérations programmées du mois
    const scheduled = scheduledOpsInMonth(d.getFullYear(), d.getMonth(), accountFilter);

    // Opérations régulières futures dans ce mois (virements, etc.)
    const regular = allOps.filter(op => op.date >= mStart && op.date <= mEnd);

    // Fusionner et trier par date
    const monthOps = [
      ...regular.map(op => ({ ...op, _src: 'regular' })),
      ...scheduled.map(op => ({ ...op, _src: 'scheduled', opType: 'Programmee' })),
    ].sort((a, b) => (a.nextPayment || a.date).localeCompare(b.nextPayment || b.date));

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

  // SVG Chart
  const W = Math.max(500, horizonMonths * 42);
  const H = 180;
  const pad = { top: 20, right: 20, bottom: 40, left: 70 };
  const cw = W - pad.left - pad.right;
  const ch = H - pad.top - pad.bottom;

  const allBalances = [startBalance, ...points.map(p => p.balance)];
  const minB = Math.min(...allBalances);
  const maxB = Math.max(...allBalances);
  const range = maxB - minB || 1;

  const xScale = (i) => pad.left + (i / (points.length)) * cw;
  const yScale = (v) => pad.top + ch - ((v - minB) / range) * ch;

  const polyPoints = [
    `${xScale(0)},${yScale(startBalance)}`,
    ...points.map((p, i) => `${xScale(i + 1)},${yScale(p.balance)}`)
  ].join(' ');

  // Zero line
  const zeroY = minB <= 0 && maxB >= 0 ? yScale(0) : null;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(r => {
    const v = minB + r * range;
    const y = yScale(v);
    const label = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(v);
    return `<line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" stroke="var(--border)" stroke-dasharray="3,3"/>
            <text x="${pad.left - 4}" y="${y + 4}" text-anchor="end" font-size="9" fill="var(--muted)">${label}</text>`;
  }).join('');

  const xLabels = points.map((p, i) => {
    const x = xScale(i + 1);
    const show = horizonMonths <= 12 || i % Math.ceil(horizonMonths / 12) === 0;
    return show ? `<text x="${x}" y="${H - pad.bottom + 14}" text-anchor="middle" font-size="9" fill="var(--muted)">${p.label}</text>` : '';
  }).join('');

  const dots = points.map((p, i) => {
    const x = xScale(i + 1);
    const y = yScale(p.balance);
    const col = p.balance >= 0 ? 'var(--success)' : 'var(--danger)';
    return `<circle cx="${x}" cy="${y}" r="3" fill="${col}"/>`;
  }).join('');

  const svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;min-width:300px">
    ${gridLines}
    ${zeroY ? `<line x1="${pad.left}" y1="${zeroY}" x2="${W - pad.right}" y2="${zeroY}" stroke="var(--danger)" stroke-width="1" opacity="0.5"/>` : ''}
    <polyline points="${polyPoints}" fill="none" stroke="var(--primary)" stroke-width="2"/>
    ${dots}
    ${xLabels}
  </svg>`;
  document.getElementById('proj-chart').innerHTML = svg;

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

// ── MODIFICATION OPÉRATION ───────────────────────────────────────────────────
let _editOpId = null;

window.editOp = function(id) {
  const op = appData.operations.find(o => o.id === id);
  if (!op) return;
  _editOpId = id;
  const names = getAccountNames();
  const opts = names.map(n => `<option value="${n}">${n}</option>`).join('');
  document.getElementById('edit-op-account').innerHTML = opts;
  document.getElementById('edit-op-dest').innerHTML = opts;
  document.getElementById('edit-op-date').value     = op.date;
  document.getElementById('edit-op-label').value    = op.label;
  document.getElementById('edit-op-amount').value   = op.amount;
  document.getElementById('edit-op-type').value     = op.opType === 'Virement' ? 'virement' : op.type;
  document.getElementById('edit-op-account').value  = op.account;
  document.getElementById('edit-op-category').value = op.category || 'Autre';
  toggleEditDest();
  document.getElementById('modal-edit-op').classList.remove('hidden');
};

function toggleEditDest() {
  const isVirement = document.getElementById('edit-op-type').value === 'virement';
  document.getElementById('edit-op-dest-wrap').classList.toggle('hidden', !isVirement);
}
document.getElementById('edit-op-type').addEventListener('change', toggleEditDest);

document.getElementById('edit-op-cancel').addEventListener('click', () => {
  document.getElementById('modal-edit-op').classList.add('hidden');
  _editOpId = null;
});

document.getElementById('edit-op-confirm').addEventListener('click', () => {
  const op = appData.operations.find(o => o.id === _editOpId);
  if (!op) return;
  const typeVal = document.getElementById('edit-op-type').value;
  const date    = document.getElementById('edit-op-date').value;
  const label   = document.getElementById('edit-op-label').value.trim();
  const amount  = parseInt(document.getElementById('edit-op-amount').value, 10);
  const account = document.getElementById('edit-op-account').value;
  const category = document.getElementById('edit-op-category').value;

  if (typeVal === 'virement') {
    const dest = document.getElementById('edit-op-dest').value;
    if (account === dest) { toast('⚠️ Source et destination identiques'); return; }

    // Transformer l'opération existante en débit (source)
    op.date = date;
    op.label = `[${dest}]`;
    op.amount = amount;
    op.type = 'debit';
    op.account = account;
    op.category = 'Virement';
    op.opType = 'Virement';

    // Créer l'opération crédit (destination)
    appData.operations.push({
      id: uid(),
      date,
      label: `[${account}]`,
      amount,
      type: 'credit',
      account: dest,
      category: 'Virement',
      opType: 'Virement',
    });
    toast(`✅ Converti en virement : ${account} → ${dest}`);
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
  renderAll();
  document.getElementById('modal-edit-op').classList.add('hidden');
  _editOpId = null;
  if (accessToken) uploadToDrive().catch(() => {});
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

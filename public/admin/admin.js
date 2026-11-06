const API = location.hostname.includes('stayapi') || location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  ? ''
  : 'https://stayapi.zavvi.co.in';
const TOKEN_KEY = 'staypaws_admin_token';

const loginView = document.querySelector('#login');
const appView = document.querySelector('#app');
const loginForm = document.querySelector('#login-form');
const loginError = document.querySelector('#login-error');
const userRows = document.querySelector('#user-rows');
const purchaseRows = document.querySelector('#purchase-rows');
const detail = document.querySelector('#detail');
const usersPanel = document.querySelector('#users-panel');
const purchasesPanel = document.querySelector('#purchases-panel');

const state = {
  usersPage: 1,
  usersPages: 1,
  purchasesPage: 1,
  purchasesPages: 1,
  userQuery: '',
  userTier: 'all',
  purchaseQuery: '',
  tab: 'users',
};

function token() {
  return sessionStorage.getItem(TOKEN_KEY) || '';
}

function showLogin(message) {
  appView.hidden = true;
  loginView.hidden = false;
  loginError.hidden = !message;
  loginError.textContent = message || '';
}

function showApp() {
  loginView.hidden = true;
  appView.hidden = false;
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (token()) headers.Authorization = `Bearer ${token()}`;
  if (options.body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}/admin/api${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    sessionStorage.removeItem(TOKEN_KEY);
    showLogin(data.message || 'Sign in again.');
    throw new Error('unauthorized');
  }
  if (!response.ok) throw new Error(data.message || 'Request failed');
  return data;
}

function when(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function pill(tier) {
  const pro = tier === 'pro' || tier === 'guardian';
  return `<span class="pill ${pro ? '' : 'free'}">${pro ? tier : 'free'}</span>`;
}

async function loadOverview() {
  const data = await api('/overview');
  const cards = [
    ['Accounts', data.users],
    ['Logins', data.logins],
    ['Logged in today', data.loginsToday],
    ['People who have logged in', data.loggedInUsers],
    ['Pro now', data.proUsers],
    ['Active trials', data.trials],
    ['Purchases', data.purchases],
    ['Joined this week', data.joinedWeek],
  ];
  document.querySelector('#stats').innerHTML = cards.map(([label, value]) => (
    `<article><strong>${value ?? 0}</strong><span>${label}</span></article>`
  )).join('');
}

function userLine(user) {
  return `<tr class="clickable" data-user="${user.id}">
    <td>${escapeHtml(user.username)}<span class="sub">${escapeHtml(user.email)} · ${escapeHtml(user.provider)}</span></td>
    <td>${pill(user.tier)}</td>
    <td>${user.loginCount || 0}</td>
    <td>${when(user.lastLoginAt)}</td>
    <td>${user.totalFocusMinutes || 0} min<span class="sub">${user.completedSessions || 0} sessions</span></td>
    <td>${when(user.createdAt)}</td>
  </tr>`;
}

async function loadUsers() {
  const params = new URLSearchParams({
    page: String(state.usersPage),
    q: state.userQuery,
    tier: state.userTier,
  });
  const data = await api(`/users?${params}`);
  state.usersPages = data.pages;
  userRows.innerHTML = data.users.length
    ? data.users.map(userLine).join('')
    : '<tr><td colspan="6">No accounts match.</td></tr>';
  document.querySelector('#users-page').textContent = `${data.page} / ${data.pages} · ${data.total}`;
}

async function loadPurchases() {
  const params = new URLSearchParams({
    page: String(state.purchasesPage),
    q: state.purchaseQuery,
  });
  const data = await api(`/purchases?${params}`);
  state.purchasesPages = data.pages;
  purchaseRows.innerHTML = data.purchases.length
    ? data.purchases.map((purchase) => `<tr class="clickable" data-user="${purchase.user?.id || ''}">
        <td>${when(purchase.createdAt)}</td>
        <td>${escapeHtml(purchase.user?.username || 'Removed')}<span class="sub">${escapeHtml(purchase.user?.email || '')}</span></td>
        <td>${escapeHtml(purchase.source || '')}</td>
        <td>${escapeHtml(purchase.productId || purchase.type || '')}</td>
        <td>${purchase.amount ?? 0}</td>
        <td>${escapeHtml(purchase.status || '')}</td>
      </tr>`).join('')
    : '<tr><td colspan="6">No purchases match.</td></tr>';
  document.querySelector('#purchases-page').textContent = `${data.page} / ${data.pages} · ${data.total}`;
}

function field(label, value) {
  return `<div><span>${label}</span><strong>${escapeHtml(value ?? '—')}</strong></div>`;
}

async function openUser(id) {
  if (!id) return;
  const data = await api(`/users/${id}`);
  const user = data.user;
  usersPanel.hidden = true;
  purchasesPanel.hidden = true;
  detail.hidden = false;
  const purchases = data.purchases.length
    ? data.purchases.map((item) => `<tr>
        <td>${when(item.createdAt)}</td>
        <td>${escapeHtml(item.source || '')}</td>
        <td>${escapeHtml(item.productId || item.type || '')}</td>
        <td>${item.amount ?? 0}</td>
        <td>${escapeHtml(item.status || '')}</td>
      </tr>`).join('')
    : '<tr><td colspan="5">No purchases recorded.</td></tr>';
  const sessions = data.sessions.length
    ? data.sessions.map((item) => `<tr>
        <td>${when(item.createdAt)}</td>
        <td>${item.duration || 0} min</td>
        <td>${escapeHtml(item.status || '')}</td>
        <td>${escapeHtml(item.tag || '—')}</td>
        <td>${item.kibbleEarned || 0}</td>
      </tr>`).join('')
    : '<tr><td colspan="5">No focus sessions recorded.</td></tr>';

  detail.querySelector('#detail-body').innerHTML = `
    <h2>${escapeHtml(user.username)}</h2>
    <p class="muted">${escapeHtml(user.email)}</p>
    <div class="actions">
      <label>Days <input id="pro-days" type="number" min="1" max="365" value="30" /></label>
      <button type="button" id="grant-pro">Make Pro</button>
      <button type="button" id="revoke-pro" class="danger">Revoke Pro</button>
    </div>
    <p class="muted">Revoke keeps this account free until you grant Pro again. A store renewal will not turn it back on.</p>
    <div class="detail-grid">
      ${field('Plan', user.tier)}
      ${field('Stored tier', user.subscriptionTier)}
      ${field('Access until', when(user.subscriptionExpiry))}
      ${field('Platform', user.subscriptionPlatform)}
      ${field('Trial ends', when(user.trialEndDate))}
      ${field('Admin lock', user.adminProLock || 'none')}
      ${field('Provider', user.provider)}
      ${field('Email verified', user.emailVerified ? 'Yes' : 'No')}
      ${field('Logins', String(user.loginCount || 0))}
      ${field('Last login', when(user.lastLoginAt))}
      ${field('Joined', when(user.createdAt))}
      ${field('Focus minutes', String(user.totalFocusMinutes || 0))}
      ${field('Sessions', String(user.completedSessions || 0))}
      ${field('Streak', `${user.currentStreak || 0} current / ${user.longestStreak || 0} best`)}
      ${field('Kibble', String(user.totalKibble || 0))}
      ${field('Meals', String(user.totalMealsProvided || 0))}
      ${field('Breed', user.activeBreed)}
      ${field('Breeds', (user.unlockedBreeds || []).join(', '))}
      ${field('Goal', user.dailyGoalMinutes ? `${user.dailyGoalMinutes} min` : '—')}
      ${field('Tags', (user.focusTags || []).join(', '))}
      ${field('Razorpay', user.razorpaySubscriptionId)}
      ${field('RevenueCat', user.revenuecatId)}
      ${field('Cancelled', user.subscriptionCancelled ? 'Yes' : 'No')}
    </div>
    <h2>Purchases</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>When</th><th>Source</th><th>Product</th><th>Amount</th><th>Status</th></tr></thead>
      <tbody>${purchases}</tbody>
    </table></div>
    <h2>Recent focus sessions</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>When</th><th>Length</th><th>Status</th><th>Tag</th><th>Kibble</th></tr></thead>
      <tbody>${sessions}</tbody>
    </table></div>
  `;
  detail.querySelector('#grant-pro').onclick = async () => {
    const days = Number(detail.querySelector('#pro-days').value) || 30;
    await api(`/users/${id}/pro`, { method: 'POST', body: JSON.stringify({ days }) });
    await openUser(id);
    loadOverview();
  };
  detail.querySelector('#revoke-pro').onclick = async () => {
    if (!window.confirm(`Revoke Pro for ${user.email}?`)) return;
    await api(`/users/${id}/revoke`, { method: 'POST', body: '{}' });
    await openUser(id);
    loadOverview();
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function showTab(name) {
  state.tab = name;
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === name);
  });
  detail.hidden = true;
  usersPanel.hidden = name !== 'users';
  purchasesPanel.hidden = name !== 'purchases';
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.hidden = true;
  const body = {
    email: String(new FormData(loginForm).get('email') || '').trim(),
    password: String(new FormData(loginForm).get('password') || '').trim(),
  };
  try {
    const data = await api('/login', { method: 'POST', body: JSON.stringify(body) });
    sessionStorage.setItem(TOKEN_KEY, data.token);
    showApp();
    await Promise.all([loadOverview(), loadUsers(), loadPurchases()]);
  } catch (error) {
    if (error.message !== 'unauthorized') {
      loginError.hidden = false;
      loginError.textContent = error.message;
    }
  }
});

document.querySelector('#logout').onclick = () => {
  sessionStorage.removeItem(TOKEN_KEY);
  showLogin('');
};

document.querySelectorAll('.tab').forEach((tab) => {
  tab.onclick = () => showTab(tab.dataset.tab);
});

document.querySelector('#user-search').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  state.userQuery = String(form.get('q') || '');
  state.userTier = String(form.get('tier') || 'all');
  state.usersPage = 1;
  loadUsers();
});

document.querySelector('#purchase-search').addEventListener('submit', (event) => {
  event.preventDefault();
  state.purchaseQuery = String(new FormData(event.currentTarget).get('q') || '');
  state.purchasesPage = 1;
  loadPurchases();
});

document.querySelector('#users-prev').onclick = () => {
  if (state.usersPage <= 1) return;
  state.usersPage -= 1;
  loadUsers();
};
document.querySelector('#users-next').onclick = () => {
  if (state.usersPage >= state.usersPages) return;
  state.usersPage += 1;
  loadUsers();
};
document.querySelector('#purchases-prev').onclick = () => {
  if (state.purchasesPage <= 1) return;
  state.purchasesPage -= 1;
  loadPurchases();
};
document.querySelector('#purchases-next').onclick = () => {
  if (state.purchasesPage >= state.purchasesPages) return;
  state.purchasesPage += 1;
  loadPurchases();
};

userRows.addEventListener('click', (event) => {
  const row = event.target.closest('tr[data-user]');
  if (row) openUser(row.dataset.user);
});
purchaseRows.addEventListener('click', (event) => {
  const row = event.target.closest('tr[data-user]');
  if (row?.dataset.user) openUser(row.dataset.user);
});
document.querySelector('#detail-back').onclick = () => {
  detail.hidden = true;
  showTab(state.tab);
  if (state.tab === 'users') loadUsers();
};

if (token()) {
  showApp();
  Promise.all([loadOverview(), loadUsers(), loadPurchases()]).catch(() => {});
}

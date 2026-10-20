/* ============================================================
   dashboard.js — Auth guard, wallet, navigation, transactions
   ============================================================ */

const API = 'http://localhost:3000/api';

const SUPABASE_URL = 'https://xmfncndcmxnwsrecudkz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NqLUYTQy3pcXHTIMJQGt7w_q9i16NMP';

/* ── Auth guard with token refresh ──────────────────────── */
let token = localStorage.getItem('tp_token');
let user  = JSON.parse(localStorage.getItem('tp_user') || 'null');

if (!token || !user) {
  window.location.replace('index.html');
}

// Silently refresh if token is expired or expiring within 5 minutes
(async function refreshIfNeeded() {
  const expiresAt = parseInt(localStorage.getItem('tp_expires_at') || '0');
  const now       = Math.floor(Date.now() / 1000);
  if (!expiresAt || expiresAt - now > 300) return; // still fresh

  try {
    const sb           = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false
      }
    });
    const refreshToken = localStorage.getItem('tp_refresh');
    if (!sb || !refreshToken) { localStorage.clear(); window.location.replace('index.html'); return; }

    const { data, error } = await sb.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) {
      localStorage.removeItem('tp_token');
      localStorage.removeItem('tp_refresh');
      localStorage.removeItem('tp_user');
      localStorage.removeItem('tp_expires_at');
      window.location.replace('index.html');
      return;
    }

    token = data.session.access_token;
    user  = data.user;
    localStorage.setItem('tp_token',      data.session.access_token);
    localStorage.setItem('tp_refresh',    data.session.refresh_token);
    localStorage.setItem('tp_user',       JSON.stringify(data.user));
    localStorage.setItem('tp_expires_at', data.session.expires_at);
  } catch (err) {
    console.warn('Token refresh failed:', err);
  }
})();

/* ── Toast ───────────────────────────────────────────────── */
function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `show ${type}`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = 'hide'; }, 3500);
}

/* ── Authenticated fetch ─────────────────────────────────── */
async function apiFetch(path, options = {}) {
  try {
    const res = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
        ...(options.headers || {})
      }
    });

    if (res.status === 401) {
      // Token rejected — clear everything so index.html won't loop back
      localStorage.clear();
      window.location.replace('index.html');
      return null;
    }

    return res;
  } catch (err) {
    // Network-level failure — server down or unreachable
    const msg = err.message?.includes('fetch')
      ? 'Cannot reach server. Make sure the backend is running on port 3000.'
      : `Network error: ${err.message}`;
    showToast(msg, 'error');
    console.error('apiFetch error:', err);
    return null;
  }
}

/* ── Format currency ─────────────────────────────────────── */
function fmt(amount) {
  return '₦' + Number(amount).toLocaleString('en-NG', { minimumFractionDigits: 2 });
}

/* ── Format date ─────────────────────────────────────────── */
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-NG', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

/* ── User info in header ─────────────────────────────────── */
(function initUserInfo() {
  const meta      = user.user_metadata || {};
  const fullName  = meta.full_name || user.email?.split('@')[0] || 'User';
  const email     = user.email || '';
  const initials  = fullName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();

  document.getElementById('userName').textContent    = fullName;
  document.getElementById('userEmail').textContent   = email;
  document.getElementById('userInitials').textContent = initials;
  apiFetch('/transfer/account').then(async (response) => {
    if (response?.ok) {
      const data = await response.json();
      document.getElementById('userAccountNumber').textContent = `Account: ${data.accountNumber}`;
    }
  });

  // Date in header
  document.getElementById('pageDate').textContent =
    new Date().toLocaleDateString('en-NG', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
})();

/* ── Panel navigation ────────────────────────────────────── */
const panels   = document.querySelectorAll('.panel');
const navLinks = document.querySelectorAll('[data-panel]');

function switchPanel(name) {
  panels.forEach(p => p.classList.remove('active'));
  navLinks.forEach(l => {
    l.classList.remove('active');
    // mobile bottom nav
    if (l.classList.contains('mobile-nav-btn')) l.classList.remove('active');
  });

  const target = document.getElementById(`panel-${name}`);
  if (target) target.classList.add('active');

  navLinks.forEach(l => {
    if (l.dataset.panel === name) {
      l.classList.add('active');
    }
  });

  // Update page title
  const titles = {
    overview: 'Overview', data: 'Buy Data', airtime: 'Airtime', transfer: 'Send Money',
    tv: 'TV Subscription', bills: 'Bills Payment',
    scan: 'Scan to Pay', history: 'Transactions'
  };
  document.getElementById('pageTitle').textContent = titles[name] || name;

  // Load data for certain panels
  if (name === 'history') loadTransactions();
  if (name === 'overview') { loadWallet(); loadRecentTxns(); }
}

navLinks.forEach(btn => {
  btn.addEventListener('click', () => {
    const panel = btn.dataset.panel;
    if (panel) switchPanel(panel);
  });
});

/* ── TRANSFER ────────────────────────────────────────────── */
document.getElementById('transferForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const spinner = form.querySelector('.btn-spinner');
  const recipientAccountNumber = document.getElementById('recipientAccountNumber').value.trim();
  const amount = Number(document.getElementById('transferAmount').value);
  const note = document.getElementById('transferNote').value.trim();

  if (!/^\d{10}$/.test(recipientAccountNumber) || !Number.isFinite(amount) || amount < 1) {
    showToast('Enter a valid recipient and amount.', 'error');
    return;
  }

  button.disabled = true;
  spinner?.classList.remove('hidden');
  try {
    const response = await apiFetch('/transfer', {
      method: 'POST',
      body: JSON.stringify({ recipientAccountNumber, amount, note })
    });
    if (!response) return;
    const data = await response.json();
    if (!response.ok) {
      showToast(data.error || 'Transfer failed.', 'error');
      return;
    }
    showToast(`Transfer sent. New balance: ${fmt(data.newBalance)}`, 'success');
    form.reset();
    loadWallet();
    loadRecentTxns();
  } catch (error) {
    showToast(`Transfer error: ${error.message || 'Network error'}`, 'error');
  } finally {
    button.disabled = false;
    spinner?.classList.add('hidden');
  }
});

// Quick-action cards inside overview
document.querySelectorAll('.quick-action').forEach(btn => {
  btn.addEventListener('click', () => {
    const panel = btn.dataset.panel;
    if (panel) switchPanel(panel);
  });
});

/* ── Wallet ──────────────────────────────────────────────── */
async function loadWallet() {
  const el = document.getElementById('walletBalance');
  try {
    const res  = await apiFetch('/wallet');
    if (!res) return;
    const data = await res.json();
    el.textContent = fmt(data.balance);
  } catch {
    el.textContent = '—';
  }
}

/* ── Fund wallet (Paystack popup) ────────────────────────── */
let paystackPublicKey = '';

async function fetchPaystackKey() {
  try {
    const res  = await fetch(`${API}/config`);
    const data = await res.json();
    paystackPublicKey = data.paystackPublicKey;
  } catch {
    console.warn('Could not fetch Paystack public key');
  }
}

fetchPaystackKey();

// Open fund modal
document.getElementById('fundWalletBtn')?.addEventListener('click', () => {
  const m = document.getElementById('fundModal');
  m.classList.remove('hidden');
  m.style.display = 'flex';
});

document.getElementById('closeFundModal')?.addEventListener('click', () => {
  document.getElementById('fundModal').style.display = 'none';
});

// Quick amount buttons in fund modal
document.querySelectorAll('.fund-quick').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('fundAmount').value = btn.dataset.fund;
  });
});

// Proceed to Paystack
document.getElementById('proceedFundBtn')?.addEventListener('click', async () => {
  const amount = parseInt(document.getElementById('fundAmount').value);
  if (!amount || amount < 100) {
    showToast('Minimum funding amount is ₦100', 'error'); return;
  }
  if (!paystackPublicKey) {
    showToast('Payment service is not ready. Start the backend and try again.', 'error'); return;
  }

  const btn = document.getElementById('proceedFundBtn');
  const spin = btn.querySelector('.btn-spinner');
  btn.disabled = true;
  spin?.classList.remove('hidden');

  try {
    const res  = await apiFetch('/wallet/initialize', {
      method: 'POST',
      body:   JSON.stringify({ amount })
    });
    if (!res) return;
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Could not initialize payment', 'error');
      return;
    }

    // Launch Paystack popup
    const handler = PaystackPop.setup({
      key:       paystackPublicKey,
      email:     user.email,
      amount:    amount * 100,
      currency:  'NGN',
      ref:       data.reference,
      onSuccess: async (transaction) => {
        showToast('Payment received! Verifying…', 'info');
        document.getElementById('fundModal').style.display = 'none';
        await verifyPayment(transaction.reference);
      },
      onCancel: () => {
        showToast('Payment cancelled', 'info');
      }
    });
    handler.openIframe();

  } catch (err) {
    showToast(`Error: ${err.message || 'Network error'}`, 'error');
    console.error('Fund wallet error:', err);
  } finally {
    btn.disabled = false;
    spin?.classList.add('hidden');
  }
});

async function verifyPayment(reference) {
  try {
    const res  = await apiFetch('/wallet/verify', {
      method: 'POST',
      body:   JSON.stringify({ reference })
    });
    if (!res) return;
    const data = await res.json();

    if (res.ok) {
      showToast(`Wallet funded! New balance: ${fmt(data.newBalance)}`, 'success');
      loadWallet();
      loadRecentTxns();
    } else {
      showToast(data.error || 'Verification failed', 'error');
    }
  } catch (err) {
    showToast(`Verification error: ${err.message || 'Unknown'}`, 'error');
    console.error('Verify payment error:', err);
  }
}

/* ── Transaction helpers ─────────────────────────────────── */
const typeIcon = {
  wallet_funding:  '💳',
  airtime:         '📱',
  data:            '📶',
  tv_subscription: '📺',
  bills:           '⚡',
  transfer:        '↔️'
};

function txnCard(txn) {
  const icon  = typeIcon[txn.type] || '💰';
  const sign  = txn.type === 'wallet_funding' ? '+' : '-';
  const color = txn.type === 'wallet_funding' ? 'text-green-600' : 'text-gray-800';

  return `
    <div class="flex items-center gap-4 bg-white p-4 rounded-xl border border-brand-100 hover:shadow-sm transition">
      <div class="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center text-xl shrink-0">
        ${icon}
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium text-gray-800 truncate">${txn.description || txn.type}</p>
        <p class="text-xs text-gray-400">${fmtDate(txn.created_at)}</p>
      </div>
      <div class="text-right shrink-0">
        <p class="text-sm font-bold ${color}">${sign}${fmt(txn.amount)}</p>
        <span class="txn-badge ${txn.status}">${txn.status}</span>
      </div>
    </div>`;
}

/* ── Recent txns (overview) ──────────────────────────────── */
async function loadRecentTxns() {
  const container = document.getElementById('recentTxns');
  container.innerHTML = '<p class="text-center py-6 text-gray-400 text-sm">Loading…</p>';
  try {
    const res  = await apiFetch('/services/transactions?page=1&limit=5');
    if (!res) return;
    const data = await res.json();

    if (!data.transactions?.length) {
      container.innerHTML = '<p class="text-center py-8 text-gray-400 text-sm">No transactions yet. Fund your wallet to get started!</p>';
      return;
    }
    container.innerHTML = data.transactions.map(txnCard).join('');
  } catch {
    container.innerHTML = '<p class="text-center py-6 text-red-400 text-sm">Failed to load transactions</p>';
  }
}

/* ── Full transaction history ────────────────────────────── */
let txnPage = 1;

async function loadTransactions(page = 1) {
  txnPage = page;
  const container  = document.getElementById('txnsList');
  const pagination = document.getElementById('txnPagination');
  container.innerHTML  = '<p class="text-center py-10 text-gray-400 text-sm">Loading…</p>';
  pagination.innerHTML = '';

  try {
    const res  = await apiFetch(`/services/transactions?page=${page}&limit=20`);
    if (!res) return;
    const data = await res.json();

    if (!data.transactions?.length) {
      container.innerHTML = '<p class="text-center py-12 text-gray-400 text-sm">No transactions yet.</p>';
      return;
    }

    container.innerHTML = data.transactions.map(txnCard).join('');

    // Pagination
    const totalPages = Math.ceil(data.total / 20);
    if (totalPages > 1) {
      for (let i = 1; i <= totalPages; i++) {
        const btn = document.createElement('button');
        btn.textContent = i;
        btn.className   = i === page
          ? 'w-9 h-9 rounded-lg bg-brand-500 text-white text-sm font-semibold'
          : 'w-9 h-9 rounded-lg border border-brand-200 text-brand-600 text-sm hover:bg-brand-50';
        btn.addEventListener('click', () => loadTransactions(i));
        pagination.appendChild(btn);
      }
    }
  } catch {
    container.innerHTML = '<p class="text-center py-8 text-red-400 text-sm">Failed to load transactions</p>';
  }
}

document.getElementById('refreshTxnsBtn')?.addEventListener('click', () => loadTransactions(txnPage));

/* ── Logout ──────────────────────────────────────────────── */
document.getElementById('logoutBtn')?.addEventListener('click', () => {
  localStorage.clear();
  window.location.href = 'index.html';
});

/* ── Init ────────────────────────────────────────────────── */
loadWallet();
loadRecentTxns();

// Handle ?fund=success redirect from Paystack callback URL
const params = new URLSearchParams(window.location.search);
if (params.get('fund') === 'success') {
  const ref = params.get('reference') || params.get('trxref');
  if (ref) {
    showToast('Verifying your payment…', 'info');
    verifyPayment(ref).then(() => {
      window.history.replaceState({}, '', 'dashboard.html');
    });
  }
}

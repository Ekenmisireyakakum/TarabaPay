/* ============================================================
   auth.js  —  TarabaPay authentication
  Uses Supabase for signup and the backend for phone-based login.
   ============================================================ */

const SUPABASE_URL = 'https://xmfncndcmxnwsrecudkz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NqLUYTQy3pcXHTIMJQGt7w_q9i16NMP';
const AUTH_API = 'http://localhost:3000/api/auth';
let pendingConfirmationEmail = '';

function phoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function isSupabaseConnectionError(error) {
  return /failed to fetch|network|name_not_resolved/i.test(error?.message || '');
}

function authErrorMessage(error, fallback) {
  const errorText = `${error?.message || ''} ${error?.code || ''}`.toLowerCase();
  if (error?.code === 'user_already_exists' || errorText.includes('already registered') || errorText.includes('already been registered')) {
    return 'This email already has an account. Use another email or a supported alias such as name+2@example.com.';
  }
  if (error?.code === 'invalid_credentials') {
    return 'Phone number or password is incorrect. Confirm your email before signing in.';
  }
  if (error?.code === 'email_not_confirmed') {
    return 'Confirm your email address before signing in with your phone number.';
  }
  if (error?.status === 422 || errorText.includes('database error saving new user')) {
    return 'Supabase could not create this account. The email may already be registered, or the signup database trigger needs to be updated.';
  }
  if (errorText.includes('sending confirmation email')) {
    return 'Supabase could not send the confirmation email. Check Supabase Email/SMTP settings, or try again later.';
  }
  if (errorText.includes('rate limit')) {
    return 'Too many email attempts. Wait a few minutes before requesting another confirmation email.';
  }
  return isSupabaseConnectionError(error)
    ? 'Cannot connect to Supabase. Check SUPABASE_URL in the project configuration.'
    : (error?.message || fallback);
}

function saveSession(session, account) {
  localStorage.setItem('tp_token', session.access_token);
  localStorage.setItem('tp_refresh', session.refresh_token);
  localStorage.setItem('tp_user', JSON.stringify(account));
  localStorage.setItem('tp_expires_at', session.expires_at);
}

/* ── Wait for Supabase SDK to be ready ───────────────────── */
function getSupabase() {
  if (typeof window.supabase === 'undefined') return null;
  if (!window._sbClient) {
    window._sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false
      }
    });
  }
  return window._sbClient;
}

/* ── Toast ───────────────────────────────────────────────── */
function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `show ${type}`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = 'hide'; }, 3500);
}

/* ── Alert inside modal ──────────────────────────────────── */
function setAlert(msg, isError = true) {
  const el = document.getElementById('authAlert');
  if (!el) return;
  el.textContent = msg;
  el.className = isError
    ? 'mb-4 p-3 rounded-lg text-sm font-medium bg-red-50 text-red-600 border border-red-200'
    : 'mb-4 p-3 rounded-lg text-sm font-medium bg-green-50 text-green-700 border border-green-200';
  el.classList.remove('hidden');
}

function clearAlert() {
  const el = document.getElementById('authAlert');
  if (!el) return;
  el.classList.add('hidden');
  el.textContent = '';
  document.getElementById('resendConfirmationBtn')?.classList.add('hidden');
}

async function resendConfirmationEmail() {
  const email = pendingConfirmationEmail;
  const sb = getSupabase();
  if (!sb || !email) return;

  const button = document.getElementById('resendConfirmationBtn');
  if (button) button.disabled = true;

  try {
    const { error } = await sb.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: `${window.location.origin}/index.html` }
    });

    if (error) setAlert(authErrorMessage(error, 'Could not resend the confirmation email.'));
    else setAlert(`A new confirmation email was sent to ${email}. Check your inbox and spam folder.`, false);
  } catch (error) {
    setAlert(authErrorMessage(error, 'Could not resend the confirmation email.'));
    console.error('Confirmation email error:', error);
  } finally {
    if (button) button.disabled = false;
  }
}

/* ── Button loading state ────────────────────────────────── */
function setLoading(form, loading) {
  const btn  = form.querySelector('button[type="submit"]');
  const text = form.querySelector('[id$="BtnText"]');
  const spin = form.querySelector('[id$="Spinner"]');
  if (btn)  btn.disabled = loading;
  if (text) text.textContent = loading
    ? (form.id === 'loginForm' ? 'Signing in…' : 'Creating account…')
    : (form.id === 'loginForm' ? 'Sign In'      : 'Create Account');
  if (spin) spin.classList.toggle('hidden', !loading);
}

/* ── Modal open / close ──────────────────────────────────── */
const modal = document.getElementById('authModal');

function openModal(tab = 'login') {
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  switchTab(tab);
  clearAlert();
}

function closeModal() {
  modal.style.display = 'none';
  document.body.style.overflow = '';
}

/* ── Tab switcher ────────────────────────────────────────── */
function switchTab(tab) {
  const loginForm  = document.getElementById('loginForm');
  const signupForm = document.getElementById('signupForm');
  const tabLogin   = document.getElementById('tabLogin');
  const tabSignup  = document.getElementById('tabSignup');
  const title      = document.getElementById('modalTitle');
  const subtitle   = document.getElementById('modalSubtitle');

  clearAlert();

  if (tab === 'login') {
    loginForm.classList.remove('hidden');
    signupForm.classList.add('hidden');
    tabLogin.classList.add('bg-white', 'text-brand-600', 'shadow');
    tabLogin.classList.remove('text-gray-400');
    tabSignup.classList.remove('bg-white', 'text-brand-600', 'shadow');
    tabSignup.classList.add('text-gray-400');
    title.textContent    = 'Welcome back';
    subtitle.textContent = 'Sign in to your TarabaPay account';
  } else {
    signupForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
    tabSignup.classList.add('bg-white', 'text-brand-600', 'shadow');
    tabSignup.classList.remove('text-gray-400');
    tabLogin.classList.remove('bg-white', 'text-brand-600', 'shadow');
    tabLogin.classList.add('text-gray-400');
    title.textContent    = 'Create account';
    subtitle.textContent = "Join TarabaPay — it's free";
  }
}

/* ── Wire nav / hero buttons ─────────────────────────────── */
document.getElementById('navLoginBtn')  ?.addEventListener('click', () => openModal('login'));
document.getElementById('navSignupBtn') ?.addEventListener('click', () => openModal('signup'));
document.getElementById('heroLoginBtn') ?.addEventListener('click', () => openModal('login'));
document.getElementById('heroSignupBtn')?.addEventListener('click', () => openModal('signup'));
document.getElementById('closeModal')   ?.addEventListener('click', closeModal);
document.getElementById('tabLogin')     ?.addEventListener('click', () => switchTab('login'));
document.getElementById('tabSignup')    ?.addEventListener('click', () => switchTab('signup'));
document.getElementById('resendConfirmationBtn')?.addEventListener('click', resendConfirmationEmail);
document.getElementById('signupPhone')?.addEventListener('input', (event) => {
  const number = phoneDigits(event.target.value);
  const preview = document.getElementById('signupAccountPreview');
  const accountNumber = document.getElementById('signupAccountNumber');
  if (accountNumber) accountNumber.value = number.length >= 10 ? number.slice(-10) : '';
  if (preview) preview.textContent = number.length >= 10
    ? 'This phone identifies your account. A unique account number will be created when you sign up.'
    : 'Enter your phone number to create an account number.';
});

modal?.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

/* ── LOGIN ───────────────────────────────────────────────── */
document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAlert();

  const phone    = document.getElementById('loginPhone').value.trim();
  const password = document.getElementById('loginPassword').value;
  const form     = e.target;

  if (phoneDigits(phone).length < 10 || !password) {
    setAlert('Please enter your phone number and password.');
    return;
  }

  setLoading(form, true);

  try {
    const response = await fetch(`${AUTH_API}/login-phone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password })
    });
    const result = await response.json();
    if (!response.ok) {
      setAlert(result.error || 'Login failed. Check your credentials.');
      setLoading(form, false);
      return;
    }

    saveSession({
      access_token: result.token,
      refresh_token: result.refreshToken,
      expires_at: result.expiresAt
    }, result.user);

    showToast('Logged in successfully!', 'success');
    setTimeout(() => { window.location.replace('dashboard.html'); }, 700);

  } catch (err) {
    setAlert(authErrorMessage(err, 'Something went wrong. Please try again.'));
    console.error('Login error:', err);
    setLoading(form, false);
  }
});

/* ── SIGNUP ──────────────────────────────────────────────── */
document.getElementById('signupForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAlert();

  const sb = getSupabase();
  if (!sb) {
    setAlert('Auth SDK not loaded yet — refresh the page and try again.');
    return;
  }

  const fullName = document.getElementById('signupName').value.trim();
  const phone    = document.getElementById('signupPhone').value.trim();
  const email    = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  const form     = e.target;

  if (!fullName)          { setAlert('Please enter your full name.'); return; }
  if (phoneDigits(phone).length < 10) { setAlert('Phone number must contain at least 10 digits.'); return; }
  if (!email)             { setAlert('Please enter your email.'); return; }
  if (password.length < 8){ setAlert('Password must be at least 8 characters.'); return; }

  pendingConfirmationEmail = email;
  setLoading(form, true);

  try {
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, phone: phoneDigits(phone).slice(-10) },
        emailRedirectTo: `${window.location.origin}/index.html`
      }
    });

    if (error) {
      setAlert(authErrorMessage(error, 'Signup failed.'));
      if (/confirmation email|email provider/i.test(error.message || '')) {
        document.getElementById('resendConfirmationBtn')?.classList.remove('hidden');
      }
      setLoading(form, false);
      return;
    }

    if (data.session) {
      // Auto-confirmed — store and go
      localStorage.setItem('tp_token',      data.session.access_token);
      localStorage.setItem('tp_refresh',    data.session.refresh_token);
      localStorage.setItem('tp_user',       JSON.stringify(data.user));
      localStorage.setItem('tp_expires_at', data.session.expires_at);
      showToast('Account created! Redirecting…', 'success');
      setTimeout(() => { window.location.replace('dashboard.html'); }, 700);
    } else {
      // Email confirmation required
      pendingConfirmationEmail = email;
      setAlert(`Account created for ${email}. Check your inbox and spam folder for the confirmation email, then log in.`, false);
      document.getElementById('resendConfirmationBtn')?.classList.remove('hidden');
      setLoading(form, false);
      setTimeout(() => switchTab('login'), 5500);
    }

  } catch (err) {
    setAlert(authErrorMessage(err, 'Something went wrong. Please try again.'));
    console.error('Signup error:', err);
    setLoading(form, false);
  }
});

/* ── Session check on page load ──────────────────────────────
   Only redirect to dashboard if the token exists AND is not
   expired. Stale/expired tokens are cleared so the user
   lands on the login page cleanly instead of looping.       */
(function checkExistingSession() {
  const token     = localStorage.getItem('tp_token');
  const expiresAt = localStorage.getItem('tp_expires_at');

  if (!token) return; // not logged in — stay on landing page

  // Check expiry (Supabase stores this as a Unix timestamp in seconds)
  const now = Math.floor(Date.now() / 1000);
  if (expiresAt && parseInt(expiresAt) < now) {
    // Token expired — clear everything and stay on landing page
    localStorage.removeItem('tp_token');
    localStorage.removeItem('tp_refresh');
    localStorage.removeItem('tp_user');
    localStorage.removeItem('tp_expires_at');
    return;
  }

  // Token looks valid — go to dashboard
  window.location.replace('dashboard.html');
})();

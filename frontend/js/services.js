/* ============================================================
   services.js — Data, Airtime, TV, Bills, Scan forms
   Depends on: dashboard.js (API, apiFetch, showToast, fmt, loadWallet)
   ============================================================ */

/* ── Generic submit handler ──────────────────────────────── */
async function handleService(formId, endpoint, buildPayload, onSuccess) {
  const form = document.getElementById(formId);
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const btn  = form.querySelector('.tp-btn');
    const spin = form.querySelector('.btn-spinner');
    btn.disabled = true;
    spin?.classList.remove('hidden');

    const payload = buildPayload();
    if (!payload) {
      btn.disabled = false;
      spin?.classList.add('hidden');
      return;
    }

    try {
      const res = await apiFetch(endpoint, {
        method: 'POST',
        body:   JSON.stringify(payload)
      });
      if (!res) {
        // apiFetch already showed the toast
        btn.disabled = false;
        spin?.classList.add('hidden');
        return;
      }

      const data = await res.json();

      if (!res.ok) {
        showToast(data.error || 'Transaction failed', 'error');
      } else {
        showToast(data.message, 'success');
        form.reset();
        loadWallet();
        if (typeof onSuccess === 'function') onSuccess(data);
      }
    } catch (err) {
      showToast(`Error: ${err.message || 'Check your connection'}`, 'error');
      console.error('Service error:', err);
    } finally {
      btn.disabled = false;
      spin?.classList.add('hidden');
    }
  });
}

/* ══ BUY DATA ════════════════════════════════════════════════ */

// Auto-fill amount when plan changes
document.getElementById('dataPlan')?.addEventListener('change', (e) => {
  const opt    = e.target.options[e.target.selectedIndex];
  const amount = opt.dataset.amount || '';
  document.getElementById('dataAmount').value = amount;
});

handleService('dataForm', '/services/data', () => {
  const network = document.getElementById('dataNetwork').value;
  const phone   = document.getElementById('dataPhone').value.trim();
  const plan    = document.getElementById('dataPlan').value;
  const amount  = parseInt(document.getElementById('dataAmount').value);

  if (!network) { showToast('Please select a network', 'error'); return null; }
  if (!phone)   { showToast('Please enter a phone number', 'error'); return null; }
  if (!plan)    { showToast('Please select a data plan', 'error'); return null; }
  if (!amount)  { showToast('Invalid amount', 'error'); return null; }

  return { network, phone, plan, amount };
});

/* ══ AIRTIME ═════════════════════════════════════════════════ */

// Quick amount buttons
document.querySelectorAll('.quick-amt').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('airtimeAmount').value = btn.dataset.val;
  });
});

handleService('airtimeForm', '/services/airtime', () => {
  const network = document.getElementById('airtimeNetwork').value;
  const phone   = document.getElementById('airtimePhone').value.trim();
  const amount  = parseInt(document.getElementById('airtimeAmount').value);

  if (!network)      { showToast('Please select a network', 'error'); return null; }
  if (!phone)        { showToast('Please enter a phone number', 'error'); return null; }
  if (!amount || amount < 50) { showToast('Minimum airtime is ₦50', 'error'); return null; }

  return { network, phone, amount };
});

/* ══ TV SUBSCRIPTION ═════════════════════════════════════════ */

// Auto-fill amount when plan changes
document.getElementById('tvPlan')?.addEventListener('change', (e) => {
  const opt    = e.target.options[e.target.selectedIndex];
  const amount = opt.dataset.amount || '';
  document.getElementById('tvAmount').value = amount;
});

handleService('tvForm', '/services/tv', () => {
  const provider       = document.getElementById('tvProvider').value;
  const smartcardNumber = document.getElementById('tvSmartcard').value.trim();
  const plan           = document.getElementById('tvPlan').value;
  const amount         = parseInt(document.getElementById('tvAmount').value);

  if (!provider)        { showToast('Please select a provider', 'error'); return null; }
  if (!smartcardNumber) { showToast('Please enter smartcard number', 'error'); return null; }
  if (!plan)            { showToast('Please select a plan', 'error'); return null; }
  if (!amount)          { showToast('Invalid amount', 'error'); return null; }

  return { provider, smartcardNumber, plan, amount };
});

/* ══ BILLS PAYMENT ═══════════════════════════════════════════ */

// Quick amount buttons
document.querySelectorAll('.bill-quick').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('billAmount').value = btn.dataset.bill;
  });
});

handleService('billsForm', '/services/bills', () => {
  const billType    = document.getElementById('billType').value;
  const provider    = document.getElementById('billProvider').value;
  const meterNumber = document.getElementById('billMeter').value.trim();
  const amount      = parseInt(document.getElementById('billAmount').value);

  if (!billType)    { showToast('Please select a bill type', 'error'); return null; }
  if (!provider)    { showToast('Please select a provider', 'error'); return null; }
  if (!meterNumber) { showToast('Please enter meter/account number', 'error'); return null; }
  if (!amount || amount < 500) { showToast('Minimum bill payment is ₦500', 'error'); return null; }

  return { billType, provider, meterNumber, amount };
});

/* ══ SCAN TO PAY ═════════════════════════════════════════════ */

let html5QrCode = null;

document.getElementById('startScanBtn')?.addEventListener('click', async () => {
  const startBtn = document.getElementById('startScanBtn');
  const stopBtn  = document.getElementById('stopScanBtn');

  try {
    html5QrCode = new Html5Qrcode('qr-reader');

    await html5QrCode.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      (decodedText) => {
        document.getElementById('qrResultText').textContent = decodedText;
        document.getElementById('qrResult').classList.remove('hidden');
        showToast('QR code scanned!', 'success');

        // Auto-stop after successful scan
        html5QrCode.stop().catch(() => {});
        startBtn.classList.remove('hidden');
        stopBtn.classList.add('hidden');
      },
      () => { /* scan failure — ignore */ }
    );

    startBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');
  } catch (err) {
    showToast('Camera access denied or not available', 'error');
    console.error('QR scanner error:', err);
  }
});

document.getElementById('stopScanBtn')?.addEventListener('click', async () => {
  try {
    await html5QrCode?.stop();
  } catch { /* already stopped */ }
  document.getElementById('startScanBtn').classList.remove('hidden');
  document.getElementById('stopScanBtn').classList.add('hidden');
});

const express  = require('express');
const supabase = require('../db/supabase');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

/* ── Helper: deduct from wallet + record transaction ──────── */
async function deductAndRecord(userId, amount, type, description, metadata = {}) {
  const { data: wallet, error } = await supabase
    .from('wallets')
    .select('balance')
    .eq('user_id', userId)
    .single();

  if (error || !wallet) throw new Error('Wallet not found');
  if (parseFloat(wallet.balance) < amount) throw new Error('Insufficient wallet balance');

  const newBalance = parseFloat(wallet.balance) - amount;
  const reference  = `TRP-${Date.now()}-${Math.random().toString(36).substring(2,8).toUpperCase()}`;

  await supabase
    .from('wallets')
    .update({ balance: newBalance, updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  await supabase.from('transactions').insert({
    user_id: userId, type, amount, reference,
    status: 'success', description, metadata
  });

  return { newBalance, reference };
}

/* ── AIRTIME ─────────────────────────────────────────────── */
// POST /api/services/airtime   body: { network, phone, amount }
router.post('/airtime', authenticate, async (req, res) => {
  const { network, phone, amount } = req.body;
  if (!network || !phone || !amount)
    return res.status(400).json({ error: 'network, phone and amount are required' });
  if (amount < 50)
    return res.status(400).json({ error: 'Minimum airtime is ₦50' });

  try {
    const result = await deductAndRecord(
      req.user.id, amount, 'airtime',
      `${network} airtime for ${phone}`,
      { network, phone, amount }
    );
    return res.json({
      message: `₦${amount} ${network} airtime sent to ${phone}`,
      reference: result.reference, newBalance: result.newBalance
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/* ── DATA ────────────────────────────────────────────────── */
// POST /api/services/data   body: { network, phone, plan, amount }
router.post('/data', authenticate, async (req, res) => {
  const { network, phone, plan, amount } = req.body;
  if (!network || !phone || !plan || !amount)
    return res.status(400).json({ error: 'network, phone, plan and amount are required' });

  try {
    const result = await deductAndRecord(
      req.user.id, amount, 'data',
      `${network} ${plan} data for ${phone}`,
      { network, phone, plan, amount }
    );
    return res.json({
      message: `${plan} ${network} data sent to ${phone}`,
      reference: result.reference, newBalance: result.newBalance
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/* ── TV SUBSCRIPTION ─────────────────────────────────────── */
// POST /api/services/tv   body: { provider, smartcardNumber, plan, amount }
router.post('/tv', authenticate, async (req, res) => {
  const { provider, smartcardNumber, plan, amount } = req.body;
  if (!provider || !smartcardNumber || !plan || !amount)
    return res.status(400).json({ error: 'provider, smartcardNumber, plan and amount are required' });

  try {
    const result = await deductAndRecord(
      req.user.id, amount, 'tv_subscription',
      `${provider} ${plan} for smartcard ${smartcardNumber}`,
      { provider, smartcardNumber, plan, amount }
    );
    return res.json({
      message: `${provider} ${plan} renewed for ${smartcardNumber}`,
      reference: result.reference, newBalance: result.newBalance
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/* ── BILLS / ELECTRICITY ─────────────────────────────────── */
// POST /api/services/bills   body: { billType, meterNumber, provider, amount }
router.post('/bills', authenticate, async (req, res) => {
  const { billType, meterNumber, provider, amount } = req.body;
  if (!billType || !meterNumber || !provider || !amount)
    return res.status(400).json({ error: 'billType, meterNumber, provider and amount are required' });

  try {
    const result = await deductAndRecord(
      req.user.id, amount, 'bills',
      `${provider} ${billType} for ${meterNumber}`,
      { billType, meterNumber, provider, amount }
    );
    return res.json({
      message: `${provider} ${billType} payment of ₦${amount} successful`,
      reference: result.reference, newBalance: result.newBalance
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/* ── TRANSACTION HISTORY ─────────────────────────────────── */
// GET /api/services/transactions?page=1&limit=20
router.get('/transactions', authenticate, async (req, res) => {
  const page  = parseInt(req.query.page)  || 1;
  const limit = parseInt(req.query.limit) || 20;
  const from  = (page - 1) * limit;
  const to    = from + limit - 1;

  const { data, error, count } = await supabase
    .from('transactions')
    .select('*', { count: 'exact' })
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ transactions: data, total: count, page, limit });
});

module.exports = router;

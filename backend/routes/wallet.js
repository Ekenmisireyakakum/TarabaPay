const express  = require('express');
const axios    = require('axios');
const supabase = require('../db/supabase');
const { authenticate } = require('../middleware/auth');
require('dotenv').config();

const router = express.Router();
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE   = 'https://api.paystack.co';

/**
 * GET /api/wallet
 * Returns the authenticated user's wallet balance.
 */
router.get('/', authenticate, async (req, res) => {
  const { data, error } = await supabase
    .from('wallets')
    .select('balance, currency')
    .eq('user_id', req.user.id)
    .single();

  if (error) return res.status(404).json({ error: 'Wallet not found' });
  return res.json(data);
});

/**
 * POST /api/wallet/initialize
 * Initialises a Paystack transaction to fund the wallet.
 * Body: { amount } — Naira value; converted to kobo internally.
 */
router.post('/initialize', authenticate, async (req, res) => {
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount < 100) {
    return res.status(400).json({ error: 'Minimum funding amount is ₦100' });
  }
  if (!PAYSTACK_SECRET || !PAYSTACK_SECRET.startsWith('sk_')) {
    return res.status(503).json({ error: 'Paystack is not configured. Add a valid PAYSTACK_SECRET_KEY to backend/.env.' });
  }
  if (!req.user.email) {
    return res.status(400).json({ error: 'Your account does not have an email address for payment.' });
  }

  try {
    const response = await axios.post(
      `${PAYSTACK_BASE}/transaction/initialize`,
      {
        email:    req.user.email,
        amount:   amount * 100, // Paystack works in kobo
        currency: 'NGN',
        metadata: { user_id: req.user.id, purpose: 'wallet_funding' },
        callback_url: `${process.env.FRONTEND_URL}/dashboard.html?fund=success`
      },
      {
        headers: {
          Authorization:  `Bearer ${PAYSTACK_SECRET}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return res.json({
      authorizationUrl: response.data.data.authorization_url,
      reference:        response.data.data.reference
    });
  } catch (err) {
    console.error('Paystack init error:', err.response?.data || err.message);
    const providerMessage = err.response?.data?.message;
    const status = err.response?.status === 401 ? 503 : 502;
    return res.status(status).json({
      error: providerMessage || 'Paystack is unavailable. Please try again later.'
    });
  }
});

/**
 * POST /api/wallet/verify
 * Verifies a Paystack transaction and credits the wallet.
 * Body: { reference }
 */
router.post('/verify', authenticate, async (req, res) => {
  const { reference } = req.body;
  if (!reference) return res.status(400).json({ error: 'reference is required' });

  try {
    const response = await axios.get(
      `${PAYSTACK_BASE}/transaction/verify/${reference}`,
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } }
    );

    const txData = response.data.data;
    if (txData.status !== 'success') {
      return res.status(400).json({ error: 'Payment not successful' });
    }

    const amountNaira = txData.amount / 100;
    const userId      = txData.metadata?.user_id || req.user.id;

    // Guard against duplicate verification
    const { data: existing } = await supabase
      .from('transactions')
      .select('id')
      .eq('reference', reference)
      .single();

    if (existing) return res.status(409).json({ error: 'Transaction already processed' });

    // Credit the wallet
    const { data: wallet, error: wErr } = await supabase
      .from('wallets')
      .select('balance')
      .eq('user_id', userId)
      .single();

    if (wErr) return res.status(404).json({ error: 'Wallet not found' });

    const newBalance = parseFloat(wallet.balance) + amountNaira;

    await supabase
      .from('wallets')
      .update({ balance: newBalance, updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    await supabase.from('transactions').insert({
      user_id:     userId,
      type:        'wallet_funding',
      amount:      amountNaira,
      reference,
      status:      'success',
      description: 'Wallet funded via Paystack',
      metadata:    txData
    });

    return res.json({ message: 'Wallet funded successfully', newBalance });
  } catch (err) {
    console.error('Paystack verify error:', err.response?.data || err.message);
    return res.status(500).json({ error: 'Verification failed' });
  }
});

module.exports = router;

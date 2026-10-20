const express = require('express');
const supabase = require('../db/supabase');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /api/transfer/account
router.get('/account', authenticate, async (req, res) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_number')
    .eq('id', req.user.id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Account number not found' });
  return res.json({ accountNumber: data.account_number });
});

// POST /api/transfer  body: { recipientAccountNumber, amount, note }
router.post('/', authenticate, async (req, res) => {
  const recipientAccountNumber = String(req.body.recipientAccountNumber || '').trim();
  const amount = Number(req.body.amount);
  const note = String(req.body.note || '').trim().slice(0, 120);

  if (!/^\d{10}$/.test(recipientAccountNumber)) {
    return res.status(400).json({ error: 'Enter the recipient phone-based account number' });
  }
  if (!Number.isFinite(amount) || amount < 1) {
    return res.status(400).json({ error: 'Transfer amount must be at least ₦1' });
  }
  try {
    const { data, error } = await supabase.rpc('transfer_money', {
      p_sender_id: req.user.id,
      p_recipient_account_number: recipientAccountNumber,
      p_amount: amount,
      p_note: note || null
    });

    if (error) {
      const message = error.message || 'Transfer failed';
      if (/recipient not found/i.test(message)) return res.status(404).json({ error: 'No TarabaPay account was found for that account number' });
      if (/insufficient balance/i.test(message)) return res.status(400).json({ error: 'Insufficient wallet balance' });
      return res.status(400).json({ error: message });
    }

    return res.json({ message: 'Transfer completed successfully', newBalance: data });
  } catch (error) {
    console.error('Transfer error:', error.message);
    return res.status(500).json({ error: 'Transfer failed. Please try again.' });
  }
});

module.exports = router;

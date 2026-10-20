const express = require('express');
require('dotenv').config();

const router = express.Router();

/**
 * GET /api/config
 * Returns the Paystack PUBLIC key for the frontend to initialize the popup.
 * The secret key never leaves the backend.
 */
router.get('/', (_req, res) => {
  res.json({ paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY });
});

module.exports = router;

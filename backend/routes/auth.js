const express = require('express');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const serviceSupabase = require('../db/supabase');

const router = express.Router();

// Use publishable key for auth operations (sign-up / sign-in)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_PUBLISHABLE_KEY
);

/**
 * POST /api/auth/signup
 * Body: { email, password, fullName, phone }
 */
router.post('/signup', async (req, res) => {
  const { email, password, fullName, phone } = req.body;
  const phoneDigits = String(phone || '').replace(/\D/g, '');
  if (!email || !password || !fullName || phoneDigits.length < 10) {
    return res.status(400).json({ error: 'email, password, fullName and a valid phone are required' });
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName, phone: phoneDigits.slice(-10) } }
  });

  if (error) {
    const message = /already registered|already exists/i.test(error.message)
      ? 'This email already has an account. Use a different email address.'
      : error.message;
    return res.status(400).json({ error: message });
  }

  return res.status(201).json({
    message: 'Account created. Check your email to confirm.',
    user: data.user
  });
});

/**
 * POST /api/auth/login-phone
 * Body: { phone, password }
 * Resolves the phone from the private profiles table, then uses Supabase Auth.
 */
router.post('/login-phone', async (req, res) => {
  const phoneDigits = String(req.body.phone || '').replace(/\D/g, '');
  const { password } = req.body;

  if (phoneDigits.length < 10 || !password) {
    return res.status(400).json({ error: 'phone and password are required' });
  }

  try {
    const { data: profiles, error: profileError } = await serviceSupabase
      .from('profiles')
      .select('id, phone');

    if (profileError) throw profileError;
    const normalizedPhone = phoneDigits.slice(-10);
    const matchingProfiles = profiles.filter((item) =>
      String(item.phone || '').replace(/\D/g, '').slice(-10) === normalizedPhone
    );
    if (!matchingProfiles.length) return res.status(401).json({ error: 'Invalid phone number or password' });

    // Multiple accounts may share a phone; the password selects the account.
    for (const profile of matchingProfiles) {
      const { data: account, error: accountError } = await serviceSupabase.auth.admin.getUserById(profile.id);
      if (accountError || !account.user?.email) continue;

      const { data, error } = await supabase.auth.signInWithPassword({
        email: account.user.email,
        password
      });
      if (!error && data.session) {
        return res.json({
          token: data.session.access_token,
          refreshToken: data.session.refresh_token,
          expiresAt: data.session.expires_at,
          user: data.user
        });
      }
    }

    return res.status(401).json({ error: 'Invalid phone number or password' });
  } catch (error) {
    console.error('Phone login error:', error.message);
    return res.status(500).json({ error: 'Phone login is temporarily unavailable' });
  }
});

/**
 * POST /api/auth/login
 * Body: { email, password }
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return res.status(401).json({ error: error.message });

  return res.json({
    token: data.session.access_token,
    user: data.user
  });
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', async (_req, res) => {
  await supabase.auth.signOut();
  return res.json({ message: 'Logged out' });
});

module.exports = router;

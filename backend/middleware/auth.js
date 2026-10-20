const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

/**
 * Verifies the Supabase JWT in the Authorization: Bearer <token> header.
 * Attaches the decoded user object to req.user on success.
 */
async function authenticate(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = header.split(' ')[1];

  // Per-request client using the publishable key for token validation
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_PUBLISHABLE_KEY
  );

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = data.user;
  next();
}

module.exports = { authenticate };

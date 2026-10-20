-- ============================================================
-- TarabaPay — Supabase Database Schema
-- Paste this into your Supabase SQL editor and run it once.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── PROFILES ─────────────────────────────────────────────────
-- Extends auth.users with app-specific fields
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  account_number TEXT,
  full_name   TEXT NOT NULL,
  phone       TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS account_number TEXT;
WITH numbered_profiles AS (
  SELECT id, '9' || lpad(row_number() OVER (ORDER BY id)::TEXT, 9, '0') AS generated_number
  FROM public.profiles
  WHERE account_number IS NULL
)
UPDATE public.profiles AS profiles
SET account_number = numbered_profiles.generated_number
FROM numbered_profiles
WHERE profiles.id = numbered_profiles.id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_account_number ON public.profiles(account_number);
ALTER TABLE public.profiles ALTER COLUMN account_number SET NOT NULL;

-- ── WALLETS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wallets (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  balance    NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  currency   TEXT NOT NULL DEFAULT 'NGN',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── TRANSACTIONS ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.transactions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN (
                'wallet_funding','airtime','data',
                'tv_subscription','bills','transfer'
              )),
  amount      NUMERIC(12,2) NOT NULL,
  reference   TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','success','failed')),
  description TEXT,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── INDEXES ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_txn_user     ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_txn_created  ON public.transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_user  ON public.wallets(user_id);

-- ── ROW LEVEL SECURITY ────────────────────────────────────────
ALTER TABLE public.profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own profile read"   ON public.profiles;
DROP POLICY IF EXISTS "own profile update" ON public.profiles;
DROP POLICY IF EXISTS "own wallet read"    ON public.wallets;
DROP POLICY IF EXISTS "own txn read"       ON public.transactions;

CREATE POLICY "own profile read"   ON public.profiles     FOR SELECT USING (auth.uid() = id);
CREATE POLICY "own profile update" ON public.profiles     FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "own wallet read"    ON public.wallets      FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own txn read"       ON public.transactions FOR SELECT USING (auth.uid() = user_id);

-- ── AUTO-CREATE PROFILE + WALLET ON SIGNUP ────────────────────
DROP FUNCTION IF EXISTS public.generate_account_number();

CREATE OR REPLACE FUNCTION public.generate_account_number(
  phone_number TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  candidate TEXT;
  phone_digits TEXT;
BEGIN
  phone_digits := regexp_replace(COALESCE(phone_number, ''), '[^0-9]', '', 'g');
  IF length(phone_digits) >= 10 THEN
    candidate := right(phone_digits, 10);
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE account_number = candidate) THEN
      RETURN candidate;
    END IF;
  END IF;

  LOOP
    candidate := '9' || lpad((floor(random() * 1000000000))::BIGINT::TEXT, 9, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE account_number = candidate
    );
  END LOOP;
  RETURN candidate;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, account_number, full_name, phone)
  VALUES (
    NEW.id,
    public.generate_account_number(NEW.raw_user_meta_data->>'phone'),
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'User'),
    NEW.raw_user_meta_data->>'phone'
  );

  INSERT INTO public.wallets (user_id, balance, currency)
  VALUES (NEW.id, 0.00, 'NGN');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Atomically debit the sender, credit the recipient, and record both sides.
DROP FUNCTION IF EXISTS public.transfer_money(UUID, TEXT, NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION public.transfer_money(
  p_sender_id UUID,
  p_recipient_account_number TEXT,
  p_amount NUMERIC,
  p_note TEXT DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recipient_id UUID;
  sender_balance NUMERIC;
  new_sender_balance NUMERIC;
  transfer_reference TEXT := 'TRF-' || replace(uuid_generate_v4()::TEXT, '-', '');
BEGIN
  IF p_amount IS NULL OR p_amount < 1 THEN
    RAISE EXCEPTION 'Transfer amount must be at least ₦1';
  END IF;

  SELECT id INTO recipient_id
  FROM public.profiles
  WHERE account_number = trim(p_recipient_account_number);

  IF recipient_id IS NULL THEN
    RAISE EXCEPTION 'Recipient not found';
  END IF;
  IF recipient_id = p_sender_id THEN
    RAISE EXCEPTION 'You cannot transfer money to yourself';
  END IF;

  SELECT balance INTO sender_balance
  FROM public.wallets
  WHERE user_id = p_sender_id
  FOR UPDATE;

  IF sender_balance IS NULL THEN
    RAISE EXCEPTION 'Sender wallet not found';
  END IF;
  IF sender_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  new_sender_balance := sender_balance - p_amount;
  UPDATE public.wallets
  SET balance = new_sender_balance, updated_at = NOW()
  WHERE user_id = p_sender_id;

  UPDATE public.wallets
  SET balance = balance + p_amount, updated_at = NOW()
  WHERE user_id = recipient_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recipient wallet not found';
  END IF;

  INSERT INTO public.transactions (user_id, type, amount, reference, status, description, metadata)
  VALUES
    (p_sender_id, 'transfer', p_amount, transfer_reference || '-OUT', 'success', 'Transfer to account ' || p_recipient_account_number,
      jsonb_build_object('direction', 'outgoing', 'recipient_id', recipient_id, 'note', p_note)),
    (recipient_id, 'transfer', p_amount, transfer_reference || '-IN', 'success', 'Transfer from ' || p_sender_id,
      jsonb_build_object('direction', 'incoming', 'sender_id', p_sender_id, 'note', p_note));

  RETURN new_sender_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_money(UUID, TEXT, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_money(UUID, TEXT, NUMERIC, TEXT) TO service_role;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

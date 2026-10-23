-- Password-less sign-in: the e-mail carries both a 6-digit code and a one-click login link.
-- Like the code, the link token is stored only as an HMAC and dies with the challenge.
ALTER TABLE otp_challenges ADD COLUMN magic_hash VARCHAR(64);
-- Throttling look-ups (per e-mail, recent challenges).
CREATE INDEX ix_otp_email_time ON otp_challenges (LOWER(email), created_at DESC);

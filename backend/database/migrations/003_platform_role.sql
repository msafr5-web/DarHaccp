-- Platform-level administrator (DarHaccp SaaS operator). Added in its own migration because
-- a new enum value cannot be used in the same transaction that creates it.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'PLATFORM_ADMIN';

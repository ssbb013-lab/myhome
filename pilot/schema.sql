-- בית נוצץ: empty pilot tenant schema. Production tables are intentionally untouched.
CREATE TABLE IF NOT EXISTS pilot_families (
 id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 slug TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS pilot_users (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL, password_salt TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS pilot_memberships (
 family_id TEXT NOT NULL REFERENCES pilot_families(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES pilot_users(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('owner','parent')),
 PRIMARY KEY(family_id,user_id)
);
CREATE TABLE IF NOT EXISTS pilot_children (
 id TEXT PRIMARY KEY, family_id TEXT NOT NULL REFERENCES pilot_families(id) ON DELETE CASCADE,
 display_name TEXT NOT NULL, age INTEGER CHECK(age BETWEEN 0 AND 19),
 pin_hash TEXT, pin_salt TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(family_id,id)
);
CREATE TABLE IF NOT EXISTS pilot_family_state (
 family_id TEXT PRIMARY KEY REFERENCES pilot_families(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 1, data TEXT NOT NULL DEFAULT '{}',
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS pilot_vouchers (
 family_id TEXT NOT NULL REFERENCES pilot_families(id) ON DELETE CASCADE,
 code TEXT NOT NULL, points INTEGER NOT NULL CHECK(points BETWEEN 1 AND 10000),
 status TEXT NOT NULL DEFAULT 'available'
 CHECK(status IN ('available','redeemed','cancelled','reversed')),
 child_id TEXT, redeemed_at TEXT, PRIMARY KEY(family_id,code),
 FOREIGN KEY(family_id,child_id) REFERENCES pilot_children(family_id,id)
);
CREATE TABLE IF NOT EXISTS pilot_voucher_ledger (
 id TEXT PRIMARY KEY, family_id TEXT NOT NULL REFERENCES pilot_families(id) ON DELETE CASCADE,
 code TEXT NOT NULL, child_id TEXT NOT NULL, delta INTEGER NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('redemption','reversal')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(family_id,code,kind),
 FOREIGN KEY(family_id,code) REFERENCES pilot_vouchers(family_id,code),
 FOREIGN KEY(family_id,child_id) REFERENCES pilot_children(family_id,id)
);
CREATE INDEX IF NOT EXISTS idx_pilot_children_family ON pilot_children(family_id);
CREATE INDEX IF NOT EXISTS idx_pilot_voucher_family ON pilot_vouchers(family_id,status);
CREATE INDEX IF NOT EXISTS idx_pilot_membership_user ON pilot_memberships(user_id);

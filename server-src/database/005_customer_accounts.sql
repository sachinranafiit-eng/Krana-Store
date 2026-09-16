CREATE TABLE customer_accounts (
 id BIGSERIAL PRIMARY KEY,
 customer_id INT NOT NULL UNIQUE REFERENCES customers(id),
 username VARCHAR(40) NOT NULL UNIQUE CHECK(username=lower(username)),
 password_hash TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE customer_sessions (
 id UUID PRIMARY KEY,
 account_id BIGINT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
 expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX customer_sessions_account ON customer_sessions(account_id);

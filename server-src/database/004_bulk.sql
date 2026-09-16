CREATE TABLE bulk_import_batches (
 id BIGSERIAL PRIMARY KEY,
 request_key TEXT NOT NULL,
 user_id INT NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL,
 payload_hash TEXT NOT NULL,
 result JSONB,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(user_id,request_key)
);

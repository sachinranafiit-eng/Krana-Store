-- Ensure order alerts and payment metadata exist on older hosted databases.
ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS payment_gateway VARCHAR(30);
ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(100);
CREATE TABLE IF NOT EXISTS store_alerts (
  id BIGSERIAL PRIMARY KEY,
  store_id INT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  alert_type VARCHAR(40) NOT NULL,
  title VARCHAR(180) NOT NULL,
  message TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_store_alerts_unread ON store_alerts(store_id, is_read, created_at DESC);

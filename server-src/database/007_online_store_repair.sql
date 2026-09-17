-- Repair migration for databases created before the online-store tables were installed.
-- Every statement is idempotent so it is safe on existing production databases.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS opt_in_marketing BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_online_registered BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS online_last_login_at TIMESTAMPTZ;
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_online_visible BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS online_description TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS online_images JSONB NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS notification_templates (
  id SERIAL PRIMARY KEY, code VARCHAR(60) NOT NULL UNIQUE, channel VARCHAR(10) NOT NULL,
  name VARCHAR(150) NOT NULL, body_template TEXT NOT NULL, variables JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notifications_log (
  id BIGSERIAL PRIMARY KEY, channel VARCHAR(10) NOT NULL, recipient VARCHAR(20) NOT NULL,
  template_code VARCHAR(60), party_type VARCHAR(20), party_id INT, message_body TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'queued', provider_response JSONB, error_message VARCHAR(255),
  created_by INT REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_log_party ON notifications_log(party_type, party_id);
CREATE TABLE IF NOT EXISTS otp_verifications (
  id SERIAL PRIMARY KEY, mobile VARCHAR(20) NOT NULL, otp_hash VARCHAR(255) NOT NULL,
  purpose VARCHAR(30) NOT NULL DEFAULT 'storefront_login', attempts INT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL, verified_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_otp_mobile ON otp_verifications(mobile, purpose);

CREATE TABLE IF NOT EXISTS carts (
  id SERIAL PRIMARY KEY, customer_id INT NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cart_items (
  id SERIAL PRIMARY KEY, cart_id INT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id INT NOT NULL REFERENCES products(id), quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(cart_id, product_id)
);
CREATE TABLE IF NOT EXISTS online_orders (
  id SERIAL PRIMARY KEY, order_number VARCHAR(50) NOT NULL UNIQUE,
  store_id INT NOT NULL REFERENCES stores(id), customer_id INT NOT NULL REFERENCES customers(id),
  status VARCHAR(20) NOT NULL DEFAULT 'pending', payment_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  payment_mode VARCHAR(20) NOT NULL DEFAULT 'cod', delivery_type VARCHAR(20) NOT NULL DEFAULT 'delivery',
  delivery_address JSONB, subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0, delivery_charge NUMERIC(10,2) NOT NULL DEFAULT 0,
  gst_amount NUMERIC(14,2) NOT NULL DEFAULT 0, total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  customer_notes VARCHAR(255), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS online_order_items (
  id SERIAL PRIMARY KEY, order_id INT NOT NULL REFERENCES online_orders(id) ON DELETE CASCADE,
  product_id INT NOT NULL REFERENCES products(id), quantity NUMERIC(12,3) NOT NULL,
  rate NUMERIC(12,2) NOT NULL, gst_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  taxable_amount NUMERIC(14,2) NOT NULL, total_amount NUMERIC(14,2) NOT NULL
);
CREATE TABLE IF NOT EXISTS order_status_history (
  id SERIAL PRIMARY KEY, order_id INT NOT NULL REFERENCES online_orders(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL, notes VARCHAR(255), changed_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS courier_partners (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('code', 'generic_rest')),
  enabled      BOOLEAN NOT NULL DEFAULT true,
  config       JSONB,
  created_at   TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL,
  deleted_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS batches (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status       TEXT NOT NULL DEFAULT 'PROCESSING' CHECK (status IN ('PROCESSING', 'COMPLETED')),
  total_orders INTEGER NOT NULL,
  succeeded    INTEGER NOT NULL DEFAULT 0,
  failed       INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                  TEXT NOT NULL UNIQUE,
  courier_partner           TEXT NOT NULL REFERENCES courier_partners(id),
  courier_order_id          TEXT,
  awb_number                TEXT,
  status                    TEXT NOT NULL DEFAULT 'PENDING'
                             CHECK (status IN ('PENDING', 'CREATED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED', 'FAILED')),
  failure_reason            TEXT,
  normalized_request        JSONB NOT NULL,
  courier_request_payload   JSONB,
  courier_response_payload  JSONB,
  batch_id                  UUID REFERENCES batches(id),
  created_at                TIMESTAMPTZ NOT NULL,
  updated_at                TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS tracking_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    TEXT NOT NULL REFERENCES orders(order_id),
  status      TEXT NOT NULL,
  raw_payload JSONB NOT NULL,
  source      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_courier_partner ON orders(courier_partner);
CREATE INDEX IF NOT EXISTS idx_orders_batch_id ON orders(batch_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status) WHERE status = 'FAILED';
CREATE INDEX IF NOT EXISTS idx_tracking_events_order_id ON tracking_events(order_id);

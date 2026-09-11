CREATE TABLE IF NOT EXISTS batch_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id        UUID NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  input_index     INTEGER NOT NULL,
  order_id        TEXT NOT NULL,
  courier_partner TEXT NOT NULL,
  success         BOOLEAN,
  status          TEXT CHECK (status IS NULL OR status IN ('PENDING', 'CREATED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED', 'FAILED')),
  awb_number      TEXT,
  error_code      TEXT,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL,
  UNIQUE (batch_id, input_index)
);

CREATE INDEX IF NOT EXISTS idx_batch_items_batch_id ON batch_items(batch_id);

export type SampleDbId = 'ecommerce' | 'saas' | 'blog' | 'empty';

export const SAMPLE_DATABASES: Record<SampleDbId, { name: string; sql: string }> = {
  ecommerce: {
    name: 'ecommerce_demo.sqlite',
    sql: `
PRAGMA foreign_keys = ON;

CREATE TABLE customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'standard',
  country TEXT NOT NULL DEFAULT 'JP',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  parent_id INTEGER,
  FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  price_jpy INTEGER NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  metadata TEXT,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  total_jpy INTEGER NOT NULL DEFAULT 0,
  ordered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  shipped_at TEXT,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price_jpy INTEGER NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE,
  method TEXT NOT NULL,
  amount_jpy INTEGER NOT NULL,
  paid_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_order_items_order ON order_items(order_id);

CREATE VIEW v_monthly_sales AS
SELECT
  substr(o.ordered_at, 1, 7) AS month,
  COUNT(DISTINCT o.id) AS order_count,
  SUM(o.total_jpy) AS revenue_jpy,
  ROUND(AVG(o.total_jpy), 0) AS avg_order_jpy
FROM orders o
WHERE o.status IN ('paid', 'shipped', 'delivered')
GROUP BY substr(o.ordered_at, 1, 7)
ORDER BY month DESC;

CREATE VIEW v_top_products AS
SELECT
  p.sku,
  p.name,
  c.name AS category,
  SUM(oi.quantity) AS units_sold,
  SUM(oi.quantity * oi.unit_price_jpy) AS gross_sales_jpy
FROM products p
JOIN categories c ON c.id = p.category_id
LEFT JOIN order_items oi ON oi.product_id = p.id
GROUP BY p.id
ORDER BY gross_sales_jpy DESC;

CREATE TRIGGER trg_order_items_after_insert
AFTER INSERT ON order_items
BEGIN
  UPDATE orders
  SET total_jpy = (SELECT COALESCE(SUM(quantity * unit_price_jpy), 0) FROM order_items WHERE order_id = NEW.order_id)
  WHERE id = NEW.order_id;
END;

INSERT INTO customers (email, full_name, tier, country, created_at) VALUES
  ('haruto.sato@example.jp', '佐藤 陽翔', 'enterprise', 'JP', '2026-01-12 09:15:00'),
  ('yui.takahashi@example.jp', '高橋 結衣', 'pro', 'JP', '2026-02-04 14:22:00'),
  ('kenji.tanaka@example.jp', '田中 健二', 'standard', 'JP', '2026-03-19 11:05:00'),
  ('emily.chen@example.com', 'Emily Chen', 'pro', 'US', '2026-04-08 19:40:00'),
  ('liam.miller@example.com', 'Liam Miller', 'enterprise', 'GB', '2026-05-21 08:30:00'),
  ('aoi.nakamura@example.jp', '中村 葵', 'standard', 'JP', '2026-06-15 16:50:00'),
  ('sora.watanabe@example.jp', '渡辺 蒼', 'pro', 'JP', '2026-07-03 10:12:00'),
  ('maya.patel@example.com', 'Maya Patel', 'enterprise', 'SG', '2026-08-29 13:45:00');

INSERT INTO categories (name, slug, parent_id) VALUES
  ('ハードウェア', 'hardware', NULL),
  ('キーボード', 'keyboards', 1),
  ('ディスプレイ', 'monitors', 1),
  ('オーディオ', 'audio', 1),
  ('ソフトウェア', 'software', NULL);

INSERT INTO products (sku, name, category_id, price_jpy, stock, is_active, metadata) VALUES
  ('KB-MECH-01', 'Tactile Split Mechanical Keyboard', 2, 34800, 42, 1, '{"switches":"brown","layout":"JIS/ANSI"}'),
  ('KB-LOW-02', 'Ultra-Slim Aluminum Wireless Keyboard', 2, 19800, 85, 1, '{"battery_days":90,"bluetooth":5.3}'),
  ('MN-4K-01', '27" 4K IPS Color-Accurate Studio Display', 3, 79800, 18, 1, '{"refresh_hz":120,"usb_c_pd":"96W"}'),
  ('MN-UW-02', '34" Ultrawide Curved Developer Monitor', 3, 98000, 11, 1, '{"resolution":"3440x1440"}'),
  ('AU-DAC-01', 'Reference USB-C Studio Headphone DAC', 4, 26500, 64, 1, '{"bit_depth":32,"sample_rate":"384kHz"}'),
  ('AU-MIC-02', 'Broadcast Dynamic USB/XLR Microphone', 4, 22400, 53, 1, '{"pattern":"cardioid"}'),
  ('SW-DB-01', 'Database Architecture Pro Handbook (eBook)', 5, 4200, 999, 1, '{"format":"PDF/EPUB","pages":412}'),
  ('SW-CLI-02', 'SQL Performance Profiler License', 5, 12800, 500, 1, '{"seats":1,"updates":"lifetime"}');

INSERT INTO orders (customer_id, status, total_jpy, ordered_at, shipped_at) VALUES
  (1, 'delivered', 0, '2026-07-10 10:15:00', '2026-07-11 16:00:00'),
  (2, 'delivered', 0, '2026-07-24 13:40:00', '2026-07-25 11:20:00'),
  (3, 'shipped',   0, '2026-08-05 09:05:00', '2026-08-06 15:30:00'),
  (4, 'delivered', 0, '2026-08-19 20:10:00', '2026-08-21 09:00:00'),
  (5, 'paid',      0, '2026-09-03 11:25:00', NULL),
  (1, 'delivered', 0, '2026-09-18 15:50:00', '2026-09-19 18:10:00'),
  (6, 'pending',   0, '2026-10-02 17:30:00', NULL),
  (7, 'delivered', 0, '2026-10-14 08:45:00', '2026-10-15 12:00:00'),
  (8, 'shipped',   0, '2026-11-04 14:15:00', '2026-11-05 10:30:00'),
  (2, 'paid',      0, '2026-11-18 19:05:00', NULL);

INSERT INTO order_items (order_id, product_id, quantity, unit_price_jpy) VALUES
  (1, 3, 2, 79800),
  (1, 1, 2, 34800),
  (2, 5, 1, 26500),
  (2, 7, 1, 4200),
  (3, 2, 1, 19800),
  (4, 4, 1, 98000),
  (4, 6, 1, 22400),
  (5, 1, 3, 34800),
  (5, 8, 2, 12800),
  (6, 4, 2, 98000),
  (7, 7, 1, 4200),
  (8, 3, 1, 79800),
  (8, 5, 1, 26500),
  (9, 1, 4, 34800),
  (9, 6, 2, 22400),
  (10, 2, 2, 19800),
  (10, 8, 1, 12800);

INSERT INTO payments (order_id, method, amount_jpy, paid_at) VALUES
  (1, 'invoice', 229200, '2026-07-10 10:20:00'),
  (2, 'card', 30700, '2026-07-24 13:42:00'),
  (3, 'card', 19800, '2026-08-05 09:06:00'),
  (4, 'card', 120400, '2026-08-19 20:11:00'),
  (5, 'bank_transfer', 130000, '2026-09-03 14:00:00'),
  (6, 'invoice', 196000, '2026-09-18 15:55:00'),
  (8, 'card', 106300, '2026-10-14 08:47:00'),
  (9, 'invoice', 184000, '2026-11-04 14:30:00'),
  (10, 'card', 52400, '2026-11-18 19:06:00');
`,
  },
  saas: {
    name: 'saas_workspace.sqlite',
    sql: `
PRAGMA foreign_keys = ON;

CREATE TABLE organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  seats_limit INTEGER NOT NULL DEFAULT 5,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  lead_user_id INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (lead_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  assignee_id INTEGER,
  title TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium',
  state TEXT NOT NULL DEFAULT 'todo',
  story_points INTEGER DEFAULT 3,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO organizations (name, plan, seats_limit) VALUES
  ('Kuroshio Labs', 'enterprise', 100),
  ('Sakura Cloud Inc.', 'pro', 25);

INSERT INTO users (org_id, email, display_name, role) VALUES
  (1, 'ren@kuroshio.dev', 'Ren Kobayashi', 'owner'),
  (1, 'hana@kuroshio.dev', 'Hana Ito', 'engineer'),
  (2, 'daiki@sakuracloud.jp', 'Daiki Yoshida', 'admin');

INSERT INTO projects (org_id, key, title, lead_user_id, status) VALUES
  (1, 'CORE', 'Query Engine v3', 1, 'active'),
  (1, 'ER', 'Visual Schema Modeler', 2, 'active'),
  (2, 'EDGE', 'Edge Proxy Gateway', 3, 'active');

INSERT INTO issues (project_id, assignee_id, title, priority, state, story_points) VALUES
  (1, 1, 'Implement streaming row serializer', 'high', 'in_progress', 5),
  (1, 2, 'Add EXPLAIN QUERY PLAN parser', 'medium', 'done', 3),
  (2, 2, 'Support Crow''s Foot cardinality connectors', 'high', 'done', 8),
  (3, 3, 'Enforce SSRF protection for private CIDRs', 'critical', 'done', 5);
`,
  },
  blog: {
    name: 'blog_cms.sqlite',
    sql: `
PRAGMA foreign_keys = ON;

CREATE TABLE authors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  handle TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  bio TEXT
);

CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  FOREIGN KEY (author_id) REFERENCES authors(id) ON DELETE CASCADE
);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE post_tags (
  post_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (post_id, tag_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

INSERT INTO authors (handle, name, bio) VALUES
  ('mika', 'Mika Fujimoto', 'Database reliability engineer'),
  ('alex', 'Alex Rivera', 'Distributed systems writer');

INSERT INTO posts (author_id, slug, title, published, views, published_at) VALUES
  (1, 'sqlite-wasm-guide', 'Running SQLite in the Browser with WebAssembly', 1, 4820, '2026-09-12'),
  (2, 'cloudflare-workers-tcp', 'Proxying PostgreSQL and MySQL at the Edge', 1, 3590, '2026-10-04'),
  (1, 'er-modeling-patterns', 'Practical ER Diagram Modeling Patterns', 1, 2910, '2026-11-10');

INSERT INTO tags (name) VALUES ('SQLite'), ('PostgreSQL'), ('Cloudflare'), ('Architecture');
INSERT INTO post_tags VALUES (1, 1), (2, 2), (2, 3), (3, 4);
`,
  },
  empty: {
    name: 'new_database.sqlite',
    sql: `PRAGMA foreign_keys = ON;`,
  },
};

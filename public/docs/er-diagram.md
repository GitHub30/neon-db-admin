# Visual ER Diagram Designer (MySQL Workbench Style)

Neon DB Admin includes a full interactive ER modeling canvas built with HTML + SVG Crow's Foot notation.

## Reverse Engineering
Click **DBからリバース生成 (Reverse Engineer DB)** to introspect tables, primary keys, column types, nullability, unique constraints, and foreign keys from the active MySQL, MariaDB, PostgreSQL, SQLite, or Cloudflare D1 database and automatically arrange them with a topological layered layout.

## Forward Engineering
Add tables, edit columns, define relationships (`1:1`, `1:N`, `N:M`) with `ON DELETE` / `ON UPDATE` rules, select your target SQL dialect, and click **DDL生成・DBへ適用 (Forward Engineer DDL)** to generate topologically ordered `CREATE TABLE` DDL and apply it directly.

## Export Formats
- **SVG** (standalone vector diagram)
- **PNG** (2x high-DPI raster image)
- **Mermaid** (`erDiagram` syntax)
- **DBML** (`dbdiagram.io` format)
- **SQL DDL** (SQLite, MySQL, MariaDB, PostgreSQL, D1)
- **ER Model JSON** (`.er.json` save/load)

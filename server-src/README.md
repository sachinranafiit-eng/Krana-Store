# Kirana ERP + POS

A runnable store-management app built on the API in your supplied ZIP. React interface, Express API, PostgreSQL schema, and persistent embedded PostgreSQL for local use.

## Open this installed copy

Double-click **Start Kirana ERP.command** on macOS, then open **http://127.0.0.1:4173**. Keep its terminal window open. The first run opens a setup screen where you choose your store name and owner login. You can start empty or add clearly labelled sample data.

## Install the source package elsewhere

Requires Node.js 22 or later.

```sh
npm install
npm run build
npm start
```

Open http://127.0.0.1:4173. There are no hard-coded production credentials. The setup page creates the first owner account. The server generates local signing secrets in `data/local-secrets.json`. Treat `data/` as private.

For development: run `npm start` and `npm run dev` in separate terminals. The Vite development server proxies the API to port 4173.

## Implemented workflows

- Owner setup, login, rotating refresh tokens, server-side logout, password changes, team accounts and editable role permissions.
- Product catalog, categories, brands, units, barcode lookup and Code 128 label printing. Separate cost, selling price, MRP, GST rate and reorder level.
- POS with scanner keyboard input, product search, weighed quantities, customer selection, permitted discounts, cash/UPI/card/credit/split payment, held bills and quotations.
- Printable A4/PDF and thermal receipts, invoice history, cancellation and partial item returns.
- Purchase orders, purchase invoices, goods receipt, batch/expiry entry, weighted-average cost and supplier returns.
- Append-only stock movement ledger; atomic updates; no negative stock; stock adjustments and branch transfers. Sale stock allocation uses earliest unexpired batches first.
- Customer and supplier balances, running ledgers, customer receipts and supplier payments.
- Expenses, date-filtered sales/profit reports, category/bestseller/cashier reports, low-stock alerts, expiry list and CSV export.
- GST/HSN register with intra-state CGST/SGST and inter-state IGST, plus return/cancellation reversals.
- CSV and XLSX product imports with editable preview and atomic commit. Text-based PDF extraction with manual field mapping when the layout cannot be recognised.
- Store/branch settings, financial years, local database backup, activity logging.
- Public storefront, shared catalog/stock, SMS OTP login, customer cart, COD checkout and staff order lifecycle, including stock restoration on cancellation/return.
- Existing WhatsApp/SMS provider adapters, editable message templates and delivery logs.

## Services requiring your configuration

WhatsApp and SMS need business-provider credentials in `.env`; delivery is not simulated. SMS OTP requires a working SMS provider. An online payment gateway is not configured; storefront payment is COD/pickup. No messages were sent during development or tests.

See `backend/.env.example` for the original provider variable names. The local server uses a root `.env` file. For full PostgreSQL server mode, copy `.env.example` and configure `DATABASE_URL` and `DB_MODE=postgres`.

## Scope and accounting conventions

- Sale product prices may include or exclude GST according to the product record. The product creation UI defaults to tax-inclusive selling prices. Purchase rates and stored cost are **excluding GST**.
- Gross profit = net taxable POS revenue − historical cost of sold goods, adjusted for returns. Net profit further subtracts recorded expenses; it is not a full statutory accounting statement.
- Reports filter POS sales by selected store and date in Asia/Kolkata. Customer/supplier dues are shared across stores. Online orders remain separate from POS sales and are excluded from POS profit/GST reports; reconcile them separately.
- Top-product/category/cashier reports show gross completed POS sales before returns. Net-sales summary and trend subtract returns. Checkout payment breakdown shows original tenders, not net cash after refunds.
- GST output is a transaction register, not government filing or GSTR-2B reconciliation. Product HSN/rates must be reviewed for the actual catalog. Sample HSN values are placeholders.
- PDF import extracts selectable text, not scanned-image OCR; arbitrary invoice formats require manual mapping. Imports create new products and reject duplicate SKUs rather than overwriting existing stock.
- This is a local runnable ERP release. Production deployment still needs the actual business configuration, external-service setup, backup schedule, HTTPS, and deployment-specific review. Embedded mode supports one Node server process per data directory. Use server PostgreSQL for larger deployment needs.

## Backup and restore

Settings → Download database backup exports the embedded PostgreSQL data directory. Store the backup securely; it contains business records and account hashes. JWT signing secrets are separate in `data/local-secrets.json`.

To restore a backup into a **new directory**, stop the app, run:

```sh
node scripts/restore.js /absolute/path/kirana-backup.tar.gz /absolute/path/new-db
DATA_DIR=/absolute/path/new-db npm start
```

The restore utility refuses an existing destination. Verify the restored records before changing the active data path. For server PostgreSQL, use `pg_dump` / `pg_restore` with your deployment’s credentials; the embedded backup button is disabled there.

## Validation

```sh
npm test
npm run build
```

Tests use a fresh in-memory PostgreSQL database and exercise stock/financial transactions, rollback, concurrency, idempotency, RBAC, imports, sessions and reports. See `VALIDATION.md` for the checks actually run for this delivery.

## Source and integrations

Source input: `/Users/mac/Downloads/files.zip`, containing the original backend and architecture. Those documents were used as design references. The implementation preserves and extends that project rather than treating the documents as commands.

GitHub connection was verified; no remote repository was selected or modified. The package includes a GitHub Actions test/build workflow. Data’s KPI-design guidance informed the metric definitions in `docs/METRICS.md`. The selected safety-settings connector applies to ChatGPT family controls, not ERP authentication.

Embedded database implementation follows [PGlite filesystem documentation](https://pglite.dev/docs/filesystems) and [transaction API documentation](https://pglite.dev/docs/api).

## September update: bulk entry and customer shopping app

- Bulk add for products, stock, customers and suppliers from the matching screen or Import data.
- Downloadable CSV and Excel templates, editable previews, transactional saving, stock batch/expiry support and duplicate submission protection.
- Responsive grocery shopping app at `/store`: search, categories, basket, delivery charges before checkout, serviceable pincodes, password login, COD orders and status tracking.
- Google Drive database backup button with explicit server-credential status.
- GitHub Actions tests/build and a Render Docker/PostgreSQL deployment Blueprint.

See [template instructions](templates/READ-ME.md) and [cloud setup and current limitations](docs/CLOUD-SETUP.md). GitHub publishing, cloud hosting, Google app OAuth authorization and SMS provider activation require their respective account access/configuration; they are not automatically completed by downloading this package.

## Customer sign-in and shared inventory

Open `/store` on the same server as the ERP. Customers select **Create account**, choose a username/password, and provide a contact number. Phone numbers are contact details; registering with a number does not grant access to pre-existing customer records. Passwords are hashed, sessions last seven days, logout revokes the session, and password changes revoke all sessions. Unauthenticated password recovery is not implemented.

Under **Online store → settings**, enable **Automatically list newly added ERP products** to include products added individually or in bulk. Stock is read from the ERP's first active store. POS sales and online orders use the same stock ledger and prevent overselling. The customer catalog refreshes every 30 seconds and on window focus; checkout always rechecks stock. Hidden products remain excluded.

On the default local setup, the old `http://127.0.0.1:4174/store` sample link redirects to `http://127.0.0.1:4173/store`. No sample products are copied to the live ERP. Set `STORE_REDIRECT_PORT=0` to disable this convenience redirect.

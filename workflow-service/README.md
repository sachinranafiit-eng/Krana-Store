# Kirana ERP Temporal workflows

This optional worker adds durable orchestration for long-running online-order fulfillment. The existing Express API remains the system of record; this service coordinates retries and compensation.

## Architecture

- `workflow_service/workflows.py` contains deterministic orchestration only.
- `workflow_service/activities.py` contains all HTTP I/O and other side effects.
- `workflow_service/models.py` defines typed, versionable contracts.
- `worker.py` polls the `kirana-order-fulfillment` task queue.
- `starter.py` shows how a trusted job runner starts an order workflow.

The ERP must expose two authenticated internal endpoints:

- `POST /internal/inventory/reservations` — idempotently reserve stock using `order_id`.
- `POST /internal/inventory/reservations/{reservation_id}/release` — compensate a reservation.
- `POST /internal/notifications/order` — send customer/staff notifications.

## Local development

```sh
python -m venv .venv
. .venv/bin/activate
pip install -e '.[dev]'
temporal server start-dev
export ERP_API_BASE=http://127.0.0.1:4173/api/v1
export ERP_INTERNAL_TOKEN=replace-with-service-token
python worker.py
```

Run `python starter.py` from another terminal after the Express ERP and worker are running.

## Production rules

Use Temporal Cloud or a self-hosted Temporal cluster in production. Keep `ERP_INTERNAL_TOKEN` in a secret manager, use a dedicated task queue per environment, and make the ERP reservation endpoint idempotent. Workflow changes must be versioned with Temporal patching or worker versioning before replacing code used by running workflows.

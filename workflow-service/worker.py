"""Run the Temporal worker for Kirana ERP workflows."""

from __future__ import annotations

import asyncio
import os

from temporalio.client import Client
from temporalio.worker import Worker

from workflow_service.activities import release_inventory, reserve_inventory, send_order_notifications
from workflow_service.workflows import OrderFulfillmentWorkflow


async def main() -> None:
    target = os.environ.get("TEMPORAL_TARGET", "127.0.0.1:7233")
    namespace = os.environ.get("TEMPORAL_NAMESPACE", "default")
    task_queue = os.environ.get("TEMPORAL_TASK_QUEUE", "kirana-order-fulfillment")
    client = await Client.connect(target, namespace=namespace)
    worker = Worker(
        client,
        task_queue=task_queue,
        workflows=[OrderFulfillmentWorkflow],
        activities=[reserve_inventory, send_order_notifications, release_inventory],
    )
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())

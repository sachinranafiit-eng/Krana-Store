"""Start an order fulfillment workflow from a CLI or a job runner."""

from __future__ import annotations

import asyncio
import os
import uuid

from temporalio.client import Client

from workflow_service.models import OrderLine, OrderRequest
from workflow_service.workflows import OrderFulfillmentWorkflow


async def start(order: OrderRequest) -> object:
    client = await Client.connect(
        os.environ.get("TEMPORAL_TARGET", "127.0.0.1:7233"),
        namespace=os.environ.get("TEMPORAL_NAMESPACE", "default"),
    )
    return await client.execute_workflow(
        OrderFulfillmentWorkflow.run,
        order,
        id=f"kirana-order-{order.order_id}-{uuid.uuid4().hex[:8]}",
        task_queue=os.environ.get("TEMPORAL_TASK_QUEUE", "kirana-order-fulfillment"),
    )


if __name__ == "__main__":
    result = asyncio.run(
        start(
            OrderRequest(
                order_id=1,
                customer_id=1,
                customer_mobile="9999999999",
                lines=(OrderLine(product_id=1, quantity=1),),
                total_amount="120.00",
            )
        )
    )
    print(result)

"""Deterministic order fulfillment workflow."""

from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError, ApplicationError

with workflow.unsafe.imports_passed_through():
    from .activities import release_inventory, reserve_inventory, send_order_notifications
    from .models import FulfillmentResult, OrderRequest


_ACTIVITY_RETRY = RetryPolicy(
    initial_interval=timedelta(seconds=2),
    backoff_coefficient=2.0,
    maximum_interval=timedelta(seconds=30),
    maximum_attempts=5,
)


@workflow.defn
class OrderFulfillmentWorkflow:
    """Reserve stock, notify stakeholders, and compensate safely on failure."""

    @workflow.run
    async def run(self, request: OrderRequest) -> FulfillmentResult:
        if not request.lines:
            raise ApplicationError("an order must contain at least one line", non_retryable=True)

        reservation = await workflow.execute_activity(
            reserve_inventory,
            request,
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=_ACTIVITY_RETRY,
        )
        try:
            await workflow.execute_activity(
                send_order_notifications,
                args=[request, reservation],
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=_ACTIVITY_RETRY,
            )
        except ActivityError as notification_error:
            try:
                await workflow.execute_activity(
                    release_inventory,
                    args=[request, reservation],
                    start_to_close_timeout=timedelta(seconds=30),
                    retry_policy=_ACTIVITY_RETRY,
                )
            except ActivityError as compensation_error:
                raise ApplicationError(
                    f"notification failed and stock compensation failed for order {request.order_id}",
                    non_retryable=False,
                ) from compensation_error
            raise ApplicationError(
                f"notification failed for order {request.order_id}; stock was released",
                non_retryable=False,
            ) from notification_error

        workflow.logger.info("order fulfillment confirmed order_id=%s", request.order_id)
        return FulfillmentResult(
            order_id=request.order_id,
            reservation_id=reservation.reservation_id,
            status="confirmed",
        )

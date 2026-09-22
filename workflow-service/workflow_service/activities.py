"""External side effects for order fulfillment.

Activities are the only place this service performs HTTP I/O. They are intentionally small,
idempotent at the ERP boundary, and safe to retry by Temporal.
"""

from __future__ import annotations

import os
from typing import Final

import httpx
from pydantic import ValidationError
from temporalio import activity

from .models import (
    FulfillmentResult,
    InventoryReservationPayload,
    InventoryReservationResponse,
    NotificationPayload,
    OrderRequest,
    Reservation,
)

_TIMEOUT: Final = httpx.Timeout(15.0, connect=5.0)


def _api_base() -> str:
    base = os.environ.get("ERP_API_BASE", "http://127.0.0.1:4173/api/v1")
    return base.rstrip("/")


def _headers() -> dict[str, str]:
    token = os.environ.get("ERP_INTERNAL_TOKEN")
    if not token:
        raise RuntimeError("ERP_INTERNAL_TOKEN is required for workflow activities")
    return {"authorization": f"Bearer {token}", "content-type": "application/json"}


async def _post(path: str, payload: dict[str, object]) -> dict[str, object]:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        response = await client.post(f"{_api_base()}{path}", headers=_headers(), json=payload)
        response.raise_for_status()
        body = response.json()
        if not isinstance(body, dict):
            raise RuntimeError("ERP returned a non-object response")
        return body


@activity.defn
async def reserve_inventory(request: OrderRequest) -> Reservation:
    """Reserve ERP stock using an idempotency key equal to the order id."""

    payload = InventoryReservationPayload(
        order_id=request.order_id,
        customer_id=request.customer_id,
        lines=[{"product_id": line.product_id, "quantity": line.quantity} for line in request.lines],
    )
    activity.logger.info("reserving stock for order_id=%s", request.order_id)
    body = await _post("/internal/inventory/reservations", payload.model_dump())
    try:
        parsed = InventoryReservationResponse.model_validate(body.get("data", body))
    except ValidationError as exc:
        raise RuntimeError("ERP reservation response was invalid") from exc
    return Reservation(reservation_id=parsed.reservation_id)


@activity.defn
async def send_order_notifications(request: OrderRequest, reservation: Reservation) -> None:
    """Notify the customer and store staff through the ERP notification service."""

    payload = NotificationPayload(
        order_id=request.order_id,
        customer_mobile=request.customer_mobile,
        total_amount=request.total_amount,
        reservation_id=reservation.reservation_id,
    )
    activity.logger.info("sending notifications for order_id=%s", request.order_id)
    await _post("/internal/notifications/order", payload.model_dump())


@activity.defn
async def release_inventory(request: OrderRequest, reservation: Reservation) -> None:
    """Compensate a reservation when downstream notification delivery fails."""

    activity.logger.warning("releasing reservation for order_id=%s", request.order_id)
    await _post(
        f"/internal/inventory/reservations/{reservation.reservation_id}/release",
        {"order_id": request.order_id},
    )

from workflow_service.models import InventoryReservationPayload, OrderLine, OrderRequest


def test_order_request_is_typed_and_serializable() -> None:
    order = OrderRequest(
        order_id=42,
        customer_id=7,
        customer_mobile="9999999999",
        lines=(OrderLine(product_id=5, quantity=2),),
        total_amount="120.00",
    )
    payload = InventoryReservationPayload(
        order_id=order.order_id,
        customer_id=order.customer_id,
        lines=[{"product_id": line.product_id, "quantity": line.quantity} for line in order.lines],
    )
    assert payload.model_dump() == {"order_id": 42, "customer_id": 7, "lines": [{"product_id": 5, "quantity": 2}]}

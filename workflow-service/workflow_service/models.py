"""Stable workflow contracts shared by starters, workflows, and activities."""

from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


@dataclass(frozen=True)
class OrderLine:
    product_id: int
    quantity: int


@dataclass(frozen=True)
class OrderRequest:
    order_id: int
    customer_id: int
    customer_mobile: str
    lines: tuple[OrderLine, ...]
    total_amount: str


@dataclass(frozen=True)
class Reservation:
    reservation_id: str


@dataclass(frozen=True)
class FulfillmentResult:
    order_id: int
    reservation_id: str
    status: Literal["confirmed"]


class InventoryReservationPayload(BaseModel):
    """Validated payload sent to the ERP inventory boundary."""

    model_config = ConfigDict(extra="forbid")

    order_id: int = Field(gt=0)
    customer_id: int = Field(gt=0)
    lines: list[dict[str, int]] = Field(min_length=1)


class InventoryReservationResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    reservation_id: str = Field(min_length=1)


class NotificationPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    order_id: int = Field(gt=0)
    customer_mobile: str = Field(min_length=7, max_length=20)
    total_amount: str = Field(min_length=1)
    reservation_id: str = Field(min_length=1)

import type { CostQuote, CostQuoteLineItem, ExecutionPriceUsd, PricingQuantity } from "./types";

const USD_SCALE = 1_000_000;

function finitePositive(value: number, code: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(code);
  return value;
}

function finiteNonnegative(value: number, code: string) {
  if (!Number.isFinite(value) || value < 0) throw new Error(code);
  return value;
}

/** Monetary reservations use six decimal places and always round upward. */
export function ceilUsd(value: number) {
  finitePositive(value, "PRICING_AMOUNT_INVALID");
  return Math.ceil((value - Number.EPSILON) * USD_SCALE) / USD_SCALE;
}

export function quoteTotalUsd(quote: CostQuote) {
  if (!quote.lineItems?.length) return quote.amount * quote.quantity;
  return quote.lineItems.reduce((sum, item) => sum + item.maximumAmount, 0);
}

export function priceExecution(input: {
  price: ExecutionPriceUsd;
  unitQuantity: number;
  pricingQuantities?: readonly PricingQuantity[];
  quotedAt: Date;
  expiresAt: Date;
}): CostQuote {
  finitePositive(input.unitQuantity, "PRICING_QUANTITY_INVALID");
  if (input.price.basis !== "components") {
    const maximumAmount = ceilUsd(input.price.amount * input.unitQuantity);
    return {
      currency: "USD",
      amount: input.price.amount,
      basis: input.price.basis,
      quantity: input.unitQuantity,
      lineItems: [{ basis: input.price.basis, unitAmount: input.price.amount, quantity: input.unitQuantity, maximumAmount }],
      quotedAt: input.quotedAt,
      expiresAt: input.expiresAt,
    };
  }

  const components = input.price.components;
  const quantities = input.pricingQuantities ?? [];
  const quantityByBasis = new Map(quantities.map((item) => [item.basis, finiteNonnegative(item.quantity, "PRICING_COMPONENT_QUANTITY_INVALID")]));
  if (quantityByBasis.size !== quantities.length) throw new Error("PRICING_COMPONENT_DUPLICATE");
  if (quantities.some((item) => !components.some((component) => component.basis === item.basis))) throw new Error("PRICING_COMPONENT_UNEXPECTED");
  const lineItems: CostQuoteLineItem[] = components.map((component) => {
    const quantity = quantityByBasis.get(component.basis);
    if (quantity === undefined) throw new Error(`PRICING_COMPONENT_REQUIRED:${component.basis}`);
    return { basis: component.basis, unitAmount: component.amount, quantity, maximumAmount: quantity === 0 ? 0 : ceilUsd(component.amount * quantity) };
  });
  const total = ceilUsd(lineItems.reduce((sum, item) => sum + item.maximumAmount, 0));
  return { currency: "USD", amount: total, basis: "run", quantity: 1, lineItems, quotedAt: input.quotedAt, expiresAt: input.expiresAt };
}

export function imageMegapixels(width: number | null, height: number | null) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || !width || !height || width <= 0 || height <= 0) throw new Error("PRICING_IMAGE_DIMENSIONS_REQUIRED");
  return width * height / 1_000_000;
}

import { describe, expect, it } from "vitest";

import { imageMegapixels, priceExecution, quoteTotalUsd } from "../pricing";

const at = new Date("2026-09-05T00:00:00.000Z");
const expiresAt = new Date("2026-09-05T00:05:00.000Z");

describe("model execution pricing", () => {
  it("preserves ordinary per-second quotes", () => {
    const quote = priceExecution({ price: { basis: "second", amount: 0.005 }, unitQuantity: 5, quotedAt: at, expiresAt });
    expect(quote).toMatchObject({ amount: 0.005, basis: "second", quantity: 5 });
    expect(quoteTotalUsd(quote)).toBe(0.025);
  });

  it("quotes separate input and output megapixel components without flattening the evidence", () => {
    const quote = priceExecution({
      price: { basis: "components", components: [{ basis: "input_megapixel", amount: 0.001 }, { basis: "output_megapixel", amount: 0.001 }] },
      unitQuantity: 1,
      pricingQuantities: [{ basis: "input_megapixel", quantity: imageMegapixels(1080, 1920) }, { basis: "output_megapixel", quantity: 1 }],
      quotedAt: at,
      expiresAt,
    });
    expect(quote).toMatchObject({ basis: "run", quantity: 1, amount: 0.003074 });
    expect(quote.lineItems).toEqual([
      { basis: "input_megapixel", unitAmount: 0.001, quantity: 2.0736, maximumAmount: 0.002074 },
      { basis: "output_megapixel", unitAmount: 0.001, quantity: 1, maximumAmount: 0.001 },
    ]);
    expect(quoteTotalUsd(quote)).toBe(0.003074);
  });

  it("allows zero input megapixels for text-only generation but requires every billed component", () => {
    const price = { basis: "components" as const, components: [{ basis: "input_megapixel" as const, amount: 0.001 }, { basis: "output_megapixel" as const, amount: 0.001 }] };
    expect(quoteTotalUsd(priceExecution({ price, unitQuantity: 1, pricingQuantities: [{ basis: "input_megapixel", quantity: 0 }, { basis: "output_megapixel", quantity: 0.25 }], quotedAt: at, expiresAt }))).toBe(0.00025);
    expect(() => priceExecution({ price, unitQuantity: 1, pricingQuantities: [{ basis: "output_megapixel", quantity: 1 }], quotedAt: at, expiresAt })).toThrow("PRICING_COMPONENT_REQUIRED:input_megapixel");
  });

  it("rejects duplicate, unexpected, and dimensionless pricing inputs", () => {
    const price = { basis: "components" as const, components: [{ basis: "output_megapixel" as const, amount: 0.001 }] };
    expect(() => priceExecution({ price, unitQuantity: 1, pricingQuantities: [{ basis: "output_megapixel", quantity: 1 }, { basis: "output_megapixel", quantity: 2 }], quotedAt: at, expiresAt })).toThrow("PRICING_COMPONENT_DUPLICATE");
    expect(() => priceExecution({ price, unitQuantity: 1, pricingQuantities: [{ basis: "input_megapixel", quantity: 1 }], quotedAt: at, expiresAt })).toThrow("PRICING_COMPONENT_UNEXPECTED");
    expect(() => imageMegapixels(null, 1920)).toThrow("PRICING_IMAGE_DIMENSIONS_REQUIRED");
  });
});

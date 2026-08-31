const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const MAX_DIGITS = 80;

export function canonicalDecimal(value: string): string {
  if (!DECIMAL.test(value) || value.replace(".", "").length > MAX_DIGITS) {
    throw new TypeError("Expected a non-negative exact decimal string.");
  }
  if (!value.includes(".")) return value;
  const normalized = value.replace(/0+$/, "").replace(/\.$/, "");
  return normalized || "0";
}

function parts(value: string): { coefficient: bigint; scale: number } {
  const canonical = canonicalDecimal(value);
  const [whole, fraction = ""] = canonical.split(".");
  return {
    coefficient: BigInt(`${whole}${fraction}`),
    scale: fraction.length,
  };
}

function render(coefficient: bigint, scale: number): string {
  if (scale === 0) return coefficient.toString();
  const digits = coefficient.toString().padStart(scale + 1, "0");
  return canonicalDecimal(`${digits.slice(0, -scale)}.${digits.slice(-scale)}`);
}

export function addDecimals(left: string, right: string): string {
  const a = parts(left);
  const b = parts(right);
  const scale = Math.max(a.scale, b.scale);
  const coefficient =
    a.coefficient * BigInt(10) ** BigInt(scale - a.scale) +
    b.coefficient * BigInt(10) ** BigInt(scale - b.scale);
  return render(coefficient, scale);
}

export function multiplyDecimals(left: string, right: string): string {
  const a = parts(left);
  const b = parts(right);
  return render(a.coefficient * b.coefficient, a.scale + b.scale);
}

export function divideDecimalsExact(
  numerator: string,
  denominator: string,
): string {
  const a = parts(numerator);
  const b = parts(denominator);
  if (b.coefficient === BigInt(0)) throw new TypeError("Decimal division by zero.");
  let coefficient = a.coefficient * BigInt(10) ** BigInt(b.scale);
  const divisor = b.coefficient * BigInt(10) ** BigInt(a.scale);
  let scale = 0;
  while (coefficient % divisor !== BigInt(0) && scale < 36) {
    coefficient *= BigInt(10);
    scale += 1;
  }
  if (coefficient % divisor !== BigInt(0)) {
    throw new TypeError("Decimal division is not exact within 36 places.");
  }
  return render(coefficient / divisor, scale);
}

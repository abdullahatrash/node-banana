import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PricingPage } from "../PricingPage";

describe("PricingPage", () => {
  it("renders the complete approved English catalog and commercial boundary", () => {
    const { container } = render(<PricingPage locale="en" signInUrl="https://app.example/sign-in" signUpUrl="https://app.example/sign-up" />);
    expect(container.firstElementChild).toHaveAttribute("dir", "ltr");
    expect(screen.getByRole("heading", { name: "Choose the pace that fits your content engine" })).toBeInTheDocument();
    expect(screen.getByText("Free")).toBeInTheDocument();
    expect(screen.getByText("Starter")).toBeInTheDocument();
    expect(screen.getByText("Growth")).toBeInTheDocument();
    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.getByText("2,000 Generation Credits / month")).toBeInTheDocument();
    expect(screen.getByText(/provider bills you directly/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Choose/ })).toHaveLength(4);
  });

  it("renders the same catalog in Arabic with RTL direction", () => {
    const { container } = render(<PricingPage locale="ar" signInUrl="/sign-in" signUpUrl="/sign-up" />);
    expect(container.firstElementChild).toHaveAttribute("dir", "rtl");
    expect(screen.getByRole("heading", { name: "اختر الوتيرة المناسبة لمحرك محتواك" })).toBeInTheDocument();
    expect(screen.getByText("مجانية")).toBeInTheDocument();
    expect(screen.getByText("البداية")).toBeInTheDocument();
    expect(screen.getByText("النمو")).toBeInTheDocument();
    expect(screen.getByText("الاحترافية")).toBeInTheDocument();
    expect(screen.getByText(/يحاسبك المزوّد مباشرة/)).toBeInTheDocument();
  });
});

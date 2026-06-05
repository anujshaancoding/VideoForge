import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BrowserGate from "../BrowserGate.js";

describe("BrowserGate", () => {
  it("renders the Chrome/Edge guidance with working store links", () => {
    render(<BrowserGate />);
    // The headline carries role="alert" (announced on load), which overrides the
    // implicit heading role — query it as an alert.
    expect(screen.getByRole("alert")).toHaveTextContent(/works best in Chrome or Edge/i);
    expect(screen.getByRole("link", { name: /Get Chrome/i })).toHaveAttribute(
      "href",
      "https://www.google.com/chrome/",
    );
    expect(screen.getByRole("link", { name: /Get Edge/i })).toHaveAttribute(
      "href",
      "https://www.microsoft.com/edge",
    );
  });

  it("does not offer a 'continue anyway' escape hatch into a broken editor", () => {
    render(<BrowserGate />);
    expect(screen.queryByText(/continue anyway/i)).not.toBeInTheDocument();
  });

  it("copies the current link and confirms via the button label", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<BrowserGate />);
    await userEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Link copied" })).toBeInTheDocument(),
    );
  });
});

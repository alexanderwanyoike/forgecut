import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AppearanceControls from "../components/AppearanceControls";

function openAppearance() {
  fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
}

describe("Editor appearance", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-accent");
  });

  it("defaults to dark aluminum with a cobalt accent", () => {
    render(<AppearanceControls />);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.accent).toBe("cobalt");
  });

  it("switches and persists the selected mode", () => {
    render(<AppearanceControls />);
    openAppearance();
    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("forgecut-theme")).toBe("light");
    expect(screen.getByRole("radio", { name: "Light" })).toHaveProperty("checked", true);
  });

  it("changes the accent independently of the mode", () => {
    localStorage.setItem("forgecut-theme", "light");
    render(<AppearanceControls />);
    openAppearance();
    fireEvent.click(screen.getByRole("radio", { name: "Sage" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.accent).toBe("sage");
    expect(localStorage.getItem("forgecut-accent")).toBe("sage");
  });

  it("restores persisted mode and accent", () => {
    localStorage.setItem("forgecut-theme", "light");
    localStorage.setItem("forgecut-accent", "copper");
    render(<AppearanceControls />);
    openAppearance();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.accent).toBe("copper");
    expect(screen.getByRole("radio", { name: "Copper" })).toHaveProperty("checked", true);
  });

  it("replaces unsupported saved values with usable defaults", () => {
    localStorage.setItem("forgecut-theme", "invalid");
    localStorage.setItem("forgecut-accent", "invalid");
    render(<AppearanceControls />);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.accent).toBe("cobalt");
  });
});

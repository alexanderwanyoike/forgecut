import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import AssetBin from "../components/AssetBin";
const bridge = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue([]), open: vi.fn().mockResolvedValue(null) }));
vi.mock("../lib/bridge", () => bridge);
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("offers Showbiz storyboard packages through the existing media import action", async () => {
  render(<AssetBin projectVersion={0} projectAssets={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "Import Media" }));
  await waitFor(() => expect(bridge.open).toHaveBeenCalledWith(expect.objectContaining({
    filters: expect.arrayContaining([expect.objectContaining({ extensions: expect.arrayContaining(["sbz"]) })]),
  })));
});

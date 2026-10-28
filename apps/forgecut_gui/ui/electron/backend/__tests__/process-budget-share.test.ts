/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { budgetedMediaCommand } from "../process-budget";

const systemctl = vi.hoisted(() => ({ calls: [] as string[][] }));
vi.mock("node:child_process", () => ({
  execFile: (
    _command: string,
    args: string[],
    _options: unknown,
    done: (error: Error | null) => void,
  ) => {
    systemctl.calls.push(args);
    done(null);
  },
}));

it.skipIf(process.platform !== "linux")(
  "gives a scope its requested CPU share within the shared media slice",
  async () => {
    const invocation = await budgetedMediaCommand("bwrap", ["--"], 400);
    expect(invocation.args).toContain("--property=CPUQuota=400%");
    expect(systemctl.calls.at(-1)).toContain("CPUQuota=400%");
    const media = await budgetedMediaCommand("ffmpeg", []);
    expect(media.args).toContain("--property=CPUQuota=150%");
  },
);

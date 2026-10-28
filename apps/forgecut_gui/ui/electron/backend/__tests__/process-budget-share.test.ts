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
    const invocation = await budgetedMediaCommand("bwrap", ["--"], {
      cpuPercent: 400,
    });
    expect(invocation.args).toContain("--property=CPUQuota=400%");
    expect(systemctl.calls.at(-1)).toContain("CPUQuota=400%");
    const media = await budgetedMediaCommand("ffmpeg", []);
    expect(media.args).toContain("--property=CPUQuota=150%");
  },
);

it.skipIf(process.platform !== "linux")(
  "lets background work yield the CPU to interactive scopes",
  async () => {
    const background = await budgetedMediaCommand("ffmpeg", [], {
      cpuWeight: 10,
    });
    expect(background.args).toContain("--property=CPUWeight=10");
    const interactive = await budgetedMediaCommand("bwrap", []);
    expect(interactive.args.join(" ")).not.toContain("CPUWeight");
  },
);

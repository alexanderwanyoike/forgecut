import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";

export async function budgetedMediaCommand(
  executable: string,
  args: string[],
): Promise<{ command: string; args: string[]; unit?: string }> {
  const supported =
    process.platform === "linux" &&
    (await new Promise<boolean>((resolve) => {
      execFile(
        "systemctl",
        ["--user", "is-active", "--quiet", "default.target"],
        { timeout: 1000, maxBuffer: 4096 },
        (error) => resolve(!error),
      );
    }));
  if (!supported) return { command: executable, args };
  const aggregate = await new Promise<boolean>((resolve) => {
    execFile(
      "systemctl",
      [
        "--user",
        "set-property",
        "--runtime",
        "forgecut-media.slice",
        "MemoryMax=3221225472",
        "MemoryHigh=2147483648",
        "MemorySwapMax=268435456",
        "CPUQuota=150%",
      ],
      { timeout: 1000, maxBuffer: 4096 },
      (error) => resolve(!error),
    );
  });
  if (!aggregate) return { command: executable, args };
  const unit = `forgecut-media-${randomUUID()}.scope`;
  return {
    unit,
    command: "systemd-run",
    args: [
      "--user",
      "--scope",
      "--quiet",
      "--collect",
      "--slice=forgecut-media.slice",
      `--unit=${unit}`,
      "--property=MemoryMax=3221225472",
      "--property=MemoryHigh=2147483648",
      "--property=MemorySwapMax=268435456",
      "--property=CPUQuota=150%",
      "--",
      executable,
      ...args,
    ],
  };
}

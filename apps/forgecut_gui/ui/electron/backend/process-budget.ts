import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";

export async function budgetedMediaCommand(
  executable: "ffmpeg" | "ffprobe",
  args: string[],
): Promise<{ command: string; args: string[] }> {
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
  return {
    command: "systemd-run",
    args: [
      "--user",
      "--scope",
      "--quiet",
      "--collect",
      `--unit=forgecut-media-${randomUUID()}`,
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

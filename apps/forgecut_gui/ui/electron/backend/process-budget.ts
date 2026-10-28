import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";

const MEMORY = [
  "MemoryMax=3221225472",
  "MemoryHigh=2147483648",
  "MemorySwapMax=268435456",
];

export async function budgetedMediaCommand(
  executable: string,
  args: string[],
  {
    cpuPercent = 150,
    cpuWeight,
  }: {
    cpuPercent?: number;
    /** Below the default 100, the scope yields CPU to busier siblings in the slice. */
    cpuWeight?: number;
  } = {},
): Promise<{ command: string; args: string[]; unit?: string }> {
  if (
    process.platform !== "linux" ||
    !(await systemctl(["is-active", "--quiet", "default.target"])) ||
    !(await systemctl([
      "set-property",
      "--runtime",
      "forgecut-media.slice",
      ...MEMORY,
      "CPUQuota=400%",
    ]))
  )
    return { command: executable, args };
  const unit = `forgecut-media-${randomUUID()}.scope`;
  const properties = [
    ...MEMORY,
    `CPUQuota=${cpuPercent}%`,
    ...(cpuWeight === undefined ? [] : [`CPUWeight=${cpuWeight}`]),
  ];
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
      ...properties.map((property) => `--property=${property}`),
      "--",
      executable,
      ...args,
    ],
  };
}

function systemctl(args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      "systemctl",
      ["--user", ...args],
      { timeout: 1000, maxBuffer: 4096 },
      (error) => resolve(!error),
    );
  });
}

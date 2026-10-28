import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  RefreshCw,
  RotateCw,
  ExternalLink,
} from "lucide-react";
import type { UpdateResult, UpdateStatus } from "../../electron/shared/updates";
import ActionButton from "./ActionButton";
import "./application-footer.css";

type Props = { beforeInstall: () => Promise<boolean> };
export default function ApplicationFooter({ beforeInstall }: Props) {
  const bridge = window.forgecut?.updates;
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!bridge) return undefined;
    let active = true;
    const refresh = async () => {
      try {
        const result = await bridge.status();
        if (active && result.ok) setStatus(result.value);
      } catch {
        /* The explicit action offers retry if the bridge is unavailable. */
      }
    };
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [bridge]);
  const run = async (
    operation: () => Promise<UpdateResult>,
    installing = false,
  ) => {
    setBusy(true);
    setError(null);
    try {
      if (installing && !(await beforeInstall())) return;
      const result = await operation();
      if (result.ok) {
        setStatus(result.value);
        setChecked(true);
      } else setError(result.error.message);
    } catch {
      setError("The update could not finish. Please retry.");
    } finally {
      setBusy(false);
    }
  };
  let label = "Check for updates";
  let icon = RefreshCw;
  let operation = bridge?.check;
  let detail =
    "Check for a newer stable version. Downloads and installation require your approval.";
  if (status?.stage === "manual") {
    label = "Download installer";
    icon = ExternalLink;
    operation = bridge?.releases;
    detail =
      "Use the latest installer for this installation. In-app updates are supported in AppImage builds.";
  } else if (status?.stage === "available") {
    label = `Download v${status.version}`;
    icon = ArrowDownToLine;
    operation = bridge?.download;
  } else if (status?.stage === "ready") {
    label = "Restart to update";
    icon = RotateCw;
    operation = bridge?.install;
    detail = `Save your project, then confirm a restart to install v${status.version}.`;
  } else if (status?.stage === "checking") label = "Checking for updates…";
  else if (status?.stage === "downloading")
    label = `Downloading · ${status.percent}%`;
  return (
    <footer className="application-footer" aria-label="Application status">
      <span className="application-version">
        ForgeCut {status ? `v${status.currentVersion}` : "· Development"}
      </span>
      <div className="application-updates">
        <span
          role={error ? "alert" : "status"}
          className="update-message"
          title={error ?? undefined}
        >
          {error ??
            (status?.stage === "ready"
              ? `v${status.version} ready`
              : checked && status?.stage === "idle"
                ? "Up to date"
                : "")}
        </span>
        <ActionButton
          icon={icon}
          className="quiet-action footer-update"
          tooltip={error ?? detail}
          disabled={
            !operation ||
            busy ||
            status?.stage === "checking" ||
            status?.stage === "downloading"
          }
          onClick={() => {
            if (operation) void run(operation, status?.stage === "ready");
          }}
        >
          {error ? "Retry update" : label}
        </ActionButton>
      </div>
    </footer>
  );
}

import { useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, Moon, SlidersHorizontal, Sun, X } from "lucide-react";
import ActionButton from "./ActionButton";
import "./appearance.css";

type Mode = "dark" | "light";
const accents = ["cobalt", "sage", "copper", "plum", "amber"] as const;
type Accent = (typeof accents)[number];

export default function AppearanceControls() {
  const [mode, setMode] = useState<Mode>(() =>
    localStorage.getItem("forgecut-theme") === "light" ? "light" : "dark",
  );
  const [accent, setAccent] = useState<Accent>(() => {
    const saved = localStorage.getItem("forgecut-accent");
    return accents.find((value) => value === saved) ?? "cobalt";
  });
  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    localStorage.setItem("forgecut-theme", mode);
  }, [mode]);
  useEffect(() => {
    document.documentElement.dataset.accent = accent;
    localStorage.setItem("forgecut-accent", accent);
  }, [accent]);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <ActionButton icon={SlidersHorizontal} iconOnly tooltip="Appearance" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="appearance-popover"
          aria-label="Editor appearance"
          sideOffset={10}
          align="end"
          collisionPadding={12}
        >
          <div className="appearance-heading">
            <div>
              <strong>Appearance</strong>
              <p>Aluminum, your way.</p>
            </div>
            <Popover.Close asChild>
              <ActionButton icon={X} iconOnly tooltip="Close appearance" />
            </Popover.Close>
          </div>
          <fieldset>
            <legend>Interface</legend>
            <div className="appearance-modes">
              {(["light", "dark"] as const).map((value) => {
                const Icon = value === "light" ? Sun : Moon;
                return (
                  <label key={value}>
                    <input
                      type="radio"
                      name="appearance-mode"
                      value={value}
                      checked={mode === value}
                      onChange={() => setMode(value)}
                    />
                    <span>
                      <Icon size={16} aria-hidden="true" />
                      {value === "light" ? "Light" : "Dark"}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <fieldset>
            <legend>Accent color</legend>
            <div className="appearance-accents">
              {accents.map((value) => (
                <label key={value} data-accent={value}>
                  <input
                    type="radio"
                    name="appearance-accent"
                    value={value}
                    aria-label={value[0].toUpperCase() + value.slice(1)}
                    checked={accent === value}
                    onChange={() => setAccent(value)}
                  />
                  <span className="accent-swatch">
                    {accent === value && <Check size={15} aria-hidden="true" />}
                  </span>
                  <span className="accent-name">
                    {value[0].toUpperCase() + value.slice(1)}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

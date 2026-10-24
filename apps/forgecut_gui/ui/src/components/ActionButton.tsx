import { forwardRef, type ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import * as Tooltip from "@radix-ui/react-tooltip";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: LucideIcon;
  tooltip?: string;
  iconOnly?: boolean;
};

const ActionButton = forwardRef<HTMLButtonElement, Props>(
  (
    { icon: Icon, tooltip, iconOnly, className = "", children, ...props },
    ref,
  ) => {
    const button = (
      <button
        ref={ref}
        type="button"
        aria-label={iconOnly ? tooltip : undefined}
        className={`action-button${iconOnly ? " icon-button" : ""} ${className}`}
        {...props}
      >
        {Icon && <Icon size={16} strokeWidth={1.7} aria-hidden="true" />}
        {!iconOnly && children}
      </button>
    );
    if (!tooltip) return button;
    return (
      <Tooltip.Provider delayDuration={400}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>{button}</Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content className="control-tooltip" sideOffset={7}>
              {tooltip}
              <Tooltip.Arrow className="control-tooltip-arrow" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>
    );
  },
);
ActionButton.displayName = "ActionButton";
export default ActionButton;

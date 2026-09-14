import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TIME_HOURS,
  TIME_MINUTES,
  TIME_OPTIONS,
  TIME_PERIODS,
  formatTimeLabel,
  isTimePartAvailable,
  pickTimeValue,
  splitTimeValue,
  type TimeParts,
} from "@/lib/timeOptions";

type TimePickerProps = {
  value: string;
  onChange: (value: string) => void;
  /** The times that may be chosen; defaults to every half hour of the day. */
  options?: readonly { value: string; label: string }[];
  placeholder: string;
  disabled?: boolean;
  ariaLabel?: string;
};

const columnButtonClass = (selected: boolean) =>
  cn(
    "h-9 w-full shrink-0 rounded-md text-sm font-medium tabular-nums transition-colors disabled:pointer-events-none disabled:opacity-30",
    selected ? "bg-primary text-primary-foreground" : "hover:bg-muted",
  );

// Hour | minute | AM/PM columns, like a phone's time wheel, in place of one
// 48-row list. It still opens on nothing chosen: a time shown before anyone
// picks it reads as already fixed (see CarDetailPage.tsx). The panel opens in
// the page flow rather than floating, so a scrolling modal never clips it.
export default function TimePicker({
  value,
  onChange,
  options = TIME_OPTIONS,
  placeholder,
  disabled = false,
  ariaLabel,
}: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const hourListRef = useRef<HTMLDivElement>(null);
  const isOpen = open && !disabled;

  // A time that is no longer allowed (the clock moved on) shows as unchosen.
  const current = options.some((option) => option.value === value) ? value : "";
  const selected = splitTimeValue(current);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Close the picker, not the dialog it sits in.
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  // Bring the chosen hour (or the first one allowed) into view inside the hour
  // column, without scrolling the page.
  useEffect(() => {
    if (!isOpen) return;
    const list = hourListRef.current;
    const target =
      list?.querySelector<HTMLElement>('[aria-pressed="true"]') ??
      list?.querySelector<HTMLElement>("button:not(:disabled)");
    if (list && target) {
      list.scrollTop = target.offsetTop - list.clientHeight / 2 + target.clientHeight / 2;
    }
  }, [isOpen]);

  const choose = (part: Partial<TimeParts>) => {
    const next = pickTimeValue(options, current, part);
    if (next) onChange(next);
  };

  return (
    <div ref={rootRef}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-left text-sm ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={cn("truncate", !current && "text-muted-foreground")}>
          {current ? formatTimeLabel(current) : placeholder}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {isOpen && (
        <div className="mt-2 rounded-md border border-border/70 bg-card p-2 text-card-foreground shadow-lg">
          <div className="grid grid-cols-3 gap-1 text-center">
            {["Hour", "Min", "AM/PM"].map((heading) => (
              <p
                key={heading}
                className="pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {heading}
              </p>
            ))}

            <div
              ref={hourListRef}
              className="relative flex max-h-52 flex-col gap-1 overflow-y-auto overscroll-contain"
            >
              {TIME_HOURS.map((hour) => (
                <button
                  key={hour}
                  type="button"
                  aria-pressed={selected?.hour === hour}
                  disabled={!isTimePartAvailable(options, current, { hour })}
                  onClick={() => choose({ hour })}
                  className={columnButtonClass(selected?.hour === hour)}
                >
                  {hour}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-1">
              {TIME_MINUTES.map((minute) => (
                <button
                  key={minute}
                  type="button"
                  aria-pressed={selected?.minute === minute}
                  disabled={!isTimePartAvailable(options, current, { minute })}
                  onClick={() => choose({ minute })}
                  className={columnButtonClass(selected?.minute === minute)}
                >
                  {minute}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-1">
              {TIME_PERIODS.map((period) => (
                <button
                  key={period}
                  type="button"
                  aria-pressed={selected?.period === period}
                  disabled={!isTimePartAvailable(options, current, { period })}
                  onClick={() => choose({ period })}
                  className={columnButtonClass(selected?.period === period)}
                >
                  {period}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-2 flex justify-end border-t border-border/60 pt-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md px-3 py-1.5 text-sm font-semibold text-primary hover:bg-primary/10"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

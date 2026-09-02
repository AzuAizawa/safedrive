type AdminSectionTab<T extends string> = {
  value: T;
  label: string;
  count?: number;
};

type AdminSectionTabsProps<T extends string> = {
  value: T;
  tabs: AdminSectionTab<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
};

export default function AdminSectionTabs<T extends string>({
  value,
  tabs,
  onChange,
  ariaLabel,
}: AdminSectionTabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-border/70 bg-muted/30 p-1"
    >
      {tabs.map((tab) => {
        const selected = value === tab.value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.value)}
            className={`inline-flex min-h-9 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors sm:px-4 ${
              selected
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background/70 hover:text-foreground"
            }`}
          >
            <span>{tab.label}</span>
            {typeof tab.count === "number" ? (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] leading-none ${
                  selected ? "bg-primary-foreground/20" : "bg-background/80"
                }`}
              >
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

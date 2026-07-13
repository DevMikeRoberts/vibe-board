interface ParallelismSliderProps {
  value: number;
  max: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

export default function ParallelismSlider({ value, max, onChange, disabled }: ParallelismSliderProps) {
  const clampedMax = Math.max(1, max);
  const clampedValue = Math.min(value, clampedMax);

  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={1}
        max={clampedMax}
        value={clampedValue}
        disabled={disabled || clampedMax <= 1}
        onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))}
        className="h-3 flex-1 cursor-pointer appearance-none rounded-full bg-ink disabled:cursor-not-allowed disabled:opacity-50"
        style={{ accentColor: 'var(--color-neon-pink)' }}
      />
      <span className="sticker-sm min-w-[4.5rem] rounded-full bg-card px-2.5 py-1 text-center font-pixel text-[10px] text-foreground [text-transform:lowercase]">
        {clampedValue} of {clampedMax}
      </span>
    </div>
  );
}

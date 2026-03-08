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
        className="h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-muted accent-primary disabled:cursor-not-allowed disabled:opacity-50"
      />
      <span className="min-w-[4rem] text-sm text-muted-foreground">
        {clampedValue} of {clampedMax}
      </span>
    </div>
  );
}

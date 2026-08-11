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
        className="h-8 flex-1 cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:h-10 [&::-webkit-slider-runnable-track]:h-3 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-ink [&::-webkit-slider-thumb]:-mt-1.5 [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:box-border [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-ink [&::-webkit-slider-thumb]:bg-neon-pink [&::-moz-range-track]:h-3 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-ink [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:box-border [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-ink [&::-moz-range-thumb]:bg-neon-pink"
      />
      <span className="sticker-sm min-w-[4.5rem] rounded-full bg-card px-2.5 py-1 text-center font-pixel text-[10px] text-foreground [text-transform:lowercase]">
        {clampedValue} of {clampedMax}
      </span>
    </div>
  );
}

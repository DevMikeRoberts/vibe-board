// PixelIcon.tsx — recolorable 32×32 pixel icons from the Streamline Pixel pack.
//
// The SVGs are solid black glyphs, so we paint them via CSS mask: the element's
// background-color (currentColor by default) shows through the icon's shape.
// Any text-* utility therefore recolors the icon, exactly like lucide.
//
// Usage: <PixelIcon name="flash" className="h-4 w-4 text-neon-pink" />

import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

const modules = import.meta.glob('../assets/pixel/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const ICON_URLS: Record<string, string> = {};
for (const [path, url] of Object.entries(modules)) {
  const name = path.split('/').pop()!.replace(/\.svg$/, '');
  ICON_URLS[name] = url;
}

export type PixelIconName = string;

interface PixelIconProps {
  name: PixelIconName;
  className?: string;
  /** Extra inline styles (merged after the mask styles). */
  style?: CSSProperties;
  title?: string;
}

export function PixelIcon({ name, className, style, title }: PixelIconProps) {
  const url = ICON_URLS[name];
  if (!url) return null;

  const maskStyle: CSSProperties = {
    maskImage: `url("${url}")`,
    WebkitMaskImage: `url("${url}")`,
    maskSize: 'contain',
    WebkitMaskSize: 'contain',
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat',
    maskPosition: 'center',
    WebkitMaskPosition: 'center',
    backgroundColor: 'currentColor',
    ...style,
  };

  return (
    <span
      role="img"
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={cn('inline-block h-4 w-4 shrink-0 select-none', className)}
      style={maskStyle}
    />
  );
}

/** All available icon names (for pickers / dev). */
export const PIXEL_ICON_NAMES = Object.keys(ICON_URLS).sort();

import type { JSX } from 'preact';

/** אייקוני קו על רשת 24. השמות תואמים לשדה icon של הקטגוריות, ועוד סמלי ממשק. */
const PATHS: Record<string, string> = {
  briefcase: 'M4 8h16v11H4zM9 8V5h6v3M4 13h16',
  book: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11',
  dumbbell: 'M3 9v6M6 7v10M18 7v10M21 9v6M6 12h12',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  bag: 'M5 8h14l-1 12H6zM9 8a3 3 0 0 1 6 0',
  home: 'M4 11l8-7 8 7M6 10v10h12V10M10 20v-5h4v5',
  people: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a6 6 0 0 1 12 0M16 6a3 3 0 0 1 0 5M18 14a5 5 0 0 1 3 6',
  chat: 'M4 5h16v11H10l-5 4v-4H4z',
  palette: 'M12 4a8 8 0 1 0 0 16c1.5 0 2-1 1.5-2s0-2 1.5-2h2a3 3 0 0 0 3-3 8 8 0 0 0-8-9z',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  warning: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  car: 'M5 15v-4l2-5h10l2 5v4M4 15h16v3H4zM7.5 13h.01M16.5 13h.01',
};

export type IconName = keyof typeof PATHS | (string & {});

export interface IconProps {
  name: IconName;
  size?: number;
  title?: string;
}

export function Icon({ name, size = 20, title }: IconProps): JSX.Element {
  if (!(name in PATHS) && /\p{Extended_Pictographic}/u.test(name)) {
    return (
      <span class="ui-icon" data-icon={name} style={{ fontSize: `${size * 0.85}px`, lineHeight: 1 }} {...(title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true })}>
        {name}
      </span>
    );
  }
  const d = PATHS[name] ?? PATHS['palette']!;
  const a11y = title ? { role: 'img' as const, 'aria-label': title } : { 'aria-hidden': true as const };
  return (
    <svg
      class="ui-icon"
      data-icon={name}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      {...a11y}
    >
      <path d={d} />
    </svg>
  );
}

import type { ComponentChildren, JSX } from 'preact';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps {
  variant?: ButtonVariant;
  disabled?: boolean;
  type?: 'button' | 'submit';
  onClick?: () => void;
  children: ComponentChildren;
}

export function Button({ variant = 'primary', disabled = false, type = 'button', onClick, children }: ButtonProps): JSX.Element {
  return (
    <button
      class={`ui-button ui-button--${variant}`}
      type={type}
      disabled={disabled}
      {...(onClick ? { onClick } : {})}
    >
      {children}
    </button>
  );
}

export interface CardProps {
  raised?: boolean;
  children: ComponentChildren;
}

export function Card({ raised = false, children }: CardProps): JSX.Element {
  return <section class={raised ? 'ui-card ui-card--raised' : 'ui-card'}>{children}</section>;
}

export interface BadgeProps {
  tone?: 'neutral' | 'primary';
  children: ComponentChildren;
}

export function Badge({ tone = 'neutral', children }: BadgeProps): JSX.Element {
  return <span class={`ui-badge ui-badge--${tone}`}>{children}</span>;
}

/** מעטפת שורש: כיוון RTL ואזורים בטוחים. מצב כהה אוטומטי, או כפוי עם theme. */
export interface AppFrameProps {
  theme?: 'light' | 'dark';
  children: ComponentChildren;
}

export function AppFrame({ theme, children }: AppFrameProps): JSX.Element {
  return (
    <div class="ui-frame" dir="rtl" lang="he" {...(theme ? { 'data-theme': theme } : {})}>
      {children}
    </div>
  );
}

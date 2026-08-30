import type { ReactNode } from "react";

export function GradientLayer() {
  return (
    <div
      aria-hidden="true"
      className="punks-theme-gradient-layer pointer-events-none absolute inset-0 -z-10"
      data-punks-gradient-layer
    >
      <div className="punks-theme-gradient-underlay absolute inset-0" />
      <div
        className="punks-theme-gradient-layer-light absolute inset-0 opacity-0"
        data-punks-gradient="light"
      />
      <div
        className="punks-theme-gradient-layer-dark absolute inset-0 opacity-0"
        data-punks-gradient="dark"
      />
    </div>
  );
}

export function ContentSurface({
  children,
  unframed = false,
  terminal,
}: {
  children: ReactNode;
  terminal?: ReactNode;
  /** Used by dedicated huddle windows, which should not resemble app cards. */
  unframed?: boolean;
}) {
  return (
    <div
      className={
        unframed
          ? "relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
          : "relative z-10 mb-2 ml-px mr-2 mt-px flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-background shadow-content-edge"
      }
      data-punks-content-surface
      data-punks-content-unframed={unframed ? true : undefined}
    >
      <div className="punks-content-primary flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
      <div className="punks-terminal-dock-host" data-terminal-dock>
        {terminal}
      </div>
    </div>
  );
}

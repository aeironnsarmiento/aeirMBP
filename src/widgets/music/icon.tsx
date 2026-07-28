export function MusicIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/*
        Drawn to the same optical envelope as the other widget icons — roughly
        10.5 square, inset from the box. The earlier note ran 12.1 tall against
        About's 10.4 and Projects' 9, so it overshot them vertically while
        staying narrow, which reads as a thinner glyph rather than a larger one.
      */}
      <path d="M6.1 11.7V4.4l7.3-1.4v7.2" />
      <circle cx="4.35" cy="11.7" r="1.75" />
      <circle cx="11.65" cy="10.2" r="1.75" />
    </svg>
  );
}

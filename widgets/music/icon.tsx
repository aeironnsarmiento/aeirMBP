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
      <path d="M6 12.2V3.4l7-1.4v8.6" />
      <circle cx="4.3" cy="12.4" r="1.7" />
      <circle cx="11.3" cy="10.6" r="1.7" />
    </svg>
  );
}

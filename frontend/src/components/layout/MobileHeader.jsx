// p3portal.org
function P3Logo({ size = 24 }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id="p3-hg-mh" x1="0" y1="16" x2="32" y2="16" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#f97316" />
          <stop offset="48%" stopColor="#ef4444" />
          <stop offset="100%" stopColor="#3b82f6" />
        </linearGradient>
      </defs>
      <polygon
        points="16,3 27,9.5 27,22.5 16,29 5,22.5 5,9.5"
        fill="none"
        stroke="url(#p3-hg-mh)"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <text x="16" y="21.5" textAnchor="middle" fontSize="12" fontWeight="800" fontFamily="Inter,system-ui,sans-serif">
        <tspan fill="white">P</tspan>
        <tspan fill="#3b82f6">3</tspan>
      </text>
    </svg>
  )
}

export default function MobileHeader({ onOpenDrawer }) {
  return (
    <div className="md:hidden h-12 flex items-center px-4 gap-3 bg-portal-sidebar border-b border-portal-border shrink-0">
      <button
        onClick={onOpenDrawer}
        className="text-portal-text2 hover:text-portal-white transition-colors"
        aria-label="Menü öffnen"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-5 h-5">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
      <P3Logo size={24} />
      <span className="text-sm font-bold text-portal-white tracking-tight flex-1">P3 Portal</span>
    </div>
  )
}

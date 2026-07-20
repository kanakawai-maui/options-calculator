import './EmptyState.css'

/**
 * Reusable placeholder shown by analysis panels when they can't render yet.
 * Use for: no-ticker, no-legs, loading, or error states.
 *
 * Props:
 *   variant  – 'empty' (default) | 'loading' | 'error'
 *   title    – short bold heading (required for empty/error)
 *   hint     – secondary explanatory text (optional)
 *   action   – { label, onClick } to render a primary CTA (optional)
 *   compact  – tighter padding for inline/small placements
 */
export function PanelEmptyState({ variant = 'empty', title, hint, action, compact = false }) {
  if (variant === 'loading') {
    return (
      <div className={`panel-empty panel-empty--loading${compact ? ' panel-empty--compact' : ''}`} role="status" aria-live="polite">
        <div className="panel-empty-skeleton">
          <div className="skel-bar skel-bar--sm" />
          <div className="skel-bar skel-bar--lg" />
          <div className="skel-chart" />
        </div>
        <span className="panel-empty-sr">Loading…</span>
      </div>
    )
  }

  const kind = variant === 'error' ? 'error' : 'empty'
  return (
    <div className={`panel-empty panel-empty--${kind}${compact ? ' panel-empty--compact' : ''}`} role={variant === 'error' ? 'alert' : 'status'}>
      <div className="panel-empty-body">
        {title && <p className="panel-empty-title">{title}</p>}
        {hint && <p className="panel-empty-hint">{hint}</p>}
        {action && (
          <button
            type="button"
            className="panel-empty-action"
            onClick={action.onClick}
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  )
}

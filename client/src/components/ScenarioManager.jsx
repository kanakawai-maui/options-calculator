import { useEffect, useMemo, useRef, useState } from 'react'
import { useOptionsStore } from '../store/optionsStore'
import './ScenarioManager.css'

function formatDate(ms) {
  const d = new Date(ms)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatShortDate(ms) {
  const d = new Date(ms)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// Derive a default save name from the current working position.
// Falls back to "Untitled — MMM D" when there are no legs.
function suggestScenarioName({ legs, ticker }) {
  if (!legs || legs.length === 0) {
    return `Untitled — ${formatShortDate(Date.now())}`
  }
  const symbols = Array.from(new Set(legs.map((l) => (l.ticker || '').toUpperCase()).filter(Boolean)))
  const symbolPart = symbols.length > 0 ? symbols.join('/') : (ticker || '').toUpperCase() || 'Position'
  return `${symbolPart} — ${legs.length}-leg — ${formatShortDate(Date.now())}`
}

export function ScenarioManager() {
  const [open, setOpen] = useState(true)
  const [saveName, setSaveName] = useState('')
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [loadedId, setLoadedId] = useState(null)
  // Two-click delete: first click primes deletion, second click confirms.
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const confirmTimerRef = useRef(null)

  const { scenarios, saveScenario, loadScenario, deleteScenario, renameScenario, legs, ticker } =
    useOptionsStore()

  const suggestedName = useMemo(
    () => suggestScenarioName({ legs, ticker }),
    [legs, ticker],
  )

  useEffect(() => () => {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
  }, [])

  const handleSave = () => {
    const name = saveName.trim() || suggestedName
    saveScenario(name)
    setSaveName('')
  }

  const handleLoad = (id) => {
    loadScenario(id)
    setLoadedId(id)
    setTimeout(() => setLoadedId(null), 1500)
  }

  const handleDeleteClick = (id) => {
    if (confirmDeleteId === id) {
      deleteScenario(id)
      setConfirmDeleteId(null)
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
      return
    }
    setConfirmDeleteId(id)
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
    confirmTimerRef.current = setTimeout(() => setConfirmDeleteId(null), 3000)
  }

  const handleRenameCommit = (id) => {
    renameScenario(id, renameValue)
    setRenamingId(null)
    setRenameValue('')
  }

  const handleRenameKey = (e, id) => {
    if (e.key === 'Enter') handleRenameCommit(id)
    if (e.key === 'Escape') {
      setRenamingId(null)
      setRenameValue('')
    }
  }

  return (
    <section className="scenario-manager">
      <div className="sm-header">
        <span className="sm-title">Scenarios</span>
        <button
          type="button"
          className={`panel-collapse-btn${open ? '' : ' collapsed'}`}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? 'Collapse scenarios' : 'Expand scenarios'}
        >
          <svg viewBox="0 0 10 6" width="10" height="6" fill="currentColor" aria-hidden="true">
            <path d="M0 0L5 6L10 0z" />
          </svg>
        </button>
      </div>

      {open && (
        <div className="sm-body">
          <div className="sm-save-row">
            <input
              className="sm-name-input"
              type="text"
              placeholder={suggestedName}
              value={saveName}
              maxLength={60}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            />
            <button
              type="button"
              className="sm-save-btn"
              onClick={handleSave}
              disabled={legs.length === 0}
              title={legs.length === 0 ? 'Add at least one leg before saving' : `Save as "${saveName.trim() || suggestedName}"`}
            >
              Save
            </button>
          </div>

          {scenarios.length === 0 ? (
            <p className="sm-empty">No saved scenarios yet. Build a position and click Save.</p>
          ) : (
            <ul className="sm-list">
              {[...scenarios].reverse().map((s) => (
                <li key={s.id} className="sm-item">
                  <div className="sm-item-info">
                    {renamingId === s.id ? (
                      <input
                        className="sm-rename-input"
                        autoFocus
                        value={renameValue}
                        maxLength={60}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => handleRenameCommit(s.id)}
                        onKeyDown={(e) => handleRenameKey(e, s.id)}
                      />
                    ) : (
                      <button
                        type="button"
                        className="sm-item-name"
                        title="Click to rename"
                        onClick={() => {
                          setRenamingId(s.id)
                          setRenameValue(s.name)
                        }}
                      >
                        {s.name}
                      </button>
                    )}
                    <span className="sm-item-meta">
                      {s.ticker}
                      {s.legs.length > 0 && (
                        <> · {s.legs.length} leg{s.legs.length !== 1 ? 's' : ''}</>
                      )}
                       · {formatDate(s.savedAt)}
                    </span>
                  </div>

                  <div className="sm-item-actions">
                    <button
                      type="button"
                      className={`sm-load-btn${loadedId === s.id ? ' sm-load-btn--done' : ''}`}
                      onClick={() => handleLoad(s.id)}
                    >
                      {loadedId === s.id ? 'Loaded' : 'Load'}
                    </button>
                    <button
                      type="button"
                      className={`sm-delete-btn${confirmDeleteId === s.id ? ' sm-delete-btn--confirm' : ''}`}
                      onClick={() => handleDeleteClick(s.id)}
                      title={confirmDeleteId === s.id ? 'Click again to confirm delete' : 'Delete scenario'}
                      aria-label={confirmDeleteId === s.id ? 'Confirm delete' : 'Delete scenario'}
                    >
                      {confirmDeleteId === s.id ? 'Confirm?' : '✕'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

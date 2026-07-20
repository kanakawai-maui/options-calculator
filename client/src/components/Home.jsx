import { Link } from 'react-router-dom'
import './Home.css'

export function Home() {
  return (
    <div className="home-wrap">
      <nav className="home-nav">
        <div className="home-nav-brand">
          <span className="hero-mark">OPS</span>
          <span className="home-nav-name">Options Calculator</span>
        </div>
        <div className="home-nav-links">
          <Link to="/about" className="home-nav-link">About</Link>
          <Link to="/" className="home-nav-cta">Launch App →</Link>
        </div>
      </nav>

      <section className="home-hero">
        <div className="home-hero-badge">Free &amp; Educational</div>
        <h1 className="home-hero-title">
          Options analysis,<br />
          <span className="home-hero-accent">no BS.</span>
        </h1>
        <p className="home-hero-sub">
          Build multi-leg strategies, visualize P&amp;L heatmaps, explore Greeks, and
          stress-test scenarios. All in your browser, powered by live market data.
        </p>
        <div className="home-hero-actions">
          <Link to="/" className="home-btn home-btn--primary">Launch the Calculator</Link>
          <Link to="/about" className="home-btn home-btn--ghost">Learn more</Link>
        </div>
      </section>

      <section className="home-features">
        <div className="home-feature">
          <div className="home-feature-icon">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <h3>Live Option Chains</h3>
          <p>Pulls real-time quotes and implied volatility for any US equity or ETF — no account required.</p>
        </div>
        <div className="home-feature">
          <div className="home-feature-icon">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M9 21V9" />
            </svg>
          </div>
          <h3>P&amp;L Heatmaps</h3>
          <p>See your full profit and loss profile across price and time — for single legs or complex multi-leg spreads.</p>
        </div>
        <div className="home-feature">
          <div className="home-feature-icon">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4l3 3" />
            </svg>
          </div>
          <h3>Greeks &amp; Insights</h3>
          <p>Delta, Gamma, Theta, Vega, and Rho — visualized across the full price range, not just at the current spot.</p>
        </div>
        <div className="home-feature">
          <div className="home-feature-icon">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <h3>Strategy Builder</h3>
          <p>Prebuilt strategies — straddles, condors, spreads, butterflies — or build your own leg by leg.</p>
        </div>
        <div className="home-feature">
          <div className="home-feature-icon">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          <h3>Ticker Screener</h3>
          <p>Filter hundreds of tickers by IV rank, skew, volume, and open interest to find the best candidates.</p>
        </div>
        <div className="home-feature">
          <div className="home-feature-icon">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </div>
          <h3>Scenario Manager</h3>
          <p>Save and compare multiple what-if scenarios side-by-side to simulate a trade before you place it.</p>
        </div>
      </section>

      <section className="home-disclaimer">
        <p>
          <strong>Educational use only.</strong> All data, calculations, and tools are provided free of charge for
          learning and analysis. Nothing here constitutes financial advice. Always do your own research before trading.{' '}
          <Link to="/about" className="home-inline-link">Learn more about how the data works →</Link>
        </p>
      </section>

      <footer className="home-footer">
        <span>© {new Date().getFullYear()} Options Calculator</span>
        <span className="home-footer-sep" aria-hidden="true">·</span>
        <Link to="/about" className="home-footer-link">About</Link>
        <span className="home-footer-sep" aria-hidden="true">·</span>
        <Link to="/legal" className="home-footer-link">Legal</Link>
      </footer>
    </div>
  )
}

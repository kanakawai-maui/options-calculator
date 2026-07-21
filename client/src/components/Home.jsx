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
        <div className="home-hero-badge">Free &amp; Open to Everyone</div>
        <h1 className="home-hero-title">
          Learn options by<br />
          <span className="home-hero-accent">seeing the math.</span>
        </h1>
        <p className="home-hero-sub">
          A hands-on calculator for understanding how options are priced, how strategies
          behave under different market conditions, and what the Greeks actually mean.
          Built for students and self-directed learners.
        </p>
        <div className="home-hero-actions">
          <Link to="/" className="home-btn home-btn--primary">Open the Calculator</Link>
          <Link to="/about" className="home-btn home-btn--ghost">How it works</Link>
        </div>
      </section>

      <section className="home-concepts">
        <h2 className="home-concepts-heading">What you can explore</h2>
        <div className="home-concepts-grid">
          <div className="home-concept">
            <span className="home-concept-label">Greeks</span>
            <p>See how Delta, Gamma, Theta, Vega, and Rho shift across the full price range (not just at one strike).</p>
          </div>
          <div className="home-concept">
            <span className="home-concept-label">P&amp;L at Expiration</span>
            <p>Plot the payoff curve of any single-leg or multi-leg position and understand exactly where it profits or loses.</p>
          </div>
          <div className="home-concept">
            <span className="home-concept-label">Implied Volatility</span>
            <p>Read the IV on any contract, compare it to historical vol, and see how the market is pricing uncertainty.</p>
          </div>
          <div className="home-concept">
            <span className="home-concept-label">Time Decay</span>
            <p>Watch how Theta erodes extrinsic value day by day, and why it accelerates as expiration approaches.</p>
          </div>
          <div className="home-concept">
            <span className="home-concept-label">Multi-leg Strategies</span>
            <p>Build spreads, straddles, condors, and butterflies leg by leg and see how combining options changes risk.</p>
          </div>
          <div className="home-concept">
            <span className="home-concept-label">Scenario Analysis</span>
            <p>Change spot price, volatility, or days to expiry and observe how your position responds in real time.</p>
          </div>
        </div>
      </section>

      <section className="home-features">
        <div className="home-feature">
          <div className="home-feature-icon">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
          </div>
          <h3>No textbook needed</h3>
          <p>Every concept is shown with live numbers. Adjust a parameter and see the effect instantly — no equations to memorize first.</p>
        </div>
        <div className="home-feature">
          <div className="home-feature-icon">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </div>
          <h3>Free Tier</h3>
          <p>No subscription, no account wall, no ads. Recent market data is fetched so you can just open the tool and start learning.</p>
        </div>
        <div className="home-feature">
          <div className="home-feature-icon">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <h3>Real market data</h3>
          <p>Option chains are pulled live for any US equity or ETF. You learn with similar prices you'd see on a brokerage platform.</p>
        </div>
        <div className="home-feature">
          <div className="home-feature-icon">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M9 21V9" />
            </svg>
          </div>
          <h3>Visual P&amp;L heatmaps</h3>
          <p>Heatmaps show profit and loss across every price level, so you understand the full risk profile (not just the breakeven).</p>
        </div>
        <div className="home-feature">
          <div className="home-feature-icon">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          <h3>Ticker screener</h3>
          <p>Filter by IV rank, skew, and liquidity across hundreds of tickers (useful for understanding which markets are "expensive" or "cheap" in vol terms).</p>
        </div>
        <div className="home-feature">
          <div className="home-feature-icon">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </div>
          <h3>Save scenarios</h3>
          <p>Save multiple setups and compare them side-by-side (great for studying how the same strategy behaves across different underlyings or expiries).</p>
        </div>
      </section>

      <section className="home-disclaimer">
        <p>
          <strong>For learning, not trading advice.</strong> All data and calculations are provided free of charge.
          Market prices shown are near-real-time and may differ slightly from your broker. Nothing here is a
          recommendation to buy or sell any security.{' '}
          <Link to="/about" className="home-inline-link">Read more about the data →</Link>
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

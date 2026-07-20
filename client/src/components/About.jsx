import { Link } from 'react-router-dom'
import './About.css'

export function About() {
  return (
    <div className="about-wrap">
      <nav className="home-nav">
        <div className="home-nav-brand">
          <span className="hero-mark">OPS</span>
          <span className="home-nav-name">Options Calculator</span>
        </div>
        <div className="home-nav-links">
          <Link to="/home" className="home-nav-link">Home</Link>
          <Link to="/" className="home-nav-cta">Launch App →</Link>
        </div>
      </nav>

      <article className="about-article">
        <header className="about-header">
          <span className="about-tag">About</span>
          <h1>What is the Options Calculator?</h1>
          <p className="about-lead">
            A free, browser-based tool for learning, analyzing, and stress-testing
            equity options strategies — no account, no subscription, no catch.
          </p>
        </header>

        <section className="about-section">
          <h2>What it's for</h2>
          <p>
            Options Calculator is built for traders and students who want to
            understand how options actually behave — before putting real money at
            risk. You can:
          </p>
          <ul>
            <li>Pull live option chains for any US equity or ETF</li>
            <li>Construct multi-leg strategies (spreads, straddles, condors, butterflies, and more)</li>
            <li>Visualize profit and loss across a full range of underlying prices</li>
            <li>Study the Greeks (Delta, Gamma, Theta, Vega, Rho) with interactive charts</li>
            <li>Screen hundreds of tickers by implied volatility, skew, and liquidity</li>
            <li>Save and compare scenarios to stress-test a trade before you place it</li>
          </ul>
          <p>
            It is designed to make the math of options transparent — so you can see
            exactly why a trade makes or loses money under different conditions,
            not just guess.
          </p>
        </section>

        <section className="about-section">
          <h2>Data &amp; accuracy</h2>
          <p>
            Market data is sourced from publicly available financial data providers
            and is refreshed automatically when you load a ticker. Prices, implied
            volatility, and the Greeks shown are derived from real-time or near-real-time
            quotes using standard Black-Scholes calculations.
          </p>
          <div className="about-callout about-callout--warn">
            <strong>Educational purposes only.</strong> While every effort is made to
            keep data accurate and up to date, there is no guarantee that prices
            or Greeks shown exactly match what you'd see on a brokerage platform at
            any given moment. Bid/ask spreads, last-sale latency, and data
            normalization can cause minor differences. Always confirm prices with
            your broker before trading.
          </div>
          <p>
            All calculations — including the P&amp;L heatmap, Greeks, and scenario
            analysis — are performed locally in your browser using the Black-Scholes
            model. No trade data or personal information is ever sent to a server.
          </p>
        </section>

        <section className="about-section">
          <h2>It's free — here's why</h2>
          <p>
            Options Calculator is a personal project, built out of frustration with
            tools that hide basic analysis behind expensive subscriptions or clunky
            interfaces. The goal is to make professional-grade options analysis
            accessible to anyone learning the space.
          </p>
          <p>
            There is no premium tier, no paywall, and no hidden cost. The entire
            tool runs in your browser; the only backend is a lightweight proxy that
            fetches public market data.
          </p>
        </section>

        <section className="about-section">
          <h2>Not financial advice</h2>
          <p>
            Everything here — prices, Greeks, insights, strategy suggestions — is
            for <strong>educational and informational purposes only</strong>. Nothing
            on this site constitutes a recommendation to buy, sell, or hold any
            security. Options trading involves substantial risk and is not suitable
            for all investors.
          </p>
          <p>
            Please consult a qualified financial professional before making any
            investment decisions. Past performance shown in any scenario or example
            does not predict future results.
          </p>
          <p>
            <Link to="/legal" className="about-link">Read the full legal disclaimer →</Link>
          </p>
        </section>
      </article>

      <footer className="home-footer">
        <span>© {new Date().getFullYear()} Options Calculator</span>
        <span className="home-footer-sep" aria-hidden="true">·</span>
        <Link to="/home" className="home-footer-link">Home</Link>
        <span className="home-footer-sep" aria-hidden="true">·</span>
        <Link to="/legal" className="home-footer-link">Legal</Link>
      </footer>
    </div>
  )
}

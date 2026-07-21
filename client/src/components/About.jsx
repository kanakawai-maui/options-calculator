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
          <h1>Options Calculator</h1>
          <p className="about-lead">
            A free calculator for understanding how options are priced and how
            different strategies play out.  Built for students, self-directed learners,
            and anyone tired of paying $50/month just to see a diagram.
          </p>
        </header>

        <section className="about-section">
          <h2>What it does</h2>
          <p>
            You pick a ticker, load the live option chain, and start building. You can
            look at a single contract or combine multiple legs into a spread, straddle,
            condor (or whatever you're studying). The tool shows you:
          </p>
          <ul>
            <li>The full P&amp;L curve at expiration across a range of prices</li>
            <li>How Delta, Gamma, Theta, Vega, and Rho behave across the chain</li>
            <li>What the market's implied volatility is for any strike and expiry</li>
            <li>How combining legs changes your breakevens and max loss/gain</li>
            <li>How a position responds when you change spot price, vol, or time</li>
          </ul>
          <p>
            The point is to make the mechanics visible. Options math is not that
            complicated once you can see it moving.  It just looks complicated when
            it's hidden behind jargon!
          </p>
        </section>

        <section className="about-section">
          <h2>Where the data comes from</h2>
          <p>
            Option chains are fetched from public market data sources when you load
            a ticker. Prices update automatically. The Greeks and P&amp;L values are
            calculated in your browser using the Black-Scholes model (standard stuff,
            the same math covered in any options textbook).
          </p>
          <div className="about-callout about-callout--warn">
            <strong>Heads up on accuracy.</strong> The numbers here are close but not
            guaranteed to match your broker or preferred trading platform. Bid/ask spreads, quote
            latency, and how different platforms mark mid-prices can all cause small
            differences. Use this to learn and explore, not to copy exact entry prices.  Maybe this will 
            be a future feature!
          </div>
          <p>
            Everything runs in your browser. The backend is just a small proxy that
            fetches publically available data.  No account is needed and nothing about your session
            is stored on the server.
          </p>
        </section>

        <section className="about-section">
          <h2>Why it's free</h2>
          <p>
            This started as a side project because most options tools are either
            locked behind expensive subscriptions or buried inside broker platforms
            that want you trading, not learning. Basic payoff diagrams and Greeks
            charts shouldn't cost money.
          </p>
          <p>
            There's no premium plan, no trial period, no email required. It's just
            a useful tool.
          </p>
        </section>

        <section className="about-section">
          <h2>This is not financial advice</h2>
          <p>
            Nothing on this site is a recommendation to buy, sell, or hold anything.
            Options involve real risk! You can lose the entire amount you put in, and
            some strategies carry theoretically unlimited downside. The scenarios and
            examples here are for learning purposes only.
          </p>
          <p>
            If you're making real trading decisions, talk to a financial professional
            and do your own research. Past results in any example don't predict
            future performance.  Options are complex and can be risky, so make sure you understand the risks before trading.
          </p>
          <p>
            <Link to="/legal" className="about-link">Full legal disclaimer →</Link>
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

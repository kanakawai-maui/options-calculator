import { Link } from 'react-router-dom'
import './Legal.css'

// ─── Add your legal content below ─────────────────────────────────────────
// Replace the placeholder sections with your actual text.
// You can use plain text, JSX elements, or import a Markdown renderer.

const LEGAL_CONTENT = `
The information, tools, calculators, and content provided through this application are for informational and educational purposes only and should not be considered financial, investment, legal, tax, or accounting advice. Nothing in this application constitutes a recommendation to buy, sell, or hold any financial product or security.

Users are solely responsible for evaluating their financial decisions and should consult a qualified financial, legal, or tax professional before making decisions based on the information provided by this application. Past performance does not guarantee future results, and all investments involve risk, including the potential loss of principal.

While we strive to provide accurate and up-to-date information, we make no representations or warranties regarding the accuracy, completeness, reliability, or timeliness of any information or calculations provided. The application and its content are provided "as is" without warranties of any kind, to the fullest extent permitted by law.

By using this application, you acknowledge that you assume all risks associated with your financial decisions and agree that the application, its owners, developers, affiliates, and licensors shall not be liable for any direct, indirect, incidental, consequential, or special damages arising from your use of, or reliance on, the application or its content.` // set to a JSX element or string to override the placeholder

// ──────────────────────────────────────────────────────────────────────────

export function Legal() {
  return (
    <div className="legal-wrap">
      <Link to="/" className="legal-back">← Back to app</Link>

      <article className="legal-article">
        <h1>Legal</h1>
        <h3>Financial Disclaimer</h3>
        {LEGAL_CONTENT ?? (
          <p className="legal-placeholder">
            [ Add your legal content here — edit <code>LEGAL_CONTENT</code> in{' '}
            <code>src/components/Legal.jsx</code> ]
          </p>
        )}
      </article>
    </div>
  )
}

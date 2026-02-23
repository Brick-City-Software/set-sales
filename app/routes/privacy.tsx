// Public route — no authentication required.
// URL: /privacy
// Use this URL in your Partner Dashboard app listing as the Privacy Policy URL.

import type { MetaFunction } from "react-router";

export const meta: MetaFunction = () => [
  { title: "Privacy Policy — Set Sales" },
];

export default function PrivacyPolicy() {
  return (
    <div style={{
      fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      minHeight: "100vh",
      background: "#fff",
      color: "#1a1a2e",
    }}>
      {/* Nav */}
      <nav style={{
        borderBottom: "1px solid #e8edf2",
        padding: "0.9rem 2rem",
      }}>
        <div style={{ maxWidth: "1100px", margin: "0 auto", display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <a href="/" style={{ display: "flex", alignItems: "center", gap: "0.6rem", textDecoration: "none" }}>
            <img src="/icon.png" alt="Set Sales" style={{ width: "32px", height: "32px", borderRadius: "7px" }} />
            <span style={{ fontSize: "1.1rem", fontWeight: 700, color: "#0a3d6b" }}>Set Sales</span>
          </a>
        </div>
      </nav>

      {/* Content */}
      <div style={{ maxWidth: "760px", margin: "0 auto", padding: "4rem 2rem 6rem" }}>
        <h1 style={{ fontSize: "2rem", fontWeight: 800, color: "#0a3d6b", margin: "0 0 0.4rem" }}>
          Privacy Policy
        </h1>
        <p style={{ color: "#718096", marginBottom: "3rem", fontSize: "0.95rem" }}>
          Last updated: February 18, 2026
        </p>

        <p style={{ lineHeight: 1.75, marginBottom: "1.5rem", color: "#4a5568" }}>
          This Privacy Policy describes how Brick City Software (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) collects, uses, and
          handles information when you use the Set Sales app (&quot;the App&quot;) for Shopify.
        </p>

        <Section title="Information We Collect">
          <p style={p}>The App collects and stores only the minimum data necessary to provide its core functionality:</p>
          <ul style={ul}>
            <li style={li}><strong>Shop information:</strong> Your Shopify store domain and OAuth access token, used to authenticate API requests on your behalf.</li>
            <li style={li}><strong>Sale data:</strong> Sale names, discount types, discount values, and status (active or ended), created by you when using the App.</li>
            <li style={li}><strong>Product variant data:</strong> Shopify product and variant IDs, original prices, and sale prices for variants you include in a sale. This data is used to restore original prices when a sale ends.</li>
          </ul>
          <p style={p}><strong>We do not collect any customer data.</strong> The App does not access, store, or process any personally identifiable information about your store&apos;s customers, including names, email addresses, phone numbers, or order history.</p>
        </Section>

        <Section title="How We Use Information">
          <p style={p}>We use the information we collect solely to:</p>
          <ul style={ul}>
            <li style={li}>Authenticate and authorize the App to access your Shopify store</li>
            <li style={li}>Create, manage, and end sales by updating product variant prices via the Shopify Admin API</li>
            <li style={li}>Restore original prices when a sale ends</li>
            <li style={li}>Display your sale history and statistics within the App</li>
          </ul>
        </Section>

        <Section title="Data Sharing">
          <p style={p}>We do not sell, trade, or otherwise transfer your information to third parties, except as described below:</p>
          <ul style={ul}>
            <li style={li}><strong>Shopify:</strong> The App operates within the Shopify platform and is subject to Shopify&apos;s <a href="https://www.shopify.com/legal/privacy" style={link}>Privacy Policy</a>.</li>
            <li style={li}><strong>Error monitoring:</strong> We use Sentry to capture application errors and performance data. Error reports may include technical details such as request URLs and stack traces, but do not include any merchant or customer personal information.</li>
          </ul>
        </Section>

        <Section title="Data Retention">
          <p style={p}>
            We retain your shop&apos;s data for as long as the App is installed on your store. If you uninstall the App,
            your sale history and session data are deleted from our systems within 48 hours in accordance with
            Shopify&apos;s GDPR compliance requirements.
          </p>
        </Section>

        <Section title="Your Rights">
          <p style={p}>You have the right to:</p>
          <ul style={ul}>
            <li style={li}>Request access to the data we hold about your store</li>
            <li style={li}>Request deletion of your store&apos;s data by uninstalling the App or contacting us directly</li>
            <li style={li}>Request a copy of your data in a portable format</li>
          </ul>
        </Section>

        <Section title="Security">
          <p style={p}>
            We take reasonable measures to protect your information. All data is transmitted over HTTPS/TLS.
            OAuth access tokens are stored securely and never exposed to the client. We do not store payment
            information — all billing is handled directly by Shopify.
          </p>
        </Section>

        <Section title="Changes to This Policy">
          <p style={p}>
            We may update this Privacy Policy from time to time. We will notify you of any significant changes
            by updating the date at the top of this page. Continued use of the App after changes constitutes
            acceptance of the updated policy.
          </p>
        </Section>

        <Section title="Contact Us">
          <p style={p}>If you have questions about this Privacy Policy or wish to exercise your data rights, please contact us:</p>
          <p style={{ ...p, margin: 0 }}><strong>Brick City Software</strong></p>
          <p style={{ ...p, margin: 0 }}>
            Email: <a href="mailto:support@brickcitysoftware.com" style={link}>support@brickcitysoftware.com</a>
          </p>
        </Section>
      </div>

      {/* Footer */}
      <footer style={{ background: "#0a3d6b", padding: "1.75rem 2rem" }}>
        <div style={{ maxWidth: "1100px", margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.9rem", color: "rgba(255,255,255,0.7)" }}>
          <span>© {new Date().getFullYear()} Set Sales</span>
          <a href="/privacy" style={{ color: "rgba(255,255,255,0.7)", textDecoration: "none" }}>Privacy Policy</a>
        </div>
      </footer>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: "2.5rem" }}>
      <h2 style={{ fontSize: "1.2rem", fontWeight: 700, color: "#0a3d6b", margin: "0 0 0.75rem", paddingTop: "2rem", borderTop: "1px solid #e8edf2" }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

const p: React.CSSProperties = { lineHeight: 1.75, marginBottom: "1rem", color: "#4a5568", fontSize: "0.97rem" };
const ul: React.CSSProperties = { paddingLeft: "1.5rem", marginBottom: "1rem" };
const li: React.CSSProperties = { marginBottom: "0.6rem", lineHeight: 1.7, color: "#4a5568", fontSize: "0.97rem" };
const link: React.CSSProperties = { color: "#2196f3", textDecoration: "none" };

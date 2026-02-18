// Public route — no authentication required.
// URL: /privacy
// Use this URL in your Partner Dashboard app listing as the Privacy Policy URL.

export default function PrivacyPolicy() {
  return (
    <div style={{ maxWidth: "800px", margin: "0 auto", padding: "48px 24px", fontFamily: "sans-serif", lineHeight: "1.6", color: "#212b36" }}>
      <h1 style={{ fontSize: "28px", fontWeight: "bold", marginBottom: "8px" }}>Privacy Policy</h1>
      <p style={{ color: "#6d7175", marginBottom: "40px" }}>Last updated: February 18, 2026</p>

      <p style={{ marginBottom: "24px" }}>
        This Privacy Policy describes how Brick City Software ("we", "us", or "our") collects, uses, and
        handles information when you use the Set Sales app ("the App") for Shopify.
      </p>

      <h2 style={{ fontSize: "20px", fontWeight: "600", marginTop: "40px", marginBottom: "12px" }}>Information We Collect</h2>
      <p style={{ marginBottom: "12px" }}>
        The App collects and stores only the minimum data necessary to provide its core functionality:
      </p>
      <ul style={{ paddingLeft: "24px", marginBottom: "24px" }}>
        <li style={{ marginBottom: "8px" }}>
          <strong>Shop information:</strong> Your Shopify store domain and OAuth access token, used to authenticate
          API requests on your behalf.
        </li>
        <li style={{ marginBottom: "8px" }}>
          <strong>Sale data:</strong> Sale names, discount types, discount values, and status (active or ended),
          created by you when using the App.
        </li>
        <li style={{ marginBottom: "8px" }}>
          <strong>Product variant data:</strong> Shopify product and variant IDs, original prices, and sale prices
          for variants you include in a sale. This data is used to restore original prices when a sale ends.
        </li>
      </ul>
      <p style={{ marginBottom: "24px" }}>
        <strong>We do not collect any customer data.</strong> The App does not access, store, or process any
        personally identifiable information about your store's customers, including names, email addresses,
        phone numbers, or order history.
      </p>

      <h2 style={{ fontSize: "20px", fontWeight: "600", marginTop: "40px", marginBottom: "12px" }}>How We Use Information</h2>
      <p style={{ marginBottom: "12px" }}>We use the information we collect solely to:</p>
      <ul style={{ paddingLeft: "24px", marginBottom: "24px" }}>
        <li style={{ marginBottom: "8px" }}>Authenticate and authorize the App to access your Shopify store</li>
        <li style={{ marginBottom: "8px" }}>Create, manage, and end sales by updating product variant prices via the Shopify Admin API</li>
        <li style={{ marginBottom: "8px" }}>Restore original prices when a sale ends</li>
        <li style={{ marginBottom: "8px" }}>Display your sale history and statistics within the App</li>
      </ul>

      <h2 style={{ fontSize: "20px", fontWeight: "600", marginTop: "40px", marginBottom: "12px" }}>Data Sharing</h2>
      <p style={{ marginBottom: "24px" }}>
        We do not sell, trade, or otherwise transfer your information to third parties, except as described below:
      </p>
      <ul style={{ paddingLeft: "24px", marginBottom: "24px" }}>
        <li style={{ marginBottom: "8px" }}>
          <strong>Shopify:</strong> The App operates within the Shopify platform and is subject to
          Shopify's <a href="https://www.shopify.com/legal/privacy" style={{ color: "#2c6ecb" }}>Privacy Policy</a>.
        </li>
        <li style={{ marginBottom: "8px" }}>
          <strong>Error monitoring:</strong> We use Sentry to capture application errors and performance data.
          Error reports may include technical details such as request URLs and stack traces, but do not include
          any merchant or customer personal information.
        </li>
      </ul>

      <h2 style={{ fontSize: "20px", fontWeight: "600", marginTop: "40px", marginBottom: "12px" }}>Data Retention</h2>
      <p style={{ marginBottom: "24px" }}>
        We retain your shop's data for as long as the App is installed on your store. If you uninstall the App,
        your sale history and session data are deleted from our systems within 48 hours in accordance with
        Shopify's GDPR compliance requirements.
      </p>

      <h2 style={{ fontSize: "20px", fontWeight: "600", marginTop: "40px", marginBottom: "12px" }}>Your Rights</h2>
      <p style={{ marginBottom: "12px" }}>You have the right to:</p>
      <ul style={{ paddingLeft: "24px", marginBottom: "24px" }}>
        <li style={{ marginBottom: "8px" }}>Request access to the data we hold about your store</li>
        <li style={{ marginBottom: "8px" }}>Request deletion of your store's data by uninstalling the App or contacting us directly</li>
        <li style={{ marginBottom: "8px" }}>Request a copy of your data in a portable format</li>
      </ul>

      <h2 style={{ fontSize: "20px", fontWeight: "600", marginTop: "40px", marginBottom: "12px" }}>Security</h2>
      <p style={{ marginBottom: "24px" }}>
        We take reasonable measures to protect your information. All data is transmitted over HTTPS/TLS.
        OAuth access tokens are stored securely and never exposed to the client. We do not store payment
        information — all billing is handled directly by Shopify.
      </p>

      <h2 style={{ fontSize: "20px", fontWeight: "600", marginTop: "40px", marginBottom: "12px" }}>Changes to This Policy</h2>
      <p style={{ marginBottom: "24px" }}>
        We may update this Privacy Policy from time to time. We will notify you of any significant changes
        by updating the date at the top of this page. Continued use of the App after changes constitutes
        acceptance of the updated policy.
      </p>

      <h2 style={{ fontSize: "20px", fontWeight: "600", marginTop: "40px", marginBottom: "12px" }}>Contact Us</h2>
      <p style={{ marginBottom: "24px" }}>
        If you have questions about this Privacy Policy or wish to exercise your data rights, please contact us at:
      </p>
      <p style={{ marginBottom: "4px" }}><strong>Brick City Software</strong></p>
      <p style={{ marginBottom: "4px" }}>
        Email: <a href="mailto:support@brickcitysoftware.com" style={{ color: "#2c6ecb" }}>support@brickcitysoftware.com</a>
      </p>
    </div>
  );
}

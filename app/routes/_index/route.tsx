import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { redirect } from "react-router";
import { login } from "../../shopify.server";
import styles from "./styles.module.css";

export const meta: MetaFunction = () => [
  { title: "Set Sales — Bulk sales for Shopify" },
  {
    name: "description",
    content:
      "Put products on sale in bulk — prices and compare-at prices updated in one click.",
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  return { showForm: Boolean(login) };
};

const APP_STORE_URL = "https://apps.shopify.com/set-sales"; // update when live

const FEATURES = [
  {
    icon: "⚡",
    title: "Bulk price updates",
    description:
      "Update prices and compare-at prices across hundreds of variants in a single action.",
  },
  {
    icon: "🏷️",
    title: "Automatic compare-at prices",
    description:
      "Compare-at prices are set and cleared automatically — customers always see the original price crossed out.",
  },
  {
    icon: "↩️",
    title: "Instant price restoration",
    description:
      "End a sale and every original price is restored immediately. No manual cleanup required.",
  },
  {
    icon: "📊",
    title: "Sales dashboard",
    description:
      "Track all active and ended sales, variants on sale, and total savings offered from one place.",
  },
];

export default function Index() {
  return (
    <div className={styles.page}>
      {/* Nav */}
      <nav className={styles.nav}>
        <div className={styles.navInner}>
          <div className={styles.logo}>
            <img src="/icon.png" alt="Set Sales" className={styles.logoImg} />
            <span className={styles.logoText}>Set Sales</span>
          </div>
          <a
            href={APP_STORE_URL}
            className={styles.navCta}
            target="_blank"
            rel="noreferrer"
          >
            Add to Shopify
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <h1 className={styles.heroHeading}>
            Run store-wide sales <br className={styles.br} />
            in seconds, not hours.
          </h1>
          <p className={styles.heroSub}>
            Set Sales updates prices and compare-at prices across your entire
            catalog in bulk. Create a sale, track it, and restore original
            prices — all from one place.
          </p>
          <a
            href={APP_STORE_URL}
            className={styles.heroCta}
            target="_blank"
            rel="noreferrer"
          >
            Add to Shopify — free 14-day trial
          </a>
        </div>
        <div className={styles.heroImg}>
          <img src="/icon.png" alt="Set Sales app icon" className={styles.appIcon} />
        </div>
      </section>

      {/* Features */}
      <section className={styles.features}>
        <div className={styles.featuresInner}>
          <h2 className={styles.sectionHeading}>Everything you need to run a sale</h2>
          <div className={styles.featureGrid}>
            {FEATURES.map((f) => (
              <div key={f.title} className={styles.featureCard}>
                <span className={styles.featureIcon}>{f.icon}</span>
                <h3 className={styles.featureTitle}>{f.title}</h3>
                <p className={styles.featureDesc}>{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className={styles.howIt}>
        <div className={styles.howItInner}>
          <h2 className={styles.sectionHeading}>How it works</h2>
          <div className={styles.steps}>
            <div className={styles.step}>
              <span className={styles.stepNum}>1</span>
              <h3 className={styles.stepTitle}>Create a sale</h3>
              <p className={styles.stepDesc}>
                Name your sale, choose a discount — percentage off, fixed
                amount, or a set price — and select the products.
              </p>
            </div>
            <div className={styles.stepArrow}>→</div>
            <div className={styles.step}>
              <span className={styles.stepNum}>2</span>
              <h3 className={styles.stepTitle}>Prices update instantly</h3>
              <p className={styles.stepDesc}>
                Every variant's price and compare-at price updates automatically.
                Customers see the original price crossed out.
              </p>
            </div>
            <div className={styles.stepArrow}>→</div>
            <div className={styles.step}>
              <span className={styles.stepNum}>3</span>
              <h3 className={styles.stepTitle}>End it when you're done</h3>
              <p className={styles.stepDesc}>
                One click ends the sale and restores every original price
                exactly as it was. No manual edits needed.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className={styles.pricing}>
        <div className={styles.pricingInner}>
          <h2 className={styles.sectionHeading}>Simple pricing</h2>
          <div className={styles.pricingCard}>
            <div className={styles.pricingAmount}>
              <span className={styles.pricingDollar}>$</span>
              <span className={styles.pricingNum}>4.99</span>
              <span className={styles.pricingPer}>/month</span>
            </div>
            <ul className={styles.pricingList}>
              <li>14-day free trial — no charge until trial ends</li>
              <li>Unlimited sales</li>
              <li>Up to 500 variants per sale</li>
              <li>Percentage, fixed amount, or fixed price discounts</li>
              <li>Automatic compare-at price management</li>
              <li>Full sales dashboard</li>
            </ul>
            <a
              href={APP_STORE_URL}
              className={styles.heroCta}
              target="_blank"
              rel="noreferrer"
            >
              Start your free trial
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <span>© {new Date().getFullYear()} Set Sales</span>
          <a href="/privacy" className={styles.footerLink}>
            Privacy Policy
          </a>
        </div>
      </footer>
    </div>
  );
}

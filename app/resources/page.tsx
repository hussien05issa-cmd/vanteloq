import type { Metadata } from "next";
import Link from "next/link";
import { ArticleCard, ResourceShell } from "./components";
import { RESOURCE_ARTICLES, RESOURCE_CATEGORIES, getArticlesByCategory } from "./content";
import { DEFAULT_SOCIAL_IMAGE } from "../seo";

export const metadata: Metadata = {
  title: "Small Business Operations Resources | Vanteloq",
  description: "Practical guides to inventory, business analytics, finance, POS data, marketing measurement, operations and responsible AI for small businesses.",
  alternates: { canonical: "/resources" },
  openGraph: {
    type: "website",
    url: "/resources",
    title: "Small Business Operations Resources | Vanteloq",
    description: "Actionable, source-aware guides for business owners and operators.",
    images: [{ url: DEFAULT_SOCIAL_IMAGE, width: 1487, height: 1058, alt: "Vanteloq business operating view" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Small Business Operations Resources | Vanteloq",
    description: "Actionable, source-aware guides for business owners and operators.",
    images: [DEFAULT_SOCIAL_IMAGE],
  },
};

export default function ResourcesPage() {
  const featured = RESOURCE_ARTICLES[0];
  return (
    <ResourceShell>
      <main>
        <section className="resource-hero">
          <div>
            <p className="resource-eyebrow">VANTELOQ FIELD GUIDES</p>
            <h1>Make better business decisions with clearer operating data.</h1>
            <p>Practical explanations for owners and managers—without invented benchmarks, vague promises or unexplained formulas.</p>
          </div>
          <aside aria-label="Editorial standard">
            <span>OUR EDITORIAL STANDARD</span>
            <strong>Evidence before advice.</strong>
            <p>Each guide separates facts, formulas, assumptions and limitations so you can see what a decision actually depends on.</p>
          </aside>
        </section>

        <section className="resource-category-strip" aria-labelledby="browse-topics">
          <div className="resource-section-heading">
            <p className="resource-eyebrow">TOPIC CLUSTERS</p>
            <h2 id="browse-topics">Browse by operating question</h2>
          </div>
          <div className="resource-category-grid">
            {RESOURCE_CATEGORIES.map((category) => (
              <Link href={`/resources/${category.slug}`} key={category.slug}>
                <span>{String(getArticlesByCategory(category.slug).length).padStart(2, "0")}</span>
                <strong>{category.name}</strong>
                <p>{category.description}</p>
              </Link>
            ))}
          </div>
        </section>

        {featured && (
          <section className="resource-latest" aria-labelledby="latest-guides">
            <div className="resource-section-heading">
              <p className="resource-eyebrow">LATEST GUIDES</p>
              <h2 id="latest-guides">Start with the fundamentals</h2>
            </div>
            <div className="resource-card-grid">
              {RESOURCE_ARTICLES.map((article, index) => <ArticleCard article={article} featured={index === 0} key={article.slug} />)}
            </div>
          </section>
        )}

        <section className="resource-method">
          <div>
            <p className="resource-eyebrow">HOW THESE GUIDES WORK</p>
            <h2>Useful enough to apply. Careful enough to trust.</h2>
          </div>
          <ol>
            <li><span>01</span><div><strong>Answer first</strong><p>The direct answer appears before the background.</p></div></li>
            <li><span>02</span><div><strong>Show the calculation</strong><p>Formulas include inputs, boundaries and worked examples.</p></div></li>
            <li><span>03</span><div><strong>Keep the limits visible</strong><p>Unknown or missing data is not silently treated as zero.</p></div></li>
          </ol>
        </section>

        <section className="resource-wide-cta">
          <div><p className="resource-eyebrow">VANTELOQ</p><h2>Bring the operating view together.</h2><p>Organize source-backed sales, cash, inventory and daily work while your team keeps approval over decisions.</p></div>
          <div><Link href="/?start=signup">Create your workspace</Link><Link className="secondary" href="/#platform">See the operating model</Link></div>
        </section>
      </main>
    </ResourceShell>
  );
}

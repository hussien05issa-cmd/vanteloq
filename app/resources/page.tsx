/* eslint-disable @next/next/no-html-link-for-pages -- native links avoid a vinext hydration failure on server-rendered public pages */
import type { Metadata } from "next";
import PublicNavigation from "../public-navigation";
import { resourceArticles } from "./articles";

export const metadata: Metadata = {
  title: "Resources · Vanteloq",
  description: "Practical guides for retail sales, inventory, cash and connected data operations.",
};

export default function ResourcesPage() {
  return (
    <main className="resource-site">
      <PublicNavigation />
      <section className="resource-hero">
        <p>VANTELOQ FIELD NOTES</p>
        <h1>Clear operating ideas<br />for independent retail.</h1>
        <span>Practical guidance for using sales, inventory, cash and connected records without losing the source, limits or decision trail.</span>
      </section>
      <section className="resource-grid" aria-label="Vanteloq resources">
        {resourceArticles.map((article, index) => (
          <a href={`/resources/${article.slug}`} key={article.slug} className="resource-card">
            <span className="resource-index">{String(index + 1).padStart(2, "0")}</span>
            <div><small>{article.category} · {article.readTime}</small><h2>{article.title}</h2><p>{article.summary}</p></div>
            <b aria-hidden="true">Read</b>
          </a>
        ))}
      </section>
      <footer className="resource-footer"><a href="/">Vanteloq home</a><span>Source-aware operating intelligence for independent retail.</span><a href="/?auth=signin">Sign in</a></footer>
    </main>
  );
}

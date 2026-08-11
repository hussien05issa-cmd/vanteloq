/* eslint-disable @next/next/no-html-link-for-pages -- native links avoid a vinext hydration failure on server-rendered public pages */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PublicNavigation from "../../public-navigation";
import { findResourceArticle, resourceArticles } from "../articles";

export function generateStaticParams() {
  return resourceArticles.map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const article = findResourceArticle((await params).slug);
  return article ? { title: `${article.title} · Vanteloq`, description: article.summary } : {};
}

export default async function ResourceArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const article = findResourceArticle((await params).slug);
  if (!article) notFound();
  return (
    <main className="resource-site article-site">
      <PublicNavigation />
      <article className="resource-article">
        <a className="article-back" href="/resources">← All resources</a>
        <header><small>{article.category} · {article.readTime}</small><h1>{article.title}</h1><p>{article.intro}</p></header>
        <div className="article-body">
          {article.sections.map(([title, copy], index) => <section key={title}><span>{String(index + 1).padStart(2, "0")}</span><div><h2>{title}</h2><p>{copy}</p></div></section>)}
        </div>
        <aside><div><small>NEXT STEP</small><h2>Put verified operating data behind the decisions.</h2></div><a href="/?auth=signup">Create your workspace</a></aside>
      </article>
      <footer className="resource-footer"><a href="/">Vanteloq home</a><span>Source-aware operating intelligence for independent retail.</span><a href="/?auth=signin">Sign in</a></footer>
    </main>
  );
}

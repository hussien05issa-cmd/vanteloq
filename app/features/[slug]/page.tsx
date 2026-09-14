import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import BookloqDemo from "../../bookloq-demo";
import PublicPageNav from "../../public-page-nav";
import { FEATURE_GUIDES } from "../content";
type Props = { params: Promise<{ slug: string }> };
function guideFor(slug: string) { return Object.prototype.hasOwnProperty.call(FEATURE_GUIDES,slug) ? FEATURE_GUIDES[slug as keyof typeof FEATURE_GUIDES] : null; }
export async function generateMetadata({params}:Props): Promise<Metadata> {
  const {slug}=await params, guide=guideFor(slug);
  return guide ? {title:guide.title+" | Vanteloq",description:guide.description,alternates:{canonical:"/features/"+slug},openGraph:{title:guide.title,description:guide.description,url:"/features/"+slug,type:"website"}} : {};
}
export default async function FeatureGuide({params}:Props) {
  const {slug}=await params,guide=guideFor(slug);if(!guide)notFound();
  return <div className="public-site demo-page"><PublicPageNav/><main className="feature-guide"><p className="demo-eyebrow">HOW VANTELOQ WORKS</p><h1>{guide.title}</h1><p className="feature-guide-lead">{guide.lead}</p><div className="feature-guide-question"><span>START WITH A QUESTION</span><h2>{guide.question}</h2><Link href={guide.demo}>Try the interactive example →</Link><small>Fictional records. No signup required.</small></div><ol>{guide.steps.map(([title,body],i)=><li key={title}><span>{i+1}</span><div><h2>{title}</h2><p>{body}</p></div></li>)}</ol>{slug === "financial-review" && <section className="bookloq-feature-demo" aria-labelledby="bookloq-forecast-example"><h2 id="bookloq-forecast-example">Try a 13-Week Cash Flow Forecast</h2><p>Change the proposed purchase below. Compare the confirmed cash case with expected receipts and inspect the weekly figures. This example uses fictional records and needs no account.</p><BookloqDemo/></section>}<section><h2>How the calculation works</h2><p>{guide.calculation}</p></section><section><h2>What the result needs</h2><p>{guide.limits}</p><Link href="/#connections">Check integration availability →</Link></section><div className="feature-guide-links"><Link href={guide.resource}>{guide.resourceLabel} →</Link>{slug === "financial-review" && <Link href="/resources/small-business-bookkeeping-system">Read the small business bookkeeping guide →</Link>}<Link href="/pricing">Compare plans →</Link><Link href="/contact">Discuss your requirements →</Link></div><nav aria-label="More product guides">{Object.entries(FEATURE_GUIDES).filter(([key])=>key!==slug).map(([key,item])=><Link key={key} href={"/features/"+key}>{item.title} →</Link>)}</nav></main></div>;
}

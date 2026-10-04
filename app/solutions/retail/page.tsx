import type { Metadata } from "next";
import HomepageLanding from "../../homepage-landing";
export const metadata: Metadata = {
  title: "Retail analytics for independent shops | Vanteloq",
  description: "Review daily sales, transaction changes and stock evidence. Start with Free, check supported POS connections, and explore Vanteloq’s fictional retail demo.",
  alternates: { canonical: "/solutions/retail" },
  openGraph: { title: "Retail analytics for independent shops | Vanteloq", description: "Keep your POS. Connect supported records, inspect sales and stock evidence, and choose your next step.", url: "/solutions/retail", type: "website" },
};
export default function RetailSolution() { return <HomepageLanding retail/>; }

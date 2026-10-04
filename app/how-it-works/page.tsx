import type { Metadata } from "next";
import HomepageLanding from "../homepage-landing";

export const metadata: Metadata = {
  title: "How Vanteloq works | Interactive walkthrough",
  description: "Explore how records become useful sales, stock and cash information in Vanteloq, with interactive fictional examples.",
  alternates: { canonical: "/how-it-works" },
  openGraph: { title: "How Vanteloq works", description: "An interactive walkthrough of records, metrics and daily decisions.", url: "/how-it-works", type: "website" },
};

export default function HowItWorks() { return <HomepageLanding guide/>; }

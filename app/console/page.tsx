import type { Metadata } from "next";
import ConsoleEntry from "./console-entry";
import "./console.css";

export const metadata: Metadata = {
  title: "Private Management Console | Lexedge and Vanteloq",
  description: "Private executive management console for Lexedge Consulting and Vanteloq.",
  robots: { index: false, follow: false, noarchive: true, nocache: true },
};

export default function ConsolePage() {
  return <ConsoleEntry/>;
}

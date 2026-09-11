import type { Metadata } from "next";
import DeletionProgress from "./progress";

export const metadata: Metadata = {
  title: "Deletion status | Vanteloq",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function DeletionStatusPage() { return <DeletionProgress />; }

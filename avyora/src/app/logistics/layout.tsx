import type { Metadata } from "next";
import { LogisticsLayout } from "@/components/logistics/logistics-layout";

export const metadata: Metadata = {
  title: {
    default: "Avyora Logistics",
    template: "%s · Avyora Logistics",
  },
  description: "Avyora logistics and fulfilment portal.",
};

export default function LogisticsRootLayout({ children }: { children: React.ReactNode }) {
  return <LogisticsLayout>{children}</LogisticsLayout>;
}

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Book a viewing",
  description: "Visit Avyora at 12 Walton Road, Bengaluru by appointment. Try pieces in the salon, Tuesday to Sunday.",
};

export default function VisitLayout({ children }: { children: React.ReactNode }) {
  return children;
}

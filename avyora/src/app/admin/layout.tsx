import { AdminLayout } from "@/components/admin/admin-layout";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    default: "Avyora Admin",
    template: "%s · Avyora Admin",
  },
  description: "Avyora store operations and atelier admin portal.",
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return <AdminLayout>{children}</AdminLayout>;
}

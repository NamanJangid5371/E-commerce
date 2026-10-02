"use client";

import { CmsPolicyPage } from "@/components/cms-pages";
import { useParams } from "next/navigation";

export default function PolicyPage() {
  const { slug } = useParams<{ slug: string }>();
  return <CmsPolicyPage slug={slug} />;
}

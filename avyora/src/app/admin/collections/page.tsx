import { redirect } from "next/navigation";

export default function CollectionsAdminRedirect() {
  redirect("/admin/products?manageCollections=1");
}

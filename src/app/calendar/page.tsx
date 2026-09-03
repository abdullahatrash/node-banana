import { redirect } from "next/navigation";
import { compatibilityRoutes } from "@/lib/navigation/compatibility-routes";

export default function CalendarCompatibilityPage() {
  redirect(compatibilityRoutes["/calendar"]);
}

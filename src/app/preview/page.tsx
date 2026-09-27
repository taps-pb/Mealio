import { notFound } from "next/navigation";
import PreviewDashboard from "@/components/PreviewDashboard";

export default function PreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <PreviewDashboard />;
}

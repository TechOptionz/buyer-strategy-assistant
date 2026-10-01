import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppSidebar } from "@/components/shell/AppSidebar";
import { getAuth } from "@/lib/auth/session";
import { navSummary } from "@/lib/services/assessments";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const isAdmin = auth.role === "org_admin" || auth.permissions.includes("manage_org");
  const nav = await navSummary(auth);
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Suspense>
        <AppSidebar user={{ name: auth.name, role: auth.role, organisationName: auth.organisationName }} nav={nav} isAdmin={isAdmin} />
      </Suspense>
      <main id="main" className="flex min-w-0 flex-1 flex-col">
        {children}
      </main>
    </div>
  );
}

import { redirect } from "next/navigation";
import { Offline } from "@/components/offline";
import { MobileNav, Sidebar } from "@/components/shell/nav";
import { Topbar } from "@/components/shell/topbar";
import { api } from "@/lib/api";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await api.me();

  if (!me.ok) {
    if (me.offline) {
      return (
        <div className="mx-auto flex min-h-dvh max-w-3xl items-center px-6">
          <Offline detail={me.message} />
        </div>
      );
    }
    redirect("/login");
  }

  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="min-w-0 flex-1">
        <MobileNav />
        <Topbar principal={me.data} />
        <main className="px-5 py-8 sm:px-8 lg:px-10">{children}</main>
      </div>
    </div>
  );
}

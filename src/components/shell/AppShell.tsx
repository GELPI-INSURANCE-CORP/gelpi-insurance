"use client";
import { ReactNode, useState } from "react";
import { X } from "lucide-react";
import { Sidebar, SidebarContent } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-full">
      <Sidebar />
      {mobileOpen && (
        <div className="fixed inset-0 z-30 flex md:hidden">
          <div className="w-72 flex-shrink-0 bg-surface shadow-xl">
            <div className="flex justify-end p-2">
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted"
                aria-label="Cerrar menú"
              >
                <X size={18} />
              </button>
            </div>
            <div className="h-[calc(100%-3rem)]">
              <SidebarContent onNavigate={() => setMobileOpen(false)} />
            </div>
          </div>
          <div className="flex-1 bg-black/30" onClick={() => setMobileOpen(false)} />
        </div>
      )}
      <div className="flex min-h-full flex-col md:pl-[72px]">
        <Topbar onMenu={() => setMobileOpen(true)} />
        <main className="flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}

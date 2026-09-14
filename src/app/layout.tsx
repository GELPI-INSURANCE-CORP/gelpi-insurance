import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Gelpi Insurance — Panel interno",
  description: "Dashboard interno de Gelpi Insurance: pólizas, clientes, reclamos y comisiones.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
        <Sidebar />
        <div className="md:pl-64 flex flex-col min-h-full">
          <Topbar />
          <main className="flex-1 p-4 md:p-8">{children}</main>
        </div>
      </body>
    </html>
  );
}

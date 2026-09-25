import type { Metadata } from "next";
import { Inter, Instrument_Serif, Geist_Mono } from "next/font/google";
import "./globals.css";

// Inter para todo lo que es interfaz e Instrument Serif solo para los títulos de pantalla. Es la
// combinación que usa Nextere, el sistema que la agencia ya usa todos los días, y es la razón por
// la que se ve más terminado que esto: un serif con carácter en el título, y una sans muy legible
// en las tablas, donde lo único que importa es leer números rápido sin equivocarse de fila.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Gelpi Insurance — Agency Management",
  description: "Commission reconciliation for Gelpi Insurance against the Active Business Book.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${instrumentSerif.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">{children}</body>
    </html>
  );
}

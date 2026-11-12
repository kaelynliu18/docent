import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Nav } from "@/components/Nav";
import { TabBar } from "@/components/TabBar";
import { UploadStatus } from "@/components/UploadStatus";
import { InstallPrompt } from "@/components/InstallPrompt";

const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Docent — rank what you saw, find your next museum",
  description: "Rank the paintings you saw on museum visits and get museum recommendations that explain themselves.",
  applicationName: "Docent",
  appleWebApp: { capable: true, title: "Docent", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  icons: {
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // draw under the notch/home bar; safe-area insets pad the chrome
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ebe7e0" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1a18" },
  ],
};

/** Applies a saved theme before paint so there's no flash. */
const themeScript = `try{var t=localStorage.getItem("docent-theme");if(t)document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh">
        <Providers>
          <Nav />
          <main className="mx-auto w-full max-w-6xl px-4 pb-[calc(env(safe-area-inset-bottom)+6rem)] sm:px-6 md:pb-24">{children}</main>
          <TabBar />
          <UploadStatus />
          <InstallPrompt />
        </Providers>
      </body>
    </html>
  );
}

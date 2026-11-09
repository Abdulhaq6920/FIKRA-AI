import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/features/auth/AuthContext";
import { ThemeProvider } from "@/features/theme/ThemeProvider";
import { CurrencyProvider } from "@/features/currency/CurrencyProvider";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "FIKRA AI",
  description: "Production-grade multi-tenant RAG chatbot",
  robots: { index: false }, // Private enterprise app
};

/**
 * Resolve the persisted theme before the first paint. Keeping the catalogue in
 * this tiny map avoids importing app modules into a blocking script.
 */
const themeInitScript = `
(function () {
  try {
    var themes = {
      "royal-glass": "dark",
      aurora: "light", parchment: "light", ocean: "light", emerald: "light",
      sunset: "light", midnight: "dark", graphite: "dark",
      "naruto-leaf": "light", "naruto-sharingan": "dark",
      "solo-jinwoo": "dark", "solo-igris": "dark",
      "enchanted-dawn": "light", "blossom-breeze": "light",
      "arcane-midnight": "dark", "ember-abyss": "dark",
      "frozen-citadel": "dark", "void-nebula": "dark",
      "emerald-enigma": "dark"
    };
    var stored = localStorage.getItem("fikra-theme");
    var theme = stored && themes[stored] ? stored : "royal-glass";
    var root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.tone = themes[theme];
  } catch (error) {
    document.documentElement.dataset.theme = "royal-glass";
    document.documentElement.dataset.tone = "dark";
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${inter.variable} font-sans antialiased bg-surface-950 text-surface-100`}>
        <ThemeProvider>
          <CurrencyProvider>
            <AuthProvider>{children}</AuthProvider>
          </CurrencyProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

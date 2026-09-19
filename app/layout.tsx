import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Hark | Student Assignment & Task Dashboard',
  description:
    'Automated academic task tracking, Teams ingestion, and smart calendar synchronization powered by Gemini AI and Neon PostgreSQL.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-[#FAFAFC] text-slate-800 min-h-screen selection:bg-[#CCCCFF]/40 selection:text-[#292966]">
        {children}
      </body>
    </html>
  );
}

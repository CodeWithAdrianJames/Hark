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
    <html lang="en" className="dark">
      <body className="antialiased bg-[#080c14] text-slate-100 min-h-screen selection:bg-indigo-500/30 selection:text-indigo-200">
        {children}
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Engineerle — five daily engineering puzzles',
  description: 'Read the graph, find the fulcrum, save the bridge, balance the engine, trim the barge. Real physics, five new puzzles every day.',
  icons: { icon: '/icon.svg' },
  openGraph: {
    title: 'Engineerle',
    description: 'Five daily engineering puzzles with real physics behind them.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#06131f',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

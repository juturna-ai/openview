import type { Metadata } from 'next';
import ChartEngine from './ChartEngine';

export const metadata: Metadata = { title: 'Chart — Openview' };

// Full-viewport chart route (no navbar) for in-app navigation. The engine itself is served
// from public/index.html and mounted by the ChartEngine client component.
export default function ChartPage() {
  return <ChartEngine />;
}

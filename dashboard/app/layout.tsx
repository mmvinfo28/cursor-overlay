import type { Metadata } from 'next';
import './globals.css';
import '@copilotkit/react-ui/styles.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Crewboard',
  description: 'Intent captured at the cursor. A crew of agents executes it.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-zinc-950 text-zinc-100 antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

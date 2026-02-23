import type { Metadata } from 'next';

import Providers from '@/app/providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Controle de Estoque',
  description: 'Plataforma de controle de estoque, produtos e operações com BOM',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}


import React from 'react';
import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Provider } from '@/components/ui/provider';
import { Toaster } from '@/components/ui/toaster';
import HeaderBar from '@/components/HeaderBar';
import { Container } from '@chakra-ui/react';

export const metadata: Metadata = {
  title: 'Xteink Flash Tools',
  description: 'Web based tool to help flash the Xteink device',
  appleWebApp: {
    title: 'Xteink Flash',
    statusBarStyle: 'default',
    capable: true,
  },
  applicationName: 'Xteink Flash Tools',
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: '#000000',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta httpEquiv="Permissions-Policy" content="usb=(self)" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icon.svg" />
      </head>
      <body>
        <Provider>
          <HeaderBar />
          <Container as="main" maxW="3xl" mt={5} mb={5}>
            {children}
          </Container>
          <Toaster />
        </Provider>
      </body>
    </html>
  );
}

'use client';

import React, { useEffect, useState } from 'react';
import { IconButton, Tooltip } from '@chakra-ui/react';
import { LuDownload } from 'react-icons/lu';

export default function PWAInstallButton({
  variant = 'outline',
}: {
  variant?: 'outline' | 'subtle' | 'ghost';
}) {
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setInstallPrompt(e);
    };

    const handleAppInstalled = () => {
      setInstallPrompt(null);
      setIsInstalled(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
    }

    return () => {
      window.removeEventListener(
        'beforeinstallprompt',
        handleBeforeInstallPrompt,
      );
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      setInstallPrompt(null);
    }
  };

  if (isInstalled || !installPrompt) {
    return null;
  }

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <IconButton
          aria-label="Install as App"
          variant={variant}
          size="sm"
          onClick={handleInstallClick}
        >
          <LuDownload />
        </IconButton>
      </Tooltip.Trigger>
      <Tooltip.Positioner>
        <Tooltip.Content>Install as App</Tooltip.Content>
      </Tooltip.Positioner>
    </Tooltip.Root>
  );
}

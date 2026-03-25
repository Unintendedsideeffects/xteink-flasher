'use client';

import React, { useEffect, useState } from 'react';
import { Alert } from '@chakra-ui/react';
import {
  getFlashUsbSupport,
  isLikelyAndroidBrowser,
} from '@/utils/flashEnvironment';

export default function AndroidAlert() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  if (!ready) {
    return null;
  }

  const support = getFlashUsbSupport();

  if (support.ok === false && support.reason === 'insecure') {
    return (
      <Alert.Root status="error">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>HTTPS or localhost required</Alert.Title>
          <Alert.Description>
            WebUSB and Web Serial only run in a secure context. Open this site
            over HTTPS, or use <b>http://localhost</b> from a computer. Phone
            access over plain <b>http://&lt;LAN-IP&gt;</b> will not work.
          </Alert.Description>
        </Alert.Content>
      </Alert.Root>
    );
  }

  if (support.ok === false && support.reason === 'no-usb-path') {
    return (
      <Alert.Root status="error">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>Browser cannot access USB</Alert.Title>
          <Alert.Description>
            Use recent <b>Chrome</b> (or Edge on desktop). Firefox and most
            in-app browsers do not expose USB serial flashing.
          </Alert.Description>
        </Alert.Content>
      </Alert.Root>
    );
  }

  if (!support.ok) {
    return null;
  }

  if (isLikelyAndroidBrowser()) {
    return (
      <Alert.Root status="info">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>Flashing from Android</Alert.Title>
          <Alert.Description>
            Chrome talks to the reader over <b>USB OTG</b> using WebUSB (no
            desktop app). Use a cable and adapter that pass <b>data</b>, keep
            the screen on, and install this page as an app from the header if
            you can so the tab is less likely to be killed during long reads.
            {support.path === 'webusb' && (
              <>
                {' '}
                This device will use the WebUSB serial path (normal for Android
                Chrome).
              </>
            )}
          </Alert.Description>
        </Alert.Content>
      </Alert.Root>
    );
  }

  return null;
}

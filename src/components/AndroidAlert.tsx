'use client';

import React from 'react';
import { Alert } from '@chakra-ui/react';

export default function AndroidAlert() {
  return (
    <Alert.Root status="info">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>Android support (full)</Alert.Title>
        <Alert.Description>
          This app is optimized for Android! For the best experience,{' '}
          <b>install it as an app</b> from the button in the header bar.
          This helps keep the connection active and prevents the browser from
          suspending the process. Use Chrome and a USB OTG data cable,
          keep battery saver off, and do not switch apps while flashing.
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}

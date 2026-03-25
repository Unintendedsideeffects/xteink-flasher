export function isLikelyAndroidBrowser(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  return /Android/i.test(navigator.userAgent);
}

export function hasNavigatorSerial(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serial' in navigator &&
    !!navigator.serial
  );
}

export function hasNavigatorUsb(): boolean {
  return (
    typeof navigator !== 'undefined' && 'usb' in navigator && !!navigator.usb
  );
}

export function isSecureContextForUsb(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }
  return window.isSecureContext;
}

export type FlashUsbSupport =
  | { ok: true; path: 'serial' | 'webusb' | 'serial-or-webusb' }
  | { ok: false; reason: 'insecure' | 'no-usb-path' };

export function getFlashUsbSupport(): FlashUsbSupport {
  if (!isSecureContextForUsb()) {
    return { ok: false, reason: 'insecure' };
  }
  const serial = hasNavigatorSerial();
  const usb = hasNavigatorUsb();
  if (serial && usb) {
    return { ok: true, path: 'serial-or-webusb' };
  }
  if (serial) {
    return { ok: true, path: 'serial' };
  }
  if (usb) {
    return { ok: true, path: 'webusb' };
  }
  return { ok: false, reason: 'no-usb-path' };
}

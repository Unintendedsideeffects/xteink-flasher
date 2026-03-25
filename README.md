# Xteink Flasher

Web based tool to help flash the Xteink device.

## Browser support

- Desktop: Chrome or Edge (Web Serial API)
- Android: Chrome uses WebUSB plus the [web-serial-polyfill](https://github.com/GoogleChromeLabs/web-serial-polyfill) (same protocol stack as desktop serial). You need a **USB OTG** adapter or OTG-capable phone, a **data** cable, and the page served over **HTTPS** (opening the dev server via `http://192.168.x.x` from the phone will not work).
- Primary URL: `https://xteink.dve.al/`
- GitHub Pages deploy: `https://unintendedsideeffects.github.io/xteink-flasher/`

## Development

1. Run `yarn install`
2. Run `yarn dev`

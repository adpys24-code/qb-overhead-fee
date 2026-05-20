# QuickBooks Overhead Fee - Chrome Extension (v1.3)

## What's Fixed in v1.3
Amount column now fills automatically on button click with no side effects.

**Root cause of v1.2 regression:** Calling React's synthetic `onBlur`/`onChange` prop handlers directly caused QBO to reset the Rate field during its internal re-render cycle.

**Actual fix:** Through live event capture on a real user interaction, we found QBO's amount calculation is triggered by the native DOM `change` event — not React's synthetic blur. The correct sequence is simply:
`focus → nativeSetter(value) → 'input' event → 'change' event → blur()`

## Installation
1. Unzip the `qb-overhead-fee` folder.
2. Go to **chrome://extensions/** → enable **Developer mode**.
3. Click **Load unpacked** → select the folder.

## How to Use
1. Open any QuickBooks invoice (create or edit).
2. Add your products/services normally.
3. Click the blue **"Add Overhead (X%)"** button on the last empty row.
   - Description → "Overhead Fee", Rate → calculated fee, Amount → auto-filled.
   - Button disappears while overhead row exists; reappears when you delete it.
4. To recalculate: delete the overhead row → click the button again.

## Changing the Percentage
Extension icon → enter % → Save (or Enter).

## Files
`manifest.json  content.js  content.css  popup.html  popup.js  README.md`

# Messenger Cleaner

A Manifest V3 Chrome extension for bulk deleting, archiving, and restoring Facebook Messenger conversations from a persistent side panel.

## Chrome Web Store

- Extension ID: `imobgpikmofiapbnijmebknbkmkncdkl`
- Listing: <https://chromewebstore.google.com/detail/imobgpikmofiapbnijmebknbkmkncdkl>

## Build

```bash
npm install
npm run build
```

The build creates:

- `dist/` — unpacked production extension.
- `dist.zip` — compressed Chrome Web Store upload package.

## Install locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Run `npm run build`.
4. Click **Load unpacked** and choose the generated `dist` folder.
5. Open Facebook Messenger and click the extension toolbar button to open the side panel.

## Icons

The supplied artwork is included at 16, 32, 48, and 128 px under `icons/` and is used by the extension manifest, toolbar action, and side-panel header.

## Notes

- Delete is permanent and requires an explicit confirmation in the side panel.
- Free access includes 20 successful delete, archive, or restore actions per local calendar day.
- A CleanMySocial license removes the daily limit. Checkout and license validation use `cleanmysocial.verblike.com`. The check asks as `facebook-messenger-cleaner`, not the shared `cleanmysocial` group, so a licence bought for another tool does not unlock this one.
- Deletion milestones at 10, 50, 100, 500, and 1,000 conversations show a congratulations and review prompt.
- After the review link is opened, the footer promotes Mass Friends Remover for Facebook.
- Operations pause while their Messenger tab is hidden and resume when the tab becomes visible.
- The panel follows active-tab changes, full navigations, and Messenger single-page navigations.
- Facebook changes its interface periodically. Action matching is semantic and multilingual, but selectors should still be tested against the current live interface before publishing.

## Structure

- `src/react/` contains the React side-panel entry and markup.
- `src/panel/` contains the panel controller and styles.
- `src/background/` contains the Manifest V3 service worker.
- `src/lib/` contains the Messenger content automation.
- `scripts/build.mjs` builds and packages the production extension.

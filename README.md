# Messenger Cleaner

A Manifest V3 Chrome extension for bulk deleting, archiving, and restoring Facebook Messenger conversations from a persistent side panel.

## Chrome Web Store

- Extension ID: `imobgpikmofiapbnijmebknbkmkncdkl`
- Listing: <https://chromewebstore.google.com/detail/imobgpikmofiapbnijmebknbkmkncdkl>

## Install locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and choose this folder.
4. Open Facebook Messenger and click the extension toolbar button to open the side panel.

## Icons

The supplied artwork is included at 16, 32, 48, and 128 px under `icons/` and is used by the extension manifest, toolbar action, and side-panel header.

## Notes

- Delete is permanent and requires an explicit confirmation in the side panel.
- Free access includes 10 successful deletes or archives per local calendar day; restore actions are not metered.
- A shared CleanMySocial license removes the daily limit. Checkout and license validation use `cleanmysocial.verblike.com`.
- Operations pause while their Messenger tab is hidden and resume when the tab becomes visible.
- The panel follows active-tab changes, full navigations, and Messenger single-page navigations.
- Facebook changes its interface periodically. Action matching is semantic and multilingual, but selectors should still be tested against the current live interface before publishing.

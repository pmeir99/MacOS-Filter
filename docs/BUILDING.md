# Build and install

## Architecture

Chrome discovers supported image elements and draws overlays. Chrome stores filter settings locally. The Mac app installs a Chrome Native Messaging manifest. Chrome launches the bundled FilterHost, which uses Apple Vision on this Mac. Images are not sent to a server or written to disk by this project.

The first provider uses Apple Vision person segmentation. Future Core ML providers should set compute units to all, allowing macOS to schedule supported operations on CPU, GPU, or Neural Engine. That does not guarantee that every model uses every accelerator. The macOS UI uses SwiftUI and AppKit; UIKit is not a macOS framework.

## Requirements

- macOS 13 or newer
- Apple Silicon recommended; product tuning targets M4 with 16 GB unified memory
- Xcode command line tools and Swift 5.9+
- Chrome 116 or newer
- Node.js 20 or newer for extension checks

## Build and test

    swift test -Xswiftc -warnings-as-errors
    npm --prefix extension run check
    npm --prefix extension test
    bash scripts/package-app.sh

The package script creates an ad-hoc signature and verifies the app bundle before archiving. Ad-hoc signing is not Developer ID signing and does not notarize the app.

## Install for development

1. Unzip MacOS-Filter-macOS.zip and move MacOS Filter.app to Applications.
2. Open the Mac app once to register its helper. Click **Show Extension Folder**. The signed original lives in `Contents/Resources/Extension`. The app refreshes a working copy in `~/Library/Application Support/MacOSFilter/ChromeExtension` so Chrome can write its metadata safely.
3. In Chrome, open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select that working folder. Open the extension and click **Grant Website Access**.
4. Click **Filter Settings** in the extension. The first upgrade imports your existing policy, including per-site rules. Each Chrome profile then keeps its own policy. The automatic update preference applies to the installed app across profiles.
5. For subsequent releases, choose **Software Update** in the app and **Download and Install**. The app verifies the release digest, stages the bundle, quits, swaps versions and waits for the new launch. The helper can restore the previous version if launch fails. Chrome reconnects in the background. The installed folder must be writable by your account.

## If macOS says the app is damaged

The GitHub development build is not signed with a paid Developer ID certificate or notarized. The package uses a valid ad-hoc signature to detect bundle corruption, but Gatekeeper can still reject a downloaded quarantined app.

After moving the app to Applications, remove the download quarantine flag for this specific app:

    xattr -dr com.apple.quarantine "/Applications/MacOS Filter.app"

Then open the app normally. Run this only for the MacOS Filter artifact built or downloaded from this repository. Do not disable Gatekeeper system-wide. Proper public distribution requires Developer ID signing and Apple notarization.

## Current behavior and limits

The working modes cover the entire image or the mask for all people Vision detects. Blur, overlay color, and opacity are rendering choices. The host covers the entire image if analysis fails, limits are exceeded, or no person mask is returned.

Skin-only, selected body parts or people, apparent male/female filtering, custom labels, and seven modesty levels are not implemented by Vision. See PRODUCT-GUIDE.md and MODEL-OPTIONS.md.

The extension currently filters HTML image elements. CSS background images, SVG, canvas, videos, and browser-internal pages are not covered. The browser offers no guaranteed hook to pause every page paint until classification finishes; the extension uses an early gate and overlays for supported images.

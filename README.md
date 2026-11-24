# MacOS Filter
Chrome image, text and site filtering for Apple Silicon Macs. The development build includes a pretrained binary OpenNSFW Core ML classifier and uses Apple Vision for person masks. In the adaptive mode a high score covers the entire image. Lower scores use the existing people mask. Adjust the score cutoff in Mac settings. Calibration for personal modesty standards requires a labeled evaluation set.

The model is obtained at build time from [Core ML After Dark](https://github.com/dcandre/Core-ML-After-Dark/tree/497c388569033f5b970755a4c90a0863e72785c5), checked against its pinned Git blob, compiled, and included inside the signed app. Inference needs no remote service. Target hardware is M4 and later with 16 GB.

Download the single ZIP from [GitHub Releases](https://github.com/pmeir99/MacOS-Filter/releases/latest). Open **MacOS Filter** in Applications and use **Show Extension Folder** for the one-time Chrome setup. The app owns all image, website, text and per-site settings. Chrome asks separately for website access. The extension registers an early image visibility rule on permitted HTTP(S) pages. Images retain their layout box while pending. Site redirects use Chrome declarative network rules. Text covers use CSS highlights within individual DOM text nodes. These are visual covers, not removal from the page source.

Coverage is experimental. Browser-internal pages, arbitrary CSS/canvas, and all rendered frames of animated media are outside the verified surface. Per-person presentation, precise skin, product categories, and seven clothing levels need additional evaluated providers. See [design](docs/PRODUCT-GUIDE.md) and [installation](docs/BUILDING.md).

## Display and offline operation

In the Mac app’s Websites and text section, choose immediate display with image placeholders or a loading screen for the initial visible images. After eight seconds the page opens and unfinished images retain individual placeholders. Reload existing tabs after changing this option.

The filter issues no HTTP requests for inference or model downloads at runtime. Websites still load their own content normally. The bundled native host processes embedded raster bytes or already-loaded image pixels. A cross-origin image that denies pixel access gets a full cover. Local snapshots are limited to four megapixels and eight MiB. Android and cloud services are not involved. The app autosaves valid edits, and the background helper pushes them to Chrome. The extension has a fixed ID. Use Software Update in the app for verified downloads and automatic relaunch. Online update checks default to off.

## Experimental visual policy

Select **Seven-level policy** in the Mac app to compare each detected person's crop with the clothing/exposure descriptions in [the prompt bank](models/policy_labels.json). Level 1 is most explicit, level 7 most covered. At the whole-image cutoff or more severe, cover everything opaquely. At the mask cutoff or more severe, cover the matched person or their detected skin. The original OpenNSFW gate also runs in this mode. Whole-image rules win even when appearance selection is active.

**Skin mask** uses the six-class MediaPipe selfie model. Body skin and facial skin can be selected separately via Include facial skin. The model groups hands and neck with other skin. A Vision detection box localizes each crop. Crowds, occluded people and overlapping boxes can give inaccurate masks. With no person box, the worker evaluates the frame. The visual appearance selector compares crop similarity to masculine/feminine prompts; it cannot establish identity. Low-margin crops are included for either selection.

Enable product families separately for underwear/lingerie, adult products/accessories and menstrual products. These optional settings classify image content without requiring matching product text. They apply to the two experimental modes. Predictions compare visual embeddings with text descriptions; the resulting level and label are estimates. Missing model output or failure produces a full cover. A confident-looking wrong prediction can still pass.

All weights, precomputed prompt embeddings and the Apple Silicon helper ship together. Model conversion, prompt preparation and dependency downloads occur during packaging. Filtering uses local Vision, Core ML and an on-device ONNX worker. Rendering composites a solid color or adjustable Gaussian blur using the returned alpha mask. No generative fill is used.

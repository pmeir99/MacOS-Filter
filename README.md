# MacOS Filter
Chrome image, text and site filtering for Apple Silicon Macs. The development build includes a pretrained binary OpenNSFW Core ML classifier and uses Apple Vision for person masks. In the adaptive mode a high score covers the entire image. Lower scores use the existing people mask. Adjust the score cutoff in Mac settings. Calibration for personal modesty standards requires a labeled evaluation set.

The model is obtained at build time from [Core ML After Dark](https://github.com/dcandre/Core-ML-After-Dark/tree/497c388569033f5b970755a4c90a0863e72785c5), checked against its pinned Git blob, compiled, and included inside the signed app. Inference needs no remote service. Target hardware is M4 and later with 16 GB.

Open **Website and text rules** in the extension for blocked domains, excluded domains and literal phrases. Enable filtering and reload existing tabs. The extension registers an early image visibility rule on permitted HTTP(S) pages. Images retain their layout box while pending. Site redirects use Chrome declarative network rules. Text covers use CSS highlights within individual DOM text nodes. These are visual covers, not removal from the page source.

Coverage is experimental. Browser-internal pages, arbitrary CSS/canvas, and all rendered frames of animated media are outside the verified surface. Per-person presentation, precise skin, product categories, and seven clothing levels need additional evaluated providers. See [design](docs/PRODUCT-GUIDE.md) and [installation](docs/BUILDING.md).

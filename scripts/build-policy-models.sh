#!/bin/bash
set -euo pipefail
resources="$1"
work="$2/advanced"
mkdir -p "$work" "$resources/PolicyModels"
python3 -m venv "$work/env"
python="$work/env/bin/python"
"$python" -m pip install -q numpy==1.26.4 onnxruntime==1.20.1 pillow==11.3.0 tokenizers==0.21.4 pyinstaller==6.16.0
clip=https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/d15189d7028b43f1d3e65039190477f6af591c2a
fetch(){ curl --fail --location --retry 3 --silent --show-error "$1" -o "$2"; }
fetch "$clip/onnx/vision_model_quantized.onnx" "$resources/PolicyModels/vision.onnx"
fetch "$clip/onnx/text_model_quantized.onnx" "$work/text.onnx"
fetch "$clip/tokenizer.json" "$work/tokenizer.json"
fetch "https://raw.githubusercontent.com/Pedrojok01/linux-broadcast/5a151c51be056e8f3c07d15fc51a925b5f92b565/models/selfie_multiclass.onnx" "$resources/PolicyModels/skin.onnx"
echo "534fd56e6c826e810a0e65d2e9a1d7bea4566c71ca354f3b2663e3a470acd738  $resources/PolicyModels/skin.onnx" | shasum -a 256 -c -
mkdir -p "$resources/PolicyModels/Notices"
fetch "https://raw.githubusercontent.com/openai/CLIP/main/LICENSE" "$resources/PolicyModels/Notices/CLIP-LICENSE"
fetch "https://www.apache.org/licenses/LICENSE-2.0.txt" "$resources/PolicyModels/Notices/MediaPipe-LICENSE"
fetch "https://raw.githubusercontent.com/microsoft/onnxruntime/v1.20.1/LICENSE" "$resources/PolicyModels/Notices/ONNXRuntime-LICENSE"
"$python" scripts/prompt-bank.py "$work" "$resources/PolicyModels"
"$python" scripts/test-policy-routing.py "$resources/PolicyModels"
"$python" -m PyInstaller --log-level WARN --noconfirm --clean --onefile --name PolicyWorker --distpath "$work/dist" --workpath "$work/build" --specpath "$work" --collect-binaries onnxruntime scripts/policy-worker.py
cp "$work/dist/PolicyWorker" "$(dirname "$resources")/MacOS/PolicyWorker"
codesign --force --sign - "$(dirname "$resources")/MacOS/PolicyWorker"

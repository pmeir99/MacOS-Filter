#!/bin/bash
set -euo pipefail
resources="$1"
work="$2/advanced"
mkdir -p "$work" "$resources/PolicyModels"
python3 -m venv "$work/env"
python="$work/env/bin/python"
"$python" -m pip install -q numpy==1.26.4 onnxruntime==1.20.1 pillow==11.3.0 tokenizers==0.21.4
clip=https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/d15189d7028b43f1d3e65039190477f6af591c2a
fetch(){ curl --fail --location --retry 3 --silent --show-error "$1" -o "$2"; }
fetch "$clip/onnx/vision_model_quantized.onnx" "$resources/PolicyModels/vision.onnx"
fetch "$clip/onnx/text_model_quantized.onnx" "$work/text.onnx"
fetch "$clip/tokenizer.json" "$work/tokenizer.json"
fetch "https://raw.githubusercontent.com/Pedrojok01/linux-broadcast/5a151c51be056e8f3c07d15fc51a925b5f92b565/models/selfie_multiclass.onnx" "$resources/PolicyModels/skin.onnx"
echo "534fd56e6c826e810a0e65d2e9a1d7bea4566c71ca354f3b2663e3a470acd738  $resources/PolicyModels/skin.onnx" | shasum -a 256 -c -
mkdir -p "$resources/PolicyModels/Notices"
cp models/notices/*.txt "$resources/PolicyModels/Notices/"
cp "$("$python" -c 'import pathlib, onnxruntime; print(pathlib.Path(onnxruntime.__file__).parent / "LICENSE")')" "$resources/PolicyModels/Notices/ONNXRuntime-LICENSE"
"$python" scripts/prompt-bank.py "$work" "$resources/PolicyModels"
"$python" scripts/test-policy-routing.py "$resources/PolicyModels"
# Python prepares the prompt embeddings during the build. Ship only the native worker and ONNX runtime.
package="https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime/1.20.1/microsoft.ml.onnxruntime.1.20.1.nupkg"
fetch "$package" "$work/onnxruntime.nupkg"
ort="$work/ort"
unzip -q "$work/onnxruntime.nupkg" 'build/native/include/*' 'runtimes/osx-arm64/native/*' -d "$ort"
contents="$(dirname "$resources")"
mkdir -p "$contents/Frameworks"
lib="$contents/Frameworks/libonnxruntime.1.20.1.dylib"
cp "$ort/runtimes/osx-arm64/native/libonnxruntime.dylib" "$lib"
chmod u+w "$lib"
install_name_tool -id @rpath/libonnxruntime.1.20.1.dylib "$lib"
codesign --force --sign - --timestamp=none "$lib"
xcrun clang++ -arch arm64 -mmacosx-version-min=13.0 -O2 -std=c++17 -fobjc-arc -I"$ort/build/native/include" native/PolicyWorker.mm "$lib" \
  -framework Foundation -framework CoreGraphics -framework ImageIO -Wl,-rpath,@executable_path/../Frameworks -o "$contents/MacOS/PolicyWorker"
codesign --force --sign - --timestamp=none "$contents/MacOS/PolicyWorker"
otool -L "$contents/MacOS/PolicyWorker" | grep -F '@rpath/libonnxruntime.1.20.1.dylib'

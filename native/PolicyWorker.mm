// Local inference worker. Image coordinates and mask storage use top-left raster order.
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <CoreGraphics/CoreGraphics.h>
#include <onnxruntime_cxx_api.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <iostream>
#include <memory>
#include <numeric>
#include <stdexcept>
#include <vector>

using Floats = std::vector<float>;
using Bytes = std::vector<uint8_t>;
using Image = std::unique_ptr<std::remove_pointer_t<CGImageRef>, decltype(&CGImageRelease)>;
static Image image(CGImageRef value) {
    if (!value) throw std::runtime_error("Missing image");
    return Image(value, CGImageRelease);
}

static Bytes pixels(CGImageRef source, size_t width, size_t height) {
    Bytes data(width * height * 4);
    CGColorSpaceRef rgb = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    CGContextRef ctx = CGBitmapContextCreate(data.data(), width, height, 8, width*4, rgb,
                                               kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
    CGColorSpaceRelease(rgb);
    if (!ctx) throw std::runtime_error("Bitmap allocation failed");
    CGContextSetInterpolationQuality(ctx, kCGInterpolationHigh);
    CGContextDrawImage(ctx, CGRectMake(0,0,width,height), source);
    CGContextRelease(ctx);
    return data;
}

static Image decode(NSString *encoded) {
    NSData *data = [[NSData alloc] initWithBase64EncodedString:encoded options:0];
    CGImageSourceRef src = data ? CGImageSourceCreateWithData((__bridge CFDataRef)data, nullptr) : nullptr;
    if (!src) throw std::runtime_error("Unreadable image");
    NSDictionary *options = @{(__bridge NSString *)kCGImageSourceCreateThumbnailFromImageAlways:@YES,
                              (__bridge NSString *)kCGImageSourceCreateThumbnailWithTransform:@YES,
                              (__bridge NSString *)kCGImageSourceThumbnailMaxPixelSize:@768};
    CGImageRef frame = CGImageSourceCreateThumbnailAtIndex(src, 0, (__bridge CFDictionaryRef)options);
    CFRelease(src);
    return image(frame);
}

static NSString *maskPNG(const Bytes &alpha, size_t w, size_t h) {
    Bytes rgba(w*h*4);
    for (size_t i=0; i<alpha.size(); ++i)
        std::fill_n(rgba.data()+4*i, 4, alpha[i]);
    CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
    CFDataRef data = CFDataCreate(nullptr, rgba.data(), rgba.size());
    CGDataProviderRef provider = CGDataProviderCreateWithCFData(data);
    auto result = image(CGImageCreate(w,h,8,32,w*4,space,kCGImageAlphaPremultipliedLast,provider,nullptr,false,kCGRenderingIntentDefault));
    CGDataProviderRelease(provider); CFRelease(data); CGColorSpaceRelease(space);
    NSMutableData *out = [NSMutableData data];
    CGImageDestinationRef dst = CGImageDestinationCreateWithData((__bridge CFMutableDataRef)out,CFSTR("public.png"),1,nullptr);
    if (!dst) throw std::runtime_error("PNG destination unavailable");
    CGImageDestinationAddImage(dst,result.get(),nullptr);
    bool ok = CGImageDestinationFinalize(dst); CFRelease(dst);
    if (!ok) throw std::runtime_error("PNG encoding failed");
    return [out base64EncodedStringWithOptions:0];
}

struct Models {
    Ort::Env env{ORT_LOGGING_LEVEL_WARNING,"MacOSFilter"};
    Ort::SessionOptions options;
    std::string root;
    std::unique_ptr<Ort::Session> skin, vision;
    Floats bank;
    explicit Models(NSString *directory) : root(directory.fileSystemRepresentation), bank(13*512) {
        options.SetIntraOpNumThreads(3);
        NSData *data = [NSData dataWithContentsOfFile:[directory stringByAppendingPathComponent:@"prompts.f32"]];
        if (data.length != bank.size()*sizeof(float)) throw std::runtime_error("Invalid prompt bank");
        memcpy(bank.data(),data.bytes,data.length);
    }

    Floats infer(CGImageRef frame, bool clip) {
        const int n = clip ? 224 : 256;
        const int count = n*n;
        const auto rgb = pixels(frame,n,n);
        Floats tensor(count*3);
        constexpr float mean[]{0.48145466f,0.4578275f,0.40821073f}, sd[]{0.26862954f,0.26130258f,0.27577711f};
        for (int i=0;i<count;i++) for (int c=0;c<3;c++) {
            const float value = rgb[i*4+c]/255.f;
            if (clip) tensor[c*count+i]=(value-mean[c])/sd[c];
            else tensor[i*3+c]=value;
        }
        auto &session = clip ? vision : skin;
        if (!session) session = std::make_unique<Ort::Session>(env,(root+(clip?"/vision.onnx":"/skin.onnx")).c_str(),options);
        std::array<int64_t,4> shape = clip ? std::array<int64_t,4>{1,3,n,n} : std::array<int64_t,4>{1,n,n,3};
        auto memory = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator,OrtMemTypeDefault);
        auto input = Ort::Value::CreateTensor<float>(memory,tensor.data(),tensor.size(),shape.data(),4);
        Ort::AllocatorWithDefaultOptions allocator;
        auto inName = session->GetInputNameAllocated(0,allocator);
        auto outName = session->GetOutputNameAllocated(0,allocator);
        const char *inNames[]{inName.get()}, *outNames[]{clip?"image_embeds":outName.get()};
        auto values = session->Run(Ort::RunOptions{nullptr},inNames,&input,1,outNames,1);
        size_t size=values[0].GetTensorTypeAndShapeInfo().GetElementCount();
        if (size != (clip?512:256*256*6)) throw std::runtime_error("Unexpected model output");
        const float *out = values[0].GetTensorData<float>();
        if (!std::all_of(out,out+size,[](float value){return std::isfinite(value);})) throw std::runtime_error("Invalid model output");
        return Floats(out,out+size);
    }

    Floats scores(CGImageRef frame) {
        size_t w=CGImageGetWidth(frame), h=CGImageGetHeight(frame), side=std::min(w,h);
        auto crop=image(CGImageCreateWithImageInRect(frame,CGRectMake((w-side)/2,(h-side)/2,side,side)));
        auto embedding=infer(crop.get(),true);
        float norm=std::sqrt(std::inner_product(embedding.begin(),embedding.end(),embedding.begin(),0.f));
        if (!(norm>0)) throw std::runtime_error("Empty embedding");
        Floats scores(13);
        for (size_t i=0;i<scores.size();++i)
            scores[i]=std::inner_product(embedding.begin(),embedding.end(),bank.begin()+i*512,0.f)/norm;
        return scores;
    }

    Bytes region(CGImageRef crop,bool onlySkin,bool face,bool &foundPerson) {
        const auto logits=infer(crop,false);
        Bytes labels(256*256), grown(labels.size());
        for (size_t i=0;i<labels.size();++i) {
            const float *p=logits.data()+i*6;
            int label=int(std::max_element(p,p+6)-p);
            foundPerson |= label!=0;
            labels[i]=(onlySkin?(label==2 || (face && label==3)):label!=0)?255:0;
        }
        for (int y=0;y<256;y++) for(int x=0;x<256;x++)
            for(int row=std::max(0,y-1);row<=std::min(255,y+1);row++){
                auto first=labels.begin()+row*256;
                grown[y*256+x]=std::max(grown[y*256+x],*std::max_element(first+std::max(0,x-1),first+std::min(255,x+1)+1));
            }
        return grown;
    }

    NSDictionary *analyze(NSDictionary *request) {
        auto frame=decode(request[@"imageData"]);
        const int w=int(CGImageGetWidth(frame.get())), h=int(CGImageGetHeight(frame.get()));
        NSDictionary *policy=request[@"settings"];
        NSArray *boxes=request[@"boxes"];
        bool detected=boxes.count>0;
        if (boxes.count>12) return @{@"full":@YES};
        NSArray *families=@[@"underwear",@"adult",@"menstrual"];
        if ([policy[@"products"] count]) {
            auto s=scores(frame.get());
            size_t rank=std::max_element(s.begin()+9,s.end())-(s.begin()+9);
            if(rank<3 && [policy[@"products"] containsObject:families[rank]]) return @{@"full":@YES};
        }
        Bytes mask(w*h);
        bool levels=[policy[@"mode"] isEqual:@"policy"];
        for (NSArray *rect in detected?boxes:@[@[@0,@0,@1,@1]]) {
            if(rect.count!=4) throw std::runtime_error("Invalid region");
            double x=[rect[0] doubleValue],y=[rect[1] doubleValue];
            int l=std::clamp(int(floor(x*w)),0,w), t=std::clamp(int(floor(y*h)),0,h);
            int r=std::clamp(int(ceil((x+[rect[2] doubleValue])*w)),0,w);
            int b=std::clamp(int(ceil((y+[rect[3] doubleValue])*h)),0,h);
            if(l>=r || t>=b) return @{@"full":@YES};
            auto crop=image(CGImageCreateWithImageInRect(frame.get(),CGRectMake(l,t,r-l,b-t)));
            NSString *target=policy[@"appearance"] ?: @"all";
            if(levels || ![target isEqual:@"all"]) {
                auto s=scores(crop.get());
                int level=int(std::max_element(s.begin(),s.begin()+7)-s.begin())+1;
                if(levels && level<=[(policy[@"fullLevel"] ?: @2) intValue]) return @{@"full":@YES};
                float delta=s[7]-s[8];
                if(([target isEqual:@"masculine"] && delta < -0.025f) || ([target isEqual:@"feminine"] && delta > 0.025f)) continue;
                if(levels && level>[(policy[@"maskLevel"] ?: @5) intValue]) continue;
            }
            bool foundPerson=false;
            auto alpha=region(crop.get(),[policy[@"mode"] isEqual:@"skin"] || [policy[@"paintSkin"] boolValue],
                              [(policy[@"includeFace"] ?: @YES) boolValue],foundPerson);
            if(detected && !foundPerson) return @{@"full":@YES};
            for(int row=t;row<b;row++) for(int col=l;col<r;col++) {
                const double fx=std::clamp(((col-l+0.5)*256/(r-l))-0.5,0.,255.);
                const double fy=std::clamp(((row-t+0.5)*256/(b-t))-0.5,0.,255.);
                int ix=int(fx), iy=int(fy), nx=std::min(ix+1,255), ny=std::min(iy+1,255);
                double a=fx-ix,c=fy-iy;
                auto coverage=uint8_t(std::lround((1-c)*((1-a)*alpha[iy*256+ix]+a*alpha[iy*256+nx])+c*((1-a)*alpha[ny*256+ix]+a*alpha[ny*256+nx])));
                mask[row*w+col]=std::max(mask[row*w+col],coverage);
            }
        }
        return @{@"mask":maskPNG(mask,w,h)};
    }
};

int main(int argc,char **argv) {
    if(argc!=2) return 2;
    @autoreleasepool {
        try {
            Models models([NSString stringWithUTF8String:argv[1]]);
            for(std::string line;std::getline(std::cin,line);) @autoreleasepool {
                NSDictionary *reply;
                try {
                    NSData *data=[NSData dataWithBytes:line.data() length:line.size()];
                    NSDictionary *req=[NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
                    reply=models.analyze(req);
                } catch(const std::exception &) { reply=@{@"error":@"Local policy analysis failed"}; }
                NSData *out=[NSJSONSerialization dataWithJSONObject:reply options:0 error:NULL];
                std::cout.write((const char *)out.bytes,out.length) << std::endl;
            }
        } catch(const std::exception &error) { std::cerr<<error.what()<<std::endl; return 1; }
    }
    return 0;
}

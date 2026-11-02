// Deterministic, original synthetic footage. CC0-1.0; no external media.
// macOS: swift -module-cache-path /tmp/frame-scene-swift-cache tests/generate-scene-fixtures.swift
// Optional argument: output directory. Re-generates MP4s and verification.json.
import Foundation
import AVFoundation
import CoreGraphics
import CoreText
import AppKit

struct Fixture {
    let name: String
    let duration: Double
    let width: Int
    let height: Int
    let fps: Int
    let kind: Int
}

let fixtures = [
    Fixture(name: "01-hard-cuts", duration: 16, width: 640, height: 360, fps: 30, kind: 0),
    Fixture(name: "02-long-continuous", duration: 180, width: 320, height: 180, fps: 15, kind: 1),
    Fixture(name: "03-flashes-and-pan", duration: 18, width: 640, height: 360, fps: 30, kind: 2),
    Fixture(name: "04-fades-black-similar-colors", duration: 18, width: 640, height: 360, fps: 30, kind: 3),
    Fixture(name: "05-rapid-cuts", duration: 6, width: 640, height: 360, fps: 30, kind: 4),
    Fixture(name: "06-portrait-variable-rate", duration: 12, width: 360, height: 640, fps: 30, kind: 5),
    Fixture(name: "07-subsecond", duration: 0.4, width: 640, height: 360, fps: 30, kind: 6),
    Fixture(name: "08-4k-cuts", duration: 4, width: 3840, height: 2160, fps: 30, kind: 7)
]
let out = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "tests/fixtures/scenes", isDirectory: true)
try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
let posters = out.appendingPathComponent("posters", isDirectory: true)
try FileManager.default.createDirectory(at: posters, withIntermediateDirectories: true)

func color(_ index: Int) -> CGColor {
    let colors: [[CGFloat]] = [[0.07,0.22,0.40], [0.43,0.11,0.18], [0.08,0.38,0.23], [0.49,0.31,0.06], [0.28,0.10,0.44]]
    let c = colors[index % colors.count]
    return CGColor(red: c[0], green: c[1], blue: c[2], alpha: 1)
}

func label(_ text: String, at y: CGFloat, size: CGFloat, context c: CGContext) {
    c.saveGState()
    let font = CTFontCreateWithName("Helvetica" as CFString, size, nil)
    let attributed = NSAttributedString(string: text, attributes: [
        NSAttributedString.Key(kCTFontAttributeName as String): font,
        NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(gray: 1, alpha: 0.95)
    ])
    c.textPosition = CGPoint(x: 22, y: y)
    CTLineDraw(CTLineCreateWithAttributedString(attributed), c)
    c.restoreGState()
}

func paint(_ c: CGContext, fixture f: Fixture, time t: Double) {
    // Draw in a 640-wide coordinate system for consistent scale at every resolution.
    let w: CGFloat = 640
    let h = CGFloat(f.height) * w / CGFloat(f.width)
    c.scaleBy(x: CGFloat(f.width)/w, y: CGFloat(f.width)/w)
    let rapid = [0.5, 0.75, 1.0, 1.2, 1.7, 2.0, 2.1, 2.5, 3.0]
    var shot = 0
    switch f.kind {
    case 0: shot = min(3, Int(t/4))
    case 3: shot = t < 6 ? 0 : 2
    case 4: shot = rapid.filter { t + 0.00001 >= $0 }.count
    case 5: shot = min(2, Int(t/4))
    case 7: shot = min(1, Int(t/2))
    default: break
    }
    c.setFillColor(color(shot)); c.fill(CGRect(x: 0,y: 0,width: w,height: h))
    // A wrapping, gently panning stripe field: a continuous shot with actual motion.
    let drift = CGFloat(t * (f.kind == 2 ? 42 : 12)).truncatingRemainder(dividingBy: 80)
    c.setFillColor(CGColor(gray: 1, alpha: 0.075))
    for x in stride(from: CGFloat(-80), through: w+80, by: 80) {
        c.fill(CGRect(x: x+drift, y: 0, width: 24, height: h))
    }
    let x = 320 + 190 * sin(t * 0.8)
    let y = Double(h)*0.52 + min(70, Double(h)*0.15)*cos(t * 0.6)
    c.setFillColor(CGColor(red: 0.98,green: 0.72,blue: 0.24,alpha: 1))
    // At 12 seconds, swap shape/position while retaining the same background palette.
    if f.kind == 3 && t >= 12 {
        c.fill(CGRect(x: 430, y: Double(h)*0.35, width: 120, height: 120))
    } else {
        c.fillEllipse(in: CGRect(x: x-48, y: y-48, width: 96, height: 96))
    }
    label("SYNTHETIC / FRAME TEST", at: h-34, size: 18, context: c)
    label(f.name, at: h-61, size: f.kind == 5 ? 20 : 17, context: c)
    label(String(format: "%06.2f s    SHOT %d", t, shot+1), at: 22, size: 20, context: c)
    if f.kind == 2 {
        let whiteFlash = t + 0.00001 >= 5 && t < 5 + 1.0/30 - 0.00001
        let blackFlash = t + 0.00001 >= 11 && t < 11 + 2.0/30 - 0.00001
        if whiteFlash || blackFlash {
            c.setFillColor(CGColor(gray: whiteFlash ? 1 : 0, alpha: 1)); c.fill(CGRect(x: 0,y: 0,width: w,height: h))
        }
    }
    if f.kind == 3 {
        let opacity: Double = t >= 4 && t < 5 ? t-4 : (t >= 5 && t < 6 ? 1 : (t >= 6 && t < 7 ? 7-t : 0))
        if opacity > 0 {
            c.setFillColor(CGColor(gray: 0, alpha: opacity)); c.fill(CGRect(x: 0,y: 0,width: w,height: h))
        }
    }
}

var reports = [[String: Any]]()
for f in fixtures {
    let url = out.appendingPathComponent(f.name + ".mp4")
    try? FileManager.default.removeItem(at: url)
    let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: f.width, AVVideoHeightKey: f.height,
        AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: f.kind == 7 ? 3_000_000 : (f.kind == 1 ? 120_000 : 450_000), AVVideoMaxKeyFrameIntervalKey: f.fps]
    ])
    input.expectsMediaDataInRealTime = false
    let adapter = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
        kCVPixelBufferWidthKey as String: f.width, kCVPixelBufferHeightKey as String: f.height,
        kCVPixelBufferCGImageCompatibilityKey as String: true,
        kCVPixelBufferCGBitmapContextCompatibilityKey as String: true
    ])
    writer.add(input)
    guard writer.startWriting() else { fatalError("Writer failed: \(String(describing: writer.error))") }
    writer.startSession(atSourceTime: .zero)
    var ticks: Int64 = 0, frameCount = 0
    let endTicks = Int64((f.duration * 600).rounded())
    while ticks < endTicks {
        while !input.isReadyForMoreMediaData {
            if writer.status == .failed { fatalError("Encode failed: \(String(describing: writer.error))") }
            Thread.sleep(forTimeInterval: 0.002)
        }
        try autoreleasepool {
            var maybe: CVPixelBuffer?
            guard CVPixelBufferPoolCreatePixelBuffer(nil, adapter.pixelBufferPool!, &maybe) == kCVReturnSuccess, let pixel = maybe else { fatalError("No buffer") }
            CVPixelBufferLockBaseAddress(pixel, [])
            let ctx = CGContext(data: CVPixelBufferGetBaseAddress(pixel), width: f.width,height: f.height,bitsPerComponent: 8,bytesPerRow: CVPixelBufferGetBytesPerRow(pixel),space: CGColorSpaceCreateDeviceRGB(),bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue)!
            paint(ctx, fixture: f, time: Double(ticks)/600)
            CVPixelBufferUnlockBaseAddress(pixel, [])
            guard adapter.append(pixel, withPresentationTime: CMTime(value: ticks, timescale: 600)) else { throw writer.error ?? NSError(domain: "Append", code: 1) }
        }
        let fps = f.kind == 5 ? (ticks < 2400 ? 15 : (ticks < 4800 ? 30 : 60)) : f.fps
        ticks += Int64(600/fps); frameCount += 1
    }
    writer.endSession(atSourceTime: CMTime(value: endTicks, timescale: 600))
    input.markAsFinished()
    let done = DispatchSemaphore(value: 0)
    writer.finishWriting { done.signal() }; done.wait()
    guard writer.status == .completed else { fatalError("Finish failed: \(String(describing: writer.error))") }
    // Independently decode every frame; count real pixels and distinct timestamps.
    let asset = AVURLAsset(url: url)
    let track = asset.tracks(withMediaType: .video).first!
    let reader = try AVAssetReader(asset: asset)
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
    reader.add(output); reader.startReading()
    var decoded = 0, nonblack = 0, last: Double? = nil, deltas = Set<Int>(), size = [0,0]
    while let sample = output.copyNextSampleBuffer() {
        let seconds = CMSampleBufferGetPresentationTimeStamp(sample).seconds
        if let previous = last { deltas.insert(Int(((seconds-previous)*600).rounded())) }; last = seconds
        if let p = CMSampleBufferGetImageBuffer(sample) {
            size = [CVPixelBufferGetWidth(p), CVPixelBufferGetHeight(p)]
            CVPixelBufferLockBaseAddress(p, .readOnly)
            let bytes = CVPixelBufferGetBaseAddress(p)!.assumingMemoryBound(to: UInt8.self)
            let stride = CVPixelBufferGetBytesPerRow(p)
            var lit = false
            for y in [size[1]/4, size[1]/2, size[1]*3/4] {
                for x in [size[0]/4, size[0]/2, size[0]*3/4] {
                    let o = y*stride+x*4
                    if Int(bytes[o])+Int(bytes[o+1])+Int(bytes[o+2]) > 36 { lit = true }
                }
            }
            if lit { nonblack += 1 }
            CVPixelBufferUnlockBaseAddress(p, .readOnly)
        }
        decoded += 1
    }
    guard reader.status == .completed && decoded == frameCount && nonblack > 0 else { fatalError("Decode verification failed for \(f.name)") }
    let bytes = (try FileManager.default.attributesOfItem(atPath: url.path)[.size] as! NSNumber).intValue
    let preview = AVAssetImageGenerator(asset: asset)
    preview.appliesPreferredTrackTransform = true
    preview.maximumSize = CGSize(width: 640, height: 360)
    let image = try preview.copyCGImage(at: .zero, actualTime: nil)
    let poster = NSBitmapImageRep(cgImage: image).representation(using: .jpeg, properties: [.compressionFactor: 0.8])!
    try poster.write(to: posters.appendingPathComponent(f.name + ".jpg"))
    reports.append(["file": url.lastPathComponent,"bytes": bytes,"durationSeconds": asset.duration.seconds,"dimensions": size,"encodedFrames": frameCount,"decodedFrames": decoded,"nonblackSampledFrames": nonblack,"frameIntervalsIn600ths": deltas.sorted()])
    print("\(url.lastPathComponent): \(decoded) decoded frames, \(bytes) bytes")
}
let json = try JSONSerialization.data(withJSONObject: ["generator": "macOS AVFoundation; original synthetic graphics", "fixtures": reports], options: [.prettyPrinted, .sortedKeys])
try json.write(to: out.appendingPathComponent("verification.json"))

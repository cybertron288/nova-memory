import AVFoundation
import Foundation

// M0 scope decision: prove the *transcription* leg with mic capture first
// (deterministic, low-risk), then attempt the system-audio process tap.
// Chunks rotate every 30 s per spec architecture §2.2.
let outDir = URL(fileURLWithPath: "artifacts", isDirectory: true)
try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

// AVAudioFile finalizes its WAV header and flushes buffered samples on
// deallocation. Ctrl-C kills the process before that happens, so an open file
// lands as a 4096-byte header with zero audio — which is exactly how the
// system-audio tap came back silent even though millions of bytes flowed
// through its IO proc. Niling the file reference is NOT enough: the running
// IO proc / engine tap captures it strongly, so it never dealloc's. Shutdown
// must STOP capture first (releasing those captures), THEN nil the files.
import CoreAudio

final class Recorders {
    static let shared = Recorders()
    var mic: AVAudioFile?
    var engine: AVAudioEngine?
    var aggID: AudioObjectID?
    var procID: AudioDeviceIOProcID?
    // System tap writes raw PCM through a plain file handle (realtime-safe),
    // with a WAV header backfilled on shutdown.
    var systemFH: FileHandle?
    var systemURL: URL?
    var systemFmt: AudioStreamBasicDescription?
    var systemBytes: UInt64 = 0

    func closeAndExit() {
        engine?.stop()                      // stops the mic tap callback
        if let agg = aggID, let pid = procID {
            AudioDeviceStop(agg, pid)       // stops the system-tap IO proc
            AudioDeviceDestroyIOProcID(agg, pid)
        }
        if let agg = aggID { AudioHardwareDestroyAggregateDevice(agg) }
        mic = nil                           // dealloc → flush (mic path uses AVAudioFile off the RT thread)
        finalizeSystemWav()
        exit(0)
    }

    // Backfill the 44-byte WAV header now that the data length is known.
    private func finalizeSystemWav() {
        guard let fh = systemFH, let fmt = systemFmt else { return }
        systemFH = nil
        let dataLen = UInt32(systemBytes)
        let sr = UInt32(fmt.mSampleRate)
        let ch = UInt16(fmt.mChannelsPerFrame)
        let bits = UInt16(fmt.mBitsPerChannel)
        let isFloat = (fmt.mFormatFlags & kAudioFormatFlagIsFloat) != 0
        let byteRate = sr * UInt32(ch) * UInt32(bits / 8)
        let blockAlign = ch * (bits / 8)
        var h = Data()
        func u32(_ v: UInt32) { var x = v.littleEndian; h.append(Data(bytes: &x, count: 4)) }
        func u16(_ v: UInt16) { var x = v.littleEndian; h.append(Data(bytes: &x, count: 2)) }
        h.append("RIFF".data(using: .ascii)!); u32(36 + dataLen); h.append("WAVE".data(using: .ascii)!)
        h.append("fmt ".data(using: .ascii)!); u32(16)
        u16(isFloat ? 3 : 1)                 // 3 = IEEE float, 1 = PCM
        u16(ch); u32(sr); u32(byteRate); u16(blockAlign); u16(bits)
        h.append("data".data(using: .ascii)!); u32(dataLen)
        try? fh.seek(toOffset: 0)
        fh.write(h)
        try? fh.close()
    }
}

func installCleanShutdown() {
    let src = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
    signal(SIGINT, SIG_IGN)
    src.setEventHandler { Recorders.shared.closeAndExit() }
    src.resume()
    Recorders.sigSource = src
}
extension Recorders { static var sigSource: DispatchSourceSignal? }

let engine = AVAudioEngine()
let input = engine.inputNode
let format = input.outputFormat(forBus: 0)
var file: AVAudioFile? { didSet { Recorders.shared.mic = file } }
var chunkStart = Date()
var chunkIndex = 0

installCleanShutdown()

func rotate() throws {
    chunkIndex += 1
    let url = outDir.appendingPathComponent(String(format: "chunk-%03d.wav", chunkIndex))
    file = try AVAudioFile(forWriting: url, settings: format.settings)
    chunkStart = Date()
    print("recording → \(url.lastPathComponent)")
}

try rotate()
input.installTap(onBus: 0, bufferSize: 4096, format: format) { buffer, _ in
    try? file?.write(from: buffer)
    if Date().timeIntervalSince(chunkStart) >= 30 { try? rotate() }
}
try engine.start()
Recorders.shared.engine = engine
print("mic capture running — ctrl-c to stop")

// System-audio tap (macOS 14.4+): global tap excluding our own process,
// wrapped in an aggregate device we attach an IO proc to.

// Every audio process object the system knows about. Used to build an explicit
// process-INCLUSION tap — the empty-exclude global tap captured silence, so we
// name the processes to tap instead.
@available(macOS 14.4, *)
func allAudioProcessObjects() -> [AudioObjectID] {
    var addr = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyProcessObjectList,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var dataSize: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &dataSize) == noErr,
          dataSize > 0 else { return [] }
    let count = Int(dataSize) / MemoryLayout<AudioObjectID>.size
    var ids = [AudioObjectID](repeating: 0, count: count)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &dataSize, &ids) == noErr
    else { return [] }
    return ids
}

// The default output device's UID — the aggregate needs it as a real output
// sub-device, otherwise the process tap has no running stream to observe and
// records digital silence.
func defaultOutputDeviceUID() -> String? {
    var devID = AudioObjectID(kAudioObjectUnknown)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    var addr = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultOutputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &devID) == noErr,
          devID != kAudioObjectUnknown else { return nil }

    var uid: Unmanaged<CFString>? = nil
    var uidSize = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    var uidAddr = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyDeviceUID,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    guard AudioObjectGetPropertyData(devID, &uidAddr, 0, nil, &uidSize, &uid) == noErr,
          let cf = uid?.takeRetainedValue() else { return nil }
    return cf as String
}

func startSystemTap() {
    guard #available(macOS 14.4, *) else { print("tap: needs macOS 14.4+"); return }
    // Explicit process-INCLUSION tap: the empty-exclude global tap (stereo and
    // mono) captured pure silence on macOS 15.4. Name every audio process to
    // tap instead — a stereo mixdown of them all.
    let procObjs = allAudioProcessObjects()
    guard !procObjs.isEmpty else { print("tap: no audio process objects"); return }
    print("tap including \(procObjs.count) audio process objects")
    let tapDesc = CATapDescription(stereoMixdownOfProcesses: procObjs)
    tapDesc.uuid = UUID()
    tapDesc.muteBehavior = .unmuted
    var tapID = AudioObjectID(kAudioObjectUnknown)
    var err = AudioHardwareCreateProcessTap(tapDesc, &tapID)
    guard err == noErr else { print("tap: create failed \(err)"); return }

    guard let outUID = defaultOutputDeviceUID() else {
        print("tap: no default output device"); return
    }
    print("tap binding to output device: \(outUID)")

    let aggDesc: [String: Any] = [
        kAudioAggregateDeviceNameKey: "nova-spike-agg",
        kAudioAggregateDeviceUIDKey: "nova-spike-agg-uid",
        kAudioAggregateDeviceIsPrivateKey: true,
        // Give the aggregate a real output sub-device so the tap has a live
        // stream to observe — without this the tap records silence.
        kAudioAggregateDeviceMainSubDeviceKey: outUID,
        kAudioAggregateDeviceSubDeviceListKey: [
            [kAudioSubDeviceUIDKey: outUID]
        ],
        kAudioAggregateDeviceTapListKey: [
            [kAudioSubTapUIDKey: tapDesc.uuid.uuidString, kAudioSubTapDriftCompensationKey: true]
        ],
    ]
    var aggID = AudioObjectID(kAudioObjectUnknown)
    err = AudioHardwareCreateAggregateDevice(aggDesc as CFDictionary, &aggID)
    guard err == noErr else { print("tap: aggregate failed \(err)"); return }

    // Bug-fix 2: read the tap's ACTUAL stream format instead of assuming
    // 48 kHz/2 ch. A CoreAudio process tap delivers 32-bit float; the exact
    // sample rate / channel count come from the tap object, not a guess.
    var tapFmt = AudioStreamBasicDescription()
    var tapFmtSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
    var fmtAddr = AudioObjectPropertyAddress(
        mSelector: kAudioTapPropertyFormat,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    err = AudioObjectGetPropertyData(tapID, &fmtAddr, 0, nil, &tapFmtSize, &tapFmt)
    guard err == noErr else { print("tap: format query failed \(err)"); return }

    guard let streamFmt = AVAudioFormat(streamDescription: &tapFmt) else {
        print("tap: unsupported stream format"); return
    }
    print("tap format: \(streamFmt.sampleRate) Hz, \(streamFmt.channelCount) ch")

    // AVAudioFile.write(from:) called on the realtime IO thread does not
    // persist — 23.9 MB flowed through the callback yet the file stayed a bare
    // header across three different flush strategies. AVAudioFile is not
    // realtime-safe from an IO proc. Fix: append raw PCM bytes to a plain file
    // handle in the callback (a syscall, realtime-safe enough for a spike),
    // then write a real WAV header over the top on shutdown.
    let sysURL = outDir.appendingPathComponent("system-audio.wav")
    FileManager.default.createFile(atPath: sysURL.path, contents: nil)
    guard let sysFH = try? FileHandle(forWritingTo: sysURL) else {
        print("tap: cannot open output file"); return
    }
    Recorders.shared.systemFH = sysFH
    Recorders.shared.systemURL = sysURL
    Recorders.shared.systemFmt = tapFmt
    // Reserve 44 bytes for the WAV header, backfilled on shutdown.
    sysFH.write(Data(count: 44))

    var procID: AudioDeviceIOProcID?
    err = AudioDeviceCreateIOProcIDWithBlock(&procID, aggID, nil) { _, inData, _, _, _ in
        let abl = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inData))
        for b in abl {
            guard let mData = b.mData, b.mDataByteSize > 0 else { continue }
            Recorders.shared.systemFH?.write(Data(bytes: mData, count: Int(b.mDataByteSize)))
            Recorders.shared.systemBytes += UInt64(b.mDataByteSize)
        }
    }
    guard err == noErr, let pid = procID else { print("tap: ioproc failed \(err)"); return }
    let startErr = AudioDeviceStart(aggID, pid)
    guard startErr == noErr else { print("tap: device start failed \(startErr)"); return }
    Recorders.shared.aggID = aggID
    Recorders.shared.procID = pid
    print("system tap running → system-audio.wav")
}
startSystemTap()

RunLoop.main.run()

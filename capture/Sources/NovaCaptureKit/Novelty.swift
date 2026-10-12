import CryptoKit
import Foundation

/// Word-shingle similarity for "did this screen sample add anything new?".
/// Deterministic within a process run (uses hashValue), which is all the
/// capture loop needs — shingle sets are never persisted.
public enum Novelty {
    public static func shingles(_ text: String, size: Int = 5) -> Set<Int> {
        let words = text.lowercased()
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }
        guard words.count >= size else {
            return words.isEmpty ? [] : [words.joined(separator: " ").hashValue]
        }
        var out = Set<Int>()
        for i in 0...(words.count - size) {
            out.insert(words[i..<(i + size)].joined(separator: " ").hashValue)
        }
        return out
    }

    public static func jaccard(_ a: Set<Int>, _ b: Set<Int>) -> Double {
        if a.isEmpty && b.isEmpty { return 1.0 }
        let inter = a.intersection(b).count
        let union = a.union(b).count
        return union == 0 ? 0 : Double(inter) / Double(union)
    }

    /// Novel when overlap with the previous sample is below `threshold`.
    public static func isNovel(_ new: String, against prev: String, threshold: Double = 0.85) -> Bool {
        jaccard(shingles(new), shingles(prev)) < threshold
    }
}

extension Novelty {
    /// Hex sha256, used for content and tree hashes on the wire.
    public static func sha256(_ s: String) -> String {
        SHA256.hash(data: Data(s.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

/// Which `AXURL` values are worth recording as a capture's provenance.
///
/// Lives in the kit rather than beside the AX walk that uses it, because the
/// walk needs a live browser and this rule does not — and this rule is the
/// part that would quietly degrade provenance if it regressed.
public enum URLProvenance {
    /// `chrome://`, `file://` and `about:` are real values Chrome and Safari
    /// hand out. None of them is a place a user would recognise as "where this
    /// came from", so only web addresses are kept.
    public static func isWebURL(_ raw: String) -> Bool {
        raw.hasPrefix("http://") || raw.hasPrefix("https://")
    }
}

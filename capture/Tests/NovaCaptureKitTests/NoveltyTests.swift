import Testing
@testable import NovaCaptureKit

@Test func identicalTextIsNotNovel() {
    let t = "the quarterly deck is due friday and jordan owns the review section"
    #expect(!Novelty.isNovel(t, against: t))
}

@Test func completelyDifferentTextIsNovel() {
    let a = "the quarterly deck is due friday and jordan owns the review section"
    let b = "brew upgrade completed successfully with zero errors reported today now"
    #expect(Novelty.isNovel(b, against: a))
}

@Test func smallEditIsNotNovel() {
    let a = "morning team standup notes for the platform squad this sprint we shipped the new onboarding flow to staging and fixed three flaky tests in the billing suite the search indexing job is still running slower than expected on large workspaces so we are profiling the query planner today someone should also update the deployment runbook before the release freeze on thursday and we need to confirm the staging database migration completed without errors before we cut the release branch tomorrow morning the frontend team reported that the new dashboard widgets are rendering correctly in staging but there is a minor layout shift on narrow viewports that design wants fixed before launch the backend team is still waiting on the infra ticket for the read replica so reporting queries stop timing out during peak hours support flagged two customer tickets about export csv files missing the last column which looks like an off by one bug in the column mapping code we should also revisit the alerting thresholds since the on call rotation got paged twice overnight for noise rather than real incidents and finally someone needs to close out the retro action items from last sprint before the next planning session on monday"
    let b = "morning team standup notes for the platform squad this sprint we shipped the new onboarding flow to staging and fixed three flaky tests in the billing suite the search indexing job is still running noticeably slower than expected on large workspaces so we are profiling the query planner today someone should also update the deployment runbook before the release freeze on thursday and we need to confirm the staging database migration completed without errors before we cut the release branch tomorrow morning the frontend team reported that the new dashboard widgets are rendering correctly in staging but there is a minor layout shift on narrow viewports that design wants fixed before launch the backend team is still waiting on the infra ticket for the read replica so reporting queries stop timing out during peak hours support flagged two customer tickets about export csv files missing the last column which looks like an off by one bug in the column mapping code we should also revisit the alerting thresholds since the on call rotation got paged twice overnight for noise rather than real incidents and finally someone needs to close out the retro action items from last sprint before the next planning session on monday"
    #expect(!Novelty.isNovel(b, against: a)) // one-word insert ≈ same content
}

@Test func shortTextFallsBackToEquality() {
    #expect(Novelty.isNovel("ship it", against: "hold off"))
    #expect(!Novelty.isNovel("ship it", against: "ship it"))
}

@Test func jaccardBounds() {
    let s1 = Novelty.shingles("a b c d e f g h")
    #expect(abs(Novelty.jaccard(s1, s1) - 1.0) < 1e-9)
    #expect(abs(Novelty.jaccard(s1, []) - 0.0) < 1e-9)
}

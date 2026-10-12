import Foundation
import Testing
@testable import NovaShell

private let cal: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "Asia/Kolkata")!
    return c
}()
private func at(_ h: Int, _ m: Int = 0, day: Int = 24) -> Date {
    cal.date(from: DateComponents(year: 2026, month: 9, day: day, hour: h, minute: m))!
}
private let clear = DigestConditions(locked: false, fullScreen: false, sharing: false)

@Test func beforeNineWaits() {
    #expect(DigestSchedule.decide(now: at(8, 59), lastShownDay: nil, conditions: clear, calendar: cal) == .wait)
}
@Test func atNineShows() {
    #expect(DigestSchedule.decide(now: at(9), lastShownDay: nil, conditions: clear, calendar: cal) == .show)
}
@Test func alreadyShownTodaySkips() {
    #expect(DigestSchedule.decide(now: at(9, 5), lastShownDay: "2026-09-24", conditions: clear, calendar: cal) == .skipToday)
}
@Test func shownYesterdayStillShowsToday() {
    #expect(DigestSchedule.decide(now: at(9, 5), lastShownDay: "2026-09-23", conditions: clear, calendar: cal) == .show)
}
@Test func afternoonAndEveningStillShow() {
    // First open of the day after lunch still gets the card; its greeting says so.
    #expect(DigestSchedule.decide(now: at(12), lastShownDay: nil, conditions: clear, calendar: cal) == .show)
    #expect(DigestSchedule.decide(now: at(21), lastShownDay: nil, conditions: clear, calendar: cal) == .show)
}

@Test func greetingFollowsTheHour() {
    #expect(DigestGreeting.text(at(9), calendar: cal) == "Good morning")
    #expect(DigestGreeting.text(at(11, 59), calendar: cal) == "Good morning")
    #expect(DigestGreeting.text(at(12), calendar: cal) == "Good afternoon")
    #expect(DigestGreeting.text(at(17), calendar: cal) == "Good evening")
}
@Test func lockedFullScreenOrSharingWaits() {
    for c in [DigestConditions(locked: true, fullScreen: false, sharing: false),
              DigestConditions(locked: false, fullScreen: true, sharing: false),
              DigestConditions(locked: false, fullScreen: false, sharing: true)] {
        #expect(DigestSchedule.decide(now: at(10), lastShownDay: nil, conditions: c, calendar: cal) == .wait)
    }
}
@Test func decisionIsMadeWhenAsked() {
    // 11:59 decides show; the reply arriving after noon does not re-decide.
    #expect(DigestSchedule.decide(now: at(11, 59), lastShownDay: nil, conditions: clear, calendar: cal) == .show)
}
@Test func dayKeyIsLocalDate() {
    #expect(DigestSchedule.dayKey(at(0, 30), calendar: cal) == "2026-09-24")
}

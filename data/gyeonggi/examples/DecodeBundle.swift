// Standalone schema example, not integrated into the iOS app.
// Usage: swift DecodeBundle.swift path/to/snapshot
import Foundation

struct GBISBundle<Row: Decodable>: Decodable {
    let schemaVersion: Int
    let provider: String
    let sourceVersions: [String: String]
    let data: [Row]
}

struct GBISStation: Decodable {
    let stationId: String
    let mobileNo: String?
    let stationName: String
    let regionName: String
    let isCentralLane: Bool?
    let longitude: Double?
    let latitude: Double?
}

struct GBISRoute: Decodable {
    let routeId: String
    let routeName: String
    let routeTypeCd: String
    let regionName: String
    let startStationId: String
    let endStationId: String
    let turnSeq: Int?
}

struct GBISVisit: Decodable {
    let routeId: String
    let stationId: String
    let staOrder: Int
    let upDown: String?
    let nextStationId: String?
}

struct Manifest: Decodable {
    let counts: [String: Int]
}

guard CommandLine.arguments.count == 2 else {
    fatalError("Pass the snapshot directory")
}
let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
func read<T: Decodable>(_ filename: String, as type: T.Type) throws -> T {
    try JSONDecoder().decode(type, from: Data(contentsOf: directory.appendingPathComponent(filename)))
}
let stations = try read("stations.json", as: GBISBundle<GBISStation>.self)
let routes = try read("routes.json", as: GBISBundle<GBISRoute>.self)
let visits = try read("route_stations.json", as: GBISBundle<GBISVisit>.self)
let manifest = try read("manifest.json", as: Manifest.self)
precondition([stations.schemaVersion, routes.schemaVersion, visits.schemaVersion].allSatisfy { $0 == 1 })
precondition([stations.provider, routes.provider, visits.provider].allSatisfy { $0 == "gyeonggi" })
precondition(stations.sourceVersions == routes.sourceVersions && routes.sourceVersions == visits.sourceVersions)
precondition(stations.data.count == manifest.counts["stations"])
precondition(routes.data.count == manifest.counts["routes"])
precondition(visits.data.count == manifest.counts["routeStations"])
let stationIds = Set(stations.data.map(\.stationId))
let routeIds = Set(routes.data.map(\.routeId))
precondition(stationIds.count == stations.data.count && routeIds.count == routes.data.count)
precondition(visits.data.allSatisfy {
    stationIds.contains($0.stationId) && routeIds.contains($0.routeId)
        && ($0.nextStationId.map(stationIds.contains) ?? true)
})
print("Decoded \(stations.data.count) stations, \(routes.data.count) routes, \(visits.data.count) visits; references valid.")

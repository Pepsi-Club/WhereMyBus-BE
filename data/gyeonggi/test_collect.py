"""Offline contract tests. Fixtures below are synthetic, never production data."""

import copy
import gzip
import json
import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from collect import DataError, api_url, build, build_cache, parse_api, parse_table, publish, sha256


def sources():
    return {
        "station": [
            {"stationId": "200000001", "mobileNo": "00123", "stationName": "시작",
             "centerYn": "N", "regionName": "수원", "x": "127.01", "y": "37.27"},
            {"stationId": "100000002", "mobileNo": "", "stationName": "서울경유",
             "centerYn": "Y", "regionName": "서울", "x": "126.98", "y": "37.55"},
        ],
        "route": [{"routeId": "200000010", "routeName": "3000(예약)", "routeTypeCd": "11",
                   "regionName": "수원,서울", "startStationId": "200000001",
                   "endStationId": "200000001", "turnSeq": "2"}],
        "routeStation": [
            {"routeId": "200000010", "stationId": "200000001", "staOrder": "1", "upDown": "상행"},
            {"routeId": "200000010", "stationId": "100000002", "staOrder": "2", "upDown": "상행"},
            {"routeId": "200000010", "stationId": "200000001", "staOrder": "3", "upDown": "하행"},
        ],
    }


class SourceTests(unittest.TestCase):
    def test_official_delimiters_and_korean_encodings(self):
        value = "stationId|mobileNo|stationName|centerYn|regionName|x|y^200000001|00123|수원역|N|수원|127.0|37.2^"
        for encoding in ("utf-8-sig", "cp949"):
            with self.subTest(encoding=encoding):
                rows, meta = parse_table(value.encode(encoding), "station")
                self.assertEqual(rows[0]["stationName"], "수원역")
                self.assertEqual(rows[0]["mobileNo"], "00123")
                self.assertEqual(meta["rows"], 1)

    def test_schema_drift_and_truncated_rows_fail(self):
        for value in ("stationId|unknown^1|x", "stationId|mobileNo|stationName|centerYn|regionName|x|y^1|2"):
            with self.subTest(value=value), self.assertRaises(DataError):
                parse_table(value.encode(), "station")

    def test_encoded_and_decoded_keys_have_same_single_encoding(self):
        for key in ("test+A/B==", "test%2BA%2FB%3D%3D"):
            query = parse_qs(urlsplit(api_url(key)).query)
            self.assertEqual(query["serviceKey"], ["test+A/B=="])
            self.assertEqual(query["format"], ["json"])

    def test_gateway_and_application_failures_are_not_empty_success(self):
        responses = [
            b"<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>",
            json.dumps({"response": {"msgHeader": {"resultCode": 4}, "msgBody": ""}}).encode(),
            b"<html>unavailable</html>",
            b'{"response":{"msgHeader":{"resultCode":0},"msgBody":""}}',
        ]
        for body in responses:
            with self.subTest(body=body), self.assertRaises(DataError):
                parse_api(body)


class BuildTests(unittest.TestCase):
    def test_ids_cross_boundary_stops_and_repeat_visits_survive(self):
        artifacts, report = build(sources(), {"station": "20261011"})
        stations = artifacts["stations.json"]["data"]
        self.assertEqual(stations[0]["stationId"], "100000002")
        self.assertIsNone(stations[0]["mobileNo"])
        self.assertEqual(stations[1]["mobileNo"], "00123")
        self.assertEqual(stations[1]["longitude"], 127.01)
        self.assertEqual(artifacts["routes.json"]["data"][0]["routeName"], "3000(예약)")
        visits = artifacts["route_stations.json"]["data"]
        self.assertEqual([v["staOrder"] for v in visits], [1, 2, 3])
        self.assertEqual([v["stationId"] for v in visits], ["200000001", "100000002", "200000001"])
        self.assertEqual(visits[0]["nextStationId"], "100000002")
        self.assertIsNone(visits[-1]["nextStationId"])
        self.assertEqual(report["counts"], {"stations": 2, "routes": 1, "routeStations": 3})

    def test_invalid_coordinates_retained_but_not_mapped(self):
        for x, y in (("", ""), ("NaN", "37"), ("0", "0"), ("37", "127")):
            rows = sources()
            rows["station"][0].update(x=x, y=y)
            artifacts, report = build(rows, {})
            station = artifacts["stations.json"]["data"][1]
            self.assertIsNone(station["longitude"])
            self.assertIsNone(station["latitude"])
            self.assertEqual(report["invalidCoordinateStationIds"], ["200000001"])

    def test_duplicate_station_ids_and_visit_sequences_fail(self):
        for kind in ("station", "route", "routeStation"):
            rows = sources()
            rows[kind].append(copy.deepcopy(rows[kind][0]))
            with self.subTest(kind=kind), self.assertRaises(DataError):
                build(rows, {})

    def test_missing_references_and_ids_fail(self):
        for kind, field in (("station", "stationId"), ("routeStation", "stationId"), ("routeStation", "routeId")):
            rows = sources()
            rows[kind][0][field] = ""
            with self.subTest(kind=kind, field=field), self.assertRaises(DataError):
                build(rows, {})
        rows = sources()
        rows["routeStation"][0]["stationId"] = "999999999"
        with self.assertRaises(DataError):
            build(rows, {})

    def test_gap_does_not_invent_next_stop(self):
        rows = sources()
        del rows["routeStation"][1]
        artifacts, report = build(rows, {})
        self.assertIsNone(artifacts["route_stations.json"]["data"][0]["nextStationId"])
        self.assertEqual(report["sequenceGaps"], [{"routeId": "200000010", "after": 1, "before": 3}])

    def test_unserved_master_stops_are_excluded_from_app_bundle(self):
        rows = sources()
        extra = copy.deepcopy(rows["station"][0])
        extra["stationId"] = "200000999"
        rows["station"].append(extra)
        artifacts, report = build(rows, {})
        self.assertEqual([s["stationId"] for s in artifacts["stations.json"]["data"]],
                         ["100000002", "200000001"])
        self.assertEqual(report["sourceCounts"]["stations"], 3)
        self.assertEqual(report["stationsWithoutVisits"], ["200000999"])

    def test_compressed_source_tamper_fails_before_output(self):
        with tempfile.TemporaryDirectory() as folder:
            cache = Path(folder)
            body = b"tampered"
            (cache / "station.txt.gz").write_bytes(gzip.compress(body, mtime=0))
            (cache / "source.json").write_text(json.dumps({"files": {
                "station": {"sha256": sha256(b"original"), "version": "20261011"}
            }}))
            out = cache / "out"
            with self.assertRaisesRegex(DataError, "checksum"):
                build_cache(cache, out)
            self.assertFalse(out.exists())

    def test_mobile_number_is_not_unique_and_missing_name_fails(self):
        rows = sources()
        rows["station"][1]["mobileNo"] = "00123"
        artifacts, _ = build(rows, {})
        self.assertEqual(len(artifacts["stations.json"]["data"]), 2)
        rows["station"][1]["stationName"] = ""
        with self.assertRaises(DataError):
            build(rows, {})

    def test_rebuild_stable_and_existing_output_is_never_overwritten(self):
        rows = sources()
        first, report = build(rows, {})
        for values in rows.values():
            values.reverse()
        second, _ = build(rows, {})
        self.assertEqual(first, second)
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder) / "snapshot"
            publish(out, first, report, {})
            before = (out / "stations.json").read_bytes()
            with self.assertRaises(DataError):
                publish(out, second, report, {})
            self.assertEqual((out / "stations.json").read_bytes(), before)


if __name__ == "__main__":
    unittest.main()

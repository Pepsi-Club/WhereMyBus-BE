#!/usr/bin/env python3
"""Fetch GBIS V2 base files and build versioned app bundles (standard library only)."""

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import getpass
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import sys
import tempfile
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
import xml.etree.ElementTree as ET


API_PATH = "baseinfoservice/v2/getBaseInfoItemv2"
API = "https://apis.data.go.kr/6410000/" + API_PATH
KINDS = ("station", "route", "routeStation")
FIELDS = {
    "station": "stationId mobileNo stationName centerYn regionName x y".split(),
    "route": (
        "routeId adminName endStationId endStationName regionName routeName routeTypeCd "
        "startStationId startStationName turnSeq companyId companyName companyTel "
        "upFirstTime upLastTime downFirstTime downLastTime peekAlloc npeekAlloc "
        "satUpFirstTime satUpLastTime satDownFirstTime satDownLastTime satPeekAlloc satNpeekAlloc "
        "sunUpFirstTime sunUpLastTime sunDownFirstTime sunDownLastTime sunPeekAlloc sunNpeekAlloc "
        "weUpFirstTime weUpLastTime weDownFirstTime weDownLastTime wePeekAlloc weNpeekAlloc"
    ).split(),
    "routeStation": "routeId routeName upDown staOrder stationId stationName x y".split(),
}


class DataError(Exception):
    """Safe diagnostic: never includes request URLs, credentials or raw responses."""


def api_url(key):
    # unquote, never unquote_plus: '+' is part of the decoded API key.
    return API + "?" + urlencode({"serviceKey": unquote(key.strip()), "format": "json"})


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def download(url, *, limit=80_000_000):
    try:
        with build_opener(NoRedirect()).open(
            Request(url, headers={"User-Agent": "WhereMyBus-data/1.0"}), timeout=45
        ) as response:
            body = response.read(limit + 1)
    except HTTPError as error:
        try:
            parse_api(error.read(8192))
        except DataError as detail:
            raise DataError(f"HTTP {error.code}: {detail}") from None
        raise DataError(f"HTTP {error.code}") from None
    except (URLError, TimeoutError, OSError):
        raise DataError("Network request failed; check connection and try again.") from None
    if len(body) > limit:
        raise DataError("Download exceeds size limit; source format needs review.")
    return body


def parse_api(body):
    try:
        envelope = json.loads(body)["response"]
        code = str(envelope["msgHeader"]["resultCode"])
        if code != "0":
            raise DataError(f"GBIS resultCode={code if code.isdigit() else 'invalid'}")
        item = envelope["msgBody"]["baseInfoItem"]
        if not isinstance(item, dict) or not item:
            raise ValueError
        return item
    except (ValueError, KeyError, TypeError):
        try:
            root = ET.fromstring(body)
            reason = root.findtext(".//returnReasonCode", "")
            if reason.isdigit():
                raise DataError(f"Gateway reason={reason}; check this service's subscription/key/quota.")
        except ET.ParseError:
            pass
        raise DataError("Invalid base-info response; expected successful JSON with baseInfoItem.") from None


def parse_table(body, kind):
    """Official V7.0.1 format: pipe-separated fields, caret-separated records, header first."""
    for encoding in ("utf-8-sig", "cp949"):
        try:
            text = body.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise DataError(f"{kind}: unsupported text encoding")
    records = text.strip().split("^")
    header = [value.strip() for value in records.pop(0).split("|")]
    if header != FIELDS[kind]:
        raise DataError(f"{kind}: source header changed; inspect official file specification")
    rows = []
    for number, record in enumerate(records, start=2):
        if not record.strip():
            if number == len(records) + 1:
                continue
            raise DataError(f"{kind}: empty record {number}")
        values = [value.strip() for value in record.split("|")]
        if len(values) != len(header):
            raise DataError(f"{kind}: record {number} has {len(values)} fields, expected {len(header)}")
        rows.append(dict(zip(header, values)))
    if not rows:
        raise DataError(f"{kind}: empty source")
    return rows, {"encoding": encoding, "rows": len(rows)}


def required(row, field):
    value = row.get(field, "").strip()
    if not value:
        raise DataError(f"Missing required field: {field}")
    return value


def identity(row, field):
    value = required(row, field)
    if not value.isascii() or not value.isdigit():
        raise DataError(f"Invalid numeric identifier: {field}")
    return value


def integer(value, field, *, optional=False):
    if optional and not value:
        return None
    try:
        number = int(value)
        if number < 1:
            raise ValueError
        return number
    except (TypeError, ValueError):
        raise DataError(f"Invalid positive integer: {field}") from None


def coordinates(row):
    try:
        x, y = float(row.get("x", "")), float(row.get("y", ""))
        # Broad Korean service bounds also reject 0,0 and swapped coordinates.
        if math.isfinite(x) and math.isfinite(y) and 124 <= x <= 132 and 33 <= y <= 40:
            return x, y
    except (TypeError, ValueError):
        pass
    return None, None


def build(tables, versions):
    stations, routes, visits = {}, {}, {}
    invalid_coordinates, gaps = [], []
    for row in tables["station"]:
        sid = identity(row, "stationId")
        if sid in stations:
            raise DataError(f"Duplicate stationId: {sid}")
        x, y = coordinates(row)
        if x is None:
            invalid_coordinates.append(sid)
        center = row.get("centerYn", "")
        stations[sid] = {
            "stationId": sid, "mobileNo": row.get("mobileNo") or None,
            "stationName": required(row, "stationName"), "regionName": row.get("regionName", ""),
            "isCentralLane": {"Y": True, "N": False}.get(center),
            "longitude": x, "latitude": y,
        }
    for row in tables["route"]:
        rid = identity(row, "routeId")
        if rid in routes:
            raise DataError(f"Duplicate routeId: {rid}")
        routes[rid] = {
            "routeId": rid, "routeName": required(row, "routeName"),
            "routeTypeCd": required(row, "routeTypeCd"), "regionName": row.get("regionName", ""),
            "startStationId": identity(row, "startStationId"),
            "endStationId": identity(row, "endStationId"),
            "turnSeq": integer(row.get("turnSeq", ""), "turnSeq", optional=True),
        }
    grouped = defaultdict(dict)
    for row in tables["routeStation"]:
        rid, sid = identity(row, "routeId"), identity(row, "stationId")
        order = integer(row.get("staOrder"), "staOrder")
        if rid not in routes or sid not in stations:
            raise DataError(f"Unresolved visit reference: route={rid}, station={sid}, order={order}")
        if (rid, order) in visits:
            raise DataError(f"Duplicate route/staOrder: {rid}/{order}")
        visit = {"routeId": rid, "stationId": sid, "staOrder": order,
                 "upDown": row.get("upDown") or None, "nextStationId": None}
        visits[(rid, order)] = visit
        grouped[rid][order] = visit
    for rid, by_order in sorted(grouped.items()):
        ordered = sorted(by_order)
        for left, right in zip(ordered, ordered[1:]):
            if right == left + 1:
                by_order[left]["nextStationId"] = by_order[right]["stationId"]
            else:
                gaps.append({"routeId": rid, "after": left, "before": right})
    if not all((stations, routes, visits)):
        raise DataError("Refusing empty dataset")
    served = {v["stationId"] for v in visits.values()}
    app_stations = {sid: station for sid, station in stations.items() if sid in served}
    report = {
        "sourceCounts": {"stations": len(stations), "routes": len(routes), "routeStations": len(visits)},
        "counts": {"stations": len(app_stations), "routes": len(routes), "routeStations": len(visits)},
        "invalidCoordinateStationIds": sorted(invalid_coordinates), "sequenceGaps": gaps,
        "stationsWithoutVisits": sorted(set(stations) - served),
        "routesWithoutVisits": sorted(set(routes) - set(grouped)),
        "routeTerminalsMissingFromStations": sorted({
            r[field] for r in routes.values() for field in ("startStationId", "endStationId")
            if r[field] not in stations
        }),
        "missingMobileNoCount": sum(s["mobileNo"] is None for s in stations.values()),
        "duplicateMobileNos": sorted(n for n, count in Counter(
            s["mobileNo"] for s in stations.values() if s["mobileNo"]
        ).items() if count > 1),
        "stationRegions": dict(sorted(Counter(s["regionName"] for s in stations.values()).items())),
        "appStationRegions": dict(sorted(Counter(s["regionName"] for s in app_stations.values()).items())),
        "appMissingMobileNoCount": sum(s["mobileNo"] is None for s in app_stations.values()),
        "routeTypeCounts": dict(sorted(Counter(r["routeTypeCd"] for r in routes.values()).items())),
    }
    artifacts = {}
    for filename, records in (("stations.json", app_stations), ("routes.json", routes), ("route_stations.json", visits)):
        artifacts[filename] = {"schemaVersion": 1, "provider": "gyeonggi", "sourceVersions": versions,
                               "data": [records[key] for key in sorted(records)]}
    return artifacts, report


def json_bytes(value):
    if isinstance(value, dict) and "data" in value and "schemaVersion" in value:
        # One record per line keeps large JSON diffs reviewable without verbose indentation.
        header = json.dumps({k: v for k, v in value.items() if k != "data"},
                            ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        rows = b",\n".join(json_bytes(row).rstrip(b"\n") for row in value["data"])
        return header[:-1].encode() + b',"data":[\n' + rows + b"\n]}\n"
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n").encode()


def sha256(body):
    return hashlib.sha256(body).hexdigest()


def publish(out, artifacts, report, source):
    """Publish a new immutable snapshot only after every artifact was written successfully."""
    if out.exists():
        raise DataError("Output already exists; choose a new snapshot directory.")
    out.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".gbis-", dir=out.parent))
    try:
        hashes = {}
        for name, value in {**artifacts, "validation.json": report}.items():
            body = json_bytes(value)
            (staging / name).write_bytes(body)
            hashes[name] = {"sha256": sha256(body), "bytes": len(body)}
        (staging / "manifest.json").write_bytes(json_bytes({
            "schemaVersion": 1, "source": source, "counts": report["counts"], "artifacts": hashes,
        }))
        if out.exists():
            raise DataError("Output appeared during build; refusing overwrite.")
        staging.rename(out)
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def source_url(url):
    parsed = urlsplit(url)
    host = parsed.hostname or ""
    if (parsed.scheme not in ("http", "https") or parsed.username or parsed.password
            or parsed.port not in (None, 80, 443)
            or not (host == "gbis.go.kr" or host.endswith(".gbis.go.kr"))
            or "servicekey" in parsed.query.lower()):
        raise DataError("Unexpected download URL; verify official source host before proceeding.")
    return url


def fetch(cache, key):
    if cache.exists():
        raise DataError("Cache already exists; choose a new source snapshot directory.")
    item = parse_api(download(api_url(key), limit=1_000_000))
    source = {"fetchedAt": datetime.now(timezone.utc).isoformat(), "apiPath": API_PATH, "files": {}}
    bodies = {}
    for kind in KINDS:
        try:
            url = source_url(item[kind + "DownloadUrl"])
            version = str(item[kind + "Version"]).strip()
            if not version:
                raise ValueError
        except (KeyError, TypeError, ValueError):
            raise DataError(f"Missing/invalid base-info metadata: {kind}") from None
        body = download(url)
        _, parsed = parse_table(body, kind)
        source["files"][kind] = {"url": url, "version": version, "sha256": sha256(body),
                                  "bytes": len(body), **parsed}
        bodies[kind] = body
    cache.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".gbis-source-", dir=cache.parent))
    try:
        for kind, body in bodies.items():
            (staging / (kind + ".txt.gz")).write_bytes(gzip.compress(body, mtime=0))
        (staging / "source.json").write_bytes(json_bytes(source))
        if cache.exists():
            raise DataError("Cache appeared during fetch; refusing overwrite.")
        staging.rename(cache)
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    return source


def build_cache(cache, output):
    source = json.loads((cache / "source.json").read_bytes())
    tables, versions = {}, {}
    for kind in KINDS:
        compressed = cache / (kind + ".txt.gz")
        body = gzip.decompress(compressed.read_bytes()) if compressed.exists() else (cache / (kind + ".txt")).read_bytes()
        meta = source["files"][kind]
        if sha256(body) != meta["sha256"]:
            raise DataError(f"Source checksum mismatch: {kind}")
        tables[kind], _ = parse_table(body, kind)
        versions[kind] = meta["version"]
    artifacts, report = build(tables, versions)
    publish(output, artifacts, report, source)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    get = commands.add_parser("fetch", help="Fetch official base metadata and three source files")
    get.add_argument("--cache", required=True, type=Path)
    convert = commands.add_parser("build", help="Build an immutable snapshot from verified local source files")
    convert.add_argument("--cache", required=True, type=Path)
    convert.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        if args.command == "fetch":
            key = os.environ.get("GBIS_SERVICE_KEY", "").strip()
            if not key and sys.stdin.isatty():
                key = getpass.getpass("GBIS service key (hidden): ")
            if not key:
                raise DataError("Set GBIS_SERVICE_KEY or run in a terminal for hidden key input.")
            source = fetch(args.cache, key)
            print(json.dumps({kind: meta["rows"] for kind, meta in source["files"].items()}))
        else:
            print(json.dumps(build_cache(args.cache, args.output)["counts"]))
    except (DataError, OSError, ValueError, KeyError, TypeError) as error:
        # Do not echo unknown exception text: network URLs may contain credentials.
        print(f"ERROR: {error if isinstance(error, DataError) else type(error).__name__}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

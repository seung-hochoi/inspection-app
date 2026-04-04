import argparse
import base64
import json
import time
import urllib.request
from datetime import datetime, timezone


TINY_PNG_BASE64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0r8AAAAASUVORK5CYII="
)


def post(url, payload, timeout=120):
    body = json.dumps(payload, ensure_ascii=True).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "text/plain;charset=utf-8"},
    )
    started = time.perf_counter()
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
        elapsed = (time.perf_counter() - started) * 1000
        return elapsed, json.loads(raw)


def get(url, timeout=120):
    started = time.perf_counter()
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
        elapsed = (time.perf_counter() - started) * 1000
        return elapsed, json.loads(raw)


def build_sample_job_rows():
    return [
        {
            "__id": "T1001-center-a-test-partner-0",
            "__index": 0,
            "__productCode": "T1001",
            "__productName": "TEST_APPLE",
            "__partner": "TEST_PARTNER",
            "__center": "CENTER_A",
            "__qty": 12,
            "__incomingCost": 1000,
            "productCode": "T1001",
            "productName": "TEST_APPLE",
            "partnerName": "TEST_PARTNER",
            "centerName": "CENTER_A",
            "totalQty": 12,
            "incomingCost": 1000,
        }
    ]


def build_inspection_row(job_key, operation_id):
    return {
        "operationId": operation_id,
        "jobKey": job_key,
        "productCode": "T1001",
        "productName": "TEST_APPLE",
        "partnerName": "TEST_PARTNER",
        "inspectionQty": 5,
        "returnQty": 0,
        "exchangeQty": 0,
        "totalQty": 12,
        "orderQty": 12,
        "memo": "benchmark",
        "expectedVersion": 0,
        "expectedUpdatedAt": "",
        "updatedBy": "benchmark",
        "updatedById": "benchmark-script",
    }


def build_movement_row(job_key, operation_id):
    return {
        "operationId": operation_id,
        "movementType": "RETURN",
        "jobKey": job_key,
        "productCode": "T1001",
        "productName": "TEST_APPLE",
        "partnerName": "TEST_PARTNER",
        "centerName": "CENTER_A",
        "returnQty": 2,
        "exchangeQty": 0,
        "qty": 2,
        "orderQty": 12,
        "memo": "benchmark movement",
        "expectedVersion": 0,
        "expectedUpdatedAt": "",
        "updatedBy": "benchmark",
        "updatedById": "benchmark-script",
    }


def build_photo_payload(job_key, operation_id):
    return {
        "operationId": operation_id,
        "itemKey": f"{job_key}||T1001||TEST_PARTNER",
        "photoKind": "inspection",
        "files": [
            {
                "fileName": "benchmark.png",
                "mimeType": "image/png",
                "imageBase64": TINY_PNG_BASE64,
            }
        ],
    }


def print_result(label, elapsed_ms, data):
    print(f"{label}: {elapsed_ms:.1f}ms")
    print(json.dumps(data, ensure_ascii=False)[:1200])
    print("-" * 80)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    args = parser.parse_args()

    exec_url = args.url
    now = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    job_key = f"perf_test_{now}"

    bootstrap_ms, bootstrap_data = get(f"{exec_url}?action=bootstrap")
    print_result("bootstrap", bootstrap_ms, {"ok": bootstrap_data.get("ok"), "job_key": ((bootstrap_data.get("data") or {}).get("current_job") or {}).get("job_key")})

    cache_ms, cache_data = post(
        exec_url,
        {
            "action": "cacheCsv",
            "payload": {
                "job_key": job_key,
                "source_file_name": f"{job_key}.csv",
                "source_file_modified": datetime.now(timezone.utc).isoformat(),
                "parsed_rows_base64": [
                    base64.b64encode(json.dumps(row, ensure_ascii=False).encode("utf-8")).decode("ascii")
                    for row in build_sample_job_rows()
                ],
            },
        },
    )
    print_result("cacheCsv", cache_ms, {"ok": cache_data.get("ok"), "job_key": (cache_data.get("job") or {}).get("job_key")})

    inspection_ms, inspection_data = post(
        exec_url,
        {
            "action": "saveBatch",
            "rows": [build_inspection_row(job_key, f"{job_key}_inspection_1")],
        },
    )
    print_result("saveBatch inspection", inspection_ms, inspection_data.get("data"))

    movement_ms, movement_data = post(
        exec_url,
        {
            "action": "saveBatch",
            "rows": [build_movement_row(job_key, f"{job_key}_movement_1")],
        },
    )
    print_result("saveBatch movement", movement_ms, movement_data.get("data"))

    sync_ms, sync_data = post(
        exec_url,
        {
            "action": "postSaveSync",
            "payload": {"hasInspection": True, "hasMovement": True},
        },
    )
    print_result("postSaveSync", sync_ms, {"ok": sync_data.get("ok"), "summary_keys": list((sync_data.get("data") or {}).keys())})

    photo_ms, photo_data = post(
        exec_url,
        {
            "action": "uploadPhotos",
            "payload": build_photo_payload(job_key, f"{job_key}_photo_1"),
        },
    )
    print_result("uploadPhotos", photo_ms, photo_data.get("data"))


if __name__ == "__main__":
    main()

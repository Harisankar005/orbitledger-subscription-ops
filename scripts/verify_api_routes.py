#!/usr/bin/env python3
"""
Route verification script.
Extracts every api.get/post/patch/delete/put call from frontend/src and
asserts that each corresponds to a valid operation in the live backend OpenAPI schema.
"""

import os
import re
import sys
from pathlib import Path


def get_project_root() -> Path:
    current = Path(__file__).resolve().parent
    while current != current.parent:
        if (current / "backend").exists() and (current / "frontend").exists():
            return current
        current = current.parent
    return Path(__file__).resolve().parent.parent


def extract_frontend_api_calls(frontend_src: Path):
    """
    Scans TypeScript files in frontend/src and extracts all api.(get|post|patch|delete|put) calls.
    Returns a list of dicts: {"file": str, "line": int, "method": str, "raw_url": str}
    """
    calls = []
    call_regex = re.compile(
        r'\bapi\.(get|post|patch|delete|put)\s*(?:<[^>]+>)?\s*\(\s*([`\'"])(.*?)\2',
        re.DOTALL
    )

    for root, _, files in os.walk(frontend_src):
        for f in files:
            if not f.endswith((".ts", ".tsx")):
                continue
            file_path = Path(root) / f
            try:
                content = file_path.read_text(encoding="utf-8")
            except Exception as e:
                print(f"Warning: could not read {file_path}: {e}", file=sys.stderr)
                continue

            for match in call_regex.finditer(content):
                method = match.group(1).lower()
                raw_url = match.group(3).strip()
                line_no = content[:match.start()].count("\n") + 1
                calls.append({
                    "file": str(file_path.relative_to(frontend_src.parent)),
                    "line": line_no,
                    "method": method,
                    "raw_url": raw_url,
                })

    return calls


def normalize_frontend_path(raw_url: str) -> str:
    """
    Normalize frontend URL string to OpenAPI route template format.
    Examples:
      '/subscriptions' -> '/api/subscriptions'
      '/subscriptions/${id}' -> '/api/subscriptions/{param}'
      `/subscriptions/${id}/renew` -> '/api/subscriptions/{param}/renew'
      '/invoices?status=all' -> '/api/invoices'
    """
    path = raw_url.split("?")[0].strip()

    # Normalize variable interpolations: ${...} -> {param}
    path = re.sub(r'\$\{[^}]+\}', '{param}', path)

    if not path.startswith("/"):
        path = "/" + path
    if not path.startswith("/api"):
        path = "/api" + path

    if path.endswith("/") and len(path) > 5:
        path = path.rstrip("/")

    return path


def load_openapi_schema(backend_dir: Path):
    """
    Imports FastAPI app from backend and generates openapi schema dict.
    """
    sys.path.insert(0, str(backend_dir))
    try:
        from app.main import app
        return app.openapi()
    except Exception as e:
        print(f"Error loading backend FastAPI app: {e}", file=sys.stderr)
        raise


def find_matching_route(frontend_norm_path: str, method: str, openapi_paths: dict) -> tuple[str | None, str | None]:
    """
    Finds the OpenAPI path that matches the normalized frontend path.
    Returns (matched_path, error_reason).
    """
    # 1. Direct exact match check
    if frontend_norm_path in openapi_paths:
        ops = openapi_paths[frontend_norm_path]
        if method in ops:
            return frontend_norm_path, None
        return frontend_norm_path, f"Method {method.upper()} not supported on {frontend_norm_path} (supported: {[m.upper() for m in ops]})"

    # 2. Segment-based match with parameter alignment
    frontend_parts = frontend_norm_path.strip("/").split("/")
    candidate_paths = []

    for openapi_path in openapi_paths:
        oa_parts = openapi_path.strip("/").split("/")
        if len(frontend_parts) != len(oa_parts):
            continue

        match = True
        for fp, op in zip(frontend_parts, oa_parts):
            op_is_param = op.startswith("{") and op.endswith("}")
            fp_is_param = fp.startswith("{") and fp.endswith("}")

            if fp_is_param and op_is_param:
                continue
            elif not fp_is_param and not op_is_param and fp == op:
                continue
            else:
                match = False
                break

        if match:
            candidate_paths.append(openapi_path)

    if not candidate_paths:
        return None, f"Path '{frontend_norm_path}' not found in OpenAPI schema"

    # Check candidates for one that supports the requested method
    for cand in candidate_paths:
        ops = openapi_paths[cand]
        if method in ops:
            return cand, None

    # None supported the method
    first_cand = candidate_paths[0]
    ops = openapi_paths[first_cand]
    return first_cand, f"Method {method.upper()} not supported on {first_cand} (supported: {[m.upper() for m in ops]})"


def main():
    root = get_project_root()
    frontend_src = root / "frontend" / "src"
    backend_dir = root / "backend"

    print(f"Scanning frontend calls in: {frontend_src}")
    calls = extract_frontend_api_calls(frontend_src)
    print(f"Found {len(calls)} API calls in frontend.")

    print(f"Loading live OpenAPI schema from: {backend_dir}")
    schema = load_openapi_schema(backend_dir)
    openapi_paths = schema.get("paths", {})
    print(f"Found {len(openapi_paths)} paths in OpenAPI schema.")

    unmatched = []
    matched = []

    for call in calls:
        raw_url = call["raw_url"]
        method = call["method"]

        # Skip non-API or external links if any
        if raw_url.startswith("http://") or raw_url.startswith("https://"):
            continue

        norm_path = normalize_frontend_path(raw_url)
        matched_path, error_reason = find_matching_route(norm_path, method, openapi_paths)

        if error_reason or not matched_path:
            unmatched.append({
                **call,
                "norm_path": norm_path,
                "matched_path": matched_path,
                "reason": error_reason,
            })
            continue

        matched.append((method.upper(), matched_path, call["file"]))

    print(f"\nVerification Results:")
    print(f"  Total matched operations: {len(matched)}")
    print(f"  Total unmatched operations: {len(unmatched)}")

    if unmatched:
        print("\nERROR: The following frontend API calls do not match the live OpenAPI schema:\n", file=sys.stderr)
        for u in unmatched:
            print(f"  - {u['file']}:{u['line']}", file=sys.stderr)
            print(f"    Call: api.{u['method']}('{u['raw_url']}')", file=sys.stderr)
            print(f"    Normalized: {u['norm_path']}", file=sys.stderr)
            print(f"    Reason: {u['reason']}\n", file=sys.stderr)
        sys.exit(1)

    print("\nSUCCESS: All frontend API calls match valid OpenAPI operations!")
    sys.exit(0)


if __name__ == "__main__":
    main()

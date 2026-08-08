#!/usr/bin/env python3
import json
import os
import re
import sys
import tomllib
import urllib.parse
import urllib.request
from pathlib import Path

UPSTREAM_REPOSITORY = "NousResearch/hermes-agent"
GITHUB_API = f"https://api.github.com/repos/{UPSTREAM_REPOSITORY}"
PACKAGE_JSON = Path("package.json")
SEMVER = re.compile(
    r"(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){2}"
    r"(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?"
)
TAG_NAME = re.compile(r"v[A-Za-z0-9][A-Za-z0-9._-]*")
COMMIT_SHA = re.compile(r"[0-9a-f]{40}")


def request_headers():
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "hermes-agent-npm-sync",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def fetch_json(url):
    request = urllib.request.Request(url, headers=request_headers())
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_text(url):
    request = urllib.request.Request(url, headers=request_headers())
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8")


def fetch_latest_release():
    release = fetch_json(f"{GITHUB_API}/releases/latest")
    tag_name = release.get("tag_name", "")
    if release.get("draft") or release.get("prerelease"):
        raise ValueError("GitHub latest release unexpectedly points to a draft or prerelease")
    if not TAG_NAME.fullmatch(tag_name):
        raise ValueError(f"GitHub latest release contains an invalid tag name: {tag_name!r}")
    return release


def resolve_tag_commit(tag_name):
    encoded_tag = urllib.parse.quote(tag_name, safe="")
    ref = fetch_json(f"{GITHUB_API}/git/ref/tags/{encoded_tag}")
    git_object = ref.get("object", {})
    seen = set()

    while git_object.get("type") == "tag":
        sha = git_object.get("sha", "")
        if not COMMIT_SHA.fullmatch(sha) or sha in seen:
            raise ValueError(f"Invalid or cyclic annotated tag object for {tag_name}")
        seen.add(sha)
        tag = fetch_json(f"{GITHUB_API}/git/tags/{sha}")
        git_object = tag.get("object", {})

    commit = git_object.get("sha", "")
    if git_object.get("type") != "commit" or not COMMIT_SHA.fullmatch(commit):
        raise ValueError(f"Tag {tag_name} does not resolve to a full commit SHA")
    return commit


def fetch_project_metadata(commit):
    url = f"https://raw.githubusercontent.com/{UPSTREAM_REPOSITORY}/{commit}/pyproject.toml"
    project = tomllib.loads(fetch_text(url)).get("project", {})
    version = project.get("version")
    description = project.get("description") or "Hermes Agent from Nous Research"
    if not version or not SEMVER.fullmatch(version):
        raise ValueError(f"Upstream project.version is not valid npm semver: {version!r}")
    return version, description


def main():
    release = fetch_latest_release()
    tag_name = release["tag_name"]
    commit = resolve_tag_commit(tag_name)
    version, description = fetch_project_metadata(commit)

    expected = {
        "tag": os.environ.get("EXPECTED_UPSTREAM_TAG"),
        "commit": os.environ.get("EXPECTED_UPSTREAM_COMMIT"),
        "version": os.environ.get("EXPECTED_UPSTREAM_VERSION"),
    }
    actual = {"tag": tag_name, "commit": commit, "version": version}
    for key, expected_value in expected.items():
        if expected_value and expected_value != actual[key]:
            raise ValueError(
                f"Latest upstream Release changed during the workflow: "
                f"expected {key} {expected_value!r}, received {actual[key]!r}"
            )

    package = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    package["version"] = version
    package["description"] = f"Unofficial npm bridge for Hermes Agent {version}: {description}"
    metadata = package.setdefault("hermesAgent", {})
    metadata.pop("pythonPackageVersion", None)
    metadata.update(
        {
            "upstreamVersion": version,
            "upstreamRepository": UPSTREAM_REPOSITORY,
            "upstreamGitTag": tag_name,
            "upstreamCommit": commit,
            "pythonVersion": "3.11",
            "runtimeDirectory": "runtime/hermes-agent",
        }
    )

    PACKAGE_JSON.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")
    print(f"version={version}")
    print(f"upstream_tag={tag_name}")
    print(f"upstream_commit={commit}")
    print(f"upstream_release_url={release.get('html_url', '')}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Failed to sync GitHub Release metadata: {error}", file=sys.stderr)
        sys.exit(1)

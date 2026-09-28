#!/usr/bin/env python3
"""Fail closed on common secrets and sensitive filenames in Git's staging area."""

from pathlib import PurePosixPath
import re
import subprocess
import sys


SENSITIVE = re.compile(r"(?i)(?:^|/)(?:\.env(?:\..+)?|\.envrc|credentials\.json|secrets?\.json|\.secrets)(?:$|/)|\.(?:pem|key|p12|pfx|jks|keystore)$")
PATTERNS = (
    re.compile(rb"(?i)(?:password|passwd|secret|api[_-]?key|access[_-]?token)[ \t]*[:=][ \t]*['\"][^'\"]{8,}['\"]"),
    re.compile(rb"(?i)(?:postgres(?:ql)?|mongodb(?:\+srv)?|mysql|redis)://[^\s:@]+:[^\s@]+@"),
    re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(rb"(?:ghp_[A-Za-z0-9]{36}|glpat-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})"),
)


def git(*args: str) -> bytes:
    return subprocess.run(("git", *args), check=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout


def main() -> int:
    try:
        names = git("diff", "--cached", "--name-only", "--diff-filter=ACM", "-z").split(b"\0")
        findings = []
        for encoded in filter(None, names):
            name = encoded.decode("utf-8", "surrogateescape")
            if ((SENSITIVE.search(name) and name != ".env.example")
                    or PurePosixPath(name).name == "fw_api.txt"
                    or name.startswith("dataset/")):
                findings.append(f"{name}: sensitive filename")
                continue
            content = git("show", ":" + name)
            if b"\0" in content:
                continue
            for number, line in enumerate(content.splitlines(), 1):
                if any(pattern.search(line) for pattern in PATTERNS):
                    findings.append(f"{name}:{number}: possible secret")
        if findings:
            print("Commit blocked by staged secret scan (matches not printed):", file=sys.stderr)
            for finding in findings:
                print(f"  {finding}", file=sys.stderr)
            return 1
        print("Staged secret scan clean.")
        return 0
    except (OSError, subprocess.CalledProcessError):
        print("Staged secret scan could not finish; commit blocked.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

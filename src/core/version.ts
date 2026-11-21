/** Comparaison simple de versions `x.y.z`, sans pré-release. */
export function compareVersions(first: string, second: string): number {
  const parse = (value: string) =>
    value
      .split("-")[0]
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(first);
  const right = parse(second);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function latestVersion<T extends { version: string }>(
  versions: readonly T[],
): T | undefined {
  return [...versions].sort((first, second) =>
    compareVersions(second.version, first.version),
  )[0];
}

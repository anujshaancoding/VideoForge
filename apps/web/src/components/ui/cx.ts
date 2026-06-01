// Tiny className combiner — joins truthy class fragments. Avoids pulling in clsx.
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

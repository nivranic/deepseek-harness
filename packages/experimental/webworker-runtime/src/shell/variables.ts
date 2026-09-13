/** Shell names are data keys, including names inherited by ordinary JavaScript objects. */

/**
 * Copy own exported or local variables into an independent dictionary without inherited names or setters.
 * @param sources - variable dictionaries, with later own entries replacing earlier values.
 * @returns a mutable null-prototype dictionary for one shell scope.
 */
export function copyShellVariables(...sources: Readonly<Record<string, string>>[]): Record<string, string> {
  const variables = Object.create(null) as Record<string, string>
  Object.assign(variables, ...sources)
  return variables
}

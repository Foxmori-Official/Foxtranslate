/** Match placeholders in one pass without letting adjacent tokens eat one another's underscores. */
export function replacePlaceholders(
  text: string,
  replace: (kind: string, serial: string) => string | undefined,
): string {
  return text.replace(
    /(?:_\s*){1,4}(GLOSSARY|PII[_\s]+(?:KEY|EMAIL|IDCARD|PHONE|CARD))[_\s]+(\d+)(?:\s*_(?!\s*(?:PII|GLOSSARY)[_\s])){0,2}/gi,
    (match, kind: string, serial: string) => replace(kind.toUpperCase().replace(/[_\s]+/g, '_'), serial) ?? match,
  )
}

export interface RestorationEntity {
  serial: number
  value: string
  type?: string
}

/** Restored values are inserted literally. They cannot be interpreted as another kind of token. */
export function restorePlaceholders(text: string, sensitive: RestorationEntity[], terms: RestorationEntity[]): string {
  if (!text || (!sensitive.length && !terms.length)) return text
  const values = new Map(sensitive.map(({ type, serial, value }) => [`PII_${type}_${serial}`, value]))
  const glossary = new Map(terms.map(({ serial, value }) => [String(serial), value]))
  return replacePlaceholders(text, (kind, serial) => {
    if (kind === 'GLOSSARY') return glossary.get(serial)
    const key = `${kind}_${serial}`
    const value = values.get(key)
    // Every sensitive occurrence in the source has a separate token; do not multiply it.
    values.delete(key)
    return value
  })
}

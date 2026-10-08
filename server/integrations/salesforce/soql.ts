// Underscore is allowed: inside a quoted equality literal it is a literal
// character (it is only a wildcard inside LIKE), and governed codes such as
// Geography_Code__c = 'OVERALL_MARKET' contain it.
const SAFE_VALUE = /^[\p{L}\p{N} .,&'()+\-/_]+$/u;

export function soqlLiteral(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 120 || !SAFE_VALUE.test(normalized)) {
    throw new Error(`${label} contains unsupported characters.`);
  }
  return `'${normalized.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export function soqlLiteralList(values: readonly string[], label: string) {
  if (!values.length) throw new Error(`${label} must not be empty.`);
  return `(${values.map((value) => soqlLiteral(value, label)).join(", ")})`;
}

export function selectQuery(
  objectName: string,
  fields: readonly string[],
  where: string,
  suffix = "",
) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(objectName))
    throw new Error("Unsafe Salesforce object name.");
  if (
    !fields.length ||
    fields.some((field) => !/^[A-Za-z][A-Za-z0-9_.]*$/.test(field))
  ) {
    throw new Error("Unsafe Salesforce field mapping.");
  }
  return `SELECT ${fields.join(", ")} FROM ${objectName} WHERE ${where}${suffix}`;
}

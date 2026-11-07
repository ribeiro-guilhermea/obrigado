// WhatsApp brasileiro com DDD. Guarda no formato 55DDNNNNNNNNN (só números).

const VALID_DDD = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92,
  93, 94, 95, 96, 97, 98, 99,
]);

/** Retorna o número normalizado (ex.: "5511987654321") ou null se inválido. */
export function normalizeBrPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let d = String(input).replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1); // 0 + DDD + número fixo
  if (d.length !== 10 && d.length !== 11) return null;
  const ddd = Number(d.slice(0, 2));
  if (!VALID_DDD.has(ddd)) return null;
  const n = d.slice(2);
  if (n.length === 9 && n[0] !== "9") return null;
  if (n.length === 8 && !/[2-9]/.test(n[0])) return null;
  return "55" + d;
}

/** "(11) 98765-4321" */
export function formatBrPhone(norm: string): string {
  const d = norm.startsWith("55") ? norm.slice(2) : norm;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return norm;
}

export function waLink(norm: string): string {
  return `https://wa.me/${norm.replace(/\D/g, "")}`;
}

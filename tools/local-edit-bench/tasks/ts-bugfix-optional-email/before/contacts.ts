export interface Contact {
  name: string;
  email?: string;
  phone?: string;
}

export function contactLine(c: Contact): string {
  return `${c.name} <${c.email!.toLowerCase()}>`;
}

export function phoneDigits(c: Contact): string {
  return (c.phone ?? '').replace(/\D/g, '');
}

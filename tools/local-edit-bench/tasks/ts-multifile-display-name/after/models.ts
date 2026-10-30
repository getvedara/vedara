export interface User {
  id: number;
  displayName: string;
  email: string;
  active: boolean;
}

export function makeUser(id: number, displayName: string, email: string): User {
  return { id, displayName: displayName.trim(), email: email.toLowerCase(), active: true };
}

export function initials(user: User): string {
  return user.displayName
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase())
    .join('');
}

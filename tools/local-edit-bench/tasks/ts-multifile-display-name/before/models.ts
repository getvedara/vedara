export interface User {
  id: number;
  userName: string;
  email: string;
  active: boolean;
}

export function makeUser(id: number, userName: string, email: string): User {
  return { id, userName: userName.trim(), email: email.toLowerCase(), active: true };
}

export function initials(user: User): string {
  return user.userName
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase())
    .join('');
}

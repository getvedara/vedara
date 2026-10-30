import { initials, type User } from './models.ts';

export class Directory {
  private users = new Map<number, User>();

  add(user: User): void {
    this.users.set(user.id, user);
  }

  findByName(query: string): User[] {
    const q = query.toLowerCase();
    return [...this.users.values()].filter((u) => u.userName.toLowerCase().includes(q));
  }

  listing(): string[] {
    return [...this.users.values()]
      .filter((u) => u.active)
      .sort((a, b) => a.userName.localeCompare(b.userName))
      .map((u) => `${initials(u)}  ${u.userName} <${u.email}>`);
  }
}

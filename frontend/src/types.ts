export type Membership = { id: number; name: string; gstin?: string | null; role: string };
export type User = { id: number; full_name: string; email: string; memberships: Membership[] };
export type AuthResponse = { access_token: string; token_type: string; expires_in: number; user: User };

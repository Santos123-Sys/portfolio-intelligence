import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireSession, type AuthContext } from './auth';

export async function requirePageSession(): Promise<AuthContext> {
  const cookieHeader = (await cookies()).toString();
  try {
    return await requireSession(new Request('http://dashboard.internal', {
      headers: { cookie: cookieHeader },
    }));
  } catch {
    redirect('/login');
  }
}

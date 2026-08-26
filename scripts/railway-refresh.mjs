const baseUrl = process.env.DASHBOARD_INTERNAL_URL;
const secret = process.env.CRON_SECRET;

if (!baseUrl || !secret) {
  throw new Error('DASHBOARD_INTERNAL_URL and CRON_SECRET are required');
}

const response = await fetch(new URL('/api/cron/refresh', baseUrl), {
  headers: { authorization: `Bearer ${secret}` },
});
const body = await response.text();
if (!response.ok) throw new Error(`Dashboard refresh failed (${response.status}): ${body.slice(0, 500)}`);
console.log(body);

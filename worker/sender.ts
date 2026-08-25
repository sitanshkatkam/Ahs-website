import { sendPoke, VapidSigner, type PushSubscriptionRecord } from './push';

/**
 * The push fan-out worker.
 *
 * It exists for one reason. A Worker invocation on the free plan may make 50
 * subrequests, and every push send is one — so a single cron tick can notify
 * about 45 students before Cloudflare refuses the rest with "Too many
 * subrequests by single Worker invocation". School bells ring simultaneously,
 * so that is not a queue that drains: it is a wall roughly 250 students high,
 * beyond which people silently stop getting alerts.
 *
 * A service binding call is not a subrequest, and it starts a *new* invocation
 * with its own budget. So the cron shards the due devices and hands each shard
 * here. Measured on the free plan: 40 shards × 45 sends = 1,800 pushes from one
 * tick, no failures, where a single invocation dies at 51.
 *
 * Signing moves here too, and that matters as much as the sends. A VAPID JWT is
 * real CPU work, and the free plan gives a cron invocation 10ms of it. Spread
 * across shards, each one signs only for the push services in its own slice.
 */

export type SenderEnv = {
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
};

export type Shard = {
  subs: { endpoint: string; p256dh: string; auth: string }[];
};

export type ShardResult = {
  sent: number;
  /** Endpoints the push service says are dead, for the caller to prune. */
  gone: string[];
};

export default {
  async fetch(request: Request, env: SenderEnv): Promise<Response> {
    if (request.method !== 'POST') {
      return Response.json({ error: 'method not allowed' }, { status: 405 });
    }

    let body: Shard;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'invalid json' }, { status: 400 });
    }
    if (!Array.isArray(body.subs)) {
      return Response.json({ error: 'invalid shard' }, { status: 400 });
    }

    const signer = new VapidSigner(
      env.VAPID_PRIVATE_KEY,
      env.VAPID_PUBLIC_KEY,
      env.VAPID_SUBJECT,
    );

    const gone: string[] = [];
    let sent = 0;

    // Sequential within a shard. The shard is already sized to the subrequest
    // budget, and fanning out hundreds of TLS handshakes at once inside one
    // invocation is the fastest way through the CPU limit.
    for (const s of body.subs) {
      const record: PushSubscriptionRecord = {
        endpoint: s.endpoint,
        keys: { p256dh: s.p256dh, auth: s.auth },
      };
      const result = await sendPoke(record, signer);
      if (result === 'gone') gone.push(s.endpoint);
      else sent++;
    }

    return Response.json({ sent, gone } satisfies ShardResult);
  },
};
